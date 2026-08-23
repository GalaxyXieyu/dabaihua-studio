#!/usr/bin/env python3
"""Render Aige 14 frozen Markdown with the registered Zen Whitespace components."""

from __future__ import annotations

import argparse
import html
import re
from pathlib import Path


BLANK = "<!-- wechat:blank -->"
SECTION_NUMBERS = set("一二三四五六七八九十")


def leaf(text: str) -> str:
    return f'<span leaf="">{html.escape(text)}</span>'


def inline(value: str) -> str:
    parts = []
    for token in re.split(r"(\*\*.*?\*\*)", value):
        if not token:
            continue
        if token.startswith("**") and token.endswith("**"):
            parts.append(
                '<strong style="color:#2B2B2B;font-weight:600;">'
                + leaf(token[2:-2])
                + "</strong>"
            )
        else:
            parts.append(leaf(token))
    return "".join(parts)


def paragraph_content(block: str) -> str:
    lines = block.split("<br>\n")
    return "<br>\n".join(inline(line) for line in lines)


def plain(block: str) -> str:
    return re.sub(r"\*\*(.*?)\*\*", r"\1", block)


def is_bold_only(block: str) -> bool:
    return bool(re.fullmatch(r"\*\*[^*]+\*\*", block.strip(), re.S))


def is_section_number(block: str) -> bool:
    value = plain(block).strip()
    return bool(value) and len(value) <= 2 and all(ch in SECTION_NUMBERS for ch in value)


def body_paragraph(block: str) -> str:
    if is_bold_only(block):
        return (
            '<p style="margin:0 0 24px;font-size:15px;line-height:1.9;text-align:justify;'
            'font-weight:600;color:#2B2B2B;padding:0 16px;">'
            + paragraph_content(block)
            + "</p>"
        )
    return (
        '<p style="margin:0 0 24px;font-size:15px;line-height:1.9;text-align:justify;'
        'color:#525252;padding:0 16px;">'
        + paragraph_content(block)
        + "</p>"
    )


def render(markdown: str) -> str:
    blocks = [block.strip() for block in re.split(r"\n{2,}", markdown.strip())]
    eyebrow, title, subtitle = blocks[0], blocks[2], blocks[3]
    parts = [
        '<section style="max-width:677px;margin:0 auto;background:#FFFFFF;'
        "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB',"
        "'Microsoft YaHei',sans-serif;color:#525252;line-height:1.9;letter-spacing:0.3px;"
        'overflow-x:hidden;">',
        '<section style="margin:30px 16px 42px;padding:28px 20px 26px;'
        'border-top:1px solid #E8E8E8;border-bottom:1px solid #E8E8E8;text-align:center;">',
        '<p style="font-size:11px;color:#4A5D52;font-weight:600;letter-spacing:2px;'
        f'margin:0 0 14px;">{inline(eyebrow)}</p>',
        '<p style="font-family:Georgia,\'Times New Roman\',serif;font-size:26px;font-weight:700;'
        f'color:#2B2B2B;margin:0 0 12px;line-height:1.45;letter-spacing:0.6px;">{inline(title)}</p>',
        '<p style="font-size:13px;color:#A3A3A3;margin:0;line-height:1.75;letter-spacing:0.4px;">'
        f'{inline(subtitle)}</p>',
        "</section>",
    ]

    index = 4
    while index < len(blocks):
        block = blocks[index]
        if block == BLANK:
            parts.append('<section style="height:18px;line-height:18px;"><br></section>')
            index += 1
            continue

        if is_section_number(block) and index + 1 < len(blocks):
            heading = blocks[index + 1]
            number = plain(block).strip()
            parts.extend([
                '<section style="margin:52px 16px 30px;padding:0;text-align:center;">',
                '<p style="font-size:11px;color:#4A5D52;font-weight:600;letter-spacing:3px;'
                f'margin:0;text-align:center;">{leaf(number)}</p>',
                '<section style="height:20px;line-height:20px;"><span leaf=""><br></span></section>',
                '<h3 style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;'
                'font-weight:700;color:#2B2B2B;margin:0 0 15px;letter-spacing:0.5px;'
                'line-height:1.45;text-align:center;">'
                f'{inline(heading)}</h3>',
                '<section style="width:40px;height:2px;background:#4A5D52;margin:0 auto;">'
                '<span leaf=""><br></span></section>',
                "</section>",
            ])
            index += 2
            continue

        if plain(block).strip() == "“逝者如斯不舍昼夜”":
            parts.append(
                '<section style="margin:38px 16px;padding:32px 20px;border-top:1px solid #E8E8E8;'
                'border-bottom:1px solid #E8E8E8;text-align:center;">'
                '<p style="font-family:Georgia,\'Times New Roman\',serif;font-size:17px;font-weight:600;'
                f'color:#2B2B2B;margin:0;line-height:1.9;letter-spacing:0.8px;">{inline(block)}</p>'
                "</section>"
            )
        else:
            parts.append(body_paragraph(block))
        index += 1

    parts.extend([
        "<!-- generated:start -->",
        '<section style="padding:0 16px;"><section style="text-align:center;margin:48px 0 40px;">'
        '<section style="display:flex;align-items:center;justify-content:center;">'
        '<span style="height:1px;width:48px;background:#E8E8E8;margin-right:16px;"></span>'
        '<span style="font-size:10px;color:#A3A3A3;letter-spacing:4px;font-weight:400;">'
        '<span leaf="">END</span></span>'
        '<span style="height:1px;width:48px;background:#E8E8E8;margin-left:16px;"></span>'
        "</section></section></section>",
        "<!-- generated:end -->",
        "</section>",
    ])
    return "\n".join(parts) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(render(args.source.read_text(encoding="utf-8")), encoding="utf-8")
    print(f"wrote: {args.output}")


if __name__ == "__main__":
    main()
