#!/usr/bin/env python3
"""
一次性补救脚本：修复后端 items 表里 publishedAt 为 null 的公众号文章。

原理：
  采集端 backfill 早期只读 markdown frontmatter 的 publish_time（常为空），
  导致后端 publishedAt 存成 null。本地 exporter.sqlite 里其实有正确日期（来自
  微信列表 API 的 update_time）。此脚本用本地 DB 的日期重新 import-wechat，
  后端 upsert 的 COALESCE(excluded.published_at, items.published_at) 会用新日期覆盖 null。

用法：
  python3 app/scripts/backfill-published-at.py [--dry-run]

走本地 SSH 隧道 http://127.0.0.1:3210（localhost 免 import 鉴权）。
"""
import json
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ENDPOINT = "http://127.0.0.1:3210"
TOKEN = json.load(open(Path.home() / ".config/topics-cli/config.json"))["token"]
DB_PATH = Path.home() / ".moore/wechat-article-downloader/exporter.sqlite"
SHANGHAI = timezone(timedelta(hours=8))


def api(path, method="GET", body=None, auth=True):
    headers = {"Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = f"Bearer {TOKEN}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{ENDPOINT}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode() or "{}")


def to_iso(value):
    """把 '2026-07-01 13:00:01'（上海时间）归一化为 ISO 字符串。"""
    s = str(value or "").strip()
    if not s:
        return None
    try:
        # 尝试 "YYYY-MM-DD HH:MM:SS" 当上海时间
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=SHANGHAI)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    except ValueError:
        pass
    try:
        # 已经是 ISO
        datetime.fromisoformat(s.replace("Z", "+00:00"))
        return s
    except ValueError:
        return None


def main():
    dry = "--dry-run" in sys.argv
    data = api("/api/dashboard?view=discover")
    items = data.get("items") or []
    sources = {s["id"]: s for s in (data.get("sources") or [])}
    null_items = [i for i in items if not i.get("publishedAt")]
    print(f"后端 null-publishedAt 条目: {len(null_items)}")

    db = sqlite3.connect(DB_PATH)
    # 按 source 分组（import-wechat 需要 accountKey/accountName）
    by_source = {}
    skipped = []
    for i in null_items:
        url = i.get("url", "")
        row = db.execute("SELECT publish_time, title FROM articles WHERE url=?", (url,)).fetchone()
        iso = to_iso(row[0]) if row and row[0] else None
        src = sources.get(i.get("sourceId"))
        wechat_url = src.get("url", "") if src else ""
        if not wechat_url.startswith("wechat://"):
            skipped.append((i["id"], "非微信源或无 source", i.get("sourceName"), url[:50]))
            continue
        if not iso:
            skipped.append((i["id"], "本地 DB 无日期", i.get("sourceName"), url[:50]))
            continue
        account_key = wechat_url[len("wechat://"):]
        account_name = src.get("name") or ""
        by_source.setdefault((account_key, account_name), []).append({
            "title": i.get("title", ""),
            "url": url,
            "publishedAt": iso,
        })

    print(f"可补救（微信+有日期）: {sum(len(v) for v in by_source.values())} 条，{len(by_source)} 个账号")
    print(f"跳过: {len(skipped)} 条")
    for s in skipped[:10]:
        print(f"  跳过 id={s[0]} 原因={s[1]} src={s[2]} url={s[3]}")

    if dry:
        print("\n[dry-run] 以下为将重导的文章：")
        for (key, name), arts in by_source.items():
            print(f"  [{name}] {len(arts)} 篇")
            for a in arts[:2]:
                print(f"    {a['publishedAt']} {a['title'][:40]}")
        return

    total_updated = 0
    for (key, name), arts in by_source.items():
        # 后端单次最多 100 篇
        for i in range(0, len(arts), 50):
            batch = arts[i:i+50]
            resp = api("/api/items", "POST", {
                "action": "import-wechat",
                "accountKey": key,
                "accountName": name,
                "articles": batch,
            }, auth=False)  # localhost 免鉴权
            added = resp.get("added", 0)
            # upsert 对已存在条目 added=0，但 publishedAt 已被 COALESCE 更新
            print(f"  [{name}] 重导 {len(batch)} 篇，新增 {added}（已存在条目日期已更新）")
            total_updated += len(batch) - added
    print(f"\n完成：约 {total_updated} 条已存在条目的 publishedAt 已通过 upsert 补全。")

    # 验证
    data2 = api("/api/dashboard?view=discover")
    items2 = data2.get("items") or []
    still_null = [i for i in items2 if not i.get("publishedAt")]
    print(f"验证：后端剩余 null-publishedAt {len(still_null)} 条（补救前 {len(null_items)}）")


if __name__ == "__main__":
    main()
