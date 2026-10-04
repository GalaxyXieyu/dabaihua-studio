# -*- coding: utf-8 -*-
"""superme CLI 2.7.0：article push --stage/--round 与封面（设计 §4.2 / §4.3）的单元测试。

覆盖：--round 单独用等同 --stage revised、typeset 无 round、revised 缺 round 报错、
多篇限制、dry-run 标签、422 round_not_reviewed 提示、封面资产上传与 covers 字段、
只换封面 contentHash 变化、meta.cover 越界忽略。
复用 test_article.py 的 MockArticleServer / load_cli / PNG 向量；只用标准库；
所有 slug、标题、正文、token 均为虚构，绝不进仓库。
运行：python3 -m unittest discover -s tests/cli -p 'test_*.py' -v
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from test_article import MockArticleServer, load_cli, PNG_A, PNG_B

ENV_NAMES = (
    "SUPERME_TOKEN", "SUPERME_ENDPOINT", "SUPERME_ASSISTANT",
    "DABAIHUA_CARDS_ASSISTANT_TOKEN", "HANDBOOK_TOKEN",
)


def asset_name(data):
    return "images/%s.png" % hashlib.sha256(data).hexdigest()[:12]


class ArticleStageTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        base = Path(self._tmp.name)
        self.config_dir = base / "config"
        self.vault = base / "vault"
        self.vault.mkdir(parents=True, exist_ok=True)
        self.cli = load_cli(self.config_dir)
        self._env_backup = {name: os.environ.pop(name, None) for name in ENV_NAMES}
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for name, value in self._env_backup.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def set_env(self, name, value):
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value

    def write(self, rel, text):
        path = self.vault / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def note(self, title="阶段笔记", name="stage-note.md", slug="stage-note"):
        return self.write(name, "---\ntitle: %s\nslug: %s\n---\n\n正文一段。\n" % (title, slug))

    def make_article_dir(self, meta_extra=None, covers=None):
        """造一个最小文章目录 stage-demo/（meta.json + 02-final.md + 可选封面图）。"""
        article_dir = self.vault / "stage-demo"
        (article_dir / "images").mkdir(parents=True, exist_ok=True)
        meta = {"slug": "stage-demo", "title": "阶段演示", "final": "02-final.md"}
        meta.update(meta_extra or {})
        (article_dir / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        (article_dir / "02-final.md").write_text(
            "---\ntags: [stage]\n---\n\n# 阶段演示\n\n正文第一段。\n", encoding="utf-8")
        for rel, data in (covers or {}).items():
            path = article_dir / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return article_dir

    def configure_endpoint(self, port, token="topk_stage_token"):
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:%d" % port, "token": token}
        ))

    def push_args(self, path, **overrides):
        values = {"action": "push", "path": str(path), "public": False,
                  "dry_run": False, "root": None, "assistant": None,
                  "stage": None, "round": None}
        values.update(overrides)
        return argparse.Namespace(**values)

    def run_article(self, args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        return code, buf.getvalue()

    def start_server(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        return server

    # ── --stage/--round 本地语义 ──
    def test_round_alone_means_stage_revised(self):
        server = self.start_server()
        note = self.note()
        code, out = self.run_article(self.push_args(note, round=3))
        self.assertEqual(code, 0, out)
        payload = server.requests[-1]
        self.assertEqual(payload["stage"], {"name": "revised", "round": 3})
        # 服务端（MockArticleServer）按协议重算 contentHash，不一致会 400；
        # 再用归一后的 markdown 直接重算一遍，确认带 stage 的 hash 一致。
        self.assertIn("已标记：已按第 3 轮改完", out)
        self.assertEqual(payload["contentHash"], self.cli._article_content_hash(
            "阶段笔记", "draft", None, None, [], [], payload["markdown"],
            stage={"name": "revised", "round": 3}))

    def test_stage_typeset_without_round(self):
        server = self.start_server()
        note = self.note()
        code, out = self.run_article(self.push_args(note, stage="typeset"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1]["stage"], {"name": "typeset"})
        self.assertNotIn("round", server.requests[-1]["stage"])
        self.assertIn("已标记：排版完成，待审", out)

    def test_stage_revised_missing_round_fails_locally(self):
        note = self.note()
        with self.assertRaises(SystemExit) as caught:
            self.run_article(self.push_args(note, stage="revised"))
        self.assertIn("--stage revised 必须带 --round", str(caught.exception))

    def test_stage_name_validated(self):
        note = self.note()
        with self.assertRaises(SystemExit) as caught:
            self.run_article(self.push_args(note, stage="final"))
        self.assertIn("drafted、revised、rewritten 或 typeset", str(caught.exception))

    def test_stage_only_for_single_article(self):
        self.write("one.md", "---\ntitle: 第一篇\nslug: stage-one\n---\n\n正文。\n")
        self.write("two.md", "---\ntitle: 第二篇\nslug: stage-two\n---\n\n正文。\n")
        with self.assertRaises(SystemExit) as caught:
            self.run_article(self.push_args(self.vault, stage="drafted"))
        self.assertEqual("--stage/--round 只能用于单篇文章", str(caught.exception))
        with self.assertRaises(SystemExit) as caught:
            self.run_article(self.push_args(self.vault, round=1))
        self.assertEqual("--stage/--round 只能用于单篇文章", str(caught.exception))

    def test_stage_with_two_article_dirs_fails(self):
        for name in ("a-demo", "b-demo"):
            article_dir = self.vault / name
            article_dir.mkdir(parents=True, exist_ok=True)
            (article_dir / "meta.json").write_text(
                json.dumps({"slug": name, "title": name}), encoding="utf-8")
            (article_dir / "02-final.md").write_text("# %s\n\n正文。\n" % name, encoding="utf-8")
        with self.assertRaises(SystemExit) as caught:
            self.run_article(self.push_args(self.vault, stage="drafted"))
        self.assertEqual("--stage/--round 只能用于单篇文章", str(caught.exception))

    # ── dry-run 标签 ──
    def test_dry_run_stage_line_and_labels(self):
        note = self.note()
        cases = [
            ({"stage": "drafted"}, "stage: drafted · 初稿完成"),
            ({"stage": "revised", "round": 2}, "stage: revised round 2 · 已按第 2 轮改完"),
            ({"stage": "rewritten", "round": 1}, "stage: rewritten round 1 · 已按第 1 轮重写"),
            ({"stage": "typeset"}, "stage: typeset · 排版完成，待审"),
            ({"stage": "typeset", "round": 2}, "stage: typeset round 2 · 已按第 2 轮改完排版"),
        ]
        for overrides, expected in cases:
            code, out = self.run_article(self.push_args(note, dry_run=True, **overrides))
            self.assertEqual(code, 0, out)
            self.assertIn(expected, out)
        # 单独 --round N 也走 revised 标签。
        code, out = self.run_article(self.push_args(note, dry_run=True, round=2))
        self.assertEqual(code, 0, out)
        self.assertIn("stage: revised round 2 · 已按第 2 轮改完", out)

    def test_dry_run_article_dir_stage_line(self):
        article_dir = self.make_article_dir()
        code, out = self.run_article(self.push_args(article_dir, dry_run=True, stage="typeset", round=2))
        self.assertEqual(code, 0, out)
        self.assertIn("stage: typeset round 2 · 已按第 2 轮改完排版", out)

    # ── 422 round_not_reviewed ──
    def test_round_not_reviewed_message(self):
        server = self.start_server()
        server.force_round_not_reviewed.add("stage-note")
        note = self.note()
        code, out = self.run_article(self.push_args(note, round=3))
        self.assertEqual(code, 1, out)
        self.assertIn("第 3 轮还没有提交审稿，不能标记阶段", out)

    # ── 封面（§4.3，仅文章目录） ──
    def test_covers_uploaded_and_sent(self):
        server = self.start_server()
        article_dir = self.make_article_dir(covers={
            "images/cover-21x9.png": PNG_A,
            "images/cover-1x1.png": PNG_B,
        })
        code, out = self.run_article(self.push_args(article_dir))
        self.assertEqual(code, 0, out)
        payload = server.requests[-1]
        self.assertEqual(payload["covers"], [
            {"role": "21x9", "path": asset_name(PNG_A)},
            {"role": "1x1", "path": asset_name(PNG_B)},
        ])
        asset_names = {asset["name"] for asset in payload["assets"]}
        self.assertEqual(asset_names, {asset_name(PNG_A), asset_name(PNG_B)})
        for asset in payload["assets"]:
            self.assertIn("base64", asset)
        # hash 包含 cover 行：与服务端（mock_article_hash）一致才不会 400。
        self.assertIn("stage-demo created", out)

    def test_cover_change_changes_content_hash(self):
        server = self.start_server()
        article_dir = self.make_article_dir(covers={"images/cover-21x9.png": PNG_A})
        code, out = self.run_article(self.push_args(article_dir))
        self.assertEqual(code, 0, out)
        first_hash = server.requests[-1]["contentHash"]
        (article_dir / "images" / "cover-21x9.png").write_bytes(PNG_B)
        code, out = self.run_article(self.push_args(article_dir))
        self.assertEqual(code, 0, out)
        second_hash = server.requests[-1]["contentHash"]
        self.assertNotEqual(first_hash, second_hash)
        self.assertIn("stage-demo updated", out)
        self.assertEqual(server.requests[-1]["covers"], [{"role": "21x9", "path": asset_name(PNG_B)}])

    def test_meta_cover_dict_and_escape(self):
        server = self.start_server()
        # meta.cover 对象：显式指定 1x1，越出目录的 21x9 被忽略并警告。
        outside = self.write("outside.png", "")  # 文本文件，只测路径越界
        article_dir = self.make_article_dir(
            meta_extra={"cover": {"21x9": "../outside.png", "1x1": "images/square.png"}},
            covers={"images/square.png": PNG_B},
        )
        code, out = self.run_article(self.push_args(article_dir, dry_run=True))
        self.assertEqual(code, 0, out)
        self.assertIn("封面 21x9 不在文章目录内", out)
        self.assertIn("封面 1x1: %s" % asset_name(PNG_B), out)
        code, out = self.run_article(self.push_args(article_dir))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1]["covers"], [{"role": "1x1", "path": asset_name(PNG_B)}])

    def test_meta_cover_string_uses_cover_role(self):
        server = self.start_server()
        article_dir = self.make_article_dir(
            meta_extra={"cover": "images/hero.png"},
            covers={"images/hero.png": PNG_A},
        )
        code, out = self.run_article(self.push_args(article_dir))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1]["covers"], [{"role": "cover", "path": asset_name(PNG_A)}])

    def test_single_file_push_has_no_covers(self):
        server = self.start_server()
        note = self.note()
        code, out = self.run_article(self.push_args(note, stage="drafted"))
        self.assertEqual(code, 0, out)
        payload = server.requests[-1]
        self.assertNotIn("covers", payload)
        self.assertEqual(payload["stage"], {"name": "drafted"})
        self.assertIn("已标记：初稿完成", out)


if __name__ == "__main__":
    unittest.main()
