# -*- coding: utf-8 -*-
"""superme CLI 2.7.0：article feedback 与 brief pipeline/responses 的单元测试。

照 test_article_auth.py 的写法：MockServer + 环境隔离 + load_cli。
只使用标准库；所有账号名、token、文章内容均为虚构，绝不进仓库。
运行：python3 -m unittest discover -s tests/cli -p 'test_*.py' -v
"""
import argparse
import contextlib
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from test_article import load_cli

ENV_NAMES = (
    "SUPERME_TOKEN", "SUPERME_ENDPOINT", "SUPERME_ASSISTANT",
    "DABAIHUA_CARDS_ASSISTANT_TOKEN", "HANDBOOK_TOKEN",
)

LONG_QUOTE = "这是一段特别长的原文，" * 12  # 132 字，超过 120 要截断

FEEDBACK = {
    "schema": "dabaihua.review-feedback/v1",
    "target": {"type": "article", "id": "12", "title": "示例文章", "slug": "demo-slug", "topicId": None},
    "round": 2,
    "verdict": "changes_requested",
    "overallComment": "整体不错，但有几处要改",
    "reviewer": {"id": 1, "nickname": "虚构审稿人"},
    "submittedAt": "2026-02-01T10:00:00.000Z",
    "contentHash": "a" * 64,
    "counts": {"good": 1, "change": 2},
    "marks": [
        {"type": "change", "quote": "这一段写得太平了。", "prefix": "", "suffix": "",
         "blockIndex": 3, "startOffset": None, "endOffset": None, "comment": "加一个具体例子"},
        {"type": "change", "quote": LONG_QUOTE, "prefix": "", "suffix": "",
         "blockIndex": 4, "startOffset": None, "endOffset": None, "comment": ""},
        {"type": "good", "quote": "开头的比喻很好。", "prefix": "", "suffix": "",
         "blockIndex": 1, "startOffset": None, "endOffset": None, "comment": "保留这个开头"},
    ],
}

PIPELINE = {
    "ok": True,
    "date": "2026-02-01",
    "topicId": 7,
    "pipeline": {"code": "notified", "label": "已通知晴儿"},
    "selection": {"topicId": 7, "title": "简报选题"},
}

RESPONSES = {
    "ok": True,
    "responses": [
        {"date": "2026-02-01", "topicId": 7, "decision": "pick", "rating": 4},
    ],
}


