#!/usr/bin/env python3
"""Extract DOCX to extended Markdown without losing mobile-reading rhythm."""

from __future__ import annotations

import argparse
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def property_enabled(properties, name):
    element = properties.find(f"{W}{name}") if properties is not None else None
    if element is None:
        return None
    return (element.get(f"{W}val") or "1") not in {"0", "false", "none"}


def load_styles(archive):
    levels = {}
    character_styles = {}
    try:
        root = ET.fromstring(archive.read("word/styles.xml"))
    except KeyError:
        return levels, character_styles
    for style in root.iter(f"{W}style"):
        style_id = style.get(f"{W}styleId") or ""
        name_el = style.find(f"{W}name")
        name = (name_el.get(f"{W}val") if name_el is not None else "") or ""
        if style.get(f"{W}type") == "character":
            properties = style.find(f"{W}rPr")
            character_styles[style_id] = {
                "bold": property_enabled(properties, "b"),
                "underline": property_enabled(properties, "u"),
            }
        match = re.search(r"(?:heading|标题)\s*([1-6])", name, re.I) or re.fullmatch(
            r"([1-6])", style_id
        )
        if match:
            levels[style_id] = int(match.group(1))
    return levels, character_styles


def load_relationships(archive):
    relationships = {}
    try:
        root = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    except KeyError:
        return relationships
    for relation in root:
        target = relation.get("Target") or ""
        if "media/" in target:
            relationships[relation.get("Id")] = (
                "word/" + target.lstrip("/").replace("../", "")
            )
    return relationships


def run_text(run, character_styles):
    pieces = []
    for node in run.iter():
        if node.tag == f"{W}t":
            pieces.append(node.text or "")
        elif node.tag in {f"{W}br", f"{W}cr"}:
            pieces.append("<br>\n")
        elif node.tag == f"{W}tab":
            pieces.append("\t")
    text = "".join(pieces)
    if not text:
        return ""
    properties = run.find(f"{W}rPr")
    style_el = properties.find(f"{W}rStyle") if properties is not None else None
    style_id = style_el.get(f"{W}val") if style_el is not None else ""
    inherited = character_styles.get(style_id, {})
    direct_bold = property_enabled(properties, "b")
    direct_underline = property_enabled(properties, "u")
    bold = inherited.get("bold") if direct_bold is None else direct_bold
    underline = (
        inherited.get("underline") if direct_underline is None else direct_underline
    )
    if bold:
        text = f"**{text}**"
    if underline:
        text = f"<u>{text}</u>"
    return text


def paragraph_text(paragraph, character_styles):
    text = "".join(
        run_text(run, character_styles) for run in paragraph.findall(f".//{W}r")
    )
    return re.sub(r"\*\*\*\*", "", text)


def paragraph_directives(properties):
    if properties is None:
        return []
    directives = []
    spacing = properties.find(f"{W}spacing")
    if spacing is not None:
        values = []
        for source, target in (
            ("before", "before"),
            ("after", "after"),
            ("line", "line"),
            ("lineRule", "line-rule"),
        ):
            value = spacing.get(f"{W}{source}")
            if value not in (None, "", "0"):
                values.append(f"{target}={value}")
        if values:
            directives.append(f"<!-- wechat:spacing {' '.join(values)} -->")
    layout = []
    alignment = properties.find(f"{W}jc")
    if alignment is not None and alignment.get(f"{W}val"):
        layout.append(f"align={alignment.get(f'{W}val')}")
    indentation = properties.find(f"{W}ind")
    if indentation is not None:
        for source, target in (
            ("left", "left"),
            ("right", "right"),
            ("firstLine", "first-line"),
            ("hanging", "hanging"),
        ):
            value = indentation.get(f"{W}{source}")
            if value not in (None, "", "0"):
                layout.append(f"{target}={value}")
    if layout:
        directives.append(f"<!-- wechat:paragraph {' '.join(layout)} -->")
    return directives


def extract_table(table):
    rows = []
    for row in table.findall(f"{W}tr"):
        cells = []
        for cell in row.findall(f"{W}tc"):
            value = "".join(node.text or "" for node in cell.iter(f"{W}t"))
            cells.append(value.strip().replace("|", "\\|") or " ")
        rows.append("| " + " | ".join(cells) + " |")
    if not rows:
        return []
    columns = rows[0].count("|") - 1
    return [rows[0], "|" + "---|" * columns, *rows[1:], ""]


def extract(docx_path, output_path):
    try:
        archive = zipfile.ZipFile(docx_path)
        document = ET.fromstring(archive.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as error:
        print(f"✗ 不是合法 DOCX：{error}", file=sys.stderr)
        return 1

    heading_levels, character_styles = load_styles(archive)
    media = load_relationships(archive)
    output_dir = os.path.dirname(os.path.abspath(output_path)) or "."
    image_dir = os.path.join(output_dir, "images")
    lines = []
    image_count = table_count = blank_count = break_count = 0

    body = document.find(f"{W}body")
    if body is None:
        print("✗ DOCX 没有 document body", file=sys.stderr)
        return 1

    for element in body:
        if element.tag == f"{W}tbl":
            table_lines = extract_table(element)
            if table_lines:
                table_count += 1
                lines.extend(table_lines)
            continue
        if element.tag != f"{W}p":
            continue

        paragraph = element
        image_found = False
        for blip in paragraph.iter(f"{A}blip"):
            source = media.get(blip.get(f"{R}embed"))
            if not source:
                continue
            os.makedirs(image_dir, exist_ok=True)
            image_count += 1
            filename = f"{image_count:02d}-" + os.path.basename(source)
            with open(os.path.join(image_dir, filename), "wb") as image_file:
                image_file.write(archive.read(source))
            lines.extend([f"![](images/{filename})", ""])
            image_found = True

        text = paragraph_text(paragraph, character_styles)
        break_count += text.count("<br>")
        properties = paragraph.find(f"{W}pPr")
        if not text.strip():
            if not image_found:
                lines.extend(["<!-- wechat:blank -->", ""])
                blank_count += 1
            continue

        lines.extend(paragraph_directives(properties))
        style_el = properties.find(f"{W}pStyle") if properties is not None else None
        style_id = style_el.get(f"{W}val") if style_el is not None else ""
        level = heading_levels.get(style_id)
        is_list = (
            properties is not None and properties.find(f"{W}numPr") is not None
        ) or bool(re.search(r"list|列表", style_id or "", re.I))
        if level:
            clean = re.sub(r"^\*\*(.*)\*\*$", r"\1", text.strip())
            lines.append("#" * min(level, 6) + " " + clean)
        elif is_list:
            lines.append("- " + text)
        else:
            lines.append(text)
        lines.append("")

    markdown = "\n".join(lines).rstrip() + "\n"
    with open(output_path, "w", encoding="utf-8") as output_file:
        output_file.write(markdown)
    print(f"✓ {os.path.basename(docx_path)} → {output_path}")
    print(
        f"  图片 {image_count} · 表格 {table_count} · "
        f"空白段落 {blank_count} · 手动换行 {break_count}"
    )
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("docx")
    parser.add_argument("-o", "--out", help="输出 Markdown 路径")
    args = parser.parse_args()
    if not os.path.isfile(args.docx):
        print(f"✗ 文件不存在：{args.docx}", file=sys.stderr)
        return 1
    output = args.out or re.sub(r"\.docx$", "", args.docx, flags=re.I) + ".md"
    return extract(args.docx, output)


if __name__ == "__main__":
    sys.exit(main())
