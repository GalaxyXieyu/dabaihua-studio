# -*- coding: utf-8 -*-
"""superme CLI 文章推送（protocol dabaihua.article-push/v1）的单元测试。

只使用标准库；所有账号名、token、文章内容均为虚构。
运行：python3 -m unittest discover -s tests/cli -p 'test_*.py' -v
"""
import argparse
import base64
import contextlib
import hashlib
import importlib.machinery
import importlib.util
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CLI_PATH = REPO / "public" / "cli" / "superme"
TOPICS_PATH = REPO / "public" / "cli" / "topics"
VECTORS = REPO / "tests" / "fixtures" / "article-push" / "hash-vectors.json"

# 外部环境若带这些变量，会让用例连错地址或带错 token，测试前统一摘除。
ENV_NAMES = (
    "SUPERME_TOKEN", "SUPERME_ENDPOINT", "SUPERME_ASSISTANT",
    "DABAIHUA_CARDS_ASSISTANT_TOKEN", "HANDBOOK_TOKEN",
)

# 1x1 的合法 PNG 字节，仅用于内容寻址，不代表真实图片素材。
PNG_A = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
PNG_B = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def load_cli(config_dir):
    os.environ["TOPICS_CONFIG_DIR"] = str(config_dir)
    name = "superme_cli_under_test"
    loader = importlib.machinery.SourceFileLoader(name, str(CLI_PATH))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def mock_article_hash(payload):
    """按协议 §3 从收到的请求体重算 contentHash，与 CLI/服务端同一套算法。"""
    public = payload.get("isPublic")
    lines = [
        "dabaihua.article-push/v1",
        "title:" + (payload.get("title") or ""),
        "status:" + (payload.get("status") or "draft"),
        "public:" + ("" if public is None else ("true" if public else "false")),
        "date:" + (payload.get("date") or ""),
        "tags:" + "\t".join(payload.get("tags") or []),
    ]
    if payload.get("boardTopicId") is not None:
        lines.append("board:" + str(payload["boardTopicId"]))
    if payload.get("brief"):
        lines.append("brief:%s\t%s" % (payload["brief"].get("date", ""), payload["brief"].get("topicId", "")))
    if payload.get("articleHtml"):
        lines.append("html:" + hashlib.sha256(payload["articleHtml"].encode("utf-8")).hexdigest())
    if payload.get("qaReport"):
        lines.append("qa:" + hashlib.sha256(payload["qaReport"].encode("utf-8")).hexdigest())
    if payload.get("stage"):
        round_value = payload["stage"].get("round")
        lines.append("stage:%s:%s" % (
            payload["stage"].get("name", ""), "" if round_value is None else str(round_value)))
    for cover in sorted(payload.get("covers") or [], key=lambda item: str(item.get("role", ""))):
        lines.append("cover:%s:%s" % (cover.get("role", ""), cover.get("path", "")))
    for asset in sorted(payload.get("assets") or [], key=lambda item: item["name"]):
        lines.append("asset:%s %s" % (asset["name"], asset["sha256"]))
    text = "\n".join(lines) + "\n\n" + (payload.get("markdown") or "")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class MockArticleServer:
    """协议最小实现：PUT /api/articles/<slug> 与 GET /api/articles。

    按协议重算并校验 contentHash（不一致返回 400 hash_mismatch），记录每次请求的
    Authorization 头与 assistant 名字；force_locked 可让某 slug 返回 409 article_locked。
    """

    def __init__(self):
        self.articles = {}
        self.requests = []
        self.force_slug_taken = set()
        self.force_locked = set()
        self.force_round_not_reviewed = set()
        self.served_assets = set()
        self.auth_headers = []
        self.assistants = []
        self._server = None
        self._thread = None
        self.port = None

    def start(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _read(self):
                length = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

            def _send(self, code, payload):
                data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_PUT(self):
                path = urllib.parse.urlparse(self.path).path
                slug = path.split("/api/articles/", 1)[-1]
                payload = self._read()
                outer.requests.append(payload)
                outer.auth_headers.append(self.headers.get("Authorization"))
                outer.assistants.append(payload.get("assistant"))
                if slug in outer.force_slug_taken:
                    self._send(409, {"error": "slug 已被占用", "code": "slug_taken"})
                    return
                if slug in outer.force_locked:
                    self._send(409, {"error": "文章已锁定", "code": "article_locked", "status": "published"})
                    return
                stage = payload.get("stage") or {}
                if slug in outer.force_round_not_reviewed and stage.get("round") is not None:
                    self._send(422, {
                        "error": "第 %s 轮还没有提交审稿" % stage.get("round"),
                        "code": "round_not_reviewed",
                    })
                    return
                given_hash = payload.get("contentHash")
                if given_hash and given_hash != mock_article_hash(payload):
                    self._send(400, {"error": "contentHash 与内容不一致", "code": "hash_mismatch"})
                    return
                missing = []
                for asset in payload.get("assets", []):
                    if "base64" not in asset and (slug, asset["name"]) not in outer.served_assets:
                        missing.append(asset["name"])
                if missing:
                    self._send(422, {"error": "缺少图片", "code": "missing_assets", "missingAssets": missing})
                    return
                for asset in payload.get("assets", []):
                    outer.served_assets.add((slug, asset["name"]))
                existing = outer.articles.get(slug)
                if existing and existing.get("contentHash") == payload.get("contentHash"):
                    self._send(200, {
                        "ok": True, "result": "unchanged", "slug": slug,
                        "url": "/articles/" + slug, "contentHash": payload.get("contentHash"),
                        "isPublic": bool(payload.get("isPublic")), "assets": {"stored": 0, "reused": 0, "removed": 0},
                    })
                    return
                created = existing is None
                outer.articles[slug] = {
                    "title": payload.get("title"),
                    "markdown": payload.get("markdown"),
                    "contentHash": payload.get("contentHash"),
                    "isPublic": payload.get("isPublic"),
                    "status": payload.get("status"),
                }
                self._send(201 if created else 200, {
                    "ok": True, "result": "created" if created else "updated", "slug": slug,
                    "url": "/articles/" + slug, "contentHash": payload.get("contentHash"),
                    "isPublic": bool(payload.get("isPublic")),
                    "assets": {"stored": len(payload.get("assets", [])), "reused": 0, "removed": 0},
                })

            def do_GET(self):
                path = urllib.parse.urlparse(self.path).path
                outer.auth_headers.append(self.headers.get("Authorization"))
                if path == "/api/articles":
                    rows = [{"slug": key, "title": value.get("title"), "isPublic": value.get("isPublic"), "date": None}
                            for key, value in outer.articles.items()]
                    self._send(200, {"articles": rows})
                    return
                self._send(404, {"error": "not found", "code": "not_found"})

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None


class ArticleCliTests(unittest.TestCase):
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

    def write(self, rel, text, root=None):
        root = root or self.vault
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def configure_endpoint(self, port):
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:%d" % port, "token": "topk_made_up_token"}
        ))

    # ── frontmatter ──
    def test_frontmatter_parsing(self):
        text = ('---\ntitle: "Hello World"\ntags: [a, b]\nstatus: published\n'
                'public: true\npublish: no\ndate: 2026-10-02\nslug: hello-world\n---\n# Body\n')
        meta, body = self.cli._parse_frontmatter(text)
        self.assertEqual(meta["title"], "Hello World")
        self.assertEqual(meta["tags"], ["a", "b"])
        self.assertEqual(meta["status"], "published")
        self.assertTrue(meta["public"])
        self.assertFalse(meta["publish"])
        self.assertEqual(meta["date"], "2026-10-02")
        self.assertEqual(meta["slug"], "hello-world")
        self.assertEqual(body, "# Body\n")

        block, _ = self.cli._parse_frontmatter("---\ntags:\n  - x\n  - y\nstatus: draft\n---\nbody")
        self.assertEqual(block["tags"], ["x", "y"])

        comma, _ = self.cli._parse_frontmatter("---\ntags: a, b, c\n---\nbody")
        self.assertEqual(self.cli._article_tags(comma), ["a", "b", "c"])

        plain, body2 = self.cli._parse_frontmatter("# No frontmatter\n\nbody\n")
        self.assertEqual(plain, {})
        self.assertEqual(body2, "# No frontmatter\n\nbody\n")

    # ── title / slug ──
    def test_title_and_slug_rules(self):
        cli = self.cli
        self.assertEqual(cli._article_title({}, "# Real Title\n", Path("x.md")), "Real Title")
        self.assertEqual(cli._article_title({}, "no heading here", Path("fallback.md")), "fallback")
        self.assertEqual(cli._article_title({"title": "FM"}, "# H", Path("x.md")), "FM")

        self.assertEqual(cli._article_generate_slug("Hello World 2026", "a.md"), "hello-world-2026")
        self.assertEqual(cli._article_resolve_slug(
            {"slug": "valid-slug"}, "T", "a.md", Path("/x/a.md"), {}), "valid-slug")
        with self.assertRaises(cli.ArticleError):
            cli._article_resolve_slug({"slug": "bad slug"}, "T", "a.md", Path("/x/a.md"), {})
        state = {"/x/a.md": {"slug": "stored-slug"}}
        self.assertEqual(cli._article_resolve_slug({}, "T", "a.md", Path("/x/a.md"), state), "stored-slug")

        # hash 键用「上级目录名/文件名」：不同目录里同名文件不撞，同一路径稳定
        generated = cli._article_generate_slug("心结方法", "notes/x.md")
        self.assertTrue(generated.startswith("n-"))
        self.assertEqual(len(generated), 12)
        self.assertEqual(generated, cli._article_generate_slug("心结方法", "notes/x.md"))
        slug_a = cli._article_generate_slug("中文标题", "a/02-final.md")
        slug_b = cli._article_generate_slug("中文标题", "b/02-final.md")
        self.assertTrue(slug_a.startswith("n-"))
        self.assertNotEqual(slug_a, slug_b)
        self.assertEqual(
            cli._article_resolve_slug({}, "心结方法", "02-final.md", Path("/vault/a/02-final.md"), {}),
            cli._article_generate_slug("心结方法", "a/02-final.md"),
        )

    # ── contentHash ──
    def test_hash_vectors(self):
        cases = json.loads(VECTORS.read_text(encoding="utf-8"))["cases"]
        self.assertTrue(cases)
        for case in cases:
            body = case["body"]
            actual = self.cli._article_content_hash(
                body.get("title", ""), body.get("status", "draft"), body.get("isPublic"),
                body.get("date"), body.get("tags", []), body.get("assets", []), body["markdown"],
                article_html=body.get("articleHtml"), qa_report=body.get("qaReport"),
                board_topic_id=body.get("boardTopicId"), brief=body.get("brief"),
                stage=body.get("stage"), covers=body.get("covers"),
            )
            self.assertEqual(actual, case["contentHash"], case["name"])

    # ── Obsidian 归一 ──
    def test_obsidian_conversion(self):
        cli = self.cli
        (self.vault / "my image.png").write_bytes(PNG_A)
        (self.vault / "other.png").write_bytes(PNG_B)
        body = (
            "![alt](my image.png)\n"
            "![enc](my%20image.png)\n"
            "![[other.png|300]]\n"
            "%%hidden comment%%\n"
            "==hl==\n"
            "[[Note B]] and [[Note B|别名]]\n"
            "```\n[[not a link]]\n```\n"
        )
        normalizer = cli._ArticleNormalizer(self.vault / "note.md", self.vault, {"note b": "note-b"})
        out = normalizer.normalize(body)
        sha_a = hashlib.sha256(PNG_A).hexdigest()[:12]
        sha_b = hashlib.sha256(PNG_B).hexdigest()[:12]
        self.assertIn("![alt](images/%s.png)" % sha_a, out)
        self.assertIn("![enc](images/%s.png)" % sha_a, out)
        self.assertIn("![other](images/%s.png)" % sha_b, out)
        self.assertNotIn("%%hidden comment%%", out)
        self.assertIn("**hl**", out)
        self.assertIn("[Note B](/articles/note-b)", out)
        self.assertIn("[别名](/articles/note-b)", out)
        self.assertIn("[[not a link]]", out)
        self.assertEqual(len(normalizer.assets), 2)

    def test_remote_image_untouched_and_missing_warns(self):
        cli = self.cli
        normalizer = cli._ArticleNormalizer(self.vault / "note.md", self.vault, {})
        remote = "![r](https://example.com/pic.png)\n"
        self.assertEqual(normalizer.normalize(remote), remote)
        out = normalizer.normalize("![x](nope.png)\n")
        self.assertIn("![x](nope.png)", out)
        self.assertTrue(normalizer.warnings)

    def test_absolute_source_path_never_sent(self):
        # sourcePath 始终是相对 root 的路径
        entry_rel = self.cli._article_relative(self.vault / "sub" / "n.md", self.vault)
        self.assertEqual(entry_rel, "sub/n.md")
        self.assertFalse(entry_rel.startswith("/"))

    # ── dry-run ──
    def test_dry_run_no_network_no_state(self):
        (self.vault / "img.png").write_bytes(PNG_A)
        note = self.write("dry-note.md", "---\ntitle: Dry Run Note\ntags: [alpha]\nstatus: draft\n---\n\n![[img.png]]\n")
        args = argparse.Namespace(action="push", path=str(note), public=False, dry_run=True, root=None)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        out = buf.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("dry-run-note", out)
        self.assertIn("Dry Run Note", out)
        self.assertIn("图片 1", out)
        self.assertIn("已变化", out)
        self.assertFalse((self.config_dir / "articles.json").exists())

    # ── 真实 vault：无 frontmatter 文件、表格、批量 wikilink ──
    def test_vault_table_and_batch_wikilinks(self):
        (self.vault / "img.png").write_bytes(PNG_A)
        # note-b 有 frontmatter，引用 note-a（无 frontmatter）与一张图，并带表格和一个缺失图
        self.write(
            "Note B.md",
            "---\ntitle: Note B\ntags: [x]\nstatus: draft\n---\n\n"
            "| A | B |\n| --- | ---: |\n| 1 | 2 |\n\n"
            "![[img.png|300]]\n\nSee [[Note A]] and [[Note A|别名]].\n\n![m](missing.png)\n",
        )
        self.write("Note A.md", "# Note A\n\nhello without frontmatter\n")

        args = argparse.Namespace(action="push", path=str(self.vault), public=False, dry_run=True, root=None)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        out = buf.getvalue()
        self.assertEqual(code, 0, out)
        self.assertIn("note-a", out)  # 无 frontmatter 文件也能生成 slug
        self.assertIn("note-b", out)
        self.assertIn("警告", out)

        note_index = {"note a": "note-a", "note b": "note-b"}
        normalizer = self.cli._ArticleNormalizer(self.vault / "Note B.md", self.vault, note_index)
        result = normalizer.normalize((self.vault / "Note B.md").read_text(encoding="utf-8"))
        self.assertIn("[Note A](/articles/note-a)", result)
        self.assertIn("[别名](/articles/note-a)", result)
        self.assertIn("| A | B |", result)
        self.assertIn("| --- | ---: |", result)
        self.assertIn("![img](images/%s.png)" % hashlib.sha256(PNG_A).hexdigest()[:12], result)

    # ── 批量收集文件 ──
    def test_default_root_finds_obsidian_vault(self):
        vault = Path(self._tmp.name) / "vault-root"
        (vault / ".obsidian").mkdir(parents=True)
        (vault / "assets").mkdir()
        (vault / "posts" / "deep").mkdir(parents=True)
        note = vault / "posts" / "deep" / "single.md"
        note.write_text("# Single\n\n![[pic in vault.png]]\n", encoding="utf-8")
        (vault / "assets" / "pic in vault.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 16)
        self.assertEqual(self.cli._article_default_root(note), vault)
        self.assertEqual(self.cli._article_default_root(vault / "posts"), vault)
        loose = Path(self._tmp.name) / "loose"
        loose.mkdir()
        self.assertEqual(self.cli._article_default_root(loose / "x.md"), loose)
        normalizer = self.cli._ArticleNormalizer(note, vault, {})
        out = normalizer.normalize(note.read_text(encoding="utf-8"))
        self.assertRegex(out, r"!\[pic in vault\]\(images/[0-9a-f]{12}\.png\)")

    def test_collect_skips_dot_dirs(self):
        self.write("keep.md", "body\n")
        self.write(".obsidian/hidden.md", "body\n")
        self.write("sub/also.md", "body\n")
        names = sorted(item["file"].name for item in self.cli._collect_article_files(self.vault) if "file" in item)
        self.assertEqual(names, ["also.md", "keep.md"])

    # ── push / sync flow ──
    def test_push_sync_flow_and_retry(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)

        note = self.write(
            "flow-note.md",
            "---\ntitle: Flow Note\ntags: [a, b]\nstatus: draft\n---\n\nfirst body\n\n![[pic.png]]\n",
        )
        (self.vault / "pic.png").write_bytes(PNG_A)
        push_args = argparse.Namespace(action="push", path=str(note), public=False, dry_run=False, root=None)

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(push_args)
        self.assertEqual(code, 0, buf.getvalue())
        self.assertIn("created", buf.getvalue())
        slug = "flow-note"
        self.assertIn(slug, server.articles)
        self.assertIn("first body", server.articles[slug]["markdown"])

        # 同内容再次 push -> unchanged，不重复建
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(push_args)
        self.assertEqual(code, 0, buf.getvalue())
        self.assertEqual(len(server.articles), 1)

        # 编辑后 sync -> updated
        note.write_text(
            "---\ntitle: Flow Note\ntags: [a, b]\nstatus: draft\n---\n\nedited body\n\n![[pic.png]]\n",
            encoding="utf-8",
        )
        sync_args = argparse.Namespace(action="sync", path=str(self.vault), public=False, dry_run=False, root=None)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(sync_args)
        self.assertEqual(code, 0, buf.getvalue())
        self.assertIn("edited body", server.articles[slug]["markdown"])

        # 服务端丢了图片 -> 422 后带 base64 重传一次
        server.served_assets.clear()
        note.write_text(
            "---\ntitle: Flow Note\ntags: [a, b]\nstatus: draft\n---\n\nsecond edit\n\n![[pic.png]]\n",
            encoding="utf-8",
        )
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(sync_args)
        self.assertEqual(code, 0, buf.getvalue())
        self.assertIn("second edit", server.articles[slug]["markdown"])
        self.assertEqual(len(server.articles), 1)

    def test_sync_skips_unchanged(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        self.write("stable-note.md", "---\ntitle: Stable Note\n---\n\nunchanged body\n")
        args = argparse.Namespace(action="sync", path=str(self.vault), public=False, dry_run=False, root=None)
        with contextlib.redirect_stdout(io.StringIO()):
            self.cli.cmd_article(args)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        self.assertEqual(code, 0)
        self.assertIn("未变化", buf.getvalue())

    def test_slug_taken_message(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        server.force_slug_taken.add("taken-slug")
        note = self.write("taken.md", "---\nslug: taken-slug\ntitle: Taken\n---\n\nbody\n")
        args = argparse.Namespace(action="push", path=str(note), public=False, dry_run=False, root=None)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        text = buf.getvalue()
        self.assertEqual(code, 1)
        self.assertIn("slug", text)
        self.assertIn("frontmatter", text)

    def test_list_articles(self):
        server = MockArticleServer()
        server.start()
        self.addCleanup(server.stop)
        self.configure_endpoint(server.port)
        server.articles["listed"] = {"title": "Listed", "isPublic": True, "contentHash": "x", "markdown": "m"}
        args = argparse.Namespace(action="list", path=None, public=False, dry_run=False, root=None)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        self.assertEqual(code, 0)
        self.assertIn("listed", buf.getvalue())
        self.assertIn("公开", buf.getvalue())


class CliCopyTests(unittest.TestCase):
    def test_superme_and_topics_identical(self):
        self.assertTrue(CLI_PATH.is_file())
        self.assertTrue(TOPICS_PATH.is_file())
        self.assertEqual(CLI_PATH.read_bytes(), TOPICS_PATH.read_bytes())


if __name__ == "__main__":
    unittest.main()
