import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createFakeD1 } from "./helpers/fake-d1.mjs";
import { d1ArticleAssetStore } from "../lib/article-assets.ts";
import {
  ArticleAccessError,
  canReadArticle,
  isArticleOwner,
  listArticlesForViewer,
  loadArticleAccess,
  setArticlePublicForViewer,
} from "../lib/article-access.ts";
import { computeArticleHash, handleArticlePut, validatePushBody } from "../lib/article-push.ts";
import { blockPlainText, parseMarkdownBlocks } from "../lib/review-markdown.ts";
import { renderMarkdownAsGzhHtml } from "../lib/gzh-markdown.ts";
import { rowUnchanged } from "../scripts/sync-articles.mjs";

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

function addUser(sqlite, { account, role = "user", nickname = account }) {
  const info = sqlite
    .prepare("INSERT INTO users (account, account_normalized, nickname, role, created_at, updated_at) VALUES (?, ?, ?, ?, '', '')")
    .run(account, account.toLowerCase(), nickname, role);
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

async function put(deps, viewer, slug, body, now = "2026-10-02T00:00:00.000Z") {
  return handleArticlePut({ db: deps.db, assets: deps.assets, viewer, slug, body, now });
}

// ─── contentHash ─────────────────────────────────────

test("computeArticleHash reproduces every shared hash vector", async () => {
  const vectors = JSON.parse(
    readFileSync(new URL("./fixtures/article-push/hash-vectors.json", import.meta.url), "utf8"),
  );
  for (const vector of vectors.cases) {
    const hash = await computeArticleHash({
      title: vector.body.title,
      status: vector.body.status || "draft",
      isPublic: vector.body.isPublic,
      date: vector.body.date,
      tags: vector.body.tags || [],
      assets: (vector.body.assets || []).map((asset) => ({ name: asset.name, sha256: asset.sha256 })),
      markdown: vector.body.markdown,
    });
    assert.equal(hash, vector.contentHash, vector.name);
  }
});

// ─── validatePushBody caps ───────────────────────────

test("validatePushBody enforces protocol caps", async () => {
  const missingTitle = await validatePushBody("s", pushBody({ title: undefined }));
  assert.equal(missingTitle.code, "invalid");
  assert.equal(missingTitle.status, 400);

  assert.equal((await validatePushBody("s", pushBody({ title: "a\nb" }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ title: "x".repeat(201) }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ markdown: "x".repeat(1024 * 1024 + 1) }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ status: "nope" }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ isPublic: "yes" }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ tags: ["x".repeat(41)] }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ tags: ["a\tb"] }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ date: "2026/10/02" }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ sourcePath: "/Users/example/secret.md" }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ sourcePath: "~/secret.md" }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ sourcePath: "C:\\secret.md" }))).code, "invalid");
  assert.equal((await validatePushBody("s", pushBody({ protocol: "other/v1" }))).code, "invalid");

  const badName = await validatePushBody("s", pushBody({ assets: [{ name: "images/zzzzzzzzzzzz.png", sha256: "0".repeat(64) }] }));
  assert.equal(badName.code, "invalid");
  const badPrefix = await validatePushBody("s", pushBody({ assets: [{ name: "images/aaaaaaaaaaaa.png", sha256: "b".repeat(64) }] }));
  assert.equal(badPrefix.code, "invalid");
  const badBytes = await validatePushBody(
    "s",
    pushBody({ assets: [assetWithBytes(Buffer.from("real-bytes"))].map((asset) => ({ ...asset, base64: Buffer.from("other-bytes").toString("base64") })) }),
  );
  assert.equal(badBytes.code, "invalid");
});