class MockFeedbackServer:
    """最小实现：GET /api/review/article/<slug>/feedback、/api/briefs/responses、
    /api/briefs/<d>/topics/<id>/pipeline。记录每次请求的完整 path（含 query）与
    Authorization 头；force_not_found 可让 feedback 返回 404。"""

    def __init__(self):
        self.requests = []
        self.auth_headers = []
        self.force_not_found = set()
        self.force_null_feedback = set()
        self._server = None
        self.port = None

    def start(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code, payload):
                data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                parsed = urllib.parse.urlparse(self.path)
                path = parsed.path
                query = parsed.query
                outer.requests.append(path + (("?" + query) if query else ""))
                outer.auth_headers.append(self.headers.get("Authorization"))
                if path.startswith("/api/review/article/") and path.endswith("/feedback"):
                    slug = path.split("/api/review/article/", 1)[1][:-len("/feedback")]
                    if slug in outer.force_not_found:
                        self._send(404, {"error": "not found", "code": "not_found"})
                        return
                    if slug in outer.force_null_feedback:
                        self._send(200, {"feedback": None})
                        return
                    # --round 只在 ?round= 里出现；默认（不带参数）取最新一轮
                    if query and int(urllib.parse.parse_qs(query).get("round", ["0"])[0]) == 3:
                        self._send(200, {"feedback": {**FEEDBACK, "round": 3}})
                    else:
                        self._send(200, {"feedback": FEEDBACK})
                    return
                if path == "/api/briefs/responses":
                    self._send(200, RESPONSES)
                    return
                if path.startswith("/api/briefs/") and path.endswith("/pipeline"):
                    self._send(200, PIPELINE)
                    return
                self._send(404, {"error": "not found", "code": "not_found"})

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def stop(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None


class FeedbackCliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.config_dir = Path(self._tmp.name) / "config"
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

    def start_server(self):
        server = MockFeedbackServer()
        server.start()
        self.addCleanup(server.stop)
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:%d" % server.port, "token": "topk_config_token"}
        ))
        return server

    def feedback_args(self, slug, **overrides):
        values = {"action": "feedback", "path": slug, "round": None, "json": False,
                  "assistant": None}
        values.update(overrides)
        return argparse.Namespace(**values)

    def run_feedback(self, args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_article(args)
        return code, buf.getvalue()

    def brief_args(self, action, **overrides):
        values = {"action": action, "pipeline_date": None, "topic_id": None,
                  "date": None, "since": None}
        values.update(overrides)
        return argparse.Namespace(**values)

    def run_brief(self, args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_brief(args)
        return code, buf.getvalue()

    # ── article feedback：默认摘要 ──
    def test_feedback_summary_contains_round_groups_and_marks(self):
        server = self.start_server()
        code, out = self.run_feedback(self.feedback_args("demo-slug"))
        self.assertEqual(code, 0, out)
        self.assertIn("《示例文章》", out)
        self.assertIn("第 2 轮", out)
        self.assertIn("要求修改", out)
        self.assertIn("审稿人 虚构审稿人", out)
        # 审稿时间转成 +08:00 的 YYYY-MM-DD HH:MM，不再原样打 UTC ISO。
        self.assertIn("审稿人 虚构审稿人 · 2026-02-01 18:00", out)
        self.assertNotIn("2026-02-01T10:00:00.000Z", out)
        self.assertIn("总体意见：整体不错，但有几处要改", out)
        self.assertIn("要改（2）", out)
        self.assertIn("写得好（1）", out)
        self.assertIn("「这一段写得太平了。」", out)
        self.assertIn("→ 加一个具体例子", out)
        self.assertIn("「开头的比喻很好。」", out)
        self.assertIn("→ 保留这个开头", out)
        self.assertIn("（未写意见）", out)
        self.assertIn("contentHash: " + "a" * 64, out)
        # 超 120 字的 quote 截断加省略号，且不出现完整长句
        self.assertIn(LONG_QUOTE[:120] + "…", out)
        self.assertNotIn(LONG_QUOTE, out)
        # 请求不带 round 参数（取最新一轮）
        self.assertEqual(server.requests[-1], "/api/review/article/demo-slug/feedback")

    def test_feedback_json_matches_server(self):
        server = self.start_server()
        code, out = self.run_feedback(self.feedback_args("demo-slug", json=True))
        self.assertEqual(code, 0, out)
        payload = json.loads(out)
        self.assertEqual(payload, FEEDBACK)
        # --json 不截断长 quote
        self.assertEqual(payload["marks"][1]["quote"], LONG_QUOTE)

    def test_feedback_round_appends_query(self):
        server = self.start_server()
        code, out = self.run_feedback(self.feedback_args("demo-slug", round=3))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1], "/api/review/article/demo-slug/feedback?round=3")
        self.assertIn("第 3 轮", out)

    def test_feedback_round_2_query(self):
        server = self.start_server()
        code, out = self.run_feedback(self.feedback_args("demo-slug", round=2))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1], "/api/review/article/demo-slug/feedback?round=2")
        self.assertIn("第 2 轮", out)

    # ── article feedback：token ──
    def test_feedback_normal_mode_uses_env_token(self):
        server = self.start_server()
        self.set_env("SUPERME_TOKEN", "topk_env_token")
        code, out = self.run_feedback(self.feedback_args("demo-slug"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_env_token")
        self.assertNotIn("topk_env_token", out)
        self.assertNotIn("topk_config_token", out)

    def test_feedback_assistant_mode_uses_assistant_token(self):
        server = self.start_server()
        self.set_env("DABAIHUA_CARDS_ASSISTANT_TOKEN", "asst_token_1")
        code, out = self.run_feedback(self.feedback_args("demo-slug", assistant="紫薇"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer asst_token_1")
        self.assertNotIn("asst_token_1", out)
        self.assertNotIn("topk_config_token", out)

    def test_feedback_assistant_via_env_variable(self):
        server = self.start_server()
        self.set_env("HANDBOOK_TOKEN", "asst_token_2")
        self.set_env("SUPERME_ASSISTANT", "紫薇")
        code, out = self.run_feedback(self.feedback_args("demo-slug"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer asst_token_2")
        self.assertNotIn("asst_token_2", out)

    # ── article feedback：错误 ──
    def test_feedback_404_message(self):
        server = self.start_server()
        server.force_not_found.add("missing-slug")
        self.set_env("SUPERME_TOKEN", "topk_env_token")
        with self.assertRaises(SystemExit) as ctx:
            self.run_feedback(self.feedback_args("missing-slug"))
        self.assertIn("还没有找到这篇文章的审稿反馈", str(ctx.exception))
        self.assertIn("slug 或轮次不对", str(ctx.exception))

    def test_feedback_null_feedback_message(self):
        server = self.start_server()
        server.force_null_feedback.add("demo-slug")
        with self.assertRaises(SystemExit) as ctx:
            self.run_feedback(self.feedback_args("demo-slug"))
        self.assertIn("还没有找到这篇文章的审稿反馈", str(ctx.exception))

    def test_feedback_401_message(self):
        # 单独起一个所有 GET 都回 401 的服务，测 token 失效提示不泄漏 token
        srv401 = _UnauthorizedServer()
        srv401.start()
        self.addCleanup(srv401.stop)
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:%d" % srv401.port, "token": "topk_config_token"}
        ))
        self.set_env("SUPERME_TOKEN", None)
        with self.assertRaises(SystemExit) as ctx:
            self.run_feedback(self.feedback_args("demo-slug"))
        self.assertIn("未登录或 Key 已失效", str(ctx.exception))
        self.assertNotIn("topk_config_token", str(ctx.exception))

    # ── brief pipeline / responses ──
    def test_brief_pipeline_path_and_assistant_token(self):
        server = self.start_server()
        self.set_env("DABAIHUA_CARDS_ASSISTANT_TOKEN", "asst_token_1")
        code, out = self.run_brief(self.brief_args(
            "pipeline", pipeline_date="2026-02-01", topic_id="7"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1], "/api/briefs/2026-02-01/topics/7/pipeline")
        self.assertEqual(server.auth_headers[-1], "Bearer asst_token_1")
        self.assertNotIn("asst_token_1", out)
        payload = json.loads(out)
        self.assertEqual(payload["pipeline"]["code"], "notified")

    def test_brief_pipeline_token_falls_back_to_config(self):
        server = self.start_server()
        code, out = self.run_brief(self.brief_args(
            "pipeline", pipeline_date="2026-02-01", topic_id="7"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_config_token")

    def test_brief_pipeline_superme_token_wins(self):
        server = self.start_server()
        self.set_env("SUPERME_TOKEN", "topk_env_token")
        self.set_env("HANDBOOK_TOKEN", "asst_token_2")
        code, out = self.run_brief(self.brief_args(
            "pipeline", pipeline_date="2026-02-01", topic_id="7"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_env_token")

    def test_brief_pipeline_missing_args_exit(self):
        self.start_server()
        with self.assertRaises(SystemExit) as ctx:
            self.run_brief(self.brief_args("pipeline", pipeline_date="2026-02-01"))
        self.assertIn("用法", str(ctx.exception))

    def test_brief_responses_with_date_query(self):
        server = self.start_server()
        self.set_env("HANDBOOK_TOKEN", "asst_token_2")
        code, out = self.run_brief(self.brief_args("responses", date="2026-02-01"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1], "/api/briefs/responses?date=2026-02-01")
        self.assertEqual(server.auth_headers[-1], "Bearer asst_token_2")
        payload = json.loads(out)
        self.assertEqual(payload["responses"][0]["decision"], "pick")

    def test_brief_responses_with_since_query(self):
        server = self.start_server()
        code, out = self.run_brief(self.brief_args("responses", since="2026-02-01T00:00:00Z"))
        self.assertEqual(code, 0, out)
        self.assertEqual(
            server.requests[-1],
            "/api/briefs/responses?since=" + urllib.parse.quote("2026-02-01T00:00:00Z", safe=""))
        payload = json.loads(out)
        self.assertEqual(payload["ok"], True)

    def test_brief_responses_without_params_has_no_query(self):
        server = self.start_server()
        code, out = self.run_brief(self.brief_args("responses"))
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1], "/api/briefs/responses")
        self.assertIsNotNone(json.loads(out))

    def test_brief_responses_date_and_since_conflict(self):
        self.start_server()
        with self.assertRaises(SystemExit) as ctx:
            self.run_brief(self.brief_args("responses", date="2026-02-01", since="2026-02-01T00:00:00Z"))
        self.assertIn("只能选一个", str(ctx.exception))


class _UnauthorizedServer:
    """所有 GET 都回 401，用来测 token 失效提示。"""

    def __init__(self):
        self._server = None
        self.port = None

    def start(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                data = json.dumps({"error": "unauthorized"}).encode("utf-8")
                self.send_response(401)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def stop(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None


if __name__ == "__main__":
    unittest.main()
