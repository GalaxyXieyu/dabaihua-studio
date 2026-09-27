#!/usr/bin/env python3
"""WeChat Reading (weread.qq.com) backed 公众号 article-list fetcher.

Replacement for the MP-backend appmsg list API (closed 2026-07-30). Logic ported from
rachelos/we-mp-rss (core/wx/model/weread_mp.py, driver/weread_qr.py), stdlib only
(``qrcode`` is needed only to render the login QR).

Mapping: a 公众号 ``fakeid``/``__biz`` (base64) -> WeRead bookId ``MP_WXS_<b64decode(fakeid)>``.

Commands (all print one JSON object on stdout):
  login-start --qr PATH [--timeout 900]   get a login uid, write QR PNG, then long-poll until the
                                          user scans+confirms in WeChat (run it in the background);
                                          progress is written to login-status.json
  login-status                            print login-status.json
  auth-check                              verify saved cookie (1 request, renews wr_skey if needed)
  renew                                   force /web/login/renewal
  subscribe (--fakeid|--book-id)          add the 公众号 to the WeRead bookshelf (/mp/shelf/addToShelf)
  latest (--fakeid|--book-id) [--name 名称] [--try-list] [--force]
                                          newest article(s) as exporter-like rows. Default path:
                                          /api/mp/cover (newest reviewId) -> skip if unchanged since
                                          last run, else /web/mp/content for title/time/digest/body.
                                          --try-list (or WEREAD_TRY_LIST=1) first tries the list API.
  articles (--fakeid B64 | --book-id MP_WXS_x) [--pages 1] [--name 名称]
                                          list API /web/mp/articles. NOTE: returns -2041 for
                                          web-QR logins as of 2026-09-27 (even with the account
                                          on the shelf); kept for when it comes back.
  cover (--fakeid|--book-id)              raw newest-article probe via /api/mp/cover

Errors carry "fatal": true when the whole run should stop (auth expired / throttled).

Credentials: ~/.moore/wechat-article-downloader/weread-auth.json (0600). Requests are globally
spaced by >= WEREAD_MIN_INTERVAL seconds (default 3), tracked across invocations.
"""
from __future__ import annotations

import argparse
import base64
import html as htmllib
import re
import datetime as dt
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

BASE = "https://weread.qq.com"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)
RUNTIME = Path(os.environ.get("WEREAD_RUNTIME", Path.home() / ".moore" / "wechat-article-downloader"))
AUTH_FILE = RUNTIME / "weread-auth.json"
STATUS_FILE = RUNTIME / "weread-login-status.json"
PACE_FILE = RUNTIME / "weread-last-request.txt"
STATE_FILE = RUNTIME / "weread-state.json"
MIN_INTERVAL = float(os.environ.get("WEREAD_MIN_INTERVAL", "3"))
SHANGHAI = dt.timezone(dt.timedelta(hours=8))
AUTH_ERRORS = {-2010: "用户不存在/未登录", -2012: "登录超时", -2013: "鉴权失败", -2041: "访问受限"}


class WereadError(RuntimeError):
    def __init__(self, code: Any, message: str):
        super().__init__(f"WeRead error {code}: {message}")
        self.code = code
        self.message = message


# ---------------------------------------------------------------- helpers

def now_iso() -> str:
    return dt.datetime.now(SHANGHAI).isoformat(timespec="seconds")


def fmt_ts(ts: Any) -> str:
    try:
        ts = int(ts or 0)
    except (TypeError, ValueError):
        return ""
    return dt.datetime.fromtimestamp(ts, SHANGHAI).strftime("%Y-%m-%d %H:%M:%S") if ts > 0 else ""