test("validatePushBody computes contentHash and rejects a mismatching one", async () => {
  const body = pushBody({ tags: ["a"], markdown: "# 标题" });
  const normalized = await validatePushBody("s", body);
  assert.equal(typeof normalized.contentHash, "string");
  const mismatched = await validatePushBody("s", { ...body, contentHash: "0".repeat(64) });
  assert.equal(mismatched.status, 400);
  assert.equal(mismatched.code, "hash_mismatch");
  const matched = await validatePushBody("s", { ...body, contentHash: normalized.contentHash });
  assert.equal(matched.contentHash, normalized.contentHash);
});

// ─── push lifecycle ──────────────────────────────────

test("push creates, is idempotent, updates in place, reuses and removes assets without touching reviews", async () => {
  const { sqlite, db, assets } = setup();
  const userA = addUser(sqlite, { account: "user-a", nickname: "A" });
  const viewerA = { id: userA, role: "user" };
  const deps = { db, assets };
  const bytes = Buffer.from("fake-image-bytes-1");
  const asset = assetWithBytes(bytes);

  const created = await put(deps, viewerA, "sample-a", pushBody({ markdown: "# 标题\n\n正文", assets: [asset] }), "2026-10-02T01:00:00.000Z");
  assert.equal(created.status, 201);
  assert.equal(created.json.result, "created");
  assert.equal(created.json.assets.stored, 1);
  assert.equal(created.json.url, "/articles/sample-a");
  const row = sqlite.prepare("SELECT * FROM articles WHERE slug = ?").get("sample-a");
  assert.equal(row.owner_id, userA);
  assert.equal(row.final_md, "# 标题\n\n正文");
  assert.equal(row.draft_md, null);
  assert.equal(row.article_html, null);
  assert.equal(row.is_public, 0);
  assert.match(row.meta_json, /"source":"push"/);

  sqlite
    .prepare("INSERT INTO review_rounds (target_type, target_id, round, user_id, verdict, feedback_json, created_at) VALUES ('article', 'sample-a', 1, ?, 'comments', '{}', '')")
    .run(userA);
  sqlite
    .prepare("INSERT INTO article_versions (target_type, target_id, round, html, markdown, content_hash, created_at) VALUES ('article', 'sample-a', 1, '', 'x', 'h', '')")
    .run();

  const updatedAtBefore = row.updated_at;
  const unchanged = await put(deps, viewerA, "sample-a", pushBody({ markdown: "# 标题\n\n正文", assets: [asset] }), "2026-10-02T09:00:00.000Z");
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.json.result, "unchanged");
  assert.equal(sqlite.prepare("SELECT updated_at FROM articles WHERE slug = ?").get("sample-a").updated_at, updatedAtBefore);

  const updated = await put(deps, viewerA, "sample-a", pushBody({ markdown: "# 标题\n\n正文改", assets: [asset] }), "2026-10-02T10:00:00.000Z");
  assert.equal(updated.status, 200);
  assert.equal(updated.json.result, "updated");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM articles").get().c, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM review_rounds").get().c, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM article_versions").get().c, 1);

  const reuseBody = pushBody({ markdown: "# 标题\n\n正文再改", assets: [{ name: asset.name, sha256: asset.sha256 }] });
  const reused = await put(deps, viewerA, "sample-a", reuseBody, "2026-10-02T11:00:00.000Z");
  assert.equal(reused.status, 200);
  assert.equal(reused.json.assets.reused, 1);
  assert.equal(reused.json.assets.stored, 0);

  const missing = await put(
    deps,
    viewerA,
    "sample-a",
    pushBody({ markdown: "# 标题\n\n缺图", assets: [{ name: "images/ffffffffffff.png", sha256: "f".repeat(64) }] }),
    "2026-10-02T12:00:00.000Z",
  );
  assert.equal(missing.status, 422);
  assert.equal(missing.json.code, "missing_assets");
  assert.deepEqual(missing.json.missingAssets, ["images/ffffffffffff.png"]);

  const dropped = await put(deps, viewerA, "sample-a", pushBody({ markdown: "# 标题\n\n删图" }), "2026-10-02T13:00:00.000Z");
  assert.equal(dropped.status, 200);
  assert.equal(dropped.json.assets.removed, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM article_assets").get().c, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM review_rounds").get().c, 1);
});

