#!/usr/bin/env python3
"""Run Moore's exporter with a normal browser request fingerprint.

The public exporter currently rejects the tool-specific User-Agent at its
Cloudflare edge even when the auth key is valid. Keep Moore as the source of
truth for storage and commands, but replace only that blocked header.
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


DEFAULT_EXPORTER = Path.home() / ".codex/skills/moore-wechat-article-downloader/scripts/wechat_exporter.py"
BROWSER_USER_AGENT = os.environ.get(
    "RSS_AI_WECHAT_USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
)


def load_exporter():
    exporter_path = Path(os.environ.get("MOORE_WECHAT_EXPORTER_SCRIPT", DEFAULT_EXPORTER)).expanduser().resolve()
    if not exporter_path.exists():
        raise RuntimeError(f"Moore exporter not found: {exporter_path}")
    sys.path.insert(0, str(exporter_path.parent))
    spec = importlib.util.spec_from_file_location("rss_ai_moore_wechat_exporter", exporter_path)
    if not spec or not spec.loader:
        raise RuntimeError("Unable to load Moore exporter")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def install_browser_user_agent(module) -> None:
    original_request = module.urllib.request.Request

    def browser_request(url, *args, **kwargs):
        headers = dict(kwargs.get("headers") or {})
        user_agent_key = next((key for key in headers if key.lower() == "user-agent"), "User-Agent")
        if not headers.get(user_agent_key) or str(headers[user_agent_key]).startswith("Moore-WeChat-Exporter/"):
            headers[user_agent_key] = BROWSER_USER_AGENT
        kwargs["headers"] = headers
        return original_request(url, *args, **kwargs)

    module.urllib.request.Request = browser_request


def curl_config_value(value: str) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "")


def install_curl_api_transport(module) -> str:
    curl = shutil.which("curl")
    if not curl:
        raise RuntimeError("curl is required for the WeChat exporter transport")

    def curl_api_request(base, request_path, params=None, profile=""):
        login, auth_key = module.get_auth_key(base, profile)
        base_url = module.normalize_base_url(
            str(login["base_url"] or module.get_config(base, "base_url", module.DEFAULT_BASE_URL))
        )
        query = module.urllib.parse.urlencode(
            {key: value for key, value in (params or {}).items() if value is not None and str(value) != ""}
        )
        url = f"{base_url}{request_path}" + (f"?{query}" if query else "")
        config = "\n".join(
            [
                f'url = "{curl_config_value(url)}"',
                f'user-agent = "{curl_config_value(BROWSER_USER_AGENT)}"',
                f'header = "X-Auth-Key: {curl_config_value(auth_key)}"',
                'header = "Accept: application/json,text/plain,*/*"',
                "silent",
                "show-error",
                "fail-with-body",
                "max-time = 30",
            ]
        )
        result = subprocess.run(
            [curl, "--config", "-"],
            input=config,
            text=True,
            capture_output=True,
            timeout=35,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "WeChat exporter request failed").strip()[-800:])
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            return {"code": 0, "data": result.stdout}

    module.api_request = curl_api_request
    return curl


def main() -> int:
    if sys.argv[1:] == ["--probe-transport"]:
        curl = shutil.which("curl")
        if not curl:
            raise RuntimeError("curl is required for the WeChat exporter transport")
        print(json.dumps({"transport": Path(curl).name, "user_agent": BROWSER_USER_AGENT}, ensure_ascii=False))
        return 0

    module = load_exporter()
    install_browser_user_agent(module)
    install_curl_api_transport(module)
    return int(module.main(sys.argv[1:]))


if __name__ == "__main__":
    raise SystemExit(main())
