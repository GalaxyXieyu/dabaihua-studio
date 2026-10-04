# -*- coding: utf-8 -*-
"""superme CLI `data put/status`（/api/<name>/data）的单元测试。

只使用标准库；所有账号名、token、日报与职业内容均为虚构。
运行：python3 -m unittest discover -s tests/cli -p 'test_*.py' -v
"""
import argparse
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

# 外部环境若带这些变量，会让用例连错地址或带错 token，测试前统一摘除。
ENV_NAMES = (
    "SUPERME_TOKEN", "SUPERME_ENDPOINT", "SUPERME_ASSISTANT",
    "DABAIHUA_CARDS_ASSISTANT_TOKEN", "HANDBOOK_TOKEN",
)

DAILY = {
    "generatedAt": "2026-10-02T10:00:00.000Z",
    "days": [
        {"date": "2026-09-28", "summary": "样例日报", "sections": {}, "repos": [], "repoStats": [], "commits": 1, "tokensM": None},
        {"date": "2026-10-02", "summary": "样例日报", "sections": {}, "repos": [], "repoStats": [], "commits": 2, "tokensM": 1.0},
    ],
}

CAREER = {
    "schema_version": 1,
    "generated_at": "2026-10-02T00:00:00.000Z",
    "header": {},
    "jobs": [{"no": 1}],
    "results": [{"id": "r1"}, {"id": "r2"}],
    "missing": {},
    "pending": [],
}


def load_cli(config_dir):
    os.environ["TOPICS_CONFIG_DIR"] = str(config_dir)
    name = "superme_cli_data_under_test"
    loader = importlib.machinery.SourceFileLoader(name, str(CLI_PATH))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class MockDataServer:
    """协议最小实现：PUT/GET /api/<name>/data。"""

    def __init__(self):
        self.datasets = {}
        self.requests = []
        self.force_422 = False
        self._server = None
        self._thread = None
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

            def do_PUT(self):
                path = urllib.parse.urlparse(self.path).path
                name = path.split("/api/")[1].split("/")[0]
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length).decode("utf-8")
                outer.requests.append((name, body))
                if outer.force_422:
                    self._send(422, {"error": "样例校验失败", "code": "invalid_data"})
                    return
                value = json.loads(body)
                canonical = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
                sha = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
                existing = outer.datasets.get(name)
                if existing and existing["sha256"] == sha:
                    self._send(200, {"status": "unchanged", "name": name, **existing})
                    return
                if name == "daily":
                    days = value.get("days") or []
                    dates = sorted(str(day.get("date")) for day in days if isinstance(day, dict) and day.get("date"))
                    summary = {"days": len(days), "first": dates[0] if dates else None, "last": dates[-1] if dates else None}
                    generated = value.get("generatedAt")
                else:
                    summary = {"jobs": len(value.get("jobs") or []), "results": len(value.get("results") or [])}
                    generated = value.get("generated_at")
                record = {
                    "sha256": sha,
                    "bytes": len(body.encode("utf-8")),
                    "generatedAt": generated,
                    "summary": summary,
                    "uploadedAt": "2026-10-02T04:00:00.000Z",
                    "uploadedBy": "样例管理员",
                }
                outer.datasets[name] = record
                self._send(200, {"status": "updated", "name": name, **record})

            def do_GET(self):
                path = urllib.parse.urlparse(self.path).path
                name = path.split("/api/")[1].split("/")[0]
                record = outer.datasets.get(name)
                if not record:
                    self._send(404, {"error": "not_found", "code": "not_found"})
                    return
                self._send(200, {"name": name, **record})

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self._server.server_address[1]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def stop(self):
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None


class DataCliTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        base = Path(self._tmp.name)
        self.config_dir = base / "config"
        self.cli = load_cli(self.config_dir)
        # 故意把配置里的 endpoint 指向不可达地址，测试 --endpoint 覆盖。
        self.config_dir.mkdir(parents=True, exist_ok=True)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:1", "token": "topk_made_up_token"}
        ))
        self._env_backup = {name: os.environ.pop(name, None) for name in ENV_NAMES}
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for name, value in self._env_backup.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def write_json(self, name, value):
        path = Path(self._tmp.name) / name
        path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def put_args(self, name, path, endpoint, dry_run=False):
        return argparse.Namespace(action="put", name=name, file=str(path), dry_run=dry_run, endpoint=endpoint)

    # ── put ──
    def test_put_updated_then_unchanged(self):
        server = MockDataServer()
        server.start()
        self.addCleanup(server.stop)
        endpoint = "http://127.0.0.1:%d" % server.port
        path = self.write_json("daily.json", DAILY)

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_data(self.put_args("daily", path, endpoint))
        self.assertEqual(code, 0)
        out = buf.getvalue()
        self.assertIn("daily: updated", out)
        self.assertIn("2 天", out)
        self.assertIn("2026-09-28..2026-10-02", out)
        self.assertEqual(len(server.requests), 1)

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_data(self.put_args("daily", path, endpoint))
        self.assertEqual(code, 0)
        self.assertIn("daily: unchanged", buf.getvalue())
        self.assertEqual(len(server.requests), 2)

    def test_put_sends_raw_body_once_no_double_encoding(self):
        server = MockDataServer()
        server.start()
        self.addCleanup(server.stop)
        endpoint = "http://127.0.0.1:%d" % server.port
        path = self.write_json("daily.json", DAILY)
        with contextlib.redirect_stdout(io.StringIO()):
            self.cli.cmd_data(self.put_args("daily", path, endpoint))
        sent = server.requests[0][1]
        # 发出去的是文件原文，不是再被 json.dumps 包一层的字符串。
        self.assertEqual(json.loads(sent), DAILY)
        self.assertFalse(sent.lstrip().startswith('"'))

    def test_put_422_reports_code_and_exits(self):
        server = MockDataServer()
        server.start()
        self.addCleanup(server.stop)
        server.force_422 = True
        endpoint = "http://127.0.0.1:%d" % server.port
        path = self.write_json("career.json", CAREER)
        with self.assertRaises(SystemExit) as ctx:
            self.cli.cmd_data(self.put_args("career", path, endpoint))
        self.assertIn("invalid_data", str(ctx.exception))
        self.assertIn("样例校验失败", str(ctx.exception))

    def test_put_local_validation_fails_without_network(self):
        server = MockDataServer()
        server.start()
        self.addCleanup(server.stop)
        endpoint = "http://127.0.0.1:%d" % server.port
        path = self.write_json("bad.json", {"generatedAt": "x", "days": "no"})
        with self.assertRaises(SystemExit) as ctx:
            self.cli.cmd_data(self.put_args("daily", path, endpoint))
        self.assertIn("校验失败", str(ctx.exception))
        self.assertEqual(server.requests, [])

    def test_put_invalid_json_fails_before_network(self):
        path = Path(self._tmp.name) / "broken.json"
        path.write_text("{not json", encoding="utf-8")
        with self.assertRaises(SystemExit) as ctx:
            self.cli.cmd_data(self.put_args("daily", path, "http://127.0.0.1:1"))
        self.assertIn("不是合法 JSON", str(ctx.exception))

    # ── dry-run ──
    def test_dry_run_validates_and_never_connects(self):
        # endpoint 指向关闭端口；dry-run 必须不联网。
        path = self.write_json("daily.json", DAILY)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_data(self.put_args("daily", path, "http://127.0.0.1:1", dry_run=True))
        self.assertEqual(code, 0)
        out = buf.getvalue()
        self.assertIn("dry-run daily", out)
        self.assertIn("2 天", out)

    # ── status ──
    def test_status_prints_uploaded_and_missing(self):
        server = MockDataServer()
        server.start()
        self.addCleanup(server.stop)
        endpoint = "http://127.0.0.1:%d" % server.port
        # 先上传 daily，career 留空。
        path = self.write_json("daily.json", DAILY)
        with contextlib.redirect_stdout(io.StringIO()):
            self.cli.cmd_data(self.put_args("daily", path, endpoint))

        args = argparse.Namespace(action="status", name=None, file=None, dry_run=False, endpoint=endpoint)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_data(args)
        self.assertEqual(code, 0)
        out = buf.getvalue()
        self.assertIn("daily", out)
        self.assertIn("北京时间", out)
        self.assertIn("2026-10-02 12:00", out)  # 04:00Z → 12:00 +08
        self.assertIn("2 天", out)
        self.assertIn("career", out)
        self.assertIn("未上传", out)

    def test_status_uses_config_endpoint_without_override(self):
        server = MockDataServer()
        server.start()
        self.addCleanup(server.stop)
        (self.config_dir / "config.json").write_text(json.dumps(
            {"endpoint": "http://127.0.0.1:%d" % server.port, "token": "topk_made_up_token"}
        ))
        args = argparse.Namespace(action="status", name=None, file=None, dry_run=False, endpoint=None)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.cmd_data(args)
        self.assertEqual(code, 0)
        self.assertIn("未上传", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
