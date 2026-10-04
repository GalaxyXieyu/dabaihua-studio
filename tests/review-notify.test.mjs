/**
 * 文章审稿提交通知测试（设计见 docs/assistant-events-design.md §4）。
 *
 * 覆盖：suggestHandoff 的自动 / 手选规则各分支；提交体 handoff 的合法值
 * （"auto" / 三位助手名 / 非法 400）；buildReviewNotifyPayload 的顶层字段
 * （与注册表一致）、article 扩展字段（meta_json / articleDir / 缺字段给 null）、
 * review 投影（good/change 都带 quote+comment、counts、links、无 reviewer id）；
 * notifyArticleReview 用 fake-d1 + 假 fetch 的发送与写回（delivered / failed /
 * unconfigured、手选优先、找不到轮返回 null）；提交与读取路由的静态约定
 * （submitReview 成功后才通知且仅 article、feedback/rounds 认助手 token 只对
 * article 生效、写接口不认助手 token、重试路由 404）；审稿页 UI 的静态断言
 * （阶段徽标 / 进度 / 通知状态四种文案与重试 / 接手人单选发 handoff / 封面）。
 *
 * 所有 URL、secret、内容都是杜撰的，仅用于测试。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getAssistantEvent } from "../lib/assistant-events.ts";
import {
  HANDOFF_ASSISTANTS,
  buildReviewNotifyPayload,
  normalizeHandoffPick,
  suggestHandoff,
} from "../lib/review-notify-core.ts";
import { notifyArticleReview } from "../lib/review-notify.ts";
import { createFakeD1 } from "./helpers/fake-d1.mjs";

const ORIGINAL_FETCH = globalThis.fetch;
test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const WEBHOOK_URL = "https://hook.example.com/secret-path";
const ORIGIN = "https://review.example.com";

function changeMark(comment, overrides = {}) {
  return { type: "change", comment, ...overrides };
}

test("suggestHandoff: 候选名单与手选优先", () => {
  assert.deepEqual([...HANDOFF_ASSISTANTS], ["紫薇", "小燕子", "尔康"]);
  // 手选优先：即使 approved 也听 Yu 的。
  const picked = suggestHandoff("approved", "整段重写", [changeMark("推翻重来")], "小燕子");
  assert.deepEqual(picked, { assistant: "小燕子", reason: "Yu 指定", source: "picked" });
  // "auto" / 空串 / 非法值都回落到自动规则。
  assert.equal(suggestHandoff("changes_requested", "错别字", [], "auto").source, "auto");
  assert.equal(suggestHandoff("changes_requested", "错别字", [], "五阿哥").source, "auto");
  assert.equal(suggestHandoff("comments", "错别字", [], null).assistant, "紫薇");
});

test("suggestHandoff: approved → 尔康（排版定稿）", () => {
  const handoff = suggestHandoff("approved", "", []);
  assert.deepEqual(handoff, { assistant: "尔康", reason: "审稿通过，进入排版定稿", source: "auto" });
  // 有文字意见也一样：通过即进排版。
  assert.equal(suggestHandoff("approved", "标题改一下", []).assistant, "尔康");
});

test("suggestHandoff: 意见命中结构词 → 小燕子", () => {
  // 总体意见命中。
  assert.deepEqual(suggestHandoff("changes_requested", "这版不行，整段重来", []), {
    assistant: "小燕子",
    reason: "结构性修改",
    source: "auto",
  });
  // 要改标记的意见命中也算。
  assert.equal(suggestHandoff("comments", "", [changeMark("换个角度再写一版")]).assistant, "小燕子");
  // good 类标记的意见不参与判定。
  assert.equal(suggestHandoff("comments", "", [{ type: "good", comment: "观点重写？" }]).assistant, "紫薇");
});

test("suggestHandoff: 全部意见只谈排版配图 → 尔康", () => {
  const handoff = suggestHandoff("changes_requested", "封面换一张", [changeMark("行距太密"), changeMark("配图换成 1:1")]);
  assert.deepEqual(handoff, { assistant: "尔康", reason: "意见都是排版配图", source: "auto" });
  // 英文 layout 也算排版词。
  assert.equal(suggestHandoff("comments", "layout 再调一下", []).assistant, "尔康");
});

test("suggestHandoff: 排版 + 文字混合，或纯文字 → 紫薇；无意见的 comments → 紫薇", () => {
  assert.deepEqual(suggestHandoff("comments", "封面换一张", [changeMark("标题改一下")]), {
    assistant: "紫薇",
    reason: "文字修改",
    source: "auto",
  });
  assert.equal(suggestHandoff("changes_requested", "", [changeMark("论点站不住")]).assistant, "紫薇");
  // 没有任何非空意见（comments 结论）也归紫薇。
  assert.deepEqual(suggestHandoff("comments", "", [changeMark("")]), {
    assistant: "紫薇",
    reason: "文字修改",
    source: "auto",
  });
});

test("normalizeHandoffPick: auto / 缺省 / 手选 / 非法（400 错误文案）", () => {
  assert.equal(normalizeHandoffPick(undefined), null);
  assert.equal(normalizeHandoffPick(null), null);
  assert.equal(normalizeHandoffPick("auto"), null);
  assert.equal(normalizeHandoffPick(" 尔康 "), "尔康");
  for (const bad of ["五阿哥", "晴儿", "", "紫薇2"]) {
    assert.throws(() => normalizeHandoffPick(bad), /审稿接手人不合法/);
  }
});

// ─── payload 构造 ────────────────────────────────────

function sampleFeedback(overrides = {}) {
  return {
    schema: "dabaihua.review-feedback/v1",
    target: { type: "article", id: "demo-slug", title: "样本文章", slug: "demo-slug", topicId: null },
    round: 2,
    verdict: "changes_requested",
    overallComment: "标题改一下",
    reviewer: { id: 42, nickname: "Yu", account: "yu@example.com" },
    submittedAt: "2026-10-06T09:00:00.000Z",
    contentHash: "hash-abc",
    counts: { good: 1, change: 2 },
    marks: [
      { id: 1, type: "good", quote: "好的句子", prefix: "前", suffix: "后", blockIndex: 0, startOffset: 0, endOffset: 4, comment: "保持" },
      { id: 2, type: "change", quote: "差的句子", prefix: "前", suffix: "后", blockIndex: 1, startOffset: 10, endOffset: 14, comment: "错别字改一下" },
      { id: 3, type: "change", quote: "另一句", prefix: "", suffix: "", blockIndex: 2, startOffset: 20, endOffset: 23, comment: "开头重写" },
    ],
    ...overrides,
  };
}

const SAMPLE_META = {
  source: "push",
  sourcePath: "content/demo-slug/03-final.md",
  assistant: "紫薇",
  brief: { date: "2026-10-02", topicId: "kb-3" },
  boardTopicId: 7,
  stage: { name: "revised", round: 1, label: "已按第 1 轮改完", assistant: "紫薇", at: "2026-10-05T10:00:00+08:00" },
};

function buildPayload(overrides = {}) {
  return buildReviewNotifyPayload({
    feedback: sampleFeedback(),
    article: { slug: "demo-slug", title: "样本文章", status: "changes-requested", metaJson: JSON.stringify(SAMPLE_META) },
    origin: ORIGIN,
    eventId: "e9a0f0ee-0000-4000-8000-000000000002",
    sentAt: "2026-10-06T21:00:00+08:00",
    ...overrides,
  });
}

test("buildReviewNotifyPayload: 顶层字段与注册表一致，逐项对上", () => {
  const def = getAssistantEvent("article.review_submitted");
  assert.ok(def, "注册表缺少 article.review_submitted");
  assert.ok(def.enabled, "article.review_submitted 应已启用");
  const payload = buildPayload();
  assert.deepEqual(Object.keys(payload), def.payloadFields);
  assert.equal(payload.protocol, "dabaihua.review-notify/v1");
  assert.equal(payload.event, "article_review_submitted");
  assert.equal(payload.eventId, "e9a0f0ee-0000-4000-8000-000000000002");
  assert.equal(payload.sentAt, "2026-10-06T21:00:00+08:00");

  assert.equal(payload.article.slug, "demo-slug");
  assert.equal(payload.article.title, "样本文章");
  assert.equal(payload.article.status, "changes-requested");
  assert.equal(payload.article.sourcePath, "content/demo-slug/03-final.md");
  assert.equal(payload.article.articleDir, "content");
  assert.equal(payload.article.assistant, "紫薇");
  assert.deepEqual(payload.article.brief, { date: "2026-10-02", topicId: "kb-3" });
  assert.equal(payload.article.boardTopicId, 7);
  assert.equal(payload.article.stage.name, "revised");

  assert.equal(payload.review.round, 2);
  assert.equal(payload.review.verdict, "changes_requested");
  assert.equal(payload.review.overallComment, "标题改一下");
  assert.equal(payload.review.submittedAt, "2026-10-06T09:00:00.000Z");
  assert.equal(payload.review.contentHash, "hash-abc");
  assert.deepEqual(payload.review.counts, { marks: 3, good: 1, change: 2 });
  // good / change 两种标记都带 quote 与 comment。
  for (const mark of payload.review.marks) {
    assert.deepEqual(Object.keys(mark), ["id", "type", "quote", "comment", "prefix", "suffix", "blockIndex"]);
    assert.equal(typeof mark.quote, "string");
    assert.equal(typeof mark.comment, "string");
  }
  assert.equal(payload.review.marks[0].type, "good");
  assert.equal(payload.review.marks[2].comment, "开头重写");

  // 自动判定：意见里命中结构词（重写）→ 小燕子。
  assert.deepEqual(payload.handoff, { assistant: "小燕子", reason: "结构性修改", source: "auto" });

  // links 指向审稿页与反馈接口，slug 编码、带轮次。
  assert.equal(payload.links.review, `${ORIGIN}/review/article/demo-slug`);
  assert.equal(payload.links.feedback, `${ORIGIN}/api/review/article/demo-slug/feedback?round=2`);
});

test("buildReviewNotifyPayload: 无 reviewer id / 邮箱，只留昵称", () => {
  const payload = buildPayload();
  assert.deepEqual(payload.review.reviewer, { nickname: "Yu" });
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes("yu@example.com"));
  assert.ok(!serialized.includes('"reviewer"'.replace("reviewer", "userId")));
  // 序列化里唯一可能的数字 id 只出现在 marks.id。
  assert.ok(!/"id"\s*:\s*42/.test(serialized));
});

test("buildReviewNotifyPayload: meta 缺字段 / 坏 JSON → null，手选优先", () => {
  const empty = buildPayload({
    article: { slug: "demo-slug", title: null, status: null, metaJson: "not json {" },
  });
  assert.equal(empty.article.title, null);
  assert.equal(empty.article.status, null);
  assert.equal(empty.article.sourcePath, null);
  assert.equal(empty.article.articleDir, null);
  assert.equal(empty.article.assistant, null);
  assert.equal(empty.article.brief, null);
  assert.equal(empty.article.boardTopicId, null);
  assert.equal(empty.article.stage, null);

  // sourcePath 不含 "/" 时 articleDir 为 null；origin 尾斜杠去掉。
  const flat = buildPayload({
    article: { slug: "demo-slug", title: "T", status: "draft", metaJson: JSON.stringify({ sourcePath: "03-final.md" }) },
    origin: `${ORIGIN}/`,
  });
  assert.equal(flat.article.articleDir, null);
  assert.equal(flat.links.review, `${ORIGIN}/review/article/demo-slug`);

  // 手选优先。
  const picked = buildPayload({ picked: "尔康" });
  assert.deepEqual(picked.handoff, { assistant: "尔康", reason: "Yu 指定", source: "picked" });
});

// ─── notifyArticleReview（fake-d1 + 假 fetch）────────

function setupReviewDb(feedback = sampleFeedback()) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE articles (slug TEXT PRIMARY KEY, title TEXT, status TEXT, meta_json TEXT NOT NULL DEFAULT '{}', review_round INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE review_rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, round INTEGER NOT NULL, user_id INTEGER NOT NULL, verdict TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', mark_count INTEGER NOT NULL DEFAULT 0, feedback_json TEXT NOT NULL, exported_at TEXT, export_path TEXT, notify_state TEXT, notify_http_status INTEGER, notify_error TEXT, notify_at TEXT, notify_handoff TEXT, handoff_pick TEXT, created_at TEXT NOT NULL, UNIQUE(target_type, target_id, round));
    CREATE TABLE assistant_notify_log (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, event TEXT NOT NULL, ref TEXT, state TEXT NOT NULL, http_status INTEGER, error TEXT, duration_ms INTEGER NOT NULL DEFAULT 0, target_host TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  `);
  sqlite.prepare("INSERT INTO articles (slug, title, status, meta_json) VALUES (?, ?, ?, ?)")
    .run("demo-slug", "样本文章", "changes-requested", JSON.stringify(SAMPLE_META));
  sqlite.prepare(
    "INSERT INTO review_rounds (target_type, target_id, round, user_id, verdict, comment, mark_count, feedback_json, handoff_pick, created_at) VALUES ('article', 'demo-slug', 2, 42, 'changes_requested', '标题改一下', 3, ?, NULL, '2026-10-06T09:00:00.000Z')",
  ).run(JSON.stringify(feedback));
  return createFakeD1(sqlite);
}

function notifyEnv(db, overrides = {}) {
  return { DB: db, SHUFANGZHAI_WEBHOOK_URL: WEBHOOK_URL, SHUFANGZHAI_WEBHOOK_SECRET: "sekret", ...overrides };
}

function headerOf(headers, name) {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

function roundRow(db) {
  return db.sqlite.prepare("SELECT * FROM review_rounds WHERE round = 2").get();
}

test("notifyArticleReview: delivered 写回 notify_* 列并写通用日志", async () => {
  const db = setupReviewDb();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(null, { status: 204 });
  };

  const result = await notifyArticleReview(notifyEnv(db), { slug: "demo-slug", round: 2, origin: ORIGIN });
  assert.ok(result, "轮次存在应返回结果");
  assert.equal(result.state, "delivered");
  assert.equal(result.httpStatus, 204);
  assert.equal(result.handoff, "小燕子");
  assert.ok(result.at);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, WEBHOOK_URL);
  assert.equal(seen[0].init.method, "POST");
  assert.equal(headerOf(seen[0].init.headers, "x-dabaihua-event"), "article_review_submitted");
  assert.equal(headerOf(seen[0].init.headers, "authorization"), "Bearer sekret");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.protocol, "dabaihua.review-notify/v1");
  assert.equal(body.event, "article_review_submitted");
  assert.match(body.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(body.review.reviewer.nickname, "Yu");
  assert.ok(!JSON.stringify(body).includes("yu@example.com"));
  assert.equal(body.links.feedback, `${ORIGIN}/api/review/article/demo-slug/feedback?round=2`);

  const row = roundRow(db);
  assert.equal(row.notify_state, "delivered");
  assert.equal(row.notify_http_status, 204);
  assert.equal(row.notify_error, null);
  assert.equal(row.notify_at, result.at);
  assert.equal(row.notify_handoff, "小燕子");

  const logs = db.sqlite.prepare("SELECT * FROM assistant_notify_log").all();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].key, "article.review_submitted");
  assert.equal(logs[0].event, "article_review_submitted");
  assert.equal(logs[0].ref, "demo-slug#2");
  assert.equal(logs[0].target_host, "hook.example.com");
});

test("notifyArticleReview: handoff_pick 手选优先，写回 notify_handoff", async () => {
  const db = setupReviewDb();
  db.sqlite.prepare("UPDATE review_rounds SET handoff_pick = '尔康' WHERE round = 2").run();
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(null, { status: 200 });
  };
  const result = await notifyArticleReview(notifyEnv(db), { slug: "demo-slug", origin: ORIGIN });
  assert.ok(result);
  assert.equal(result.state, "delivered");
  assert.equal(result.handoff, "尔康");
  assert.equal(JSON.parse(seen[0].init.body).handoff.assistant, "尔康");
  assert.equal(roundRow(db).notify_handoff, "尔康");
});

test("notifyArticleReview: fetch 抛错不抛出，记 failed 与短 error", async () => {
  const db = setupReviewDb();
  globalThis.fetch = async () => {
    throw new Error("connect failed");
  };
  const result = await notifyArticleReview(notifyEnv(db), { slug: "demo-slug", round: 2, origin: ORIGIN });
  assert.ok(result);
  assert.equal(result.state, "failed");
  assert.ok(result.error);
  assert.ok(!String(result.error).includes("secret-path"));
  assert.ok(!result.httpStatus);

  const row = roundRow(db);
  assert.equal(row.notify_state, "failed");
  assert.equal(row.notify_http_status, null);
  assert.ok(String(row.notify_error).includes("connect failed"));
  assert.equal(row.notify_handoff, "小燕子");
});

test("notifyArticleReview: 未配置 webhook URL → unconfigured；轮次不存在 → null", async () => {
  const db = setupReviewDb();
  globalThis.fetch = async () => {
    throw new Error("不应发起请求");
  };
  const result = await notifyArticleReview(notifyEnv(db, { SHUFANGZHAI_WEBHOOK_URL: "" }), { slug: "demo-slug", round: 2, origin: ORIGIN });
  assert.equal(result.state, "unconfigured");
  assert.equal(roundRow(db).notify_state, "unconfigured");

  const missing = await notifyArticleReview(notifyEnv(db), { slug: "no-such", round: 2, origin: ORIGIN });
  assert.equal(missing, null);
  const noRound = await notifyArticleReview(notifyEnv(db), { slug: "demo-slug", round: 9, origin: ORIGIN });
  assert.equal(noRound, null);
});

// ─── 路由静态断言 ────────────────────────────────────

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("submit 路由：submitReview 成功后、仅 article 时调用 notifyArticleReview", () => {
  const route = read("../app/api/review/[type]/[id]/submit/route.ts");
  // 提交体透传 handoff。
  assert.match(route, /handoff\?: unknown/);
  assert.match(route, /await submitReview\(env, user, target, id, body\)/);
  const submitIndex = route.indexOf("await submitReview(env, user, target, id, body)");
  const notifyIndex = route.indexOf("notifyArticleReview(env");
  assert.ok(submitIndex >= 0 && notifyIndex > submitIndex, "notifyArticleReview 必须在 submitReview 之后调用");
  // 仅 article 通知（topic 在注册表里 disabled）：guard 取 submitReview 之后的那个。
  const guard = route.indexOf("if (target === \"article\")", submitIndex);
  assert.ok(guard > submitIndex && guard < notifyIndex, "通知调用要包在 target === \"article\" 分支里");
  // 通知失败不影响提交结果（catch 兜底），响应带 notify 字段。
  assert.match(route, /catch \{\s*notify = null;\s*\}/);
  assert.match(route, /Response\.json\(\{ \.\.\.result, notify \}\)/);
  // 写接口不认助手 token。
  assert.doesNotMatch(route, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
});

test("feedback / rounds 路由：认助手 token，只对 article 生效（只读）", () => {
  for (const path of ["../app/api/review/[type]/[id]/feedback/route.ts", "../app/api/review/[type]/[id]/rounds/route.ts"]) {
    const route = read(path);
    assert.match(route, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
    assert.match(route, /bearerToken/);
    assert.match(route, /sameSecret\(token, assistantToken\)/);
    // 助手 token 与 target === "article" 同一条件：topic 时助手 token 仍走会话逻辑（401）。
    assert.match(route, /sameSecret\(token, assistantToken\) && target === "article"/);
    // 会话逻辑保留（owner 检查 / 权限原样）。
    assert.match(route, /requireSessionUser/);
    assert.match(route, /requireArticleRead/);
  }
  // 写接口不认助手 token。
  for (const path of ["../app/api/review/[type]/[id]/submit/route.ts", "../app/api/review/[type]/[id]/marks/route.ts"]) {
    assert.doesNotMatch(read(path), /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
  }
});

test("notify 重试路由：仅文章所有者会话，无已提交轮 404", () => {
  const route = read("../app/api/review/[type]/[id]/notify/route.ts");
  assert.match(route, /assertSameOrigin/);
  assert.match(route, /requireSessionUser/);
  assert.match(route, /target !== "article"/);
  assert.match(route, /requireArticleRead/);
  assert.match(route, /notifyArticleReview\(env/);
  assert.match(route, /status: 404/);
  // 读接口同款鉴权之外不接受助手 token（重发是写操作）。
  assert.doesNotMatch(route, /DABAIHUA_CARDS_ASSISTANT_TOKEN/);
});

// ─── 审稿页 UI 静态断言（设计 §4.2 / §4.3）──────────

test("审稿页：阶段徽标 + 进度 + 通知状态四种文案与重试", () => {
  const reviewer = read("../app/_components/ArticleReviewer.tsx");
  const css = read("../app/_components/article-reviewer.css");

  // 阶段徽标：状态后，描边小徽标，title 带助手与时间。
  assert.match(reviewer, /data-testid="stage-badge"/);
  assert.match(reviewer, /className="ar-a-badge"/);
  assert.match(reviewer, /stageTitle\(stage\)/);
  assert.match(css, /\.ar-a-badge\s*\{/);

  // 进度：stageHistory 最近 5 条、最新在右，每段 title 带助手与时间。
  assert.match(reviewer, /data-testid="stage-history"/);
  assert.match(reviewer, /进度：/);
  assert.match(reviewer, /stageHistory\.slice\(-5\)/);
  assert.match(reviewer, /ar-a-progress-sep">→/);
  assert.match(reviewer, /stageTitle\(item\)/);
  assert.match(css, /\.ar-a-progress\s*\{/);

  // 通知状态：取 rounds\[0\].notify，四种文案。
  assert.match(reviewer, /rounds\[0\]\.notify \?\? null/);
  assert.match(reviewer, /data-testid="review-notify"/);
  assert.match(reviewer, /data-state=\{latestNotify\.state\}/);
  assert.match(reviewer, /轮审稿已通知助手 · \{latestNotify\.handoff \|\| "助手"\} 接手 · \{formatTime\(latestNotify\.at\)\}/);
  assert.match(reviewer, /轮审稿通知失败（\{latestNotify\.httpStatus \?\? \(latestNotify\.error \|\| "未知错误"\)\}）/);
  assert.match(reviewer, /未配置助手通知/);
  assert.match(reviewer, /通知已关闭/);
  assert.match(css, /\.ar-a-notify\[data-state="failed"\]/);

  // 失败才出「重新通知」按钮（仅 canReview）：POST /notify 带 round，成功 toast 后 reload。
  assert.match(reviewer, /latestNotify\.state === "failed" && canReview/);
  assert.match(reviewer, /data-testid="review-notify-retry"/);
  assert.match(reviewer, /`\$\{base\}\/notify`/);
  assert.match(reviewer, /\{ round: latest\.round \}/);
  assert.match(reviewer, /void retryNotify\(\)/);
});

test("审稿页：接手人单选随 submit 发 handoff，封面只读展示", () => {
  const reviewer = read("../app/_components/ArticleReviewer.tsx");
  const articlePage = read("../app/articles/[slug]/page.tsx");
  const css = read("../app/_components/article-reviewer.css");

  // 接手人单选：自动 + 三位助手（名单来自 review-notify-core），默认自动。
  assert.match(reviewer, /data-testid="handoff-picker"/);
  assert.match(reviewer, /交给：/);
  assert.match(reviewer, /HANDOFF_ASSISTANTS/);
  assert.match(reviewer, /useState<string>\("auto"\)/);
  assert.match(css, /\.ar-a-handoff-on\s*\{/);

  // 「提交批注」「要求修改」两个面板发手选值；「确认通过」不加单选（默认 auto）。
  assert.match(reviewer, /submitVerdict\("comments", verdictComment, handoffPick\)/);
  assert.match(reviewer, /submitVerdict\("changes_requested", verdictComment, handoffPick\)/);
  assert.match(reviewer, /submitVerdict\("approved", verdictComment\)/);
  assert.match(reviewer, /\{ verdict, comment: overall, handoff \}/);

  // 提交后的 toast 按通知状态分支，旧文案下线。
  assert.match(reviewer, /已通知助手（\$\{notify\.handoff \|\| "助手"\} 接手）/);
  assert.match(reviewer, /通知助手失败，可在页头重试/);
  assert.doesNotMatch(reviewer, /反馈文件会在几秒内写入文章目录/);

  // 封面：宽图在前、小方图在旁，lazy，alt 带 21:9 / 1:1，放在划词容器之外。
  assert.match(reviewer, /data-testid="article-covers"/);
  assert.match(reviewer, /cover\.role !== "1x1"/);
  assert.match(reviewer, /loading="lazy"/);
  assert.match(reviewer, /`封面 \$\{cover\.role\}`/);
  const bodyIndex = reviewer.indexOf("dangerouslySetInnerHTML={articleHtml}");
  const coversIndex = reviewer.indexOf("data-testid=\"article-covers\"");
  assert.ok(coversIndex >= 0 && bodyIndex > coversIndex, "封面要在正文（划词容器）之前");
  assert.match(css, /\.ar-a-covers\s*\{/);

  // 文章页从 getArticle 传入 stage / stageHistory / covers（未登录分支不传）。
  assert.match(articlePage, /toStageEntry/);
  assert.match(articlePage, /stage=\{stage\}/);
  assert.match(articlePage, /stageHistory=\{stageHistory\}/);
  assert.match(articlePage, /covers=\{covers\}/);
});
