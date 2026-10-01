import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CARDS_SCHEMA_STATEMENTS, ID_RE, isCanonical, nextCardId, revisionSummary, validateCard } from "../lib/cards-core.ts";
import { handleCardsRequest } from "../lib/cards-api.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";

const OWNER_COOKIE = "session=owner";

function setup({ sameOrigin = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  for (const sql of CARDS_SCHEMA_STATEMENTS) sqlite.exec(sql);
  const db = createFakeD1(sqlite);
  const deps = {
    db,
    assistantToken: "test-assistant-token",
    resolveAdmin: async (request) => (String(request.headers.get("cookie") || "").includes(OWNER_COOKIE) ? { name: "Yu" } : null),
    checkSameOrigin: () => sameOrigin,
  };
  return { db, sqlite, deps };
}

function makeRequest(pathname, { method = "GET", actor, body } = {}) {
  const headers = {};
  if (actor === "assistant") headers.authorization = "Bearer test-assistant-token";
  if (actor === "owner") headers.cookie = OWNER_COOKIE;
  const hasBody = body !== undefined && method !== "GET" && method !== "HEAD";
  if (hasBody) headers["content-type"] = "application/json";
  return new Request(`http://localhost${pathname}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
}

function call(deps, pathname, options) {
  return handleCardsRequest(makeRequest(pathname, options), deps);
}

function cardInput(overrides = {}) {
  return {
    category: "偏好",
    title: "样例偏好：先写清单",
    body: "样例数据：动手前先列清单。",
    scope: ["工作"],
    sources: [{ agent: "样例助手", date: "2026-10-01", ref: "样例出处" }],
    ...overrides,
  };
}

async function ownerCreate(deps, overrides = {}) {
  const response = await call(deps, "/api/cards", { method: "POST", actor: "owner", body: cardInput(overrides) });
  assert.equal(response.status, 201);
  return response.json();
}

test("未登录 401，助手可以读列表", async () => {
  const { deps } = setup();
  const unauthorized = await call(deps, "/api/cards");
  assert.equal(unauthorized.status, 401);
  const asAssistant = await call(deps, "/api/cards", { actor: "assistant" });
  assert.equal(asAssistant.status, 200);
  assert.deepEqual((await asAssistant.json()).cards, []);
});

test("助手新增默认待确认，带有效状态 403", async () => {
  const { deps } = setup();
  const created = await call(deps, "/api/cards", { method: "POST", actor: "assistant", body: cardInput() });
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.equal(payload.card.status, "待确认");
  assert.equal(payload.card.added_by, "样例助手");
  assert.equal(payload.revisions[0].action, "add");

  const forbidden = await call(deps, "/api/cards", { method: "POST", actor: "assistant", body: cardInput({ status: "有效" }) });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, "助手只能新增待确认的卡");
});

test("助手对确认 / 拒绝 / 删除 / 恢复 / 编辑 / 替换 / 过期一律 403，且不改动数据", async () => {
  const { deps, sqlite } = setup();
  const { card } = await ownerCreate(deps, { status: "有效" });

  const attempts = [
    { pathname: `/api/cards/${card.id}`, method: "PATCH", body: { expectedVersion: card.version, title: "改" } },
    { pathname: `/api/cards/${card.id}`, method: "DELETE", body: { expectedVersion: card.version } },
    { pathname: `/api/cards/${card.id}/supersede`, method: "POST", body: { expectedVersion: card.version, reason: "样例原因" } },
    { pathname: `/api/cards/${card.id}/expire`, method: "POST", body: { expectedVersion: card.version } },
    { pathname: `/api/cards/${card.id}/restore`, method: "POST", body: { expectedVersion: card.version } },
    { pathname: `/api/cards/${card.id}/confirm`, method: "POST", body: { expectedVersion: card.version } },
    { pathname: `/api/cards/${card.id}/reject`, method: "POST", body: { expectedVersion: card.version } },
  ];
  for (const attempt of attempts) {
    const response = await call(deps, attempt.pathname, { method: attempt.method, actor: "assistant", body: attempt.body });
    assert.equal(response.status, 403, `${attempt.method} ${attempt.pathname}`);
  }

  const row = sqlite.prepare("SELECT version, status FROM cards WHERE id = ?").get(card.id);
  assert.equal(row.version, card.version);
  assert.equal(row.status, "有效");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM card_revisions WHERE card_id = ?").get(card.id).count, 1);
});

test("owner 新增有效卡：id 递增、校验失败返回 errors", async () => {
  const { deps } = setup();
  const first = await ownerCreate(deps, { status: "有效" });
  assert.match(first.card.id, ID_RE);
  assert.equal(first.card.id, "H-PREF-20261001-01");
  assert.equal(first.card.confirmed_by, "Yu");
  assert.ok(isCanonical(first.card));

  const second = await ownerCreate(deps, { status: "有效", title: "样例偏好：第二张" });
  assert.equal(second.card.id, "H-PREF-20261001-02");

  const cases = [
    { title: "  " },
    { scope: ["不存在"] },
    { sources: [{ agent: "样例", date: "2026-10-01" }] },
    { sources: [{ agent: "样例", date: "2026-13-40", ref: "样例出处" }] },
  ];
  for (const overrides of cases) {
    const response = await call(deps, "/api/cards", { method: "POST", actor: "owner", body: cardInput(overrides) });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.ok(Array.isArray(payload.errors) && payload.errors.length > 0);
  }
});

test("PATCH：旧 version 409 带 current，缺 expectedVersion 400，成功后历史只增不改", async () => {
  const { deps, sqlite } = setup();
  const { card } = await ownerCreate(deps, { status: "有效" });

  const conflict = await call(deps, `/api/cards/${card.id}`, { method: "PATCH", actor: "owner", body: { expectedVersion: 0, title: "改一下" } });
  assert.equal(conflict.status, 409);
  const conflictPayload = await conflict.json();
  assert.equal(conflictPayload.error, "version conflict");
  assert.equal(conflictPayload.current.version, card.version);

  const missing = await call(deps, `/api/cards/${card.id}`, { method: "PATCH", actor: "owner", body: { title: "改一下" } });
  assert.equal(missing.status, 400);

  const before = sqlite.prepare("SELECT snapshot_json FROM card_revisions WHERE card_id = ? AND version = 1").get(card.id).snapshot_json;
  const ok = await call(deps, `/api/cards/${card.id}`, {
    method: "PATCH",
    actor: "owner",
    body: { expectedVersion: card.version, title: "样例偏好：先写清单再动手", reason: "样例：补一句" },
  });
  assert.equal(ok.status, 200);
  const payload = await ok.json();
  assert.equal(payload.card.version, 2);
  assert.equal(payload.card.title, "样例偏好：先写清单再动手");
  assert.equal(payload.revisions[0].action, "edit");
  assert.equal(payload.revisions[0].reason, "样例：补一句");

  const after = sqlite.prepare("SELECT snapshot_json FROM card_revisions WHERE card_id = ? AND version = 1").get(card.id).snapshot_json;
  assert.equal(after, before, "旧 revision 快照不变");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM card_revisions WHERE card_id = ?").get(card.id).count, 2);
});

test("并发：两个写请求带同一个 expectedVersion，只有一个成功，另一个 409 且不留孤立历史", async () => {
  const { deps, sqlite } = setup();
  const { card } = await ownerCreate(deps, { status: "有效" });
  const [first, second] = await Promise.all([
    call(deps, `/api/cards/${card.id}`, { method: "PATCH", actor: "owner", body: { expectedVersion: 1, title: "样例：并发甲" } }),
    call(deps, `/api/cards/${card.id}`, { method: "PATCH", actor: "owner", body: { expectedVersion: 1, title: "样例：并发乙" } }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  assert.equal(sqlite.prepare("SELECT version FROM cards WHERE id = ?").get(card.id).version, 2);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM card_revisions WHERE card_id = ?").get(card.id).count, 2);

  // 替换和直接改并发：替换输了时新卡也不能落库。
  const cardsBefore = sqlite.prepare("SELECT COUNT(*) AS count FROM cards").get().count;
  const [edit, supersede] = await Promise.all([
    call(deps, `/api/cards/${card.id}`, { method: "PATCH", actor: "owner", body: { expectedVersion: 2, body: "样例：先改正文" } }),
    call(deps, `/api/cards/${card.id}/supersede`, { method: "POST", actor: "owner", body: { expectedVersion: 2, title: "样例：新卡", reason: "样例：替换" } }),
  ]);
  const statuses = [edit.status, supersede.status];
  assert.equal(statuses.filter((status) => status === 409).length, 1);
  const cardsAfter = sqlite.prepare("SELECT COUNT(*) AS count FROM cards").get().count;
  const revisionCount = sqlite.prepare("SELECT COUNT(*) AS count FROM card_revisions").get().count;
  if (supersede.status === 409) {
    assert.equal(cardsAfter, cardsBefore, "替换失败不留新卡");
    assert.equal(revisionCount, 3);
  } else {
    assert.equal(cardsAfter, cardsBefore + 1);
    assert.equal(revisionCount, 4);
  }
});

test("软删：行还在，默认列表不含，deleted=1 含，restore 后 history 依次 add/delete/restore", async () => {
  const { deps, sqlite } = setup();
  const { card } = await ownerCreate(deps, { status: "有效" });

  const deleted = await call(deps, `/api/cards/${card.id}`, {
    method: "DELETE",
    actor: "owner",
    body: { expectedVersion: card.version, reason: "样例：不适用了" },
  });
  assert.equal(deleted.status, 200);
  const deletedCard = (await deleted.json()).card;

  const row = sqlite.prepare("SELECT * FROM cards WHERE id = ?").get(card.id);
  assert.ok(row, "软删不删行");
  assert.ok(row.deleted_at);

  assert.equal((await (await call(deps, "/api/cards", { actor: "owner" })).json()).cards.length, 0);
  const trash = await (await call(deps, "/api/cards?deleted=1", { actor: "owner" })).json();
  assert.equal(trash.cards.length, 1);
  assert.equal(trash.cards[0].id, card.id);

  const restored = await call(deps, `/api/cards/${card.id}/restore`, {
    method: "POST",
    actor: "owner",
    body: { expectedVersion: deletedCard.version },
  });
  assert.equal(restored.status, 200);
  assert.equal((await (await call(deps, "/api/cards", { actor: "owner" })).json()).cards.length, 1);

  const history = sqlite.prepare("SELECT version, action FROM card_revisions WHERE card_id = ? ORDER BY version").all(card.id);
  assert.deepEqual(history.map((item) => item.action), ["add", "delete", "restore"]);
  assert.deepEqual(history.map((item) => item.version), [1, 2, 3]);
});

test("supersede：旧卡已推翻指向新卡，两边各记一条历史，缺 reason 400，旧 version 409", async () => {
  const { deps, sqlite } = setup();
  const { card: old } = await ownerCreate(deps, { status: "有效" });

  const missingReason = await call(deps, `/api/cards/${old.id}/supersede`, {
    method: "POST",
    actor: "owner",
    body: { expectedVersion: old.version },
  });
  assert.equal(missingReason.status, 400);

  const response = await call(deps, `/api/cards/${old.id}/supersede`, {
    method: "POST",
    actor: "owner",
    body: { expectedVersion: old.version, reason: "样例：换成新写法", title: "样例偏好：清单只写三步" },
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.card.status, "有效");
  assert.deepEqual(payload.card.supersedes, [old.id]);
  assert.equal(payload.old.status, "已推翻");
  assert.equal(payload.old.superseded_by, payload.card.id);
  assert.equal(payload.revisions.length, 2);

  assert.deepEqual(
    sqlite.prepare("SELECT action FROM card_revisions WHERE card_id = ? ORDER BY version").all(old.id).map((item) => item.action),
    ["add", "supersede"],
  );
  assert.deepEqual(
    sqlite.prepare("SELECT action FROM card_revisions WHERE card_id = ? ORDER BY version").all(payload.card.id).map((item) => item.action),
    ["supersede"],
  );

  const conflict = await call(deps, `/api/cards/${old.id}/supersede`, {
    method: "POST",
    actor: "owner",
    body: { expectedVersion: old.version, reason: "样例：再换" },
  });
  assert.equal(conflict.status, 409);
});

test("收件箱：confirm 进正本，reject 不留 superseded_by，confirm 非待确认 400", async () => {
  const { deps } = setup();
  const inbox = (await (await call(deps, "/api/cards", {
    method: "POST",
    actor: "assistant",
    body: cardInput({ category: "决策", title: "样例决策：样例会议改到周三", scope: ["工作"] }),
  })).json()).card;
  assert.equal(inbox.status, "待确认");

  const confirmedResponse = await call(deps, `/api/cards/${inbox.id}/confirm`, {
    method: "POST",
    actor: "owner",
    body: { expectedVersion: inbox.version },
  });
  assert.equal(confirmedResponse.status, 200);
  const confirmed = (await confirmedResponse.json()).card;
  assert.equal(confirmed.status, "有效");
  assert.equal(confirmed.confirmed_by, "Yu");
  assert.ok(isCanonical(confirmed));

  const rejectedTarget = (await (await call(deps, "/api/cards", {
    method: "POST",
    actor: "assistant",
    body: cardInput({ category: "复盘结论", title: "样例复盘：样例结论" }),
  })).json()).card;

  const rejectedResponse = await call(deps, `/api/cards/${rejectedTarget.id}/reject`, {
    method: "POST",
    actor: "owner",
    body: { expectedVersion: rejectedTarget.version, reason: "" },
  });
  assert.equal(rejectedResponse.status, 200);
  const rejected = (await rejectedResponse.json()).card;
  assert.equal(rejected.status, "已推翻");
  assert.equal(rejected.superseded_by, "");
  const validation = validateCard(rejected, { knownIds: new Set([rejected.id, confirmed.id]) });
  assert.ok(validation.ok, JSON.stringify(validation.errors));

  const again = await call(deps, `/api/cards/${confirmed.id}/confirm`, {
    method: "POST",
    actor: "owner",
    body: { expectedVersion: confirmed.version },
  });
  assert.equal(again.status, 400);
});

test("会话写请求不同源 403，助手 Bearer 不受同源限制", async () => {
  const { deps } = setup({ sameOrigin: false });
  const sessionWrite = await call(deps, "/api/cards", { method: "POST", actor: "owner", body: cardInput() });
  assert.equal(sessionWrite.status, 403);
  const assistantWrite = await call(deps, "/api/cards", { method: "POST", actor: "assistant", body: cardInput() });
  assert.equal(assistantWrite.status, 201);
});

test("validateCard 覆盖 8 条规则", () => {
  const valid = {
    id: "H-PREF-20261001-01",
    kind: "mirror",
    version: 1,
    category: "偏好",
    title: "标题",
    body: "正文",
    scope: ["工作"],
    sources: [{ agent: "样例", date: "2026-10-01", ref: "出处" }],
    status: "有效",
    confirmed_by: "Yu",
    confirmed_at: "2026-10-01",
    supersedes: [],
    superseded_by: "",
    review_after: "",
    reason: "",
    added_by: "样例",
    options: [],
    owner: "",
    recorded_at: "2026-10-01",
  };
  const knownIds = new Set(["H-PREF-20261001-01", "H-PREF-20261001-02"]);
  const fields = (overrides) => validateCard({ ...valid, ...overrides }, { knownIds }).errors.map((error) => error.field);
  assert.ok(validateCard(valid, { knownIds }).ok);
  assert.ok(fields({ id: "BAD" }).includes("id"));
  assert.ok(fields({ title: "" }).includes("title"));
  assert.ok(fields({ scope: ["不存在"] }).includes("scope"));
  assert.ok(fields({ status: "待确认", confirmed_by: "Yu", confirmed_at: "2026-10-01" }).includes("confirmed_by"));
  assert.ok(fields({ confirmed_at: "" }).includes("confirmed_at"));
  assert.ok(fields({ status: "已推翻", superseded_by: "" }).includes("superseded_by"));
  assert.ok(fields({ supersedes: ["H-NOPE-20260101-01"] }).includes("supersedes"));
  assert.ok(fields({ review_after: "2026-13-01" }).includes("review_after"));

  assert.equal(nextCardId(["H-PREF-20261001-01", "H-PREF-20261001-02"], "偏好", "20261001"), "H-PREF-20261001-03");
  assert.equal(revisionSummary({ action: "add", actor: "样例助手", reason: "", snapshot: { status: "待确认" } }), "样例助手 提出，待确认");
  assert.equal(revisionSummary({ action: "supersede", actor: "Yu", reason: "", snapshot: { status: "已推翻", superseded_by: "H-X" } }), "被 H-X 取代");
});

test("迁移脚本：导入、幂等、dry-run 不写库", () => {
  const script = fileURLToPath(new URL("../scripts/cards-import-handbook.mjs", import.meta.url));
  const entries = fileURLToPath(new URL("fixtures/handbook-cards/entries.jsonl", import.meta.url));
  const inbox = fileURLToPath(new URL("fixtures/handbook-cards/inbox.jsonl", import.meta.url));
  const dir = mkdtempSync(path.join(tmpdir(), "cards-import-"));
  const dbPath = path.join(dir, "cards.sqlite");
  try {
    const output = execFileSync(process.execPath, [script, "--entries", entries, "--inbox", inbox, "--db", dbPath], { encoding: "utf8" });
    assert.match(output, /cards: 新增 6 \/ 跳过 0/);
    assert.match(output, /revisions: 10/);

    const sqlite = new DatabaseSync(dbPath);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM cards").get().count, 6);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM card_revisions").get().count, 10);

    const oldPref = sqlite.prepare("SELECT version, status, superseded_by FROM cards WHERE id = ?").get("H-PREF-20261001-01");
    assert.equal(oldPref.version, 2);
    assert.equal(oldPref.status, "已推翻");
    assert.equal(oldPref.superseded_by, "H-PREF-20261001-02");

    const inboxCard = sqlite.prepare("SELECT version, status FROM cards WHERE id = ?").get("H-ADJ-20261005-01");
    assert.equal(inboxCard.version, 1);
    assert.equal(inboxCard.status, "待确认");

    const actions = (id) => sqlite.prepare("SELECT action FROM card_revisions WHERE card_id = ? ORDER BY version").all(id).map((row) => row.action);
    assert.deepEqual(actions("H-PREF-20261001-01"), ["add", "supersede"]);
    assert.deepEqual(actions("H-METH-20261001-01"), ["add", "expire"]);
    assert.deepEqual(actions("H-DEC-20261003-01"), ["add", "confirm"]);
    assert.deepEqual(actions("H-REV-20261006-01"), ["add", "reject"]);
    sqlite.close();

    const again = execFileSync(process.execPath, [script, "--entries", entries, "--inbox", inbox, "--db", dbPath], { encoding: "utf8" });
    assert.match(again, /cards: 新增 0 \/ 跳过 6/);
    assert.match(again, /revisions: 0/);

    const dryPath = path.join(dir, "dry.sqlite");
    const dry = execFileSync(process.execPath, [script, "--entries", entries, "--inbox", inbox, "--db", dryPath, "--dry-run"], { encoding: "utf8" });
    assert.match(dry, /cards: 新增 6 \/ 跳过 0/);
    assert.equal(existsSync(dryPath), false, "dry-run 不写库");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
