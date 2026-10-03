/**
 * Brief material full-text fetch tests. Part A of the "brief split view" task:
 * pure helpers, the fetch pipeline (with a fake global fetch) and the DB layer.
 *
 * All data here is made up for tests; no real brief or material content.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  FETCH_REASON_LABELS,
  isSummaryOnly,
  looksPaywalled,
  reasonFromError,
  reasonFromStatus,
  pickMaterialRow,
  reasonLabel,
} from "../lib/material-fetch-core.ts";
import { fetchMaterialText, isJunkLine } from "../lib/material-fetch.ts";
import { itemUrlVariants } from "../lib/item-url.ts";
import { briefMaterialTargets, fetchMaterialTexts } from "../lib/brief-material-fetch.ts";
import {
  cleanMaterialBody,
  hasCjk,
  pickInitialTopic,
  toMaterialView,
  topicStatusLabel,
} from "../lib/brief-view.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";

const ORIGINAL_FETCH = globalThis.fetch;
test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const LONG_ARTICLE_HTML = `<!doctype html><html><head><title>样本文章</title></head><body><article><h1>样本文章</h1>${"<p>这是一段足够长的样本正文，用来测试正文提取是否能够拿到超过四百字的文本内容。</p>".repeat(16)}</article></body></html>`;
const SHORT_ARTICLE_HTML = "<!doctype html><html><body><article><p>太短了，抓不到正文。</p></article></body></html>";

test("isSummaryOnly: 空、只有链接、摘要+链接、等于摘要都算只有摘要", () => {
  assert.equal(isSummaryOnly({ contentMarkdown: null }), true);
  assert.equal(isSummaryOnly({ contentMarkdown: "" }), true);
  assert.equal(isSummaryOnly({ contentMarkdown: "[原文链接](https://example.com/a)" }), true);
  assert.equal(isSummaryOnly({ contentMarkdown: "一段摘要\n\n[原文链接](https://example.com/a)", originalExcerpt: "一段摘要" }), true);
  assert.equal(isSummaryOnly({ contentMarkdown: "只有摘要正文", originalExcerpt: "只有摘要正文" }), true);
  assert.equal(isSummaryOnly({ contentMarkdown: "中文摘要", translatedExcerpt: "中文摘要" }), true);

  const body = "正文内容".repeat(150); // 600 字，且带链接
  assert.equal(isSummaryOnly({ contentMarkdown: `${body}\n\n[原文链接](https://example.com/a)`, originalExcerpt: "别的摘要" }), false);
  assert.equal(isSummaryOnly({ contentMarkdown: "一段真正的长正文，和摘要不一样。" }), false);
});

test("reasonFromStatus: 登录墙、付费墙、打不开、200", () => {
  assert.equal(reasonFromStatus(401), "login");
  assert.equal(reasonFromStatus(402), "login");
  assert.equal(reasonFromStatus(403, "<html>Subscribe to continue reading</html>"), "login");
  assert.equal(reasonFromStatus(403, "<html>Forbidden</html>"), "unreachable");
  assert.equal(reasonFromStatus(404), "unreachable");
  assert.equal(reasonFromStatus(410), "unreachable");
  assert.equal(reasonFromStatus(429), "unreachable");
  assert.equal(reasonFromStatus(500), "unreachable");
  assert.equal(reasonFromStatus(503), "unreachable");
  assert.equal(reasonFromStatus(200), null);
});

test("reasonFromError: 网络层异常统一是打不开", () => {
  assert.equal(reasonFromError(Object.assign(new Error("x"), { name: "TimeoutError" })), "unreachable");
  assert.equal(reasonFromError(new Error("来源响应超时")), "unreachable");
  assert.equal(reasonFromError(new TypeError("fetch failed")), "unreachable");
  assert.equal(reasonFromError(new Error("不能抓取本机或内网地址")), "unreachable");
});

test("looksPaywalled: 付费墙标记真/假", () => {
  assert.equal(looksPaywalled('<script type="application/ld+json">{"isAccessibleForFree": false}</script>'), true);
  assert.equal(looksPaywalled("<p>Subscribe to continue</p>"), true);
  assert.equal(looksPaywalled("<p>这是正常的公开文章正文。</p>"), false);
  assert.equal(looksPaywalled('<script>{"isAccessibleForFree": true}</script>'), false);
});

test("reasonLabel: 三种原因中文一字不差，未知为空", () => {
  assert.equal(reasonLabel("login"), "需要登录或付费");
  assert.equal(reasonLabel("unreachable"), "网页打不开");
  assert.equal(reasonLabel("extract"), "正文提取失败");
  assert.equal(reasonLabel("nope"), "");
  assert.equal(reasonLabel(null), "");
  assert.equal(reasonLabel(undefined), "");
  assert.deepEqual(FETCH_REASON_LABELS, {
    login: "需要登录或付费",
    unreachable: "网页打不开",
    extract: "正文提取失败",
  });
});

function fakeFetch(routes) {
  globalThis.fetch = async (input) => {
    const url = String(input);
    for (const [match, handler] of routes) {
      if (typeof match === "string" ? url === match : match.test(url)) return handler(url);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

test("fetchMaterialText: 正常文章、短页面、402、网络错误、GitHub README", async () => {
  // 正常文章 → ok 且正文够长
  fakeFetch([
    [
      "https://example.com/article",
      () => new Response(LONG_ARTICLE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    ],
  ]);
  const ok = await fetchMaterialText("https://example.com/article");
  assert.equal(ok.ok, true);
  assert.ok(ok.markdown.length >= 400, `expected >=400 chars, got ${ok.ok ? ok.markdown.length : 0}`);

  // 短页面 → extract
  fakeFetch([["https://example.com/short", () => new Response(SHORT_ARTICLE_HTML, { status: 200, headers: { "content-type": "text/html" } })]]);
  assert.deepEqual(await fetchMaterialText("https://example.com/short"), { ok: false, reason: "extract" });

  // 402 → login
  fakeFetch([["https://example.com/pay", () => new Response("payment required", { status: 402 })]]);
  assert.deepEqual(await fetchMaterialText("https://example.com/pay"), { ok: false, reason: "login" });

  // 网络错误 → unreachable
  fakeFetch([
    [
      "https://example.com/down",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ]);
  assert.deepEqual(await fetchMaterialText("https://example.com/down"), { ok: false, reason: "unreachable" });

  // GitHub 仓库走 raw README
  const readmeRoute = [
    /^https:\/\/raw\.githubusercontent\.com\/example\/repo\/HEAD\//,
    () => new Response("# Example\n\n这是仓库 README 的正文说明。", { status: 200, headers: { "content-type": "text/plain" } }),
  ];
  fakeFetch([readmeRoute]);
  const github = await fetchMaterialText("https://github.com/example/repo");
  assert.equal(github.ok, true);
  assert.match(github.markdown, /仓库 README/);

  globalThis.fetch = ORIGINAL_FETCH;
});

function setupItemsDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    "CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, title TEXT, original_excerpt TEXT, translated_excerpt TEXT, content_markdown TEXT, author TEXT, content_fetch_status TEXT, content_fetch_reason TEXT, content_fetched_at TEXT)",
  );
  return createFakeD1(sqlite);
}

function insertItem(sqlite, item) {
  sqlite
    .prepare(
      "INSERT INTO items (url, title, original_excerpt, translated_excerpt, content_markdown, author, content_fetch_status, content_fetch_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      item.url,
      item.title ?? "样本标题",
      item.originalExcerpt ?? null,
      item.translatedExcerpt ?? null,
      item.contentMarkdown ?? null,
      item.author ?? null,
      item.fetchStatus ?? null,
      item.fetchReason ?? null,
    );
  return Number(sqlite.prepare("SELECT id FROM items WHERE url = ?").get(item.url).id);
}

function itemRow(sqlite, url) {
  return sqlite.prepare("SELECT * FROM items WHERE url = ?").get(url);
}

test("fetchMaterialTexts: 成功替换正文、失败只记原因、非摘要跳过、failed 默认跳过 force 重试", async () => {
  const { sqlite, ...db } = setupItemsDb();
  const successId = insertItem(sqlite, { url: "https://example.com/success", contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/success)", originalExcerpt: "样本摘要", fetchStatus: null });
  const failureId = insertItem(sqlite, { url: "https://example.com/failure", contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/failure)", originalExcerpt: "样本摘要", fetchStatus: null });
  const bodyId = insertItem(sqlite, { url: "https://example.com/has-body", contentMarkdown: "已经有真正的长正文".repeat(20), originalExcerpt: "摘要", fetchStatus: null });
  const failedId = insertItem(sqlite, {
    url: "https://example.com/failed-before",
    contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/failed-before)",
    originalExcerpt: "样本摘要",
    fetchStatus: "failed",
    fetchReason: "unreachable",
  });

  const targets = [
    { id: successId, url: "https://example.com/success", contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/success)", originalExcerpt: "样本摘要", translatedExcerpt: null, fetchStatus: null },
    { id: failureId, url: "https://example.com/failure", contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/failure)", originalExcerpt: "样本摘要", translatedExcerpt: null, fetchStatus: null },
    { id: bodyId, url: "https://example.com/has-body", contentMarkdown: "已经有真正的长正文".repeat(20), originalExcerpt: "摘要", translatedExcerpt: null, fetchStatus: null },
    { id: failedId, url: "https://example.com/failed-before", contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/failed-before)", originalExcerpt: "样本摘要", translatedExcerpt: null, fetchStatus: "failed", fetchReason: "unreachable" },
  ];

  const fetcher = async (url) => {
    if (url === "https://example.com/success") return { ok: true, markdown: "抓到的正文".repeat(50), author: "样本作者" };
    if (url === "https://example.com/failure") return { ok: false, reason: "login" };
    throw new Error(`unexpected fetch: ${url}`);
  };

  const summary = await fetchMaterialTexts(db, targets, { fetcher, concurrency: 2 });
  assert.deepEqual(
    { checked: summary.checked, fetched: summary.fetched, skipped: summary.skipped, failed: summary.failed },
    { checked: 2, fetched: 1, skipped: 2, failed: [{ url: "https://example.com/failure", reason: "login" }] },
  );

  const success = itemRow(sqlite, "https://example.com/success");
  assert.ok(String(success.content_markdown).startsWith("抓到的正文"));
  assert.equal(success.content_fetch_status, "ok");
  assert.equal(success.content_fetch_reason, null);
  assert.equal(success.author, "样本作者");
  assert.ok(success.content_fetched_at);

  const failure = itemRow(sqlite, "https://example.com/failure");
  assert.equal(failure.content_markdown, "样本摘要\n\n[原文链接](https://example.com/failure)");
  assert.equal(failure.content_fetch_status, "failed");
  assert.equal(failure.content_fetch_reason, "login");

  assert.equal(itemRow(sqlite, "https://example.com/has-body").content_fetch_status, null);
  assert.equal(itemRow(sqlite, "https://example.com/failed-before").content_fetch_status, "failed");

  // force 时重试之前失败的
  const retry = await fetchMaterialTexts(db, targets, {
    force: true,
    fetcher: async (url) => (url === "https://example.com/failed-before" ? { ok: true, markdown: "重试后的正文".repeat(60), author: "" } : { ok: false, reason: "extract" }),
  });
  assert.equal(retry.checked, 3); // 三条仍是摘要的（success 已变正文，body 本来就跳过）
  const retried = itemRow(sqlite, "https://example.com/failed-before");
  assert.equal(retried.content_fetch_status, "ok");
  assert.ok(String(retried.content_markdown).startsWith("重试后的正文"));
});

test("briefMaterialTargets: 按简报素材 URL 匹配 items，兼容末尾斜杠", async () => {
  const { sqlite, ...db } = setupItemsDb();
  sqlite.exec("CREATE TABLE daily_briefs (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, data_json TEXT NOT NULL, topic_count INTEGER NOT NULL, imported_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  const brief = {
    version: 1,
    date: "2026-10-02",
    topics: [
      { id: "t1", type: "新闻题", label: "", title: "样本选题", oneLiner: "", detail: "", scenarios: [], questions: [], note: "", materials: [{ title: "A", summary: "s", url: "https://example.com/a", links: [] }, { title: "B", summary: "s", url: "https://example.com/b/", links: [] }] },
    ],
  };
  sqlite
    .prepare("INSERT INTO daily_briefs (date, data_json, topic_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("2026-10-02", JSON.stringify(brief), 1, "2026-10-02T00:00:00.000Z", "2026-10-02T00:00:00.000Z");
  const aId = insertItem(sqlite, { url: "https://example.com/a", contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/a)", originalExcerpt: "样本摘要" });
  const bId = insertItem(sqlite, { url: "https://example.com/b/", contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/b/)", originalExcerpt: "样本摘要" });

  const targets = await briefMaterialTargets(db, "2026-10-02");
  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map((target) => target.id).sort((x, y) => x - y), [aId, bId].sort((x, y) => x - y));
  assert.deepEqual(targets.map((target) => target.url), ["https://example.com/a", "https://example.com/b/"]);
});

test("briefMaterialTargets: 同一链接因末尾斜杠存成两条时，选有原文的那条", async () => {
  const { sqlite, ...db } = setupItemsDb();
  sqlite.exec("CREATE TABLE daily_briefs (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, data_json TEXT NOT NULL, topic_count INTEGER NOT NULL, imported_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  const brief = {
    version: 1,
    date: "2026-10-03",
    topics: [{ id: "t1", type: "新闻题", label: "", title: "样本选题", oneLiner: "", detail: "", scenarios: [], questions: [], note: "", materials: [{ title: "C", summary: "s", url: "https://example.com/c/", links: [] }] }],
  };
  sqlite
    .prepare("INSERT INTO daily_briefs (date, data_json, topic_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("2026-10-03", JSON.stringify(brief), 1, "2026-10-03T00:00:00.000Z", "2026-10-03T00:00:00.000Z");
  insertItem(sqlite, { url: "https://example.com/c/", contentMarkdown: "样本摘要\n\n[原文链接](https://example.com/c/)", originalExcerpt: "样本摘要" });
  const fullId = insertItem(sqlite, { url: "https://example.com/c", contentMarkdown: "完整正文。".repeat(200), originalExcerpt: "样本摘要" });

  const targets = await briefMaterialTargets(db, "2026-10-03");
  assert.equal(targets.length, 1);
  assert.equal(targets[0].id, fullId);
  assert.equal(targets[0].url, "https://example.com/c/");
});

test("pickMaterialRow: 有原文优先，其次没失败过，最后 id 最小", () => {
  const summary = "样本摘要\n\n[原文链接](https://example.com/x)";
  const full = "完整正文。".repeat(200);
  assert.equal(pickMaterialRow([]), null);
  assert.equal(pickMaterialRow([{ id: 1, contentMarkdown: summary }, { id: 2, contentMarkdown: full }]).id, 2);
  assert.equal(pickMaterialRow([{ id: 1, contentMarkdown: summary, fetchStatus: "failed" }, { id: 2, contentMarkdown: summary }]).id, 2);
  assert.equal(pickMaterialRow([{ id: 5, contentMarkdown: summary }, { id: 3, contentMarkdown: summary }]).id, 3);
});

test("itemUrlVariants: 原样、去尾斜杠、加尾斜杠", () => {
  const variants = itemUrlVariants("https://example.com/post/");
  assert.ok(variants.includes("https://example.com/post/"));
  assert.ok(variants.includes("https://example.com/post"));
  assert.deepEqual(itemUrlVariants(""), []);
});

test("isJunkLine: 样式类名碎片、Loading 行算垃圾，正常句子不算", () => {
  assert.equal(isJunkLine("[&_[data-slot=x]]:[--gutter:0px] [&_.y]:[--pad:4px] text"), true);
  assert.equal(isJunkLine("Loading…"), true);
  assert.equal(isJunkLine("Loading..."), true);
  assert.equal(isJunkLine("We trained the model on a new mixture of public and licensed data."), false);
  assert.equal(isJunkLine("短句"), false);
  assert.equal(isJunkLine("Use the --flag: option once when running the CLI."), false);
});

/* ── PART B：/topics/daily 左右布局的纯函数 ───────────── */

