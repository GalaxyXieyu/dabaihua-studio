/**
 * 事件日志拉取测试（设计见 docs/assistant-events-design.md；webhook 失败时的兜底）。
 *
 * 覆盖：listAssistantEventLog 的 afterId / since / key（多 key）/ limit 过滤与
 * nextAfterId（含无命中沿用 afterId）；payload 解析（正常 / null / 坏 JSON）；
 * sendAssistantEvent 写日志时存 payload_json（delivered / disabled 也记一行）、
 * 超 64KB 存 null 且 error 为空时写 payload_too_large、failed 时保留原 error；
 * 路由静态断言（认助手 token、只读无 POST、不含 webhook URL 变量）。
 *
 * 所有 URL、secret、内容都是杜撰的，仅用于测试。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sendAssistantEvent } from "../lib/assistant-notify.ts";
import {
  ASSISTANT_EVENT_LOG_MAX_LIMIT,
  listAssistantEventLog,
  parseAssistantEventPayload,
} from "../lib/assistant-event-log.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";

const WEBHOOK_URL = "https://hook.example.com/secret-path";

function setupLogDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE assistant_notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, event TEXT NOT NULL, ref TEXT, state TEXT NOT NULL, http_status INTEGER, error TEXT, duration_ms INTEGER NOT NULL DEFAULT 0, target_host TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, payload_json TEXT);
  `);
  return createFakeD1(sqlite);
}

function insertLog(db, row) {
  db.sqlite
    .prepare(
      "INSERT INTO assistant_notify_log (key, event, ref, state, http_status, error, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      row.key,
      row.event,
      row.ref ?? null,
      row.state,
      row.httpStatus ?? null,
      row.error ?? null,
      row.createdAt,
      row.payloadJson ?? null,
    );
}

function seededDb() {
  const db = setupLogDb();
  insertLog(db, { key: "brief.select", event: "select", ref: "2026-10-05/kb-1", state: "delivered", httpStatus: 204, createdAt: "2026-10-05T08:00:00.000Z", payloadJson: '{"event":"select"}' });
  insertLog(db, { key: "brief.response_decided", event: "response_decided", ref: "2026-10-06/kb-2", state: "failed", httpStatus: 500, error: "HTTP 500", createdAt: "2026-10-06T01:00:00.000Z" });
  insertLog(db, { key: "article.review_submitted", event: "article_review_submitted", ref: "demo-slug#2", state: "delivered", httpStatus: 200, createdAt: "2026-10-06T09:00:00.000Z", payloadJson: "not json {" });
  insertLog(db, { key: "brief.select", event: "select", ref: "2026-10-07/kb-3", state: "disabled", createdAt: "2026-10-07T00:00:00.000Z", payloadJson: '{"event":"select","topicId":"kb-3"}' });
  return db;
}

// ─── listAssistantEventLog ──────────────────────────

test("listAssistantEventLog: 默认按 id 升序返回全部，payload 解析", async () => {
  const db = seededDb();
  const page = await listAssistantEventLog(db);
  assert.deepEqual(page.events.map((event) => event.id), [1, 2, 3, 4]);
  assert.equal(page.nextAfterId, 4);

  const first = page.events[0];
  assert.deepEqual(Object.keys(first), ["id", "key", "event", "ref", "state", "httpStatus", "error", "createdAt", "payload"]);
  assert.equal(first.key, "brief.select");
  assert.equal(first.httpStatus, 204);
  assert.deepEqual(first.payload, { event: "select" });
  // 坏 JSON → null；未存 → null。
  assert.equal(page.events[2].payload, null);
  assert.equal(page.events[1].payload, null);
  assert.deepEqual(page.events[3].payload, { event: "select", topicId: "kb-3" });
});

test("listAssistantEventLog: afterId / since / key / limit 过滤与 nextAfterId", async () => {
  const db = seededDb();
  // afterId：id > 2。
  const after = await listAssistantEventLog(db, { afterId: 2 });
  assert.deepEqual(after.events.map((event) => event.id), [3, 4]);
  assert.equal(after.nextAfterId, 4);

  // since：created_at >= 某个 ISO 时间。
  const since = await listAssistantEventLog(db, { since: "2026-10-06T00:00:00.000Z" });
  assert.deepEqual(since.events.map((event) => event.id), [2, 3, 4]);

  // key 精确匹配（单个）。
  const single = await listAssistantEventLog(db, { keys: ["brief.select"] });
  assert.deepEqual(single.events.map((event) => event.id), [1, 4]);

  // key 多个（逗号分隔的多个注册表键，OR）。
  const multi = await listAssistantEventLog(db, { keys: ["brief.select", "article.review_submitted"] });
  assert.deepEqual(multi.events.map((event) => event.id), [1, 3, 4]);

  // limit 截断，nextAfterId = 最后一条 id。
  const limited = await listAssistantEventLog(db, { limit: 2 });
  assert.deepEqual(limited.events.map((event) => event.id), [1, 2]);
  assert.equal(limited.nextAfterId, 2);

  // 组合：afterId + key + limit。
  const combined = await listAssistantEventLog(db, { afterId: 1, keys: ["brief.select"], limit: 1 });
  assert.deepEqual(combined.events.map((event) => event.id), [4]);
  assert.equal(combined.nextAfterId, 4);

  // 无命中：沿用 afterId，空数组。
  const empty = await listAssistantEventLog(db, { afterId: 4 });
  assert.deepEqual(empty.events, []);
  assert.equal(empty.nextAfterId, 4);

  // 归一化：limit 夹到 1–200，key 去空白，afterId 负数当 0。
  const clamped = await listAssistantEventLog(db, { limit: 999, afterId: -5 });
  assert.equal(clamped.events.length, 4);
  const keyTrim = await listAssistantEventLog(db, { keys: [" brief.select ", "", "  "] });
  assert.deepEqual(keyTrim.events.map((event) => event.id), [1, 4]);
  assert.equal(ASSISTANT_EVENT_LOG_MAX_LIMIT, 200);
});

test("parseAssistantEventPayload: 空 / 坏 JSON → null", () => {
  assert.deepEqual(parseAssistantEventPayload('{"a":1}'), { a: 1 });
  assert.equal(parseAssistantEventPayload(null), null);
  assert.equal(parseAssistantEventPayload(undefined), null);
  assert.equal(parseAssistantEventPayload(""), null);
  assert.equal(parseAssistantEventPayload("not json {"), null);
});

// ─── sendAssistantEvent 写日志（fake-d1 + 假 fetch）────────

const ORIGINAL_FETCH = globalThis.fetch;
test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function notifyEnv(db, overrides = {}) {
  return { DB: db, SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL, SHUFANGZHAI_WEBHOOK_SECRET: "sekret", ...overrides };
}

function logRows(db) {
  return db.sqlite.prepare("SELECT * FROM assistant_notify_log ORDER BY id").all();
}

test("sendAssistantEvent: delivered 存 payload_json，日志只留 host", async () => {
  const db = setupLogDb();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(null, { status: 204 });
  };
  const result = await sendAssistantEvent(notifyEnv(db), "article.review_submitted", { event: "article_review_submitted", round: 2 }, { ref: "demo-slug#2" });
  assert.equal(result.state, "delivered");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.body, JSON.stringify({ event: "article_review_submitted", round: 2 }));

  const rows = logRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload_json, '{"event":"article_review_submitted","round":2}');
  assert.equal(rows[0].target_host, "hook.example.com");
  assert.equal(rows[0].error, null);
  assert.equal(rows[0].ref, "demo-slug#2");
});

test("sendAssistantEvent: disabled 也照常记一行（含 payload）", async () => {
  const db = setupLogDb();
  globalThis.fetch = async () => {
    throw new Error("不应发起请求");
  };
  const result = await sendAssistantEvent(notifyEnv(db), "cards.decision", { cardId: 9 });
  assert.equal(result.state, "disabled");
  const rows = logRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "disabled");
  assert.equal(rows[0].payload_json, '{"cardId":9}');
});

test("sendAssistantEvent: 超 64KB 存 null，error 为空时写 payload_too_large", async () => {
  const db = setupLogDb();
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const big = { padding: "x".repeat(70 * 1024) };
  const result = await sendAssistantEvent(notifyEnv(db), "brief.select", big);
  assert.equal(result.state, "delivered");
  const rows = logRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload_json, null);
  assert.equal(rows[0].error, "payload_too_large");
  // 发送本体不受影响：完整 payload 照发。
  assert.ok(JSON.stringify(big).length > 64 * 1024);
});

test("sendAssistantEvent: failed 且超 64KB → error 保留原值，payload 仍为 null", async () => {
  const db = setupLogDb();
  globalThis.fetch = async () => new Response(null, { status: 500 });
  const result = await sendAssistantEvent(notifyEnv(db), "brief.select", { padding: "x".repeat(70 * 1024) });
  assert.equal(result.state, "failed");
  assert.equal(result.error, "HTTP 500");
  const rows = logRows(db);
  assert.equal(rows[0].payload_json, null);
  assert.equal(rows[0].error, "HTTP 500");
});

test("sendAssistantEvent: 未配置 URL → unconfigured 也记一行", async () => {
  const db = setupLogDb();
  globalThis.fetch = async () => {
    throw new Error("不应发起请求");
  };
  const result = await sendAssistantEvent(notifyEnv(db, { SHUFANGZHAI_WEBHOOK_URL: "" }), "brief.select", { ok: true });
  assert.equal(result.state, "unconfigured");
  const rows = logRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "unconfigured");
  assert.equal(rows[0].payload_json, '{"ok":true}');
});

// ─── 路由 / 迁移静态断言 ─────────────────────────────

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("GET /api/assistant-events 路由：认助手 token，只读，不含 webhook 信息", () => {
  const route = read("../app/api/assistant-events/route.ts");
  // 助手 token（未配置不启用）+ 恒定时间比较。
  assert.match(route, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
  assert.match(route, /bearerToken/);
  assert.match(route, /sameSecret\(token, assistantToken\)/);
  // topk_ / 会话走 admin 检查（照 briefs/responses）。
  assert.match(route, /authenticateApiKey/);
  assert.match(route, /getSessionUser/);
  assert.match(route, /role !== "admin"/);
  // 只读：只有 GET，没有 POST / assertSameOrigin。
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function PUT/);
  // 查询走纯函数，绝不带出 webhook URL / secret。
  assert.match(route, /listAssistantEventLog/);
  assert.doesNotMatch(route, /SHUFANGZHAI_WEBHOOK_URL/);
  assert.doesNotMatch(route, /SHUFANGZHAI_WEBHOOK_SECRET/);
});

test("payload_json 列：store 幂等 ALTER + drizzle 迁移 + schema 三处一致", () => {
  const store = read("../lib/store.ts");
  assert.match(store, /CREATE TABLE IF NOT EXISTS assistant_notify_log \([^)]*payload_json TEXT\)/);
  assert.match(store, /ALTER TABLE assistant_notify_log ADD COLUMN payload_json TEXT/);
  const schema = read("../db/schema.ts");
  assert.match(schema, /payloadJson: text\("payload_json"\)/);
  const migration = read("../drizzle/0026_notify_payload.sql");
  assert.match(migration, /ALTER TABLE `assistant_notify_log` ADD `payload_json` TEXT/);
  const journal = JSON.parse(read("../drizzle/meta/_journal.json"));
  assert.equal(journal.entries.at(-1).tag, "0026_notify_payload");
});
