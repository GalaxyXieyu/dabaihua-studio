#!/usr/bin/env python3
"""Deterministic smoke tests for the unified WeChat article skill."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent


def run(*arguments):
    result = subprocess.run(
        [sys.executable, *map(str, arguments)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result.stdout


def make_docx(path):
    document = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:rStyle w:val="EmphasisBold"/></w:rPr><w:t>第一行</w:t><w:br/><w:t>第二行</w:t></w:r></w:p>
    <w:p/>
    <w:p>
      <w:pPr><w:spacing w:before="240" w:after="120"/><w:jc w:val="center"/></w:pPr>
      <w:r><w:t>下一段</w:t></w:r>
    </w:p>
  </w:body>
</w:document>"""
    styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:style w:type="character" w:styleId="EmphasisBold">
        <w:name w:val="EmphasisBold"/>
        <w:rPr><w:b/></w:rPr>
      </w:style>
    </w:styles>"""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document)
        archive.writestr("word/styles.xml", styles)


def main():
    with tempfile.TemporaryDirectory(prefix="wechat-skill-test-") as directory:
        root = Path(directory)
        docx = root / "sample.docx"
        markdown = root / "sample.md"
        make_docx(docx)
        run(SCRIPT_DIR / "extract_docx.py", docx, "-o", markdown)
        extracted = markdown.read_text(encoding="utf-8")
        assert "**第一行<br>\n第二行**" in extracted
        assert "<!-- wechat:blank -->" in extracted
        assert "<!-- wechat:spacing before=240 after=120 -->" in extracted
        assert "<!-- wechat:paragraph align=center -->" in extracted

        before = root / "01-source.md"
        punctuated = root / "02-punctuation.md"
        laid_out = root / "03-layout.md"
        before.write_text(
            "问题往往不是我们没有力量。\n\n而是这些力量太容易耗散。\n",
            encoding="utf-8",
        )
        punctuated.write_text(
            "问题往往不是我们没有力量，\n\n而是这些力量太容易耗散。\n",
            encoding="utf-8",
        )
        laid_out.write_text(
            "问题往往不是我们没有力量，<br>\n"
            "而是这些力量太容易耗散。\n\n"
            "<!-- wechat:blank -->\n",
            encoding="utf-8",
        )
        run(SCRIPT_DIR / "validate_content.py", "--mode", "punctuation", before, punctuated)
        run(SCRIPT_DIR / "validate_content.py", "--mode", "layout", punctuated, laid_out)

        source = root / "source.md"
        rendered = root / "rendered.html"
        source.write_text("# 标题\n\n正文", encoding="utf-8")
        rendered.write_text(
            '<!-- generated:start --><section><span leaf="">01</span></section>'
            '<!-- generated:end --><section><h1><span leaf="">标题</span></h1>'
            '<p><span leaf="">正文</span></p></section>',
            encoding="utf-8",
        )
        run(SCRIPT_DIR / "validate_content.py", "--mode", "render", source, rendered)
        run(SCRIPT_DIR / "validate_gzh_html.py", rendered)
        preserved = root / "preserved-punctuation.html"
        preserved.write_text(
            '<section><p><span leaf="">原文,保留</span></p></section>', encoding="utf-8"
        )
        punctuation_check = run(
            SCRIPT_DIR / "validate_gzh_html.py",
            "--allow-source-punctuation",
            preserved,
        )
        assert "半角标点" not in punctuation_check
        generated_punctuation = root / "generated-punctuation.html"
        generated_punctuation.write_text(
            '<!-- generated:start --><section><span leaf="">新增,文字</span></section>'
            '<!-- generated:end -->',
            encoding="utf-8",
        )
        punctuation_check = run(
            SCRIPT_DIR / "validate_gzh_html.py",
            "--allow-source-punctuation",
            generated_punctuation,
        )
        assert "半角标点" in punctuation_check
        body_only = root / "body-only.html"
        body_only.write_text(
            '<section><p><span leaf="">正文</span></p></section>', encoding="utf-8"
        )
        run(
            SCRIPT_DIR / "validate_content.py",
            "--mode",
            "render",
            "--ignore-source-title",
            source,
            body_only,
        )

        history = root / "history"
        history.mkdir()
        (history / "one.html").write_text(
            '<section style="color:#222;background:#fff;padding:20px">'
            '<h2 style="font-size:20px;color:#0a7;font-weight:700">标题</h2>'
            '<p style="font-size:16px;line-height:1.8;color:#222">正文</p></section>',
            encoding="utf-8",
        )
        report = root / "theme-profile.md"
        run(SCRIPT_DIR / "extract_theme_from_html.py", history, "--out", report)
        profile = report.read_text(encoding="utf-8")
        assert "样本数量：1" in profile
        assert "#0a7" in profile
        assert "标题" in profile

    run(SKILL_DIR / "test/layout/run_checkpoint.py")

    print("✓ unified skill self-test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