// ─── ownership / visibility ──────────────────────────

test("private articles stay private to their owner", async () => {
  const { sqlite, db, assets } = setup();
  const userA = addUser(sqlite, { account: "user-a", nickname: "A" });
  const userB = addUser(sqlite, { account: "user-b", nickname: "B" });
  const viewerA = { id: userA, role: "user" };
  const viewerB = { id: userB, role: "user" };
  const deps = { db, assets };

  const bytes = Buffer.from("fake-image-bytes-2");
  const asset = assetWithBytes(bytes);
  await put(deps, viewerA, "private-a", pushBody({ markdown: "# 私密", assets: [asset] }), "2026-10-02T01:00:00.000Z");

  const access = await loadArticleAccess(db, "private-a");
  assert.equal(access.ownerId, userA);
  assert.equal(canReadArticle(access, viewerB), false);
  assert.equal(canReadArticle(access, null), false);
  assert.equal(canReadArticle(access, viewerA), true);
  assert.equal(isArticleOwner(access, viewerB), false);

  const listB = await listArticlesForViewer(db, viewerB);
  assert.deepEqual(listB.map((item) => item.slug), []);
  const listAnonymous = await listArticlesForViewer(db, null);
  assert.deepEqual(listAnonymous.map((item) => item.slug), []);
  const listA = await listArticlesForViewer(db, viewerA);
  assert.deepEqual(listA.map((item) => item.slug), ["private-a"]);
  assert.equal(listA[0].isOwner, true);

  await assert.rejects(() => setArticlePublicForViewer(db, viewerB, "private-a", true), (error) => error instanceof ArticleAccessError && error.status === 404);

  const before = sqlite.prepare("SELECT * FROM articles WHERE slug = ?").get("private-a");
  const taken = await put(deps, viewerB, "private-a", pushBody({ markdown: "# 抢占" }), "2026-10-02T02:00:00.000Z");
  assert.equal(taken.status, 409);
  assert.equal(taken.json.code, "slug_taken");
  const after = sqlite.prepare("SELECT * FROM articles WHERE slug = ?").get("private-a");
  assert.equal(after.updated_at, before.updated_at);
  assert.equal(after.content_hash, before.content_hash);
});

test("public articles are readable by everyone", async () => {
  const { sqlite, db, assets } = setup();
  const userA = addUser(sqlite, { account: "user-a", nickname: "A" });
  const userB = addUser(sqlite, { account: "user-b", nickname: "B" });
  const viewerA = { id: userA, role: "user" };
  const deps = { db, assets };

  await put(deps, viewerA, "public-a", pushBody({ status: "published", markdown: "# 公开" }), "2026-10-02T01:00:00.000Z");
  const access = await loadArticleAccess(db, "public-a");
  assert.equal(access.isPublic, true);
  assert.equal(canReadArticle(access, { id: userB, role: "user" }), true);
  assert.equal(canReadArticle(access, null), true);
  assert.deepEqual((await listArticlesForViewer(db, null)).map((item) => item.slug), ["public-a"]);
  assert.equal((await listArticlesForViewer(db, null))[0].isOwner, false);
});

test("folder-imported slugs are managed and cannot be overwritten by push", async () => {
  const { sqlite, db, assets } = setup();
  const userA = addUser(sqlite, { account: "user-a", nickname: "A" });
  const viewerA = { id: userA, role: "user" };
  sqlite
    .prepare("INSERT INTO articles (slug, title, status, meta_json, content_hash, owner_id, synced_at, created_at, updated_at) VALUES (?, ?, 'draft', ?, 'h', ?, '', '', '')")
    .run("folder-a", "目录文章", JSON.stringify({ source: "folder" }), userA);

  const result = await put({ db, assets }, viewerA, "folder-a", pushBody({ markdown: "# 推送" }));
  assert.equal(result.status, 409);
  assert.equal(result.json.code, "slug_managed");
});

