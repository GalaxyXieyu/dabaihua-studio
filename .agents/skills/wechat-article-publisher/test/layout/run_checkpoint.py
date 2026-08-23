#!/usr/bin/env python3
"""Verify the approved layout golden master or compare a new candidate against it."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import html
import json
import re
import subprocess
import sys
from pathlib import Path

TEST_DIR = Path(__file__).resolve().parent
SKILL_DIR = TEST_DIR.parents[1]
CASE_DIR = TEST_DIR / "aige-14"
EXPECTED_DIR = CASE_DIR / "expected"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*arguments: Path | str) -> None:
    result = subprocess.run(
        [sys.executable, *map(str, arguments)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)


def verify_fixture() -> None:
    manifest = json.loads((CASE_DIR / "checkpoint.json").read_text(encoding="utf-8"))
    failures = []
    for relative, expected in manifest["files"].items():
        path = CASE_DIR / relative
        actual = digest(path) if path.is_file() else "missing"
        if actual != expected:
            failures.append(f"{relative}: expected {expected}, got {actual}")
    if failures:
        raise AssertionError("Checkpoint integrity failed:\n" + "\n".join(failures))


def compare_layout(candidate: Path) -> None:
    expected = (EXPECTED_DIR / "03-layout.md").read_text(encoding="utf-8")
    actual = candidate.read_text(encoding="utf-8")
    if actual == expected:
        return
    diff = "".join(
        difflib.unified_diff(
            expected.splitlines(keepends=True),
            actual.splitlines(keepends=True),
            fromfile="checkpoint/03-layout.md",
            tofile=str(candidate),
            n=3,
        )
    )
    raise AssertionError("Layout regression detected:\n" + diff[:12000])


def plain(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def chapter_pairs(markdown: str) -> list[tuple[str, str]]:
    blocks = [block.strip() for block in re.split(r"\n\s*\n", markdown) if block.strip()]
    pairs = []
    numerals = re.compile(r"^\*\*([一二三四五六七八九十百]+)\*\*$")
    for index, block in enumerate(blocks[:-1]):
        match = numerals.fullmatch(block)
        next_block = blocks[index + 1]
        if match and next_block.startswith("**") and next_block.endswith("**"):
            pairs.append((match.group(1), next_block[2:-2]))
    return pairs


def centered_elements(markup: str, tag: str) -> list[tuple[re.Match[str], str]]:
    pattern = re.compile(
        rf"<{tag}\b(?=[^>]*style=\"[^\"]*text-align\s*:\s*center)[^>]*>(.*?)</{tag}>",
        re.I | re.S,
    )
    return [(match, plain(match.group(1))) for match in pattern.finditer(markup)]


def inherited_centered_paragraphs(markup: str) -> list[tuple[re.Match[str], str]]:
    pattern = re.compile(
        r"<section\b(?=[^>]*style=\"[^\"]*text-align\s*:\s*center)[^>]*>\s*"
        r"<p\b[^>]*>(.*?)</p>",
        re.I | re.S,
    )
    return [(match, plain(match.group(1))) for match in pattern.finditer(markup)]


def verify_chapter_structure(layout: Path, rendered: Path) -> None:
    markdown = layout.read_text(encoding="utf-8")
    markup = rendered.read_text(encoding="utf-8")
    pairs = chapter_pairs(markdown)
    if not pairs:
        raise AssertionError("No chapter number/title pairs found in layout Markdown")

    numbers = centered_elements(markup, "p") + inherited_centered_paragraphs(markup)
    titles = centered_elements(markup, "h3")
    spacer = re.compile(
        r"<section\b[^>]*style=\"[^\"]*(?:height|line-height)\s*:[^\"]*\"[^>]*>"
        r"\s*(?:<span\b[^>]*>)?\s*<br\s*/?>",
        re.I | re.S,
    )

    for number, title in pairs:
        number_match = next((match for match, text in numbers if text == number), None)
        title_match = next((match for match, text in titles if text == title), None)
        if number_match is None:
            raise AssertionError(f"Chapter number is not centered: {number}")
        if title_match is None:
            raise AssertionError(f"Chapter title is not centered: {title}")
        between = markup[number_match.end() : title_match.start()]
        if number_match.end() >= title_match.start() or not spacer.search(between):
            raise AssertionError(f"Missing one visual blank line between {number} and {title}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-layout", type=Path)
    parser.add_argument("--candidate-html", type=Path)
    parser.add_argument(
        "--allow-layout-variation",
        action="store_true",
        help="skip byte comparison and keep only content/structure contracts",
    )
    parser.add_argument(
        "--strict-html",
        action="store_true",
        help="also require byte-for-byte equality with the approved theme output",
    )
    args = parser.parse_args()

    verify_fixture()
    layout = args.candidate_layout or EXPECTED_DIR / "03-layout.md"
    rendered = args.candidate_html or EXPECTED_DIR / "output.html"
    if args.candidate_layout and not args.allow_layout_variation:
        compare_layout(layout)

    run(SKILL_DIR / "scripts/validate_content.py", "--mode", "render", layout, rendered)
    run(
        SKILL_DIR / "scripts/validate_gzh_html.py",
        "--allow-source-punctuation",
        rendered,
    )
    verify_chapter_structure(layout, rendered)

    if args.strict_html and rendered.read_bytes() != (EXPECTED_DIR / "output.html").read_bytes():
        raise AssertionError("Strict HTML regression detected")

    print("✓ aige-14 layout checkpoint passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
