/**
 * 助手事件注册表 + 通用发送测试（设计见 docs/assistant-events-design.md）。
 *
 * 覆盖：注册表约束（key/event 唯一、启停与目标）、sendAssistantEvent 的
 * URL/头/body/超时信号与四种状态、assistant_notify_log 日志、日志失败不抛、
 * 生成的 docs/assistant-events.md 与脚本当前输出一致。
 *
 * 所有 URL、secret、内容都是杜撰的，仅用于测试。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ASSISTANT_EVENTS, getAssistantEvent, WEBHOOK_TARGETS } from "../lib/assistant-events.ts";
import { PIPELINE_NOTIFY_EVENTS } from "../lib/brief-pipeline-core.ts";
import { sendAssistantEvent } from "../lib/assistant-notify.ts";
import { renderAssistantEventsDoc } from "../scripts/gen-assistant-events-doc.mjs";
import { createFakeD1 } from "./helpers/fake-d1.mjs";

const ORIGINAL_FETCH = globalThis.fetch;
test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const WEBHOOK_URL = "https://hook.example.com/secret-path";

function headerOf(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

test("registry: keys are unique, events unique within a protocol", () => {
  const keys = ASSISTANT_EVENTS.map((def) => def.key);
  assert.equal(new Set(keys).size, keys.length, `key 重复：${keys.join(", ")}`);
  const eventsByProtocol = new Map();
  for (const def of ASSISTANT_EVENTS) {
    const seen = eventsByProtocol.get(def.protocol) ?? new Set();
    assert.ok(!seen.has(def.event), `event 重复：${def.protocol}/${def.event}`);
    seen.add(def.event);
    eventsByProtocol.set(def.protocol, seen);
  }
});

test("registry: enabled entries have a target listed in WEBHOOK_TARGETS, disabled ones have null", () => {
  for (const def of ASSISTANT_EVENTS) {
    if (def.enabled) {
      assert.ok(def.target, `${def.key} 启用但没有 target`);
      assert.ok(def.target in WEBHOOK_TARGETS, `${def.key} 的 target 不在 WEBHOOK_TARGETS`);
    } else {
      assert.equal(def.target, null, `${def.key} 禁用时 target 必须是 null`);
    }
  }
});

test("registry: the four brief pipeline events map to brief.<event> entries", () => {
  assert.equal(getAssistantEvent("nope"), null);
  for (const event of PIPELINE_NOTIFY_EVENTS) {
    const def = getAssistantEvent(`brief.${event}`);
    assert.ok(def, `缺少 brief.${event}`);
    assert.equal(def.event, event);
    assert.equal(def.protocol, "dabaihua.brief-notify/v1");
    assert.equal(def.target, "shufangzhai");
    assert.equal(def.handoff, "小燕子");
    assert.equal(def.enabled, true);
    assert.equal(def.read, "superme brief pipeline <date> <topicId>");
    assert.equal(def.writeBack, "PATCH /api/briefs/<date>/topics/<topicId>/pipeline");
  }
});

test("registry: brief.response_decided 已启用交给晴儿，digest / diagram 仍登记不启用", () => {
  const decided = getAssistantEvent("brief.response_decided");
  assert.ok(decided, "注册表缺少 brief.response_decided");
  assert.equal(decided.event, "response_decided");
  assert.equal(decided.protocol, "dabaihua.brief-response/v1");
  assert.equal(decided.page, "今日简报「不要」/ 清空决定（POST /api/briefs/<date>/responses，decision 变化时）");
  assert.equal(decided.target, "shufangzhai");
  assert.equal(decided.handoff, "晴儿");
  assert.deepEqual(decided.cc, ["晴儿"]);
  assert.equal(decided.enabled, true);
  assert.deepEqual(decided.payloadFields, [
    "protocol",
    "event",
    "eventId",
    "sentAt",
    "date",
    "topicId",
    "decision",
    "rejectReason",
    "rating",
    "ratingComment",
    "scenario",
    "answers",
    "cc",
    "links",
  ]);
  assert.equal(decided.read, "superme brief responses --date <date>");

  const digest = getAssistantEvent("brief.responses_digest");
  assert.ok(digest, "注册表缺少 brief.responses_digest");
  assert.equal(digest.enabled, false);
  assert.equal(digest.target, null);
  assert.equal(digest.handoff, "晴儿");
  assert.equal(digest.read, "superme brief responses --date <date>");

  const diagram = getAssistantEvent("brief.diagram_reviewed");
  assert.ok(diagram, "注册表缺少 brief.diagram_reviewed");
  assert.equal(diagram.enabled, false);
  assert.equal(diagram.target, null);
  assert.equal(diagram.handoff, "尔康");
  assert.equal(diagram.read, "superme brief pipeline <date> <topicId>");

  // 旧占位键已升级为启用的 brief.response_decided。
  assert.equal(getAssistantEvent("brief.response"), null);
});

test("registry: 只有简报四个老事件带「线上名为旧别名」的备注", () => {
  const expected = new Map([
    ["brief.select", "brief_select"],
    ["brief.confirm_outline", "brief_confirm_outline"],
    ["brief.regenerate_outline", "brief_regenerate_outline"],
    ["brief.cancel", "brief_cancel"],
  ]);
  for (const def of ASSISTANT_EVENTS) {
    if (expected.has(def.key)) {
      assert.equal(def.aliasOf, expected.get(def.key), `${def.key} 应注明规范名`);
      assert.equal(def.enabled, true, `${def.key} 老事件仍在线上发送`);
    } else {
      assert.equal(def.aliasOf, undefined, `${def.key} 不应有 aliasOf`);
    }
  }
  // 文档里的备注列由生成脚本常量拼接，两条命名约定写在文档顶部。
  const doc = renderAssistantEventsDoc();
  assert.match(doc, /线上名为旧别名/);
  assert.match(doc, /## 命名约定/);
});

function setupLogDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE assistant_notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, event TEXT NOT NULL, ref TEXT, state TEXT NOT NULL, http_status INTEGER, error TEXT, duration_ms INTEGER NOT NULL DEFAULT 0, target_host TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, payload_json TEXT)",
  );
  return createFakeD1(sqlite);
}

test("sendAssistantEvent: POST URL, headers, byte-identical body, timeout signal, log row", async () => {
  const db = setupLogDb();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(null, { status: 204 });
  };
  const payload = { protocol: "dabaihua.brief-notify/v1", event: "select", topic: { id: "kb-3" } };
  const result = await sendAssistantEvent(
    { DB: db, SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL, SHUFANGZHAI_WEBHOOK_SECRET: "sekret" },
    "brief.select",
    payload,
    { ref: "2026-10-02/kb-3" },
  );

  assert.equal(result.state, "delivered");
  assert.equal(result.httpStatus, 204);
  assert.equal(result.error, undefined);
  assert.ok(result.at);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, WEBHOOK_URL);
  assert.equal(seen[0].init.method, "POST");
  assert.equal(headerOf(seen[0].init.headers, "content-type"), "application/json");
  assert.equal(headerOf(seen[0].init.headers, "x-dabaihua-event"), "select");
  assert.equal(headerOf(seen[0].init.headers, "authorization"), "Bearer sekret");
  assert.equal(seen[0].init.body, JSON.stringify(payload));
  assert.ok(seen[0].init.signal instanceof AbortSignal);
  assert.equal(seen[0].init.signal.aborted, false);

  const logs = db.sqlite.prepare("SELECT * FROM assistant_notify_log").all();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].key, "brief.select");
  assert.equal(logs[0].event, "select");
  assert.equal(logs[0].ref, "2026-10-02/kb-3");
  assert.equal(logs[0].state, "delivered");
  assert.equal(logs[0].http_status, 204);
  assert.equal(logs[0].error, null);
  assert.ok(Number.isInteger(logs[0].duration_ms));
  assert.equal(logs[0].target_host, "hook.example.com");
  assert.ok(!String(logs[0].target_host).includes("/"));
  // payload 留档：与发送的 body 逐字一致（漏收 webhook 时拉回）。
  assert.equal(logs[0].payload_json, JSON.stringify(payload));
});

test("sendAssistantEvent: custom auth header sends the raw secret", async () => {
  const db = setupLogDb();
  let captured = null;
  globalThis.fetch = async (_url, init) => {
    captured = init;
    return new Response(null, { status: 200 });
  };
  const result = await sendAssistantEvent(
    {
      DB: db,
      SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL,
      SHUFANGZHAI_WEBHOOK_SECRET: "sekret",
      SHUFANGZHAI_WEBHOOK_AUTH_HEADER: "X-Dabaihua-Secret",
    },
    "brief.confirm_outline",
    { event: "confirm_outline" },
  );
  assert.equal(result.state, "delivered");
  assert.equal(headerOf(captured.headers, "x-dabaihua-secret"), "sekret");
  assert.equal(headerOf(captured.headers, "authorization"), undefined);
  assert.equal(headerOf(captured.headers, "x-dabaihua-event"), "confirm_outline");
});

test("sendAssistantEvent: 500 is failed with HTTP status in the log", async () => {
  const db = setupLogDb();
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  const result = await sendAssistantEvent(
    { DB: db, SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL, SHUFANGZHAI_WEBHOOK_SECRET: "sekret" },
    "brief.cancel",
    { event: "cancel" },
  );
  assert.equal(result.state, "failed");
  assert.equal(result.httpStatus, 500);
  assert.match(result.error, /HTTP 500/);
  const log = db.sqlite.prepare("SELECT * FROM assistant_notify_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(log.state, "failed");
  assert.equal(log.http_status, 500);
  assert.match(String(log.error), /HTTP 500/);
});

test("sendAssistantEvent: no URL -> unconfigured, no request", async () => {
  const db = setupLogDb();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("不应发起请求");
  };
  const result = await sendAssistantEvent({ DB: db }, "brief.select", { event: "select" });
  assert.equal(result.state, "unconfigured");
  assert.equal(result.httpStatus, undefined);
  assert.equal(calls, 0);
  const log = db.sqlite.prepare("SELECT * FROM assistant_notify_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(log.state, "unconfigured");
  assert.equal(log.key, "brief.select");
  assert.equal(log.event, "select");
  assert.equal(log.target_host, "");
});

test("sendAssistantEvent: disabled or unknown key -> disabled, no request", async () => {
  const db = setupLogDb();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("不应发起请求");
  };
  const env = { DB: db, SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL, SHUFANGZHAI_WEBHOOK_SECRET: "sekret" };

  const disabled = await sendAssistantEvent(env, "topic.review_decision", { topicId: 1 });
  assert.equal(disabled.state, "disabled");
  assert.equal(disabled.httpStatus, undefined);

  const unknown = await sendAssistantEvent(env, "nope.event", {});
  assert.equal(unknown.state, "disabled");

  assert.equal(calls, 0);
  const logs = db.sqlite.prepare("SELECT * FROM assistant_notify_log").all();
  assert.equal(logs.length, 2);
  assert.equal(logs[0].key, "topic.review_decision");
  assert.equal(logs[0].event, "topic_review_decision");
  assert.equal(logs[0].state, "disabled");
  assert.equal(logs[1].key, "nope.event");
  assert.equal(logs[1].event, "");
  assert.equal(logs[1].state, "disabled");
});

test("sendAssistantEvent: thrown errors are failed and never leak the full URL", async () => {
  const db = setupLogDb();
  const env = { DB: db, SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL, SHUFANGZHAI_WEBHOOK_SECRET: "sekret" };
  globalThis.fetch = async () => {
    throw new Error("connect failed https://hook.example.com/secret-path");
  };
  const result = await sendAssistantEvent(env, "brief.select", { event: "select" });
  assert.equal(result.state, "failed");
  assert.equal(result.httpStatus, undefined);
  assert.ok(!result.error.includes("hook.example.com/secret-path"));
  assert.ok(result.error.includes("hook.example.com"));
  const log = db.sqlite.prepare("SELECT * FROM assistant_notify_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(log.state, "failed");
  assert.ok(!String(log.error ?? "").includes("secret-path"));
  assert.ok(!String(log.target_host).includes("/"));
});

test("sendAssistantEvent: missing DB or failing log write never throws", async () => {
  globalThis.fetch = async () => new Response(null, { status: 200 });
  const noDb = await sendAssistantEvent(
    { SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL, SHUFANGZHAI_WEBHOOK_SECRET: "sekret" },
    "brief.select",
    { event: "select" },
  );
  assert.equal(noDb.state, "delivered");

  globalThis.fetch = async () => new Response(null, { status: 500 });
  const badDb = await sendAssistantEvent(
    {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async run() {
                  throw new Error("日志写入失败");
                },
              };
            },
          };
        },
      },
      SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL,
      SHUFANGZHAI_WEBHOOK_SECRET: "sekret",
    },
    "brief.select",
    { event: "select" },
  );
  assert.equal(badDb.state, "failed");
  assert.equal(badDb.httpStatus, 500);
});

test("docs/assistant-events.md is exactly what renderAssistantEventsDoc() produces", () => {
  const file = readFileSync(new URL("../docs/assistant-events.md", import.meta.url), "utf8");
  assert.equal(file, renderAssistantEventsDoc());
});

test("assistant_notify_log: runtime schema, drizzle schema and migration stay in sync", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const store = read("../lib/store.ts");
  const schema = read("../db/schema.ts");
  const migration = read("../drizzle/0024_assistant_notify.sql");
  const journal = read("../drizzle/meta/_journal.json");

  for (const source of [store, schema, migration]) {
    assert.match(source, /assistant_notify_log/);
    assert.match(source, /target_host/);
    assert.match(source, /duration_ms/);
    assert.match(source, /key_ref/);
  }

  // 运行时 schema：表 + (key, ref, id DESC) 索引，SCHEMA_VERSION 已 bump。
  assert.match(store, /CREATE TABLE IF NOT EXISTS assistant_notify_log/);
  assert.match(
    store,
    /CREATE INDEX IF NOT EXISTS assistant_notify_log_key_ref_idx ON assistant_notify_log\(key, ref, id DESC\)/,
  );
  assert.doesNotMatch(store, /2026-10-05\.1"/);

  // drizzle migration：同样的表和索引。
  assert.match(migration, /`ref` text/);
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS `assistant_notify_log_key_ref_idx` ON `assistant_notify_log` \(`key`,`ref`,`id` DESC\)/,
  );
  assert.match(journal, /"tag": "0024_assistant_notify"/);
  assert.match(journal, /"idx": 24/);
});
