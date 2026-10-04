/**
 * 文章推送协议 v1 扩展字段（articleHtml / qaReport / boardTopicId / brief）与
 * 助手 token 推送的服务端测试。风格同 tests/articles-access.test.mjs：
 * 纯函数 + fake-d1（node:sqlite），外加路由源码的静态断言。
 *
 * 所有账号、名字、token、文章内容都是杜撰的，仅用于测试。
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createFakeD1 } from "./helpers/fake-d1.mjs";
import { d1ArticleAssetStore } from "../lib/article-assets.ts";
import {
  computeArticleHash,
  handleArticlePut,
  parseAssistantName,
  resolveArticlesOwnerId,
  validatePushBody,
} from "../lib/article-push.ts";

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  account_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  nickname TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  avatar_key TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE articles (
  slug TEXT PRIMARY KEY, date TEXT, title TEXT, topic TEXT, status TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}', draft_md TEXT, final_md TEXT, qa_report TEXT,
  article_html TEXT, content_hash TEXT, review_round INTEGER NOT NULL DEFAULT 1,
  is_public INTEGER NOT NULL DEFAULT 0, owner_id INTEGER, topic_id INTEGER,
  synced_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE article_assets (
  slug TEXT NOT NULL, path TEXT NOT NULL, content_type TEXT NOT NULL, bytes BLOB NOT NULL,
  size INTEGER NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(slug, path)
);
CREATE TABLE article_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, round INTEGER NOT NULL,
  html TEXT, markdown TEXT, content_hash TEXT, created_at TEXT NOT NULL, UNIQUE(target_type, target_id, round)
);
CREATE TABLE review_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, round INTEGER NOT NULL,
  user_id INTEGER NOT NULL, kind TEXT NOT NULL, exact TEXT NOT NULL, prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '', start_offset INTEGER, end_offset INTEGER, block_index INTEGER,
  comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE review_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, round INTEGER NOT NULL,
  user_id INTEGER NOT NULL, verdict TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '',
  mark_count INTEGER NOT NULL DEFAULT 0, feedback_json TEXT NOT NULL, exported_at TEXT, export_path TEXT,
  created_at TEXT NOT NULL, UNIQUE(target_type, target_id, round)
);
`;

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA);
  const db = createFakeD1(sqlite);
  const assets = d1ArticleAssetStore(db);
  return { sqlite, db, assets };
}

function addUser(sqlite, { account, normalized = account.toLowerCase(), role = "user", nickname = account }) {
  const info = sqlite
    .prepare("INSERT INTO users (account, account_normalized, nickname, role, created_at, updated_at) VALUES (?, ?, ?, ?, '', '')")
    .run(account, normalized, nickname, role);
  return Number(info.lastInsertRowid);
}

function sha256Hex(bytes) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function assetWithBytes(bytes) {
  const sha256 = sha256Hex(bytes);
  return {
    name: `images/${sha256.slice(0, 12)}.png`,
    sha256,
    base64: Buffer.from(bytes).toString("base64"),
  };
}

function pushBody(overrides = {}) {
  return { protocol: "dabaihua.article-push/v1", title: "样例标题", markdown: "正文", ...overrides };
}

async function put(deps, viewer, slug, body, now = "2026-10-02T00:00:00.000Z", assistant) {
  const extra = assistant === undefined ? {} : { assistant };
  return handleArticlePut({ db: deps.db, assets: deps.assets, viewer, slug, body, now, ...extra });
}

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function rowOf(sqlite, slug) {
  return sqlite.prepare("SELECT * FROM articles WHERE slug = ?").get(slug);
}

// ─── contentHash 向量（旧向量不变 + 新向量通过） ─────

test("computeArticleHash reproduces every shared hash vector, old and new", async () => {
  const vectors = JSON.parse(
    readFileSync(new URL("./fixtures/article-push/hash-vectors.json", import.meta.url), "utf8"),
  );
  assert.equal(vectors.cases.length, 4);
  for (const vector of vectors.cases) {
    const hash = await computeArticleHash({
      title: vector.body.title,
      status: vector.body.status || "draft",
      isPublic: vector.body.isPublic,
      date: vector.body.date,
      tags: vector.body.tags || [],
      assets: (vector.body.assets || []).map((asset) => ({ name: asset.name, sha256: asset.sha256 })),
      markdown: vector.body.markdown,
      articleHtml: vector.body.articleHtml,
      qaReport: vector.body.qaReport,
      boardTopicId: vector.body.boardTopicId,
      brief: vector.body.brief ? { date: vector.body.brief.date, topicId: vector.body.brief.topicId } : undefined,
    });
    assert.equal(hash, vector.contentHash, vector.name);
  }
});

test("computeArticleHash stays byte-identical without the optional fields", async () => {
  const base = { title: "T", status: "draft", tags: [], markdown: "m" };
  const without = await computeArticleHash(base);
  const withExplicitUndefined = await computeArticleHash({
    ...base,
    articleHtml: undefined,
    qaReport: null,
    boardTopicId: undefined,
    brief: undefined,
  });
  assert.equal(without, withExplicitUndefined);
});

// ─── validatePushBody：新增可选字段 ───────────────────

test("validatePushBody validates articleHtml, qaReport, boardTopicId and brief", async () => {
  assert.equal((await validatePushBody("s", pushBody({ articleHtml: "<p>x</p>".repeat(150000) }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ articleHtml: 123 }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ qaReport: "q".repeat(256 * 1024 + 1) }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ qaReport: ["x"] }))).code, "invalid");
  for (const bad of [0, -1, 1.5, "3", true, false, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await validatePushBody("s", pushBody({ boardTopicId: bad }));
    assert.equal(result.code, "invalid", `boardTopicId ${String(bad)}`);
    assert.equal(result.status, 400);
  }
  assert.equal((await validatePushBody("s", pushBody({ brief: "x" }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ brief: { date: "2026/10/01", topicId: "t-1" } }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ brief: { date: "2026-10-01" } }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ brief: { date: "2026-10-01", topicId: "-t" } }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ brief: { date: "2026-10-01", topicId: "x".repeat(61) } }))).code, "invalid");
});

test("validatePushBody normalizes the new fields and treats blank as absent", async () => {
  const html = '<section><img src="images/0123456789ab.png"></section>';
  const body = pushBody({
    articleHtml: html,
    qaReport: "## QA\n\n无问题",
    boardTopicId: 12,
    brief: { date: "2026-10-01", topicId: "t-quiet-01" },
  });
  const normalized = await validatePushBody("s", body);
  assert.equal(normalized.articleHtml, html);
  assert.equal(normalized.qaReport, "## QA\n\n无问题");
  assert.equal(normalized.boardTopicId, 12);
  assert.deepEqual(normalized.brief, { date: "2026-10-01", topicId: "t-quiet-01" });

  for (const blank of [undefined, null, ""]) {
    const skipped = await validatePushBody("s", pushBody({ articleHtml: blank, qaReport: blank, boardTopicId: blank, brief: blank }));
    assert.equal(skipped.articleHtml, undefined);
    assert.equal(skipped.qaReport, undefined);
    assert.equal(skipped.boardTopicId, undefined);
    assert.equal(skipped.brief, undefined);
  }
});

// ─── 推送 articleHtml / qaReport / boardTopicId / brief ─

test("push stores sanitized articleHtml, qaReport, topic and brief metadata", async () => {
  const { sqlite, db, assets } = setup();
  const userA = addUser(sqlite, { account: "user-a", nickname: "A" });
  const viewerA = { id: userA, role: "user" };
  const deps = { db, assets };
  const bytes = Buffer.from("fake-image-push-v2");
  const asset = assetWithBytes(bytes);
  const sha12 = asset.sha256.slice(0, 12);

  const articleHtml = `<section><script>alert("bad")</script><h1>标题</h1><p onclick="evil()">正文</p><img src="images/${sha12}.png" alt="图"></section>`;
  const created = await put(deps, viewerA, "html-a", pushBody({
    markdown: "# 标题\n\n正文",
    articleHtml,
    qaReport: "## QA\n\n- 无问题",
    boardTopicId: 12,
    brief: { date: "2026-10-01", topicId: "t-quiet-01" },
    assets: [asset],
  }));
  assert.equal(created.status, 201);
  assert.equal(created.json.result, "created");

  const row = rowOf(sqlite, "html-a");
  assert.equal(row.final_md, "# 标题\n\n正文");
  assert.doesNotMatch(row.article_html, /script/i);
  assert.doesNotMatch(row.article_html, /onclick/i);
  assert.match(row.article_html, new RegExp(`src="images/${sha12}\\.png"`));
  assert.equal(row.qa_report, "## QA\n\n- 无问题");
  assert.equal(row.topic_id, 12);
  const meta = JSON.parse(row.meta_json);
  assert.deepEqual(meta.brief, { date: "2026-10-01", topicId: "t-quiet-01" });
  assert.equal(meta.boardTopicId, 12);
  assert.equal(meta.pushedBy, "owner");
  assert.equal(meta.assistant, undefined);

  const unchanged = await put(deps, viewerA, "html-a", pushBody({
    markdown: "# 标题\n\n正文",
    articleHtml,
    qaReport: "## QA\n\n- 无问题",
    boardTopicId: 12,
    brief: { date: "2026-10-01", topicId: "t-quiet-01" },
    assets: [asset],
  }), "2026-10-02T02:00:00.000Z");
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.json.result, "unchanged");

  const updated = await put(deps, viewerA, "html-a", pushBody({
    markdown: "# 标题\n\n正文",
    articleHtml: `${articleHtml}<p>改动</p>`,
    qaReport: "## QA\n\n- 无问题",
    boardTopicId: 12,
    brief: { date: "2026-10-01", topicId: "t-quiet-01" },
    assets: [asset],
  }), "2026-10-02T03:00:00.000Z");
  assert.equal(updated.status, 200);
  assert.equal(updated.json.result, "updated");
  assert.match(rowOf(sqlite, "html-a").article_html, /<p>改动<\/p>/);
  assert.notEqual(updated.json.contentHash, unchanged.json.contentHash);

  // 整体替换：更新时不带 articleHtml / qaReport → 回到 NULL。
  const stripped = await put(deps, viewerA, "html-a", pushBody({ markdown: "# 标题\n\n正文改" }), "2026-10-02T04:00:00.000Z");
  assert.equal(stripped.status, 200);
  const strippedRow = rowOf(sqlite, "html-a");
  assert.equal(strippedRow.article_html, null);
  assert.equal(strippedRow.qa_report, null);
});

test("update without boardTopicId keeps topic_id", async () => {
  const { sqlite, db, assets } = setup();
  const userA = addUser(sqlite, { account: "user-a", nickname: "A" });
  const viewerA = { id: userA, role: "user" };
  const deps = { db, assets };

  await put(deps, viewerA, "board-a", pushBody({ markdown: "正文一", boardTopicId: 12 }));
  assert.equal(rowOf(sqlite, "board-a").topic_id, 12);

  const updated = await put(deps, viewerA, "board-a", pushBody({ markdown: "正文二" }), "2026-10-02T01:00:00.000Z");
  assert.equal(updated.json.result, "updated");
  assert.equal(rowOf(sqlite, "board-a").topic_id, 12);
  assert.equal(JSON.parse(rowOf(sqlite, "board-a").meta_json).boardTopicId, undefined);

  const replaced = await put(deps, viewerA, "board-a", pushBody({ markdown: "正文三", boardTopicId: 30 }), "2026-10-02T02:00:00.000Z");
  assert.equal(replaced.json.result, "updated");
  assert.equal(rowOf(sqlite, "board-a").topic_id, 30);
});

// ─── 助手纯函数 ──────────────────────────────────────

test("resolveArticlesOwnerId: owner account wins, else earliest admin, else null", async () => {
  const { sqlite, db } = setup();
  const owner = addUser(sqlite, { account: "owner@example.com", role: "user" });
  const adminFirst = addUser(sqlite, { account: "admin-first", role: "admin" });
  addUser(sqlite, { account: "admin-second", role: "admin" });

  assert.equal(await resolveArticlesOwnerId(db, " owner@Example.COM "), owner);
  // NFKC：全角字母归一后匹配。
  assert.equal(await resolveArticlesOwnerId(db, "ＯＷＮＥＲ@example.com"), owner);
  // 给了 ownerAccount 但找不到 → 回退最早的 admin。
  assert.equal(await resolveArticlesOwnerId(db, "nobody@example.com"), adminFirst);
  assert.equal(await resolveArticlesOwnerId(db), adminFirst);
  assert.equal(await resolveArticlesOwnerId(db, ""), adminFirst);

  const { sqlite: sqlite2, db: db2 } = setup();
  addUser(sqlite2, { account: "plain-user", role: "user" });
  assert.equal(await resolveArticlesOwnerId(db2), null);
  assert.equal(await resolveArticlesOwnerId(db2, "missing@example.com"), null);
});

test("parseAssistantName: non-empty, trimmed, at most 20 chars, no newlines", () => {
  assert.equal(parseAssistantName(null), null);
  assert.equal(parseAssistantName(undefined), null);
  assert.equal(parseAssistantName("not-an-object"), null);
  assert.equal(parseAssistantName({ assistant: undefined }), null);
  assert.equal(parseAssistantName({ assistant: 42 }), null);
  assert.equal(parseAssistantName({ assistant: "" }), null);
  assert.equal(parseAssistantName({ assistant: "   " }), null);
  assert.equal(parseAssistantName({ assistant: "a".repeat(21) }), null);
  assert.equal(parseAssistantName({ assistant: "康".repeat(21) }), null);
  assert.equal(parseAssistantName({ assistant: "两\n行" }), null);
  assert.equal(parseAssistantName({ assistant: "  小助手  " }), "小助手");
  assert.equal(parseAssistantName({ assistant: "a".repeat(20) }), "a".repeat(20));
});

// ─── 助手推送规则 ────────────────────────────────────

test("assistant push creates a draft owned by the resolved owner with assistant metadata", async () => {
  const { sqlite, db, assets } = setup();
  const owner = addUser(sqlite, { account: "owner@example.com", role: "admin" });
  addUser(sqlite, { account: "other-user", role: "user" });
  const ownerViewer = { id: owner, role: "admin" };
  const deps = { db, assets };

  const created = await put(deps, ownerViewer, "assistant-a", pushBody({ markdown: "# 草稿" }), "2026-10-02T01:00:00.000Z", "小助手");
  assert.equal(created.status, 201);
  const row = rowOf(sqlite, "assistant-a");
  assert.equal(row.owner_id, owner);
  assert.equal(row.status, "draft");
  assert.equal(row.is_public, 0);
  const meta = JSON.parse(row.meta_json);
  assert.equal(meta.assistant, "小助手");
  assert.equal(meta.pushedBy, "assistant");
});

test("assistant cannot publish or make articles public", async () => {
  const { sqlite, db, assets } = setup();
  const owner = addUser(sqlite, { account: "owner@example.com", role: "admin" });
  const ownerViewer = { id: owner, role: "admin" };
  const deps = { db, assets };

  const published = await put(deps, ownerViewer, "assistant-b", pushBody({ markdown: "x", status: "published" }), "2026-10-02T01:00:00.000Z", "小助手");
  assert.equal(published.status, 403);
  assert.equal(published.json.code, "assistant_draft_only");

  const publicBody = await put(deps, ownerViewer, "assistant-b", pushBody({ markdown: "x", isPublic: true }), "2026-10-02T01:00:00.000Z", "小助手");
  assert.equal(publicBody.status, 403);
  assert.equal(publicBody.json.code, "assistant_draft_only");
  assert.equal(rowOf(sqlite, "assistant-b"), undefined);
});

test("assistant cannot overwrite articles locked out of draft status", async () => {
  const { sqlite, db, assets } = setup();
  const owner = addUser(sqlite, { account: "owner@example.com", role: "admin" });
  const ownerViewer = { id: owner, role: "admin" };
  const deps = { db, assets };

  await put(deps, ownerViewer, "assistant-c", pushBody({ markdown: "初稿" }), "2026-10-02T01:00:00.000Z", "小助手");
  const body = pushBody({ markdown: "初稿" });
  for (const lockedStatus of ["approved", "published"]) {
    sqlite.prepare("UPDATE articles SET status = ? WHERE slug = ?").run(lockedStatus, "assistant-c");
    // 内容 hash 相同也要先吃 409：锁定检查在 unchanged 短路之前。
    const sameContent = await put(deps, ownerViewer, "assistant-c", body, "2026-10-02T02:00:00.000Z", "小助手");
    assert.equal(sameContent.status, 409);
    assert.equal(sameContent.json.code, "article_locked");
    assert.equal(sameContent.json.status, lockedStatus);
    const changed = await put(deps, ownerViewer, "assistant-c", pushBody({ markdown: "改稿" }), "2026-10-02T03:00:00.000Z", "小助手");
    assert.equal(changed.status, 409);
    assert.equal(changed.json.code, "article_locked");
    assert.equal(rowOf(sqlite, "assistant-c").final_md, "初稿");
  }
});

test("assistant can re-push a changes-requested article and status returns to draft", async () => {
  const { sqlite, db, assets } = setup();
  const owner = addUser(sqlite, { account: "owner@example.com", role: "admin" });
  const ownerViewer = { id: owner, role: "admin" };
  const deps = { db, assets };

  await put(deps, ownerViewer, "assistant-d", pushBody({ markdown: "初稿" }), "2026-10-02T01:00:00.000Z", "小助手");
  sqlite.prepare("UPDATE articles SET status = 'changes-requested' WHERE slug = ?").run("assistant-d");

  const revised = await put(deps, ownerViewer, "assistant-d", pushBody({ markdown: "按审稿意见改的修订稿" }), "2026-10-02T02:00:00.000Z", "小助手");
  assert.equal(revised.status, 200);
  assert.equal(revised.json.result, "updated");
  const row = rowOf(sqlite, "assistant-d");
  assert.equal(row.status, "draft");
  assert.equal(row.final_md, "按审稿意见改的修订稿");
});

test("assistant push keeps an existing public flag and cannot take foreign slugs", async () => {
  const { sqlite, db, assets } = setup();
  const owner = addUser(sqlite, { account: "owner@example.com", role: "admin" });
  const other = addUser(sqlite, { account: "other-user", role: "user" });
  const ownerViewer = { id: owner, role: "admin" };
  const otherViewer = { id: other, role: "user" };
  const deps = { db, assets };

  // 所有者自己把文章设为公开但仍是草稿状态。
  await put(deps, ownerViewer, "assistant-e", pushBody({ markdown: "公开草稿", isPublic: true }), "2026-10-02T01:00:00.000Z");
  assert.equal(rowOf(sqlite, "assistant-e").is_public, 1);
  const revised = await put(deps, ownerViewer, "assistant-e", pushBody({ markdown: "公开草稿改" }), "2026-10-02T02:00:00.000Z", "小助手");
  assert.equal(revised.status, 200);
  assert.equal(revised.json.isPublic, true);
  const row = rowOf(sqlite, "assistant-e");
  assert.equal(row.is_public, 1);
  assert.equal(row.status, "draft");

  // 助手（viewer 是所有者）推别人的 slug → 照旧 409 slug_taken。
  await put(deps, otherViewer, "other-a", pushBody({ markdown: "别人的文章" }), "2026-10-02T01:00:00.000Z");
  const taken = await put(deps, ownerViewer, "other-a", pushBody({ markdown: "抢占" }), "2026-10-02T03:00:00.000Z", "小助手");
  assert.equal(taken.status, 409);
  assert.equal(taken.json.code, "slug_taken");
  assert.equal(rowOf(sqlite, "other-a").owner_id, other);
});

test("topk_/session pushes without assistant keep the old behaviour", async () => {
  const { sqlite, db, assets } = setup();
  const userA = addUser(sqlite, { account: "user-a", nickname: "A" });
  const viewerA = { id: userA, role: "user" };
  const deps = { db, assets };

  const created = await put(deps, viewerA, "plain-a", pushBody({ markdown: "正文", status: "published" }), "2026-10-02T01:00:00.000Z");
  assert.equal(created.status, 201);
  assert.equal(created.json.isPublic, true);
  const row = rowOf(sqlite, "plain-a");
  assert.equal(row.status, "published");
  assert.equal(row.is_public, 1);
  const meta = JSON.parse(row.meta_json);
  assert.equal(meta.pushedBy, "owner");
  assert.equal(meta.assistant, undefined);
});

// ─── 路由源码静态断言 ────────────────────────────────

test("route source: PUT takes the assistant token, GET/PATCH do not", () => {
  const source = readSource("../app/api/articles/[slug]/route.ts");

  function functionBody(name) {
    const start = source.indexOf(`export async function ${name}`);
    assert.ok(start >= 0, `missing ${name} handler`);
    const rest = source.slice(start);
    const next = rest.indexOf("export async function", 1);
    return next === -1 ? rest : rest.slice(0, next);
  }

  const putBody = functionBody("PUT");
  assert.match(putBody, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
  assert.match(putBody, /assistant_required/);
  assert.match(putBody, /sameSecret/);
  assert.match(putBody, /resolveArticlesOwnerId/);
  assert.match(putBody, /owner_unavailable/);
  for (const name of ["GET", "PATCH"]) {
    const body = functionBody(name);
    assert.doesNotMatch(body, /DABAIHUA_CARDS_ASSISTANT_TOKEN/, `${name} must not use the assistant token`);
    assert.doesNotMatch(body, /assistant/i, `${name} must not reference assistant auth`);
  }

  for (const script of ["../deploy/aries/run-server.sh", "../scripts/serve-prod.sh"]) {
    assert.match(readSource(script), /ARTICLES_OWNER_ACCOUNT/);
  }
  assert.match(readSource("../cloudflare-env.d.ts"), /ARTICLES_OWNER_ACCOUNT/);
});
