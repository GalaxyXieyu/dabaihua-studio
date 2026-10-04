# -*- coding: utf-8 -*-
"""superme CLI 2.7.0：events 子命令（助手事件日志兜底拉取）的单元测试。

照 test_article_feedback.py 的写法：MockServer + 环境隔离 + load_cli。
只使用标准库；所有 token、事件内容均为虚构，绝不进仓库。
运行：python3 -m unittest tests/cli/test_events.py -v
"""
import argparse
import argparse
import contextlib
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# 仓库根目录运行（python3 -m unittest tests/cli/test_events.py）时补上同目录，
# 便于复用 test_article.load_cli；在 tests/cli 里直接跑也兼容。
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_article import load_cli

ENV_NAMES = (
    "SUPERME_TOKEN", "SUPERME_ENDPOINT", "SUPERME_ASSISTANT",
    "DABAIHUA_CARDS_ASSISTANT_TOKEN", "HANDBOOK_TOKEN",
)

EVENTS = {
    "events": [
        {"id": 3, "key": "brief.select", "event": "select", "ref": "2026-10-02/kb-3",
         "state": "delivered", "httpStatus": 204, "error": None,
         "createdAt": "2026-10-06T13:00:01.000Z", "payload": {"event": "select"}},
        {"id": 4, "key": "article.review_submitted", "event": "article_review_submitted",
         "ref": "demo-slug#2", "state": "failed", "httpStatus": 500, "error": "HTTP 500",
         "createdAt": "2026-10-06T13:05:00.000Z", "payload": None},
    ],
    "nextAfterId": 4,
}

EMPTY_EVENTS = {"events": []}


class MockEventsServer:
    """最小实现：GET /api/assistant-events。记录每次请求的完整 path（含 query）
    与 Authorization 头；force_payload 可换掉响应体（如空页）。"""

    def __init__(self):
        self.requests = []
        self.auth_headers = []
        self.force_payload = None
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
                outer.requests.append(self.path)
                outer.auth_headers.append(self.headers.get("Authorization"))
                if parsed.path == "/api/assistant-events":
                    payload = dict(outer.force_payload) if outer.force_payload else dict(EVENTS)
                    if "nextAfterId" not in payload:
                        # 空页时服务端契约：沿用请求的 afterId。
                        query = urllib.parse.parse_qs(parsed.query)
                        payload["nextAfterId"] = int((query.get("afterId") or ["0"])[0])
                    self._send(200, payload)
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