const LONG_BODY = "这是真正的原文正文。" + "内容不断重复，用来超过摘要判断门槛。".repeat(40);

test("toMaterialView: 有原文、只有摘要、没试过、item 不存在", () => {
  const withBody = toMaterialView(
    { title: "素材标题", summary: "一句话摘要", url: "https://example.com/post" },
    {
      id: 7,
      title: "原文标题",
      translatedTitle: null,
      originalExcerpt: "摘要",
      translatedExcerpt: null,
      contentMarkdown: LONG_BODY,
      author: "example.com",
      publishedAt: "2026-09-29T10:00:00.000Z",
      fetchStatus: "ok",
      fetchReason: null,
    },
  );
  assert.equal(withBody.hasText, true);
  assert.equal(withBody.itemId, 7);
  assert.equal(withBody.title, "原文标题");
  assert.equal(withBody.site, "example.com");
  assert.equal(withBody.publishedLabel, "9月29日");
  assert.equal(withBody.summary, "一句话摘要");
  assert.equal(withBody.missingReason, "");
  assert.ok(withBody.body.length > 0);

  const failed = toMaterialView(
    { title: "素材标题", summary: "一句话摘要", url: "https://example.com/post" },
    {
      id: 8,
      title: "原文标题",
      contentMarkdown: "一句话摘要\n\n[原文链接](https://example.com/post)",
      originalExcerpt: "一句话摘要",
      translatedExcerpt: null,
      fetchStatus: "failed",
      fetchReason: "unreachable",
    },
  );
  assert.equal(failed.hasText, false);
  assert.equal(failed.body, "");
  assert.equal(failed.missingReason, "网页打不开");
  assert.ok(["需要登录或付费", "网页打不开", "正文提取失败"].includes(failed.missingReason));

  const untried = toMaterialView(
    { title: "素材标题", summary: "一句话摘要", url: "https://example.com/post" },
    { id: 9, contentMarkdown: "摘要", originalExcerpt: "摘要", fetchStatus: null, fetchReason: null },
  );
  assert.equal(untried.hasText, false);
  assert.equal(untried.missingReason, "");

  const noItem = toMaterialView(
    { title: "素材标题", summary: "摘要", url: "https://www.example.com/post" },
    null,
  );
  assert.equal(noItem.itemId, null);
  assert.equal(noItem.title, "素材标题");
  assert.equal(noItem.site, "example.com");
  assert.equal(noItem.hasText, false);
  assert.equal(noItem.missingReason, "");
});

