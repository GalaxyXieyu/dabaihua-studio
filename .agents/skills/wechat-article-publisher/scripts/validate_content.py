#!/usr/bin/env python3
"""Validate the mutation contract between two article artifacts."""

from __future__ import annotations

import argparse
import html
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
PUNCTUATION = set("，。；：、？！“”‘’《》（）〔〕【】———…·,.!?;:'\"()[]{}-–—")


class VisibleTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_depth = 0
        self.generated_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "head", "title"}:
            self.skip_depth += 1
        elif tag == "br" and not self.skip_depth and not self.generated_depth:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "head", "title"} and self.skip_depth:
            self.skip_depth -= 1
        elif tag in {"p", "section", "h1", "h2", "h3", "li", "blockquote"}:
            if not self.skip_depth and not self.generated_depth:
                self.parts.append("\n")

    def handle_comment(self, data):
        marker = data.strip().lower()
        if marker == "generated:start":
            self.generated_depth += 1
        elif marker == "generated:end" and self.generated_depth:
            self.generated_depth -= 1

    def handle_data(self, data):
        if not self.skip_depth and not self.generated_depth:
            self.parts.append(data)


def docx_text(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    paragraphs = []
    for paragraph in root.iter(f"{W}p"):
        parts = []
        for node in paragraph.iter():
            if node.tag == f"{W}t":
                parts.append(node.text or "")
            elif node.tag in {f"{W}br", f"{W}cr"}:
                parts.append("\n")
            elif node.tag == f"{W}tab":
                parts.append("\t")
        paragraphs.append("".join(parts))
    return "\n\n".join(paragraphs)


def markdown_text(value, ignore_title=False):
    value = re.sub(r"\A---\s*\n.*?\n---\s*\n", "", value, flags=re.S)
    if ignore_title:
        value = re.sub(r"^\s{0,3}#\s+.*(?:\n|$)", "", value, count=1, flags=re.M)
    value = re.sub(r"<!--\s*wechat:[\s\S]*?-->", "\n", value, flags=re.I)
    value = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"^\s{0,3}#{1,6}\s+", "", value, flags=re.M)
    value = re.sub(r"^\s*(?:[-*+] |\d+[.)] )", "", value, flags=re.M)
    value = re.sub(r"^\s*>\s?", "", value, flags=re.M)
    value = value.replace("<br>", "\n").replace("<br/>", "\n")
    value = re.sub(r"</?(?:u|strong|em|code)[^>]*>", "", value, flags=re.I)
    value = re.sub(r"(?<!\\)(\*\*|__|~~|==|`)", "", value)
    return html.unescape(value)


def read_visible(path, ignore_title=False):
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return docx_text(path)
    value = path.read_text(encoding="utf-8", errors="replace")
    if suffix in {".html", ".htm"}:
        parser = VisibleTextParser()
        parser.feed(value)
        return "".join(parser.parts)
    if suffix in {".md", ".markdown"}:
        return markdown_text(value, ignore_title=ignore_title)
    return value


def normalize(value, mode):
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    if mode == "punctuation":
        return "".join(character for character in value if character not in PUNCTUATION)
    if mode in {"layout", "render"}:
        return re.sub(r"\s+", "", value)
    raise ValueError(mode)


def first_difference(left, right):
    limit = min(len(left), len(right))
    for index in range(limit):
        if left[index] != right[index]:
            return index
    return limit


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("punctuation", "layout", "render"), required=True)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument(
        "--ignore-source-title",
        action="store_true",
        help="render 模式下允许 Markdown 一级标题只作为公众号平台标题",
    )
    args = parser.parse_args()
    if args.ignore_source_title and args.mode != "render":
        parser.error("--ignore-source-title 只能用于 render 模式")
    before = normalize(
        read_visible(args.before, ignore_title=args.ignore_source_title), args.mode
    )
    after = normalize(read_visible(args.after), args.mode)
    if before == after:
        print(f"✓ {args.mode} 内容合同通过")
        return 0
    index = first_difference(before, after)
    start = max(0, index - 24)
    end = index + 24
    print(f"✗ {args.mode} 内容合同失败，首个差异位置：{index}", file=sys.stderr)
    print(f"原稿：{before[start:end]!r}", file=sys.stderr)
    print(f"结果：{after[start:end]!r}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
