#!/usr/bin/env python3
"""Extract reusable visual tokens and component patterns from historical HTML."""

from __future__ import annotations

import argparse
import collections
import html
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

COLOR = re.compile(
    r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|transparent)\b",
    re.I,
)
INTERESTING = {
    "color",
    "background",
    "background-color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "margin",
    "margin-top",
    "margin-bottom",
    "padding",
    "padding-top",
    "padding-bottom",
    "border",
    "border-left",
    "border-radius",
    "box-shadow",
}


def parse_style(value):
    declarations = {}
    for item in value.split(";"):
        if ":" not in item:
            continue
        key, raw = item.split(":", 1)
        key = key.strip().lower()
        raw = raw.strip()
        if key and raw:
            declarations[key] = raw
    return declarations


def style_signature(style):
    return ";".join(f"{key}:{style[key]}" for key in sorted(style) if key in INTERESTING)


def infer_role(tag, attrs, style):
    marker = " ".join(
        [tag, attrs.get("class", ""), attrs.get("id", ""), attrs.get("data-role", "")]
    ).lower()
    if tag in {"h1", "h2", "h3", "h4", "h5", "h6"} or any(
        word in marker for word in ("title", "heading", "headline", "chapter")
    ):
        return "标题"
    if tag == "blockquote" or any(word in marker for word in ("quote", "blockquote", "callout")):
        return "引用/提示"
    if tag in {"ul", "ol", "li"} or "list" in marker:
        return "列表"
    if tag in {"img", "figure", "figcaption"} or any(
        word in marker for word in ("image", "media", "figure", "video")
    ):
        return "图片/媒体"
    if tag in {"pre", "code"} or "code" in marker:
        return "代码"
    if tag in {"table", "tr", "td", "th"} or any(
        word in marker for word in ("table", "data", "metric")
    ):
        return "数据/表格"
    if tag == "a" or any(word in marker for word in ("cta", "button", "download")):
        return "CTA/链接"
    if any(word in marker for word in ("author", "profile", "footer", "ending")):
        return "作者/结尾"
    if style.get("font-weight") in {"600", "700", "800", "900", "bold"}:
        return "强调"
    if tag in {"p", "span", "strong", "em"}:
        return "正文/行内"
    return "容器"


class ThemeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.properties = collections.defaultdict(collections.Counter)
        self.colors = collections.Counter()
        self.roles = collections.defaultdict(collections.Counter)
        self.tags = collections.Counter()

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        style = parse_style(attributes.get("style", ""))
        self.tags[tag] += 1
        for key, value in style.items():
            if key in INTERESTING:
                self.properties[key][value] += 1
            for color in COLOR.findall(value):
                self.colors[color.lower()] += 1
        signature = style_signature(style)
        if signature:
            role = infer_role(tag, attributes, style)
            self.roles[role][f"<{tag} style=\"{signature}\">"] += 1


def html_files(inputs):
    found = []
    for value in inputs:
        path = Path(value)
        if path.is_dir():
            found.extend(sorted(path.rglob("*.html")))
            found.extend(sorted(path.rglob("*.htm")))
        elif path.is_file() and path.suffix.lower() in {".html", ".htm"}:
            found.append(path)
    unique = []
    seen = set()
    for path in found:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(path)
    return unique


def top(counter, count=8):
    return counter.most_common(count)


def render_report(files, parser):
    lines = [
        "# 历史 HTML 主题分析",
        "",
        f"样本数量：{len(files)}",
        "",
        "## 高频设计变量",
        "",
        "### 颜色",
        "",
        "| 值 | 次数 |",
        "|---|---:|",
    ]
    lines.extend(f"| `{value}` | {count} |" for value, count in top(parser.colors, 12))
    for property_name in (
        "font-family",
        "font-size",
        "font-weight",
        "line-height",
        "border-radius",
        "box-shadow",
        "text-align",
    ):
        values = top(parser.properties[property_name], 8)
        if not values:
            continue
        lines.extend(["", f"### `{property_name}`", "", "| 值 | 次数 |", "|---|---:|"])
        lines.extend(f"| `{html.escape(value)}` | {count} |" for value, count in values)
    lines.extend(["", "## 高频组件模式", ""])
    for role in sorted(parser.roles):
        lines.extend([f"### {role}", "", "| 样式骨架 | 次数 |", "|---|---:|"])
        lines.extend(
            f"| `{html.escape(signature)}` | {count} |"
            for signature, count in top(parser.roles[role], 6)
        )
        lines.append("")
    lines.extend(
        [
            "## 生成主题时的处理",
            "",
            "- 使用高频值建立设计变量，不照搬偶发样式。",
            "- 将同一语义下的相近样式合并为一个主组件和少量变体。",
            "- 从样本中提取骨架与节奏，不复制正文、姓名、品牌或业务数据。",
            "- 按公众号平台约束改写组件，并补齐 `<span leaf=\"\">`。",
            "- 生成主题后登记到 `theme-index.md`，运行组件检查和历史文章回归。",
            "",
            "## 样本文件",
            "",
        ]
    )
    lines.extend(f"- `{path}`" for path in files)
    return "\n".join(lines) + "\n"


def main():
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("inputs", nargs="+", help="HTML 文件或目录")
    argument_parser.add_argument("--out", type=Path, required=True)
    args = argument_parser.parse_args()
    files = html_files(args.inputs)
    if not files:
        print("✗ 没有找到 HTML 文件", file=sys.stderr)
        return 1
    parser = ThemeParser()
    for path in files:
        parser.feed(path.read_text(encoding="utf-8", errors="replace"))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render_report(files, parser), encoding="utf-8")
    print(f"✓ 分析 {len(files)} 篇 HTML → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