def write_private(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def pace() -> None:
    """Keep >= MIN_INTERVAL seconds between any two WeRead requests (across processes)."""
    try:
        last = float(PACE_FILE.read_text().strip())
    except (OSError, ValueError):
        last = 0.0
    wait = last + MIN_INTERVAL - time.time()
    if wait > 0:
        time.sleep(wait)
    PACE_FILE.parent.mkdir(parents=True, exist_ok=True)
    PACE_FILE.write_text(str(time.time()))


def book_id_from(fakeid: str = "", book_id: str = "") -> str:
    if book_id:
        return book_id if book_id.startswith("MP_WXS_") else f"MP_WXS_{book_id}"
    raw = fakeid.strip()
    raw += "=" * (-len(raw) % 4)
    return "MP_WXS_" + base64.b64decode(raw).decode("utf-8")


def mp_url(token: str) -> str:
    # WeRead writes '_' as '~' in article tokens; mp.weixin.qq.com needs '_' back.
    token = str(token or "").strip().replace("~", "_")
    return f"https://mp.weixin.qq.com/s/{urllib.parse.quote(token, safe='')}" if token else ""


def link_from_review_id(review_id: str, book_id: str) -> str:
    prefix = f"{book_id}_"
    token = review_id[len(prefix):] if review_id.startswith(prefix) else review_id.split("_")[-1]
    return mp_url(token)


def cookie_header(cookies: dict[str, str]) -> str:
    return "; ".join(f"{k}={v}" for k, v in cookies.items() if v)


def raise_for_payload(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise WereadError("invalid_response", "response is not a JSON object")
    code = payload.get("errCode", payload.get("errcode", 0))
    try:
        code = int(code or 0)
    except (TypeError, ValueError):
        code = 0
    if code:
        raise WereadError(code, str(payload.get("errMsg") or AUTH_ERRORS.get(code) or code))


def wr_request(method: str, path: str, *, params: dict | None = None, cookies: dict | None = None,
         body: Any = None, jar: http.cookiejar.CookieJar | None = None, timeout: int = 30,
         accept: str = "application/json, text/plain, */*", paced: bool = True):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = {"User-Agent": UA, "Accept": accept, "Accept-Language": "zh-CN,zh;q=0.9",
               "Origin": BASE, "Referer": BASE + "/"}
    data = None
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode()
        headers["Content-Type"] = "application/json;charset=UTF-8"
    if cookies:
        headers["Cookie"] = cookie_header(cookies)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    handlers = [urllib.request.HTTPCookieProcessor(jar)] if jar is not None else []
    if paced:
        pace()
    with urllib.request.build_opener(*handlers).open(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", "replace")
        set_cookies = resp.headers.get_all("Set-Cookie") or []
    return raw, set_cookies


def http_json(method: str, path: str, **kw) -> tuple[dict, list[str]]:
    raw, sc = wr_request(method, path, **kw)
    try:
        return json.loads(raw), sc
    except ValueError as exc:
        raise WereadError("invalid_json", raw[:200]) from exc


def merge_set_cookies(cookies: dict[str, str], set_cookies: list[str]) -> dict[str, str]:
    out = dict(cookies)
    for sc in set_cookies:
        name, _, rest = sc.partition("=")
        value = rest.split(";", 1)[0]
        if name.strip() and value:
            out[name.strip()] = value
    return out


# ---------------------------------------------------------------- auth

def load_auth() -> dict[str, Any]:
    auth = read_json(AUTH_FILE)
    if not auth.get("cookies"):
        raise WereadError("missing_cookie", f"未登录微信读书：先运行 login-start（{AUTH_FILE} 不存在）")
    return auth


def save_auth(auth: dict[str, Any]) -> None:
    auth["updated_at"] = now_iso()
    write_private(AUTH_FILE, auth)


def verify(cookies: dict[str, str]) -> bool:
    payload, _ = http_json("GET", "/web/shelf/sync", params={"userVid": "", "synckey": 0}, cookies=cookies)
    code = payload.get("errCode", 0) if isinstance(payload, dict) else "bad"
    return not code and any(k in payload for k in ("books", "bookCount", "synckey"))


def renew(cookies: dict[str, str]) -> dict[str, str] | None:
    if not cookies.get("wr_rt"):
        return None
    jar = http.cookiejar.CookieJar()
    payload_raw, set_cookies = wr_request("POST", "/web/login/renewal", cookies=cookies,
                                    body={"rq": "%2Fweb%2Fbook%2Fread", "ql": True}, jar=jar)
    updated = merge_set_cookies(cookies, set_cookies)
    if updated.get("wr_skey") and updated.get("wr_skey") != cookies.get("wr_skey"):
        return updated
    try:
        j = json.loads(payload_raw)
        if isinstance(j, dict) and j.get("succ") in (1, True):
            return updated
    except ValueError:
        pass
    return None


def authed_get(path: str, params: dict, auth: dict[str, Any], accept: str | None = None):
    """GET with saved cookies; on a login-timeout error renew wr_skey once and retry."""
    kw = {"accept": accept} if accept else {}
    for attempt in (0, 1):
        raw, sc = wr_request("GET", path, params=params, cookies=auth["cookies"], **kw)
        if sc:
            auth["cookies"] = merge_set_cookies(auth["cookies"], sc)
            save_auth(auth)
        if accept and "html" in accept:
            return raw
        try:
            payload = json.loads(raw)
        except ValueError as exc:
            raise WereadError("invalid_json", raw[:200]) from exc
        code = payload.get("errCode", 0) if isinstance(payload, dict) else 0
        if attempt == 0 and code in (-2012, -2013):
            renewed = renew(auth["cookies"])
            if renewed:
                auth["cookies"] = renewed
                auth["last_renewal"] = now_iso()
                save_auth(auth)
                continue
        raise_for_payload(payload)
        return payload
    raise WereadError("auth", "renewal did not help")


# ---------------------------------------------------------------- login

def set_status(**fields) -> None:
    status = read_json(STATUS_FILE)
    status.update(fields, updated_at=now_iso())
    write_private(STATUS_FILE, status)


def cmd_login_start(args) -> dict[str, Any]:
    import qrcode  # noqa: PLC0415  (only needed here)

    jar = http.cookiejar.CookieJar()
    payload, _ = http_json("GET", "/api/auth/getLoginUid", jar=jar, timeout=20)
    uid = payload.get("uid") or (payload.get("data") or {}).get("uid")
    if not uid:
        raise WereadError("no_uid", json.dumps(payload)[:200])
    confirm_url = f"{BASE}/web/confirm?uid={uid}"
    qr_path = Path(args.qr).resolve()
    qr_path.parent.mkdir(parents=True, exist_ok=True)
    img = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=4)
    img.add_data(confirm_url)
    img.make(fit=True)
    img.make_image(fill_color="black", back_color="white").save(str(qr_path))
    started = time.time()
    deadline = started + args.timeout
    write_private(STATUS_FILE, {})
    set_status(state="waiting_scan", qr_path=str(qr_path), started_at=now_iso(), pid=os.getpid(),
               expires_at=dt.datetime.fromtimestamp(deadline, SHANGHAI).isoformat(timespec="seconds"))
    print(json.dumps({"ok": True, "state": "waiting_scan", "qr_path": str(qr_path)}, ensure_ascii=False), flush=True)

    polls = 0
    while time.time() < deadline:
        polls += 1
        try:
            info, set_cookies = http_json("GET", "/api/auth/getLoginInfo", params={"uid": uid, "otp": ""},
                                          jar=jar, timeout=75, paced=False)
        except (urllib.error.URLError, TimeoutError, OSError, WereadError) as exc:
            set_status(last_poll_error=str(exc)[:200], polls=polls)
            time.sleep(3)
            continue
        inner = info.get("data") or {}
        if info.get("succeed") or inner.get("succeed"):
            cookies = {c.name: c.value for c in jar if c.value}
            cookies = merge_set_cookies(cookies, set_cookies)
            vid = str(info.get("webLoginVid") or info.get("vid") or inner.get("vid") or cookies.get("wr_vid") or "")
            if vid and not cookies.get("wr_vid"):
                cookies["wr_vid"] = vid
            rt = info.get("refreshToken") or inner.get("refreshToken") or ""
            if rt and not cookies.get("wr_rt"):
                cookies["wr_rt"] = urllib.parse.quote(rt, safe="")
            at = info.get("accessToken") or inner.get("accessToken") or ""
            if at and not cookies.get("wr_skey"):
                cookies["wr_skey"] = at
            ok = False
            for _ in range(2):
                if verify(cookies):
                    ok = True
                    break
                renewed = renew(cookies)
                if renewed:
                    cookies = renewed
            auth = {"cookies": cookies, "vid": vid, "login_at": now_iso(), "verified": ok}
            save_auth(auth)
            set_status(state="logged_in" if ok else "login_unverified", vid=vid, polls=polls,
                       cookie_names=sorted(cookies))
            return {"ok": ok, "state": "logged_in" if ok else "login_unverified", "vid": vid}
        logic = info.get("logicCode") or ""
        if logic == "NEED_OTP":
            set_status(state="need_otp", polls=polls)
            return {"ok": False, "state": "need_otp"}
        set_status(state="waiting_scan", polls=polls, last_logic_code=str(logic))
        time.sleep(1)
    set_status(state="expired", polls=polls)
    return {"ok": False, "state": "expired"}


# ---------------------------------------------------------------- articles

def parse_articles(payload: dict[str, Any], book_id: str, name: str) -> tuple[list[dict], int]:
    groups = payload.get("reviews") or []
    rows = []
    for group in groups:
        for sub in group.get("subReviews") or []:
            review = sub.get("review") or {}
            mp = review.get("mpInfo") or {}
            rid = review.get("reviewId") or sub.get("reviewId")
            if not rid:
                continue
            ts = mp.get("time") or review.get("createTime") or group.get("createTime")
            rows.append({
                "msgid": rid,
                "title": mp.get("title", ""),
                "url": mp_url(mp.get("originalId", "")) or link_from_review_id(rid, book_id),
                "digest": mp.get("content") or review.get("content", ""),
                "cover_url": mp.get("pic_url", ""),
                "author": mp.get("author") or name,
                "account_name": name or mp.get("mpName", ""),
                "publish_time": fmt_ts(ts),
                "create_time": fmt_ts(review.get("createTime")),
                "read_count": mp.get("readNum"),
                "like_count": mp.get("likeNum"),
            })
    return rows, len(groups)


def cmd_articles(args) -> dict[str, Any]:
    auth = load_auth()
    book_id = book_id_from(args.fakeid or "", args.book_id or "")
    rows: list[dict] = []
    offset = 0
    pages = 0
    for _ in range(max(1, args.pages)):
        payload = authed_get("/web/mp/articles", {"bookId": book_id, "offset": offset}, auth)
        page_rows, groups = parse_articles(payload, book_id, args.name or "")
        pages += 1
        rows.extend(page_rows)
        if not groups:
            break
        offset += groups
    return {"ok": True, "source": "weread", "book_id": book_id, "pages": pages,
            "count": len(rows), "articles": rows}


def cmd_cover(args) -> dict[str, Any]:
    auth = load_auth()
    book_id = book_id_from(args.fakeid or "", args.book_id or "")
    payload = authed_get("/api/mp/cover", {"bookId": book_id}, auth)
    rid = payload.get("reviewId") or ""
    return {"ok": bool(rid), "book_id": book_id, "title": payload.get("title", ""),
            "url": link_from_review_id(rid, book_id) if rid else "", "raw_keys": sorted(payload)}


# ---------------------------------------------------------------- latest (cover + content)

FATAL_CODES = {-2010, -2012, -2013, 429}


def is_fatal(code: Any) -> bool:
    """Stop the whole run on auth failures and throttling; per-account problems are not fatal."""
    try:
        code = int(code)
    except (TypeError, ValueError):
        return code in ("missing_cookie", "throttled")
    return code in FATAL_CODES or code >= 500


def js_var(page: str, name: str) -> str:
    for pattern in (
        rf"var\s+{name}\s*=\s*htmlDecode\(\s*([\"'])(.*?)\1\s*\)",
        rf"var\s+{name}\s*=\s*([\"'])(.*?)\1\s*\.html\(",
        rf"var\s+{name}\s*=\s*([\"'])((?:(?!\1).)+)\1\s*(?:\|\||;|\n)",
        rf"var\s+{name}\s*=\s*\"\"\s*\|\|\s*([\"'])((?:(?!\1).)+)\1",
    ):
        m = re.search(pattern, page, re.S)
        if m and m.group(2).strip():
            return htmllib.unescape(m.group(2).strip())
    return ""


_BLOCK_TAGS = {"p", "section", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "tr", "figure"}


def html_to_markdown(fragment: str) -> str:
    """Small, dependency-free converter for #js_content: headings, paragraphs, images, bold, lists."""
    from html.parser import HTMLParser

    class Conv(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.out: list[str] = []
            self.skip = 0

        def handle_starttag(self, tag, attrs):
            a = dict(attrs)
            if tag in ("script", "style"):
                self.skip += 1
            elif tag == "img":
                src = a.get("data-src") or a.get("src") or ""
                if src.startswith("http"):
                    self.out.append(f"\n\n![]({src})\n\n")
            elif tag == "br":
                self.out.append("\n")
            elif tag in ("strong", "b"):
                self.out.append("**")
            elif tag in _BLOCK_TAGS:
                self.out.append("\n\n")
                if tag[0] == "h" and tag[1:].isdigit():
                    self.out.append("#" * int(tag[1:]) + " ")
                elif tag == "li":
                    self.out.append("- ")
                elif tag == "blockquote":
                    self.out.append("> ")

        def handle_endtag(self, tag):
            if tag in ("script", "style"):
                self.skip = max(0, self.skip - 1)
            elif tag in ("strong", "b"):
                self.out.append("**")
            elif tag in _BLOCK_TAGS:
                self.out.append("\n\n")

        def handle_data(self, data):
            if not self.skip:
                self.out.append(re.sub(r"[ \t\r\n\u00a0]+", " ", data))

    conv = Conv()
    conv.feed(fragment)
    text = "".join(conv.out)
    text = re.sub(r"\*\*\s*\*\*", "", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_js_content(page: str) -> str:
    m = re.search(r'<div[^>]+id=["\']js_content["\'][^>]*>', page)
    if not m:
        return ""
    start, depth, i = m.end(), 1, m.end()
    for tag in re.finditer(r"<(/?)div\b[^>]*>", page[start:]):
        depth += -1 if tag.group(1) else 1
        if depth == 0:
            return page[start:start + tag.start()]
    return page[start:]


def parse_content_page(page: str, review_id: str, book_id: str, name: str) -> dict[str, Any]:
    ct = js_var(page, "ct") or (re.search(r'create_time\s*=\s*"(\d{9,})"', page) or [None, ""])[1]
    biz, mid, idx, sn = (js_var(page, k) for k in ("biz", "mid", "idx", "sn"))
    long_url = (f"https://mp.weixin.qq.com/s?__biz={urllib.parse.quote(biz)}&mid={mid}&idx={idx}&sn={sn}"
                if biz and mid and idx and sn else "")
    body = extract_js_content(page)
    return {
        "msgid": review_id,
        "title": js_var(page, "msg_title"),
        "url": link_from_review_id(review_id, book_id),
        "long_url": long_url,
        "digest": js_var(page, "msg_desc"),
        "cover_url": js_var(page, "msg_cdn_url"),
        "author": name or js_var(page, "nickname"),
        "account_name": js_var(page, "nickname") or name,
        "publish_time": fmt_ts(ct),
        "create_time": fmt_ts(ct),
        "content_markdown": html_to_markdown(body) if body else "",
        "source": "weread-cover",
    }


def cmd_subscribe(args) -> dict[str, Any]:
    auth = load_auth()
    book_id = book_id_from(args.fakeid or "", args.book_id or "")
    raw, _ = wr_request("POST", "/mp/shelf/addToShelf", cookies=auth["cookies"], body={"bookIds": [book_id]})
    payload = json.loads(raw)
    raise_for_payload(payload)
    return {"ok": bool(payload.get("succ", 1)), "book_id": book_id, "status": "on_shelf"}


def cmd_latest(args) -> dict[str, Any]:
    auth = load_auth()
    book_id = book_id_from(args.fakeid or "", args.book_id or "")
    name = args.name or ""
    if args.try_list or os.environ.get("WEREAD_TRY_LIST") == "1":
        try:
            payload = authed_get("/web/mp/articles", {"bookId": book_id, "offset": 0}, auth)
            rows, _ = parse_articles(payload, book_id, name)
            if rows:
                return {"ok": True, "source": "weread-list", "book_id": book_id, "count": len(rows), "articles": rows}
        except WereadError as exc:
            if exc.code != -2041:
                raise
    state = read_json(STATE_FILE)
    cover = authed_get("/api/mp/cover", {"bookId": book_id}, auth)
    review_id = str(cover.get("reviewId") or "")
    if not review_id:
        return {"ok": True, "source": "weread-cover", "book_id": book_id, "count": 0, "articles": [],
                "note": "公众号在微信读书里没有文章"}
    avatar = str(cover.get("avatar") or "")
    pending = (state.get(book_id) or {}).get("pending") or {}
    if pending.get("msgid") == review_id:
        # fetched earlier but not yet confirmed imported: reuse without another content request
        return {"ok": True, "source": "weread-cover", "book_id": book_id, "count": 1, "articles": [pending],
                "avatar_url": avatar, "reused_pending": True}
    if not args.force and (state.get(book_id) or {}).get("review_id") == review_id:
        return {"ok": True, "source": "weread-cover", "book_id": book_id, "count": 0, "articles": [],
                "unchanged": True, "latest_title": cover.get("title", ""), "avatar_url": avatar}
    page = authed_get("/web/mp/content", {"reviewId": review_id}, auth, accept="text/html,application/xhtml+xml,*/*")
    row = parse_content_page(page, review_id, book_id, name or str(cover.get("name") or ""))
    row["title"] = row["title"] or str(cover.get("title") or "")
    row["cover_url"] = row["cover_url"] or str(cover.get("pic") or "")
    if not row["publish_time"]:
        row["publish_time"] = now_iso()[:19].replace("T", " ")
        row["publish_time_estimated"] = True
    # Not marked as seen until the caller confirms the import (`seen` command).
    state.setdefault(book_id, {})["pending"] = row
    write_private(STATE_FILE, state)
    return {"ok": True, "source": "weread-cover", "book_id": book_id, "count": 1, "articles": [row],
            "avatar_url": avatar}


def cmd_seen(args) -> dict[str, Any]:
    """Mark a reviewId as imported (local only, no network)."""
    book_id = book_id_from(args.fakeid or "", args.book_id or "")
    state = read_json(STATE_FILE)
    entry = state.get(book_id) or {}
    pending = entry.pop("pending", None) or {}
    entry.update(review_id=args.review_id, title=pending.get("title", entry.get("title", "")),
                 publish_time=pending.get("publish_time", entry.get("publish_time", "")), seen_at=now_iso())
    state[book_id] = entry
    write_private(STATE_FILE, state)
    return {"ok": True, "book_id": book_id, "review_id": args.review_id}


def cmd_auth_check(_args) -> dict[str, Any]:
    auth = load_auth()
    if verify(auth["cookies"]):
        return {"ok": True, "status": "valid", "vid": auth.get("vid"), "login_at": auth.get("login_at")}
    renewed = renew(auth["cookies"])
    if renewed and verify(renewed):
        auth["cookies"] = renewed
        auth["last_renewal"] = now_iso()
        save_auth(auth)
        return {"ok": True, "status": "renewed", "vid": auth.get("vid")}
    return {"ok": False, "status": "expired", "error": "微信读书登录已失效，需要重新扫码"}


def cmd_renew(_args) -> dict[str, Any]:
    auth = load_auth()
    renewed = renew(auth["cookies"])
    if not renewed:
        return {"ok": False, "status": "renew_failed"}
    auth["cookies"] = renewed
    auth["last_renewal"] = now_iso()
    save_auth(auth)
    return {"ok": True, "status": "renewed"}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("login-start")
    s.add_argument("--qr", required=True)
    s.add_argument("--timeout", type=int, default=900)
    sub.add_parser("login-status")
    s = sub.add_parser("seen")
    s.add_argument("--fakeid", default="")
    s.add_argument("--book-id", default="")
    s.add_argument("--review-id", required=True)
    sub.add_parser("auth-check")
    sub.add_parser("renew")
    for name in ("articles", "cover", "latest", "subscribe"):
        s = sub.add_parser(name)
        s.add_argument("--fakeid", default="")
        s.add_argument("--book-id", default="")
        s.add_argument("--name", default="")
        if name == "articles":
            s.add_argument("--pages", type=int, default=1)
        if name == "latest":
            s.add_argument("--try-list", action="store_true")
            s.add_argument("--force", action="store_true")
    args = p.parse_args()
    try:
        if args.cmd == "login-status":
            result = read_json(STATUS_FILE) or {"state": "none"}
        else:
            result = {"login-start": cmd_login_start, "auth-check": cmd_auth_check, "renew": cmd_renew,
                      "articles": cmd_articles, "cover": cmd_cover, "latest": cmd_latest,
                      "subscribe": cmd_subscribe, "seen": cmd_seen}[args.cmd](args)
    except WereadError as exc:
        result = {"ok": False, "code": exc.code, "error": exc.message, "fatal": is_fatal(exc.code)}
    except urllib.error.HTTPError as exc:
        result = {"ok": False, "code": exc.code, "error": f"HTTP {exc.code}", "fatal": is_fatal(exc.code)}
    except (urllib.error.URLError, OSError) as exc:
        result = {"ok": False, "code": "network_error", "error": str(exc), "fatal": False}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
