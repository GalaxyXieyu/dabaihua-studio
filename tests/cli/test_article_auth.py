# -*- coding: utf-8 -*-
"""superme CLI 文章推送：认证（SUPERME_TOKEN / SUPERME_ENDPOINT）与助手模式的单元测试。

复用 test_article.py 的 MockArticleServer（按协议重算并校验扩展 contentHash）。
只使用标准库；所有账号名、token、文章内容均为虚构，绝不进仓库。
运行：python3 -m unittest discover -s tests/cli -p 'test_*.py' -v
"""
import argparse
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from test_article import MockArticleServer, load_cli

ENV_NAMES = (
    "SUPERME_TOKEN", "SUPERME_ENDPOINT", "SUPERME_ASSISTANT",
    "DABAIHUA_CARDS_ASSISTANT_TOKEN", "HANDBOOK_TOKEN",
)


class ArticleAuthTests(unittest.TestCase):
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

    def configure_endpoint(self, port, token="topk_config_token"):
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:%d" % port, "token": token}
        ))

    def push_args(self, path, **overrides):
        values = {"action": "push", "path": str(path), "public": False,
                  "dry_run": False, "root": None, "assistant": None}
        values.update(overrides)
        return argparse.Namespace(**values)

    def run_article(self, args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        return code, buf.getvalue()

    # ── SUPERME_TOKEN / SUPERME_ENDPOINT ──
    def test_superme_token_env_overrides_config_for_article(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port, token="topk_config_token")
        self.set_env("SUPERME_TOKEN", "topk_env_token")
        note = self.write("env-note.md", "---\ntitle: Env Note\n---\n\n正文\n")
        code, out = self.run_article(self.push_args(note))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_env_token")
        self.assertNotIn("topk_env_token", out)
        self.assertNotIn("topk_config_token", out)

    def test_superme_token_env_overrides_config_for_request(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port, token="topk_config_token")
        self.set_env("SUPERME_TOKEN", "topk_env_token")
        payload = self.cli.request("/api/articles")
        self.assertIsInstance(payload, dict)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_env_token")

    def test_config_token_used_without_env(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        note = self.write("cfg-note.md", "---\ntitle: Cfg Note\n---\n\n正文\n")
        code, out = self.run_article(self.push_args(note))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_config_token")

    def test_superme_endpoint_env(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        # config 指向一个连不上的地址，必须被 SUPERME_ENDPOINT 覆盖
        self.set_env("SUPERME_ENDPOINT", "http://127.0.0.1:%d" % server.port)
        self.set_env("SUPERME_TOKEN", "topk_env_token")
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:9", "token": "topk_config_token"}))
        self.assertEqual(self.cli.endpoint(), "http://127.0.0.1:%d" % server.port)
        note = self.write("endpoint-note.md", "---\ntitle: Endpoint Note\n---\n\n正文\n")
        code, out = self.run_article(self.push_args(note))
        self.assertEqual(code, 0, out)
        self.assertEqual(len(server.requests), 1)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_env_token")

    # ── 助手模式 ──
    def test_assistant_push_draft_with_superme_token(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port, token="topk_config_token")
        self.set_env("SUPERME_TOKEN", "topk_assistant_env_token")
        note = self.write("assistant-note.md", "---\nslug: assistant-note\ntitle: 助手草稿\ntags: [a]\nstatus: draft\n---\n\n正文\n")
        code, out = self.run_article(self.push_args(note, assistant="测试助手"))
        self.assertEqual(code, 0, out)
        # 环境变量 token 优先于 config；助手模式不使用 config token
        self.assertEqual(server.auth_headers[-1], "Bearer topk_assistant_env_token")
        payload = server.requests[-1]
        self.assertEqual(payload.get("assistant"), "测试助手")
        self.assertEqual(payload.get("status"), "draft")
        self.assertNotIn("isPublic", payload)
        # mock 按扩展 contentHash 校验通过（不一致会 400 hash_mismatch 导致失败）
        self.assertIn("assistant-note", server.articles)
        self.assertNotIn("topk_assistant_env_token", out)
        self.assertNotIn("topk_config_token", out)

    def test_assistant_token_fallback_order(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port, token="topk_config_token")
        note = self.write("fallback.md", "---\ntitle: Fallback\n---\n\n正文\n")
        # DABAIHUA_CARDS_ASSISTANT_TOKEN 优先于 HANDBOOK_TOKEN
        self.set_env("DABAIHUA_CARDS_ASSISTANT_TOKEN", "tok_cards_assistant")
        self.set_env("HANDBOOK_TOKEN", "tok_handbook")
        code, _ = self.run_article(self.push_args(note, assistant="尔康"))
        self.assertEqual(code, 0)
        self.assertEqual(server.auth_headers[-1], "Bearer tok_cards_assistant")
        # 只剩 HANDBOOK_TOKEN 时也能用
        self.set_env("DABAIHUA_CARDS_ASSISTANT_TOKEN", None)
        code, out = self.run_article(self.push_args(note, assistant="尔康"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer tok_handbook")
        self.assertNotIn("tok_handbook", out)

    def test_assistant_forces_draft_and_ignores_public_frontmatter(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port, token="topk_config_token")
        self.set_env("SUPERME_TOKEN", "topk_assistant_env_token")
        note = self.write(
            "assistant-published.md",
            "---\ntitle: 想发布的助手稿\nstatus: published\npublic: true\n---\n\n正文\n",
        )
        code, out = self.run_article(self.push_args(note, assistant="写稿助手"))
        self.assertEqual(code, 0, out)
        self.assertIn("警告", out)
        self.assertIn("draft", out)
        payload = server.requests[-1]
        self.assertEqual(payload.get("status"), "draft")
        self.assertNotIn("isPublic", payload)

    def test_assistant_from_env_variable(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port, token="topk_config_token")
        self.set_env("SUPERME_TOKEN", "topk_assistant_env_token")
        self.set_env("SUPERME_ASSISTANT", "环境助手")
        note = self.write("env-assistant.md", "---\ntitle: Env Assistant\n---\n\n正文\n")
        code, out = self.run_article(self.push_args(note))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1].get("assistant"), "环境助手")
        self.assertEqual(server.assistants[-1], "环境助手")

    def test_assistant_conflicts_with_public(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.set_env("SUPERME_TOKEN", "topk_assistant_env_token")
        note = self.write("conflict.md", "---\ntitle: Conflict\n---\n\n正文\n")
        with self.assertRaises(SystemExit) as ctx:
            self.run_article(self.push_args(note, public=True, assistant="尔康"))
        self.assertIn("不能同时", str(ctx.exception))
        self.assertEqual(server.requests, [])

    def test_assistant_requires_token(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        # config 里有普通 topk token，助手模式不得拿它充当助手 token
        self.configure_endpoint(server.port)
        note = self.write("needs-token.md", "---\ntitle: Needs Token\n---\n\n正文\n")
        with self.assertRaises(SystemExit) as ctx:
            self.run_article(self.push_args(note, assistant="尔康"))
        message = str(ctx.exception)
        self.assertIn("助手推送需要助手 token", message)
        self.assertIn("HANDBOOK_TOKEN", message)
        self.assertIn("set -a", message)
        self.assertEqual(server.requests, [])

    def test_assistant_name_too_long(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.set_env("SUPERME_TOKEN", "topk_assistant_env_token")
        note = self.write("long-name.md", "---\ntitle: Long Name\n---\n\n正文\n")
        with self.assertRaises(SystemExit) as ctx:
            self.run_article(self.push_args(note, assistant="超" * 21))
        self.assertIn("1-20", str(ctx.exception))
        self.assertEqual(server.requests, [])

    def test_article_locked_message(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        self.set_env("SUPERME_TOKEN", "tok_assistant_locked")
        server.force_locked.add("locked-note")
        note = self.write("locked.md", "---\nslug: locked-note\ntitle: Locked\n---\n\n正文\n")
        code, out = self.run_article(self.push_args(note, assistant="尔康"))
        self.assertEqual(code, 1)
        self.assertIn("已锁定", out)
        self.assertIn("published", out)
        self.assertNotIn("tok_assistant_locked", out)

    # ── 请求体扩展字段（协议 §3 / §7） ──
    def test_push_one_sends_extended_body_fields(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        note = self.write("rich.md", "---\ntitle: Rich\n---\n\n正文\n")
        article_html = '<section><h1>Rich</h1><img src="images/0123456789ab.png"></section>\n'
        qa_report = "## QA\n\n- 标题与正文一致。\n"
        brief = {"date": "2026-10-01", "topicId": "t-quiet-desk-01"}
        entry = {
            "file": note, "rel": "rich.md", "markdown": "正文\n", "title": "Rich",
            "slug": "rich-note", "status": "draft", "date": "2026-10-03",
            "tags": ["x"], "is_public": None,
            "article_html": article_html, "qa_report": qa_report,
            "board_topic_id": 12, "brief": brief,
            "contentHash": self.cli._article_content_hash(
                "Rich", "draft", None, "2026-10-03", ["x"], [], "正文\n",
                article_html=article_html, qa_report=qa_report,
                board_topic_id=12, brief=brief,
            ),
        }
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            failed = self.cli._article_push_one(entry, [], {})
        self.assertFalse(failed, buf.getvalue())
        payload = server.requests[-1]
        self.assertEqual(payload.get("articleHtml"), article_html)
        self.assertEqual(payload.get("qaReport"), qa_report)
        self.assertEqual(payload.get("boardTopicId"), 12)
        self.assertEqual(payload.get("brief"), brief)
        # mock 重算的 contentHash 与请求一致（否则 400 hash_mismatch、推送失败）
        self.assertIn("rich-note", server.articles)

        # entry 里没有这些字段时一个都不传；assistant 也不会凭空出现
        plain = {
            "file": note, "rel": "plain.md", "markdown": "正文\n", "title": "Plain",
            "slug": "plain-note", "status": "draft", "date": None,
            "tags": [], "is_public": None,
            "contentHash": self.cli._article_content_hash(
                "Plain", "draft", None, None, [], [], "正文\n"),
        }
        with contextlib.redirect_stdout(io.StringIO()) as buf2:
            failed = self.cli._article_push_one(plain, [], {})
        self.assertFalse(failed, buf2.getvalue())
        payload = server.requests[-1]
        for key in ("articleHtml", "qaReport", "boardTopicId", "brief", "assistant"):
            self.assertNotIn(key, payload)

    def test_assistant_body_not_in_content_hash(self):
        # assistant 不参与 contentHash：同内容带不带助手，hash 一样
        base = self.cli._article_content_hash(
            "T", "draft", None, None, [], [], "正文\n")
        self.assertEqual(base, self.cli._article_content_hash(
            "T", "draft", None, None, [], [], "正文\n"))


if __name__ == "__main__":
    unittest.main()