test("toMaterialView: 英文正文配中文摘要有译文，中文正文没有", () => {
  const englishBody = "This is the full article body. ".repeat(40);
  const english = toMaterialView(
    { title: "English", summary: "s", url: "https://example.com/en" },
    { id: 10, contentMarkdown: englishBody, translatedExcerpt: "这是中文摘要。", originalExcerpt: null, fetchStatus: "ok" },
  );
  assert.equal(english.hasText, true);
  assert.equal(hasCjk(english.body), false);
  assert.equal(english.translatedBody, "这是中文摘要。");

  const chinese = toMaterialView(
    { title: "中文", summary: "s", url: "https://example.com/zh" },
    { id: 11, contentMarkdown: LONG_BODY, translatedExcerpt: "这是中文摘要。", originalExcerpt: "摘要", fetchStatus: "ok" },
  );
  assert.equal(chinese.hasText, true);
  assert.equal(chinese.translatedBody, "");
});

test("cleanMaterialBody: 去图片与原文链接，并把一整段长文切成多段", () => {
  const sentence = "这是一段很长的正文句子，用来测试自动分段。";
  const raw = "![封面](https://example.com/a.png)" + sentence.repeat(80) + "[原文链接](https://example.com/a)";
  const cleaned = cleanMaterialBody(raw);
  assert.equal(cleaned.includes("!["), false);
  assert.equal(cleaned.includes("[原文链接]"), false);
  assert.ok(cleaned.includes("\n\n"));
  assert.ok(cleaned.split("\n\n").length >= 2);
  assert.ok(cleaned.length > 1000);
});