// ─── renderer ────────────────────────────────────────

test("parses GFM tables with alignment and escaped pipes", () => {
  const blocks = parseMarkdownBlocks("| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| **粗** | a\\|b | c |\n");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "table");
  assert.deepEqual(blocks[0].header, ["左", "中", "右"]);
  assert.deepEqual(blocks[0].align, ["left", "center", "right"]);
  assert.deepEqual(blocks[0].rows, [["**粗**", "a|b", "c"]]);
});

test("renders tables, callouts and same-site links without gradients", () => {
  const html = renderMarkdownAsGzhHtml(
    "| 左 | 右 |\n| :--- | ---: |\n| **粗** | c |\n\n> [!note]\n> 正文\n\n> [!warning] 小心\n> 警告\n\n[站内](/articles/foo)\n\n---\n",
  );
  assert.match(html, /<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;color:#333;"/);
  assert.match(html, /text-align:left/);
  assert.match(html, /text-align:right/);
  assert.match(html, /<strong>/);
  assert.match(html, /background:#F7F3EA;border-left:3px solid #1C1917/);
  assert.match(html, />注</);
  assert.match(html, />小心</);
  assert.match(html, /href="\/articles\/foo"/);
  assert.doesNotMatch(html, /href="\/articles\/foo"[^>]*target="_blank"/);
  assert.doesNotMatch(html, /linear-gradient/);
});

test("drops a leading H1 that repeats the page title, keeps everything else", () => {
  const md = "#   Agent  **评测**清单 \n\n正文第一段。\n\n# 第二个一级标题\n\n## 章节\n";
  const html = renderMarkdownAsGzhHtml(md, { pageTitle: "Agent 评测清单" });
  assert.doesNotMatch(html, /Agent  ?\*?\*?评测/);
  assert.match(html, /正文第一段/);
  // later H1s are no longer promoted to the big title block
  assert.match(html, /<h2[^>]*><span leaf="">第二个一级标题<\/span><\/h2>/);
  assert.doesNotMatch(html, /font-size:24px;font-weight:900/);
  assert.doesNotMatch(html, /data-gzh-title/);
  assert.match(html, /^<section data-gzh-md=""/);

  // no pageTitle → unchanged behaviour (title block rendered)
  assert.match(renderMarkdownAsGzhHtml(md), /font-size:24px;font-weight:900[^<]*><span leaf="">Agent  \*\*评测\*\*清单<\/span>/);
  assert.match(renderMarkdownAsGzhHtml(md), /<section data-gzh-title=""/);
  // different title → kept
  assert.match(renderMarkdownAsGzhHtml(md, { pageTitle: "别的标题" }), /font-size:24px;font-weight:900/);
  // first heading is H2 → nothing dropped even if a later H1 matches
  const h2First = renderMarkdownAsGzhHtml("## 导语\n\n# Agent 评测清单\n", { pageTitle: "Agent 评测清单" });
  assert.match(h2First, /Agent 评测清单/);
});

test("blockPlainText includes table content", () => {
  const blocks = parseMarkdownBlocks("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
  assert.equal(blocks[0].type, "table");
  assert.match(blockPlainText(blocks[0]), /a b 1 2/);
});

// ─── sync helper ─────────────────────────────────────

test("rowUnchanged compares every sync field", () => {
  const row = {
    date: "2026-01-01",
    title: "t",
    topic: null,
    status: null,
    metaJson: "{}",
    draftMd: null,
    finalMd: "x",
    qaReport: null,
    articleHtml: null,
    contentHash: "h",
    topicId: null,
  };
  assert.equal(rowUnchanged(row, { ...row }), true);
  assert.equal(rowUnchanged(row, { ...row, title: "changed" }), false);
  assert.equal(rowUnchanged(row, { ...row, contentHash: "other" }), false);
  assert.equal(rowUnchanged(null, row), false);
});