class EventsCliTests(unittest.TestCase):
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
        server = MockEventsServer()
        server.start()
        self.addCleanup(server.stop)
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:%d" % server.port, "token": "topk_config_token"}
        ))
        return server

    def events_args(self, **overrides):
        values = {"after_id": None, "since": None, "key": None, "limit": None,
                  "json": False, "follow_state": False}
        values.update(overrides)
        return argparse.Namespace(**values)

    def run_events(self, **overrides):
        args = self.events_args(**overrides)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_events(args)
        return code, buf.getvalue()

    # ── 输出格式 ──
    def test_default_line_format_and_next_hint(self):
        server = self.start_server()
        code, out = self.run_events()
        self.assertEqual(code, 0, out)
        # 一行一条：#<id> +08:00 时间 key ref state[ http <status>]；ref 为空给 -。
        self.assertIn("#3 2026-10-06 21:00:01 brief.select 2026-10-02/kb-3 delivered", out)
        self.assertIn("#4 2026-10-06 21:05:00 article.review_submitted demo-slug#2 failed http 500", out)
        self.assertIn("下次用 --after-id 4", out)
        # 不带参数时请求不带 query；token 用 config。
        self.assertEqual(server.requests[-1], "/api/assistant-events")
        self.assertEqual(server.auth_headers[-1], "Bearer topk_config_token")
        self.assertNotIn("topk_config_token", out)

    def test_empty_events_message(self):
        server = self.start_server()
        server.force_payload = EMPTY_EVENTS
        code, out = self.run_events(after_id=9)
        self.assertEqual(code, 0, out)
        self.assertIn("（没有事件）", out)
        self.assertIn("下次用 --after-id 9", out)
        self.assertEqual(server.requests[-1], "/api/assistant-events?afterId=9")

    # ── 请求参数 ──
    def test_query_params_forwarded(self):
        server = self.start_server()
        code, out = self.run_events(after_id=2, since="2026-10-06T00:00:00Z",
                                    key="brief.select, article.review_submitted", limit=10)
        self.assertEqual(code, 0, out)
        # key 去空白后逗号拼接（逗号不转义），since 整体转义。
        self.assertEqual(
            server.requests[-1],
            "/api/assistant-events?afterId=2"
            "&since=2026-10-06T00%3A00%3A00Z"
            "&key=brief.select,article.review_submitted&limit=10",
        )

    # ── --json ──
    def test_json_output_matches_server(self):
        server = self.start_server()
        code, out = self.run_events(json=True)
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(out), EVENTS)

    # ── token 链：助手链再退回 config（同 brief）──
    def test_assistant_token_via_env(self):
        server = self.start_server()
        self.set_env("DABAIHUA_CARDS_ASSISTANT_TOKEN", "asst_token_1")
        code, out = self.run_events()
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer asst_token_1")
        self.assertNotIn("asst_token_1", out)

    def test_superme_token_beats_assistant_token(self):
        server = self.start_server()
        self.set_env("SUPERME_TOKEN", "topk_env_token")
        self.set_env("DABAIHUA_CARDS_ASSISTANT_TOKEN", "asst_token_1")
        code, out = self.run_events()
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer topk_env_token")

    def test_handbook_token_before_config(self):
        server = self.start_server()
        self.set_env("HANDBOOK_TOKEN", "asst_token_2")
        code, out = self.run_events()
        self.assertEqual(code, 0, out)
        self.assertEqual(server.auth_headers[-1], "Bearer asst_token_2")

    # ── --follow-state：写游标并复用 ──
    def test_follow_state_writes_and_reuses_cursor(self):
        server = self.start_server()
        cursor = self.config_dir / "events-cursor.json"
        code, out = self.run_events(after_id=1, follow_state=True)
        self.assertEqual(code, 0, out)
        self.assertTrue(cursor.exists(), "游标文件应写入 CONFIG_DIR/events-cursor.json")
        data = json.loads(cursor.read_text())
        self.assertEqual(data, {"http://127.0.0.1:%d" % server.port: 4})

        # 下次不给 --after-id：自动从游标接着拉。
        code, out = self.run_events()
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1], "/api/assistant-events?afterId=4")

        # 显式 --after-id 优先于游标。
        code, out = self.run_events(after_id=2)
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1], "/api/assistant-events?afterId=2")

    def test_no_follow_state_does_not_write_cursor(self):
        server = self.start_server()
        cursor = self.config_dir / "events-cursor.json"
        code, out = self.run_events()
        self.assertEqual(code, 0, out)
        self.assertFalse(cursor.exists(), "只有 --follow-state 才写游标文件")

    def test_cursor_ignored_for_other_endpoint(self):
        server = self.start_server()
        cursor = self.config_dir / "events-cursor.json"
        cursor.parent.mkdir(parents=True, exist_ok=True)
        cursor.write_text(json.dumps({"https://other.example.com": 99}))
        code, out = self.run_events()
        self.assertEqual(code, 0, out)
        self.assertEqual(server.requests[-1], "/api/assistant-events")

    # ── 参数校验 ──
    def test_invalid_key_and_limit_exit_with_error(self):
        self.start_server()
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stdout(io.StringIO()):
                self.cli.cmd_events(self.events_args(key="  ,  "))
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stdout(io.StringIO()):
                self.cli.cmd_events(self.events_args(limit=0))
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stdout(io.StringIO()):
                self.cli.cmd_events(self.events_args(limit=201))


if __name__ == "__main__":
    unittest.main()
