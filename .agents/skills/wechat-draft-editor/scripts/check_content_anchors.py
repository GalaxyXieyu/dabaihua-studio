#!/usr/bin/env python3
"""Compare protected textual anchors between an original and an edited draft."""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path


NUMBER_WITH_UNIT_RE = re.compile(
    r"(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万亿几]+)\s*"
    r"(?:%|个百分点|亿元|万元|万次|万小时|万人|万名|多年|个月|分钟|小时|"
    r"多?个|多?项|多?条|多?篇|多?次|人|名|年|月|日|天|周|分|秒)"
)
URL_RE = re.compile(r"https?://[^\s)\]}>，。；、]+")
LATIN_TERM_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*\b")
QUOTE_RES = (
    re.compile(r"“([^”\n]{1,500})”"),
    re.compile(r"「([^」\n]{1,500})」"),
    re.compile(r"『([^』\n]{1,500})』"),
    re.compile(r'"([^"\n]{1,500})"'),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Flag changes to numbers, time expressions, URLs, quotations, and Latin "
            "proper-name candidates. A difference requires manual review."
        )
    )
    parser.add_argument("original", type=Path, help="original UTF-8 text or Markdown file")
    parser.add_argument("edited", type=Path, help="edited UTF-8 text or Markdown file")
    return parser.parse_args()


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise SystemExit(f"error: cannot read {path}: {exc}") from exc


def extract_quotes(text: str) -> Counter[str]:
    values: list[str] = []
    for pattern in QUOTE_RES:
        values.extend(match.strip() for match in pattern.findall(text))
    return Counter(values)


def extract_anchors(text: str) -> dict[str, Counter[str]]:
    latin_terms = set(LATIN_TERM_RE.findall(URL_RE.sub("", text)))
    return {
        "numbers_and_time": Counter(match.group(0).strip() for match in NUMBER_WITH_UNIT_RE.finditer(text)),
        "urls": Counter(URL_RE.findall(text)),
        "quotations": extract_quotes(text),
        "latin_terms": Counter({term: 1 for term in latin_terms}),
    }


def format_counter(counter: Counter[str]) -> str:
    parts = []
    for value in sorted(counter):
        count = counter[value]
        parts.append(f"{value!r}" if count == 1 else f"{value!r} x{count}")
    return ", ".join(parts)


def main() -> int:
    args = parse_args()
    original = extract_anchors(read_text(args.original))
    edited = extract_anchors(read_text(args.edited))

    changed = False
    for category in original:
        removed = original[category] - edited[category]
        added = edited[category] - original[category]
        if not removed and not added:
            continue
        changed = True
        print(f"[{category}]")
        if removed:
            print(f"  removed/changed: {format_counter(removed)}")
        if added:
            print(f"  added/changed:   {format_counter(added)}")

    if changed:
        print("\nAnchor changes detected. Review each item against the original draft.")
        return 1

    print("No protected anchor changes detected by the automated checks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
