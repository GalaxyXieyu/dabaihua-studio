/**
 * 简报 → 漱芳斋管线测试：纯状态/规则、通知负载与出站、简报 schema 的
 * scenarioSources/questionSources、以及源码层的鉴权约定。
 *
 * 所有 URL、secret、内容都是杜撰的，仅用于测试。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  PIPELINE_LABELS,
  PIPELINE_NOTIFY_EVENTS,
  PIPELINE_STATUSES,
  assistantStatusRule,
  buildNotifyPayload,
  parsePipelineStatus,
} from "../lib/brief-pipeline-core.ts";
import { deliverBriefNotification, resolveAuthHeader, webhookHost } from "../lib/brief-notify.ts";
import { validateBrief } from "../lib/daily-brief-core.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";

const ORIGINAL_FETCH = globalThis.fetch;
test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function headerOf(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

test("pipeline statuses: exactly eight codes in order, labels defined once, parse by code or label", () => {
  assert.deepEqual(
    [...PIPELINE_STATUSES],
    ["selected", "outline_pending", "drafting", "pending_review", "reviewing", "typesetting", "published", "shelved"],
  );
  assert.deepEqual(Object.values(PIPELINE_LABELS), ["已选", "大纲待确认", "写稿中", "待审", "审稿中", "排版中", "已发", "搁置"]);
  assert.deepEqual([...PIPELINE_NOTIFY_EVENTS], ["select", "confirm_outline", "cancel", "regenerate_outline"]);

  for (const code of PIPELINE_STATUSES) assert.equal(parsePipelineStatus(code), code);
  assert.equal(parsePipelineStatus("已选"), "selected");
  assert.equal(parsePipelineStatus(" 大纲待确认 "), "outline_pending");
  assert.equal(parsePipelineStatus("搁置"), "shelved");
  assert.equal(parsePipelineStatus("nope"), null);
  assert.equal(parsePipelineStatus(""), null);
  assert.equal(parsePipelineStatus(null), null);
});

test("assistantStatusRule: owner-only moves, outline requirements and the allowed matrix", () => {
  assert.deepEqual(assistantStatusRule(null, "drafting", false), { ok: false, code: "not_selected" });
  assert.deepEqual(assistantStatusRule("shelved", "drafting", false), { ok: false, code: "shelved" });
  assert.deepEqual(assistantStatusRule("selected", "selected", false), { ok: false, code: "owner_only" });
  assert.deepEqual(assistantStatusRule("selected", "shelved", false), { ok: false, code: "owner_only" });
  assert.deepEqual(assistantStatusRule("outline_pending", "drafting", true), { ok: false, code: "owner_only" });
  assert.deepEqual(assistantStatusRule("selected", "bogus", false), { ok: false, code: "bad_status" });
  assert.deepEqual(assistantStatusRule("selected", "outline_pending", false), { ok: false, code: "outline_required" });

  // 只传大纲、不传状态：selected → outline_pending。
  assert.deepEqual(assistantStatusRule("selected", null, true), { ok: true, status: "outline_pending" });
  // 待审允许。
  assert.deepEqual(assistantStatusRule("drafting", "pending_review", true), { ok: true, status: "pending_review" });
  // 前进一步、后退一步都允许。
  assert.deepEqual(assistantStatusRule("drafting", "reviewing", true), { ok: true, status: "reviewing" });
  assert.deepEqual(assistantStatusRule("published", "reviewing", true), { ok: true, status: "reviewing" });
  // 已有大纲时只传大纲不传状态：保持当前状态。
  assert.deepEqual(assistantStatusRule("drafting", null, true), { ok: true, status: "drafting" });
});

const TOPIC = {
  id: "kb-3",
  date: "2026-10-02",
  type: "新闻题",
  label: "新闻主选题",
  title: "一个大标题",
  oneLiner: "一句话说清",
  detail: "更详细的背景",
  scenarios: ["场景 A", "场景 B"],
  questions: ["问一", "问二"],
};

function payloadInput(overrides = {}) {
  return {
    event: "select",
    eventId: "event-1",
    sentAt: "2026-10-03T21:10:00+08:00",
    topic: TOPIC,
    status: "selected",
    boardTopicId: 12,
    baseUrl: "https://example.com/",
    ...overrides,
  };
}

test("buildNotifyPayload: select preset / custom / null and links", () => {
  const preset = buildNotifyPayload(payloadInput({ scenarioIndex: 1, scenarioText: "场景 B", answers: ["答一", ""] }));
  assert.equal(preset.protocol, "dabaihua.brief-notify/v1");
  assert.equal(preset.event, "select");
  assert.deepEqual(preset.topic, {
    id: "kb-3",
    date: "2026-10-02",
    type: "新闻题",
    label: "新闻主选题",
    title: "一个大标题",
    summary: "一句话说清",
    detail: "更详细的背景",
  });
  assert.deepEqual(preset.scenario, { kind: "preset", index: 1, text: "场景 B" });
  assert.deepEqual(preset.answers, [{ question: "问一", answer: "答一" }]);
  assert.equal(preset.outline, null);
  assert.deepEqual(preset.status, { code: "selected", label: "已选" });
  assert.equal(preset.boardTopicId, 12);
  assert.equal(preset.links.topic, "https://example.com/content?view=brief&date=2026-10-02&topic=kb-3");
  assert.equal(preset.links.board, "https://example.com/content?view=board&card=12");

  const custom = buildNotifyPayload(payloadInput({ scenarioIndex: null, scenarioCustom: "我自己说的场景" }));
  assert.deepEqual(custom.scenario, { kind: "custom", text: "我自己说的场景" });

  const none = buildNotifyPayload(payloadInput({ scenarioIndex: null, scenarioCustom: "" }));
  assert.equal(none.scenario, null);

  const noBoard = buildNotifyPayload(payloadInput({ boardTopicId: null }));
  assert.equal(noBoard.boardTopicId, null);
  assert.equal(noBoard.links.board, "https://example.com/content?view=board");
});

test("buildNotifyPayload: confirm_outline carries the outline, cancel carries shelved status", () => {
  const confirm = buildNotifyPayload(
    payloadInput({ event: "confirm_outline", status: "outline_pending", outline: "# 大纲\n- 第一节" }),
  );
  assert.equal(confirm.event, "confirm_outline");
  assert.equal(confirm.outline, "# 大纲\n- 第一节");
  assert.deepEqual(confirm.status, { code: "outline_pending", label: "大纲待确认" });

  const cancel = buildNotifyPayload(payloadInput({ event: "cancel", status: "shelved", outline: "" }));
  assert.equal(cancel.event, "cancel");
  assert.equal(cancel.outline, null);
  assert.deepEqual(cancel.status, { code: "shelved", label: "搁置" });
});

test("resolveAuthHeader / webhookHost: default Bearer, custom raw, host only", () => {
  assert.deepEqual(resolveAuthHeader(undefined, "sekret"), { name: "Authorization", value: "Bearer sekret" });
  assert.deepEqual(resolveAuthHeader("   ", "sekret"), { name: "Authorization", value: "Bearer sekret" });
  assert.deepEqual(resolveAuthHeader("X-Dabaihua-Secret", "sekret"), { name: "X-Dabaihua-Secret", value: "sekret" });
  assert.equal(webhookHost("https://hook.example.com/path/x?q=1"), "hook.example.com");
  assert.equal(webhookHost("not a url"), "");
});

function setupNotifyDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE brief_notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, topic_id TEXT NOT NULL, event TEXT NOT NULL, state TEXT NOT NULL, http_status INTEGER, error TEXT, duration_ms INTEGER NOT NULL DEFAULT 0, target_host TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  );
  sqlite.exec(
    "CREATE TABLE brief_selections (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, topic_id TEXT NOT NULL, notify_event TEXT, notify_state TEXT, notify_http_status INTEGER, notify_error TEXT, notify_at TEXT, updated_at TEXT NOT NULL DEFAULT '')",
  );
  sqlite.prepare("INSERT INTO brief_selections (date, topic_id, updated_at) VALUES (?, ?, '')").run("2026-10-02", "kb-3");
  return createFakeD1(sqlite);
}

function notifyInput(overrides = {}) {
  return {
    date: "2026-10-02",
    topicId: "kb-3",
    event: "select",
    topic: TOPIC,
    status: "selected",
    baseUrl: "https://example.com",
    ...overrides,
  };
}

test("deliverBriefNotification: no URL -> unconfigured and no request", async () => {
  const db = setupNotifyDb();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("不应发起请求");
  };
  const result = await deliverBriefNotification({ DB: db }, notifyInput());
  assert.equal(result.state, "unconfigured");
  assert.equal(calls, 0);
  const logs = db.sqlite.prepare("SELECT * FROM brief_notify_log").all();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].state, "unconfigured");
});

test("deliverBriefNotification: 204 delivered, log keeps host only", async () => {
  const db = setupNotifyDb();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(null, { status: 204 });
  };
  const env = { DB: db, SHUFANGZHAI_WEBHOOK_URL: "https://hook.example.com/secret-path", SHUFANGZHAI_WEBHOOK_SECRET: "sekret" };
  const result = await deliverBriefNotification(env, notifyInput());
  assert.equal(result.state, "delivered");
  assert.equal(result.httpStatus, 204);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.method, "POST");
  assert.equal(headerOf(seen[0].init.headers, "content-type"), "application/json");
  assert.equal(headerOf(seen[0].init.headers, "x-dabaihua-event"), "select");
  assert.equal(headerOf(seen[0].init.headers, "authorization"), "Bearer sekret");
  const payload = JSON.parse(seen[0].init.body);
  assert.equal(payload.protocol, "dabaihua.brief-notify/v1");
  assert.equal(payload.eventId.length > 0, true);

  const log = db.sqlite.prepare("SELECT * FROM brief_notify_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(log.state, "delivered");
  assert.equal(log.http_status, 204);
  assert.equal(log.target_host, "hook.example.com");
  assert.ok(!String(log.error ?? "").includes("secret-path"));
  const selection = db.sqlite.prepare("SELECT * FROM brief_selections WHERE date = '2026-10-02' AND topic_id = 'kb-3'").get();
  assert.equal(selection.notify_state, "delivered");
  assert.equal(selection.notify_event, "select");
});

test("deliverBriefNotification: custom auth header sends the raw secret", async () => {
  const db = setupNotifyDb();
  let captured = null;
  globalThis.fetch = async (_url, init) => {
    captured = init;
    return new Response(null, { status: 200 });
  };
  const env = {
    DB: db,
    SHUFANGZHAI_WEBHOOK_URL: "https://hook.example.com/x",
    SHUFANGZHAI_WEBHOOK_SECRET: "sekret",
    SHUFANGZHAI_WEBHOOK_AUTH_HEADER: "X-Dabaihua-Secret",
  };
  const result = await deliverBriefNotification(env, notifyInput());
  assert.equal(result.state, "delivered");
  assert.equal(headerOf(captured.headers, "x-dabaihua-secret"), "sekret");
  assert.equal(headerOf(captured.headers, "authorization"), undefined);
});

test("deliverBriefNotification: 500 and thrown errors are failed, never leaking the full URL", async () => {
  const db = setupNotifyDb();
  const env = { DB: db, SHUFANGZHAI_WEBHOOK_URL: "https://hook.example.com/secret-path", SHUFANGZHAI_WEBHOOK_SECRET: "sekret" };

  globalThis.fetch = async () => new Response("nope", { status: 500 });
  const httpFail = await deliverBriefNotification(env, notifyInput());
  assert.equal(httpFail.state, "failed");
  assert.equal(httpFail.httpStatus, 500);
  assert.match(httpFail.error, /HTTP 500/);

  globalThis.fetch = async () => {
    throw new Error("connect failed https://hook.example.com/secret-path");
  };
  const thrown = await deliverBriefNotification(env, notifyInput());
  assert.equal(thrown.state, "failed");
  assert.equal(thrown.httpStatus, undefined);
  assert.ok(!thrown.error.includes("hook.example.com/secret-path"));
  assert.ok(thrown.error.includes("hook.example.com"));

  const logs = db.sqlite.prepare("SELECT * FROM brief_notify_log").all();
  assert.ok(logs.some((row) => row.state === "failed" && row.http_status === 500));
  for (const row of logs) {
    assert.ok(!String(row.error ?? "").includes("secret-path"), "日志不能出现完整 webhook URL");
    assert.ok(!String(row.target_host).includes("/"), "target_host 只能是 host");
  }
});

test("brief schema: scenarioSources / questionSources parse index-aligned", () => {
  const ok = validateBrief({
    version: 1,
    date: "2026-10-04",
    topics: [
      {
        id: "t1",
        type: "新闻题",
        title: "标题",
        scenarios: ["场景一", "场景二"],
        scenarioSources: ["来源一", 42, "多余"],
        questions: ["问一", "问二"],
        questionSources: ["q来源一"],
      },
      { id: "t2", type: "落地题", title: "没有来源的旧简报" },
    ],
  });
  assert.equal(ok.ok, true);
  const [first, second] = ok.brief.topics;
  assert.deepEqual(first.scenarios, ["场景一", "场景二"]);
  assert.deepEqual(first.scenarioSources, ["来源一", ""]);
  assert.deepEqual(first.questionSources, ["q来源一", ""]);
  assert.deepEqual(second.scenarioSources, []);
  assert.deepEqual(second.questionSources, []);

  const long = "x".repeat(250);
  const clamped = validateBrief({
    version: 1,
    date: "2026-10-04",
    topics: [{ id: "t3", type: "落地题", title: "x", scenarios: ["s"], scenarioSources: [`  ${long}  `] }],
  });
  assert.equal(clamped.ok, true);
  assert.equal(clamped.brief.topics[0].scenarioSources[0].length, 200);
});

test("source checks: admin brief endpoints ignore the assistant token, PATCH compares constant-time", () => {
  const select = read("../app/api/briefs/[date]/topics/[topicId]/select/route.ts");
  const undo = read("../app/api/briefs/[date]/topics/[topicId]/undo/route.ts");
  const confirm = read("../app/api/briefs/[date]/topics/[topicId]/confirm-outline/route.ts");
  const notify = read("../app/api/briefs/[date]/topics/[topicId]/notify/route.ts");
  const pipeline = read("../app/api/briefs/[date]/topics/[topicId]/pipeline/route.ts");

  for (const route of [select, undo, confirm, notify]) {
    assert.match(route, /authenticateApiKey/);
    assert.match(route, /assertSameOrigin/);
    assert.doesNotMatch(route, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
  }

  assert.match(pipeline, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
  assert.match(pipeline, /sameSecret/);
  assert.match(pipeline, /charCodeAt/);
  assert.match(pipeline, /export async function GET/);
  assert.match(pipeline, /export async function PATCH/);

  const core = read("../lib/brief-pipeline-core.ts");
  for (const label of ["selected", "outline_pending", "drafting", "pending_review", "reviewing", "typesetting", "published", "shelved"]) {
    assert.match(core, new RegExp(`"${label}"`));
  }

  const runServer = read("../deploy/aries/run-server.sh");
  for (const key of ["SHUFANGZHAI_WEBHOOK_URL", "SHUFANGZHAI_WEBHOOK_SECRET", "SHUFANGZHAI_WEBHOOK_AUTH_HEADER"]) {
    assert.match(runServer, new RegExp(key));
  }

  const prodEnv = read("../deploy/aries/prod.env.example");
  assert.match(prodEnv, /SHUFANGZHAI_WEBHOOK_URL=/);
  assert.match(prodEnv, /SHUFANGZHAI_WEBHOOK_SECRET=/);
  assert.match(prodEnv, /SHUFANGZHAI_WEBHOOK_AUTH_HEADER=/);
  assert.doesNotMatch(prodEnv, /[a-f0-9]{32,}/i, "示例文件不能出现像真 secret 的随机串");
});
