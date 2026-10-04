# -*- coding: utf-8 -*-
"""superme CLI 文章目录（meta.json）推送的单元测试。

覆盖：文章目录 dry-run 明细、文章目录 push（请求体扩展字段与 html 图片改写）、
父目录 sync（子目录各算一篇）、slug 生成修复、单文件推送仍可用、助手推送文章目录。
复用 test_article.py 的 MockArticleServer / load_cli / PNG 向量；只用标准库；
所有 slug、标题、正文、token 均为虚构。运行：
python3 -m unittest discover -s tests/cli -p 'test_*.py' -v
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

from test_article import MockArticleServer, load_cli, PNG_A

ENV_NAMES = (
    "SUPERME_TOKEN", "SUPERME_ENDPOINT", "SUPERME_ASSISTANT",
    "DABAIHUA_CARDS_ASSISTANT_TOKEN", "HANDBOOK_TOKEN",
)

DEMO_META = {
    "title": "演示文章",
    "brief_date": "2026-01-02",
    "topic_id": "t-demo-01",
    "board_topic_id": 12,
    "final": "02-final.md",
}


class ArticleDirTests(unittest.TestCase):
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

    def write(self, rel, text, root=None):
        root = root or self.vault
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def make_demo_dir(self, root=None):
        """造一个完整的文章目录 2026-01-02-demo/（含 meta.json / 正文 / html / qa / 杂项 md / 图）。"""
        root = root or self.vault
        article_dir = root / "2026-01-02-demo"
        (article_dir / "images").mkdir(parents=True, exist_ok=True)
        (article_dir / "meta.json").write_text(
            json.dumps(DEMO_META, ensure_ascii=False, indent=1), encoding="utf-8")
        (article_dir / "02-final.md").write_text(
            "---\ntags: [demo]\n---\n\n# 演示文章\n\n正文第一段。\n", encoding="utf-8")
        (article_dir / "article.html").write_text(
            '<section><h1>演示文章</h1><img src="images/fig-1.png">'
            '<img src="images/missing.png"></section>\n', encoding="utf-8")
        (article_dir / "qa-report.md").write_text(
            "## QA\n\n- 标题与正文一致。\n", encoding="utf-8")
        (article_dir / "outline.md").write_text("# 提纲\n\n不应被推送\n", encoding="utf-8")
        (article_dir / "titles.md").write_text("备选标题\n", encoding="utf-8")
        (article_dir / "images" / "fig-1.png").write_bytes(PNG_A)
        return article_dir

    def configure_endpoint(self, port):
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:%d" % port, "token": "topk_dir_config_token"}
        ))

    def push_args(self, path, **overrides):
        values = {"action": "push", "path": str(path), "public": False,
                  "dry_run": False, "root": None, "assistant": None}
        values.update(overrides)
        return argparse.Namespace(**values)

    def sync_args(self, path, **overrides):
        values = {"action": "sync", "path": str(path), "public": False,
                  "dry_run": False, "root": None, "assistant": None}
        values.update(overrides)
        return argparse.Namespace(**values)

    def run_article(self, args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        return code, buf.getvalue()

    # ── 文章目录 dry-run ──
    def test_article_dir_dry_run_detail(self):
        article_dir = self.make_demo_dir()
        sha = hashlib.sha256(PNG_A).hexdigest()
        code, out = self.run_article(self.push_args(article_dir, dry_run=True))
        self.assertEqual(code, 0, out)
        self.assertIn("2026-01-02-demo", out)
        self.assertIn("演示文章", out)
        self.assertIn("已变化", out)
        self.assertIn("状态: draft/默认", out)
        self.assertIn("日期: 2026-01-02", out)
        self.assertIn("正文: 2026-01-02-demo/02-final.md", out)
        self.assertIn("article.html: 有（改写 1 张图）", out)
        self.assertIn("qa-report: 有", out)
        self.assertIn("brief: 2026-01-02 · t-demo-01", out)
        self.assertIn("boardTopicId: 12", out)
        self.assertIn("images/%s.png ← images/fig-1.png" % sha[:12], out)
        self.assertIn("上传", out)
        self.assertIn("警告", out)
        self.assertIn("找不到图片", out)
        self.assertIn("images/missing.png", out)
        # outline.md / titles.md 不会被当成文章
        self.assertNotIn("提纲", out)
        self.assertNotIn("备选标题", out)
        self.assertNotIn("outline", out)
        self.assertNotIn("titles", out)
        # 不联网、不写 state
        self.assertFalse((self.config_dir / "articles.json").exists())

        # 助手名字在 dry-run 里逐项打印（dry-run 不需要 token）
        code, out = self.run_article(self.push_args(article_dir, dry_run=True, assistant="测试助手"))
        self.assertEqual(code, 0, out)
        self.assertIn("assistant: 测试助手", out)

    # ── 文章目录 push ──
    def test_article_dir_push_full_payload(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        article_dir = self.make_demo_dir()
        sha = hashlib.sha256(PNG_A).hexdigest()
        asset_name = "images/%s.png" % sha[:12]

        code, out = self.run_article(self.push_args(article_dir))
        self.assertEqual(code, 0, out)
        self.assertIn("created", out)
        self.assertEqual(len(server.requests), 1)
        payload = server.requests[0]
        self.assertIn("2026-01-02-demo", server.articles)
        self.assertEqual(payload["title"], "演示文章")
        self.assertEqual(payload["status"], "draft")
        self.assertNotIn("isPublic", payload)
        self.assertEqual(payload["date"], "2026-01-02")
        self.assertEqual(payload["sourcePath"], "2026-01-02-demo/02-final.md")
        self.assertEqual(payload["brief"], {"date": "2026-01-02", "topicId": "t-demo-01"})
        self.assertEqual(payload["boardTopicId"], 12)
        self.assertEqual(payload["qaReport"], "## QA\n\n- 标题与正文一致。\n")
        self.assertEqual(payload["tags"], ["demo"])
        self.assertIn("正文第一段", payload["markdown"])
        # html 图片改写：fig-1 → images/<sha12>.png；缺图 src 原样保留
        self.assertIn('src="%s"' % asset_name, payload["articleHtml"])
        self.assertIn('src="images/missing.png"', payload["articleHtml"])
        self.assertNotIn("fig-1.png", payload["articleHtml"])
        # 对应 asset 带 base64（首次推送、无 state）
        asset = next(item for item in payload["assets"] if item["name"] == asset_name)
        self.assertTrue(asset.get("base64"))
        # contentHash 被 mock 按协议重算校验通过（否则 400 hash_mismatch、推送失败）
        # state 按正文文件绝对路径记录 slug / contentHash / assets
        state = json.loads((self.config_dir / "articles.json").read_text(encoding="utf-8"))
        records = [record for endpoint in state["endpoints"].values()
                   for record in endpoint["files"].values()]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["slug"], "2026-01-02-demo")
        self.assertEqual(records[0]["contentHash"], payload["contentHash"])
        self.assertEqual(records[0]["assets"], {asset_name: sha})

        # 再 sync 一次：内容未变化，不发请求
        code, out = self.run_article(self.sync_args(article_dir))
        self.assertEqual(code, 0, out)
        self.assertIn("未变化", out)
        self.assertEqual(len(server.requests), 1)

    # ── html 引用目录外图片：不改写、不上传、给警告 ──
    def test_article_dir_html_image_outside_dir(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        article_dir = self.make_demo_dir()
        # 目录外真实存在的图片（父目录里）
        (self.vault / "outside.png").write_bytes(PNG_A)
        (article_dir / "article.html").write_text(
            '<section><img src="../outside.png"></section>\n', encoding="utf-8")

        # dry-run：警告可见，不上传
        code, out = self.run_article(self.push_args(article_dir, dry_run=True))
        self.assertEqual(code, 0, out)
        self.assertIn("图片不在文章目录内: ../outside.png", out)
        self.assertIn("警告", out)

        code, out = self.run_article(self.push_args(article_dir))
        self.assertEqual(code, 0, out)
        self.assertEqual(len(server.requests), 1)
        payload = server.requests[0]
        # src 原样保留，不改写
        self.assertIn('src="../outside.png"', payload["articleHtml"])
        outside_name = "images/%s.png" % hashlib.sha256(PNG_A).hexdigest()[:12]
        self.assertNotIn(outside_name, payload["articleHtml"])
        # 不上传：assets 为空（正文无图，html 唯一引用是目录外图片）
        self.assertEqual(payload["assets"], [])

    # ── 父目录 sync：子目录各算一篇 ──
    def test_parent_dir_sync_multiple_articles(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        parent = self.vault / "batch"
        self.make_demo_dir(parent)  # batch/2026-01-02-demo（内含 outline.md / titles.md）
        other = parent / "second-demo"
        self.write("second-demo/meta.json", json.dumps({"title": "第二篇"}, ensure_ascii=False), root=parent)
        self.write("second-demo/02-final.md", "# 第二篇\n\n正文 B。\n", root=parent)
        self.write("second-demo/notes-inside.md", "# 内部笔记\n\n不应推送\n", root=parent)
        self.write("plain-note.md", "# Plain Note\n\n普通单文件。\n", root=parent)

        code, out = self.run_article(self.sync_args(parent))
        self.assertEqual(code, 0, out)
        self.assertEqual(len(server.requests), 3)
        self.assertEqual(sorted(server.articles), ["2026-01-02-demo", "plain-note", "second-demo"])
        # 文章目录内部的其它 .md 不推
        for article in server.articles.values():
            self.assertNotIn("不应推送", article["markdown"])
            self.assertNotIn("提纲", article["markdown"])
            self.assertNotIn("备选标题", article["markdown"])

    # ── slug 修复：不同目录的同名 02-final.md 不再撞 ──
    def test_article_dir_slug_generation_stable(self):
        one = self.vault / "草稿一"
        two = self.vault / "草稿二"
        for directory in (one, two):
            self.write("%s/meta.json" % directory.name, json.dumps({"title": "心结观察"}, ensure_ascii=False), root=self.vault)
            self.write("%s/02-final.md" % directory.name, "# 心结观察\n\n正文。\n")
        entry_one = self.cli._article_dir_entry(one, {"title": "心结观察"}, {})
        entry_two = self.cli._article_dir_entry(two, {"title": "心结观察"}, {})
        self.assertTrue(entry_one["slug"].startswith("n-"), entry_one["slug"])
        self.assertTrue(entry_two["slug"].startswith("n-"), entry_two["slug"])
        self.assertNotEqual(entry_one["slug"], entry_two["slug"])
        # 同一路径稳定
        again = self.cli._article_dir_entry(one, {"title": "心结观察"}, {})
        self.assertEqual(again["slug"], entry_one["slug"])
        # 目录名合法时优先用目录名
        named = self.vault / "named-dir"
        self.write("named-dir/meta.json", json.dumps({"title": "随便"}, ensure_ascii=False))
        self.write("named-dir/02-final.md", "# 随便\n\n正文。\n")
        self.assertEqual(self.cli._article_dir_entry(named, {"title": "随便"}, {})["slug"], "named-dir")
        # meta.slug 不合法 → 跳过并报错
        with self.assertRaises(self.cli.ArticleError):
            self.cli._article_dir_entry(one, {"slug": "bad slug", "title": "T"}, {})

    # ── 助手推送文章目录 ──
    def test_assistant_push_article_dir(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        self.set_env("SUPERME_TOKEN", "topk_dir_assistant_token")
        article_dir = self.make_demo_dir()
        code, out = self.run_article(self.push_args(article_dir, assistant="测试助手"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_dir_assistant_token")
        payload = server.requests[-1]
        self.assertEqual(payload.get("assistant"), "测试助手")
        self.assertEqual(payload.get("status"), "draft")
        self.assertNotIn("isPublic", payload)
        self.assertNotIn("topk_dir_assistant_token", out)
        self.assertNotIn("topk_dir_config_token", out)

    # ── 单文件推送仍可用 ──
    def test_single_file_push_still_works(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        (self.vault / "pic.png").write_bytes(PNG_A)
        note = self.write(
            "single-note.md",
            "---\ntitle: Single Note\ntags: [s]\nstatus: draft\n---\n\n正文单文件。\n\n![[pic.png]]\n",
        )
        # dry-run：单文件模式保持一行式输出，不写 state
        code, out = self.run_article(self.push_args(note, dry_run=True))
        self.assertEqual(code, 0, out)
        self.assertIn("图片 1", out)
        self.assertIn("已变化", out)
        self.assertFalse((self.config_dir / "articles.json").exists())
        # 真实推送
        code, out = self.run_article(self.push_args(note))
        self.assertEqual(code, 0, out)
        self.assertIn("single-note", server.articles)
        self.assertIn("正文单文件", server.articles["single-note"]["markdown"])


if __name__ == "__main__":
    unittest.main()