test("pickInitialTopic: URL 指定、今日推荐、第一条未处理、全都处理过", () => {
  const ids = ["b", "a", "c"];
  assert.equal(pickInitialTopic(ids, "a", {}, "c"), "c");
  assert.equal(pickInitialTopic(ids, "a", {}, "zzz"), "a");
  assert.equal(pickInitialTopic(ids, "a", {}, null), "a");
  assert.equal(pickInitialTopic(ids, "a", { a: "pick" }, null), "b");
  assert.equal(pickInitialTopic(ids, "a", { a: "pick", b: "reject", c: "pick" }, null), "b");
  assert.equal(pickInitialTopic([], "a", {}, null), null);
});

test("topicStatusLabel: 已选 / 不要 / 星 / 未处理", () => {
  assert.equal(topicStatusLabel({ decision: null, rating: null }), "未处理");
  assert.equal(topicStatusLabel({ decision: null, rating: 4 }), "4 星");
  assert.equal(topicStatusLabel({ decision: "pick", rating: null }), "已选");
  assert.equal(topicStatusLabel({ decision: "reject", rating: null }), "不要");
  assert.equal(topicStatusLabel({ decision: "pick", rating: 4 }), "已选 · 4 星");
  assert.equal(topicStatusLabel({ decision: "reject", rating: 5 }), "不要 · 5 星");
});

