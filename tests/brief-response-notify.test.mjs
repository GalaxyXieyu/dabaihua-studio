/**
 * 简报反馈（晴儿）通知测试（设计见 docs/assistant-events-design.md §5）。
 *
 * 覆盖：buildBriefResponsePayload 的字段 / scenario / links / cc / 不带用户 id；
 * maybeNotifyResponseDecision 的「decision 变化才发」（变化发、相同不发、
 * 只改打分发、清空也发）与发送细节（注册表键、日志、失败不抛）；
 * responses 两个路由的鉴权约定（GET 认助手 token 只读，POST 不认）。
 *
 * 所有 URL、secret、内容都是杜撰的，仅用于测试。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getAssistantEvent } from "../lib/assistant-events.ts";
import { BRIEF_RESPONSE_CC, buildBriefResponsePayload } from "../lib/brief-response-notify-core.ts";
import { maybeNotifyResponseDecision } from "../lib/brief-response-notify.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";

const ORIGINAL_FETCH = globalThis.fetch;
test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const WEBHOOK_URL = "https://hook.example.com/secret-path";

function sampleResponse(overrides = {}) {
  return {
    date: "2026-10-02",
    topicId: "kb-3",
    topicTitle: "样本选题",
    topicType: "新闻题",
    topicMissing: false,
    user: { account: "yu@example.com", nickname: "Yu" },
    rating: 4,
    ratingComment: "有点意思",
    decision: "reject",
    scenario: { index: 1, text: "第二个场景" },
    scenarioCustom: "",
    answers: [{ question: "为什么？", answer: "因为样本" }],
    rejectReason: "角度太旧",
    createdAt: "2026-10-02T01:00:00.000Z",
    updatedAt: "2026-10-02T02:00:00.000Z",
    ...overrides,
  };
}

function buildInput(overrides = {}) {
  return {
    date: "2026-10-02",
    topicId: "kb-3",
    response: sampleResponse(),
    origin: "https://brief.example.com",
    eventId: "b7f0f0ee-0000-4000-8000-000000000001",
    sentAt: "2026-10-02T21:10:00+08:00",
    ...overrides,
  };
}

test("buildBriefResponsePayload: 顶层字段与注册表一致，值逐项对上，不带用户 id", () => {
  const def = getAssistantEvent("brief.response_decided");
  assert.ok(def, "注册表缺少 brief.response_decided");
  const payload = buildBriefResponsePayload(buildInput());

  assert.deepEqual(Object.keys(payload), def.payloadFields);
  assert.equal(payload.protocol, "dabaihua.brief-response/v1");
  assert.equal(payload.event, "response_decided");
  assert.equal(payload.eventId, "b7f0f0ee-0000-4000-8000-000000000001");
  assert.equal(payload.sentAt, "2026-10-02T21:10:00+08:00");
  assert.equal(payload.date, "2026-10-02");
  assert.equal(payload.topicId, "kb-3");
  assert.equal(payload.decision, "reject");
  assert.equal(payload.rejectReason, "角度太旧");
  assert.equal(payload.rating, 4);
  assert.equal(payload.ratingComment, "有点意思");
  assert.deepEqual(payload.scenario, { index: 1, custom: "" });
  assert.deepEqual(payload.answers, [{ question: "为什么？", answer: "因为样本" }]);
  assert.deepEqual(payload.cc, BRIEF_RESPONSE_CC);
  assert.equal(payload.cc[0], "晴儿");

  // 不带用户 id：payload 里不能出现回复的账号 / 昵称。
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes("yu@example.com"));
  assert.ok(!serialized.includes("nickname"));
  assert.ok(!serialized.includes("Yu"));
});

test("buildBriefResponsePayload: links 用简报页与反馈接口的真实路径，去掉 origin 尾斜杠", () => {
  const payload = buildBriefResponsePayload(buildInput({ origin: "https://brief.example.com/" }));
  assert.equal(payload.links.brief, "https://brief.example.com/content?view=brief&date=2026-10-02");
  assert.equal(payload.links.responses, "https://brief.example.com/api/briefs/responses?date=2026-10-02");

  // 无预设场景时 index 为 null，自定义场景照抄。
  const custom = buildBriefResponsePayload(
    buildInput({ response: sampleResponse({ scenario: null, scenarioCustom: "换个写法" }) }),
  );
  assert.deepEqual(custom.scenario, { index: null, custom: "换个写法" });
});

function headerOf(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function setupNotifyDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE assistant_notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, event TEXT NOT NULL, ref TEXT, state TEXT NOT NULL, http_status INTEGER, error TEXT, duration_ms INTEGER NOT NULL DEFAULT 0, target_host TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, payload_json TEXT)",
  );
  return createFakeD1(sqlite);
}

function notifyEnv(db) {
  return { DB: db, SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL, SHUFANGZHAI_WEBHOOK_SECRET: "sekret" };
}

function notifyInput(overrides = {}) {
  return {
    date: "2026-10-02",
    topicId: "kb-3",
    response: sampleResponse({ decision: "reject" }),
    hasDecision: true,
    previousDecision: null,
    origin: "https://brief.example.com",
    ...overrides,
  };
}

test("maybeNotifyResponseDecision: decision 变化才发送，经注册表 brief.response_decided", async () => {
  const db = setupNotifyDb();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(null, { status: 204 });
  };

  const result = await maybeNotifyResponseDecision(notifyEnv(db), notifyInput());
  assert.ok(result, "decision 从 null 变 reject 应该发送");
  assert.equal(result.state, "delivered");
  assert.equal(result.httpStatus, 204);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, WEBHOOK_URL);
  assert.equal(seen[0].init.method, "POST");
  const headers = seen[0].init.headers;
  assert.equal(headerOf(headers, "x-dabaihua-event"), "response_decided");
  assert.equal(headerOf(headers, "authorization"), "Bearer sekret");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.protocol, "dabaihua.brief-response/v1");
  assert.equal(body.event, "response_decided");
  assert.equal(body.decision, "reject");
  assert.equal(body.topicId, "kb-3");
  assert.deepEqual(body.cc, ["晴儿"]);
  assert.equal(body.links.responses, "https://brief.example.com/api/briefs/responses?date=2026-10-02");

  const logs = db.sqlite.prepare("SELECT * FROM assistant_notify_log").all();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].key, "brief.response_decided");
  assert.equal(logs[0].event, "response_decided");
  assert.equal(logs[0].ref, "2026-10-02/kb-3");
  assert.equal(logs[0].state, "delivered");
  assert.equal(logs[0].target_host, "hook.example.com");
});

test("maybeNotifyResponseDecision: 相同 decision 不发送，只改打分也不发送", async () => {
  const db = setupNotifyDb();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("不应发起请求");
  };

  const sameDecision = await maybeNotifyResponseDecision(
    notifyEnv(db),
    notifyInput({ previousDecision: "reject", response: sampleResponse({ decision: "reject", rating: 2 }) }),
  );
  assert.equal(sameDecision, null);

  const ratingOnly = await maybeNotifyResponseDecision(
    notifyEnv(db),
    notifyInput({ hasDecision: false, response: sampleResponse({ decision: "reject", rating: 2 }) }),
  );
  assert.equal(ratingOnly, null);

  assert.equal(calls, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM assistant_notify_log").get().n, 0);
});

test("maybeNotifyResponseDecision: 清空决定（pick → null）也发送", async () => {
  const db = setupNotifyDb();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(null, { status: 200 });
  };
  const result = await maybeNotifyResponseDecision(
    notifyEnv(db),
    notifyInput({ previousDecision: "pick", response: sampleResponse({ decision: null }) }),
  );
  assert.ok(result);
  assert.equal(result.state, "delivered");
  assert.equal(JSON.parse(seen[0].init.body).decision, null);
});

test("maybeNotifyResponseDecision: 发送失败只回传状态，不抛出", async () => {
  const db = setupNotifyDb();
  globalThis.fetch = async () => {
    throw new Error("connect failed");
  };
  const result = await maybeNotifyResponseDecision(notifyEnv(db), notifyInput());
  assert.ok(result);
  assert.equal(result.state, "failed");
  assert.ok(!String(result.error).includes("secret-path"));
});

test("responses 路由鉴权约定：GET 认助手 token 只读，POST 不认", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const getRoute = read("../app/api/briefs/responses/route.ts");
  const postRoute = read("../app/api/briefs/[date]/responses/route.ts");

  // GET：助手 token 只读（sameSecret 恒定时间比对，未配置不启用），topk_ / 会话逻辑保留。
  assert.match(getRoute, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
  assert.match(getRoute, /bearerToken/);
  assert.match(getRoute, /sameSecret/);
  assert.match(getRoute, /authenticateApiKey/);
  assert.match(getRoute, /getSessionUser/);
  assert.match(getRoute, /kind: "assistant"/);
  // 助手 token 只在只读分支生效，写分支（assertSameOrigin）保留。
  assert.match(getRoute, /if \(!write\)/);
  assert.match(getRoute, /assertSameOrigin/);

  // POST：不认助手 token，仍是 topk_ / 会话 + 同源校验。
  assert.doesNotMatch(postRoute, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
  assert.doesNotMatch(postRoute, /sameSecret/);
  assert.match(postRoute, /authenticateApiKey/);
  assert.match(postRoute, /assertSameOrigin/);

  // POST：保存前后按「getResponse 取旧 decision → upsert → maybeNotify」的顺序，通知包在 try/catch 里。
  assert.match(postRoute, /getResponse/);
  assert.match(postRoute, /maybeNotifyResponseDecision/);
  assert.match(postRoute, /hasDecision: "decision" in patch/);
  const notifyIndex = postRoute.indexOf("maybeNotifyResponseDecision(env");
  const catchIndex = postRoute.indexOf("} catch {", notifyIndex);
  assert.ok(notifyIndex >= 0 && catchIndex > notifyIndex, "通知调用必须包在 try/catch 里");
});