test("DailyBrief 紧凑刊头与宽屏满屏双栏：源码约束", () => {
  const tsx = readFileSync(
    new URL("../app/content/_brief/DailyBrief.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../app/content/_brief/daily-brief.css", import.meta.url),
    "utf8",
  );

  // 刊头去掉面包屑，日期标题用自己的类，方便覆盖全局 page-title 样式。
  assert.equal(tsx.includes("page-kicker"), false);
  assert.equal(tsx.includes("内容 · 选题简报"), false);
  assert.ok(tsx.includes("db-head-title"));

  // 交互与日期切换的钩子必须保留。
  assert.ok(tsx.includes('aria-live="polite"'));
  assert.ok(tsx.includes("brief-prev"));
  assert.ok(tsx.includes("brief-next"));
  assert.ok(tsx.includes("brief-date-select"));
  assert.ok(tsx.includes("scrollIntoView"));

  // 宽屏用 flex 撑满视口，不再依赖硬编码的 appbar 高度。
  const wideStart = css.indexOf("@media (min-width: 1024px)");
  assert.ok(wideStart >= 0, "缺少宽屏媒体查询");
  const wide = css.slice(wideStart);
  assert.ok(wide.includes(".db-page"));
  assert.ok(wide.includes("height: 100dvh"));
  assert.equal(css.includes("--db-appbar: 93px"), false);

  // 刊头下保留杂志风双细线。
  assert.ok(css.includes("3px double var(--ink)"));
});
