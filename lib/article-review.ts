/**
 * article-review.ts — 文章 / 选题的统一审稿领域服务
 *
 * 审稿对象统一为 (target_type, target_id)：
 *   article → slug（文章目录名）
 *   topic   → 选题数字 id（以 TEXT 存储）
 *
 * 所有对外函数先调用 ensureSchema，用户可见错误一律使用中文。
 */

import { ensureSchema } from "./store";
import { sanitizeArticleHtml } from "./html-sanitize";
import { renderMarkdownAsGzhHtml } from "./gzh-markdown";
import { setReviewDecision } from "./reviews";
import type { SessionUser } from "./auth";

type Env = { DB: D1Database };

const now = () => new Date().toISOString();
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export type ReviewTargetType = "article" | "topic";
export type ReviewVerdict = "approved" | "changes_requested" | "comments";
export type MarkKind = "good" | "change";

export type FeedbackMark = {
  id: number;
  type: MarkKind;
  quote: string;
  prefix: string;
  suffix: string;
  blockIndex: number | null;
  startOffset: number | null;
  endOffset: number | null;
  comment: string;
};

export type ReviewFeedback = {
  schema: "dabaihua.review-feedback/v1";
  target: { type: ReviewTargetType; id: string; title: string; slug: string | null; topicId: number | null };
  round: number;
  verdict: ReviewVerdict;
  overallComment: string;
  reviewer: { id: number; nickname: string };
  submittedAt: string;
  contentHash: string;
  counts: { good: number; change: number };
  marks: FeedbackMark[];
};

function positiveId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}不合法`);
  return id;
}

function cleanText(value: unknown, label: string, limit: number, required = true): string {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  if (text.length > limit) throw new Error(`${label}最多 ${limit} 个字符`);
  return text;
}

function optionalOffset(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label}不合法`);
  return number;
}

export function parseTargetType(value: unknown): ReviewTargetType {
  const type = String(value ?? "");
  if (type !== "article" && type !== "topic") throw new Error("审稿对象类型不合法");
  return type;
}

function normalizeTargetId(type: ReviewTargetType, id: unknown): string {
  if (type === "article") {
    const slug = String(id ?? "").trim();
    if (!SLUG_RE.test(slug)) throw new Error("文章标识不合法");
    return slug;
  }
  return String(positiveId(id, "选题 ID"));
}

async function assertTargetExists(env: Env, type: ReviewTargetType, targetId: string) {
  const row = type === "article"
    ? await env.DB.prepare("SELECT 1 AS ok FROM articles WHERE slug = ?").bind(targetId).first()
    : await env.DB.prepare("SELECT 1 AS ok FROM topics WHERE id = ?").bind(Number(targetId)).first();
  if (!row) throw new Error("审稿对象不存在");
}

async function currentRound(env: Env, type: ReviewTargetType, targetId: string): Promise<number> {
  if (type === "article") {
    const row = await env.DB.prepare("SELECT review_round AS round FROM articles WHERE slug = ?").bind(targetId).first<{ round: number }>();
    if (!row) throw new Error("审稿对象不存在");
    return Math.max(1, Number(row.round || 1));
  }
  const row = await env.DB.prepare("SELECT COALESCE(MAX(round), 0) + 1 AS round FROM review_rounds WHERE target_type = 'topic' AND target_id = ?")
    .bind(targetId).first<{ round: number }>();
  return Math.max(1, Number(row?.round || 1));
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fallbackHtml(markdown: string, assetBase: string) {
  const text = String(markdown ?? "");
  return text.trim() ? renderMarkdownAsGzhHtml(text, { assetBase }) : "";
}

function mapMarkRow(row: Record<string, unknown>): FeedbackMark & { userId: number; round: number; nickname: string; createdAt: string; updatedAt: string; targetType: string; targetId: string } {
  return {
    id: Number(row.id),
    type: (row.kind === "good" ? "good" : "change") as MarkKind,
    quote: String(row.exact || ""),
    prefix: String(row.prefix || ""),
    suffix: String(row.suffix || ""),
    blockIndex: row.blockIndex === null || row.blockIndex === undefined ? null : Number(row.blockIndex),
    startOffset: row.startOffset === null || row.startOffset === undefined ? null : Number(row.startOffset),
    endOffset: row.endOffset === null || row.endOffset === undefined ? null : Number(row.endOffset),
    comment: String(row.comment || ""),
    userId: Number(row.userId || 0),
    round: Number(row.round || 0),
    nickname: String(row.nickname || ""),
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || ""),
    targetType: String(row.targetType || ""),
    targetId: String(row.targetId || ""),
  };
}

const MARK_SELECT = `SELECT m.id, m.target_type AS targetType, m.target_id AS targetId, m.round, m.user_id AS userId,
    COALESCE(u.nickname, '') AS nickname, m.kind, m.exact, m.prefix, m.suffix,
    m.start_offset AS startOffset, m.end_offset AS endOffset, m.block_index AS blockIndex,
    m.comment, m.created_at AS createdAt, m.updated_at AS updatedAt
  FROM review_marks m LEFT JOIN users u ON u.id = m.user_id`;

// ─── 文章列表 / 详情 ─────────────────────────────────

export type ArticleListItem = {
  slug: string; date: string | null; title: string | null; topic: string | null; status: string | null;
  reviewRound: number; isPublic: boolean; hasHtml: boolean; updatedAt: string;
};

export async function listArticles(env: Env, options: { includePrivate?: boolean } = {}): Promise<ArticleListItem[]> {
  await ensureSchema(env.DB);
  const includePrivate = options.includePrivate ? 1 : 0;
  const rows = await env.DB.prepare(
    `SELECT slug, date, title, topic, status, review_round AS reviewRound, is_public AS isPublic,
        CASE WHEN article_html IS NOT NULL AND article_html != '' THEN 1 ELSE 0 END AS hasHtml,
        updated_at AS updatedAt
     FROM articles
     WHERE (? = 1 OR is_public = 1)
     ORDER BY COALESCE(date, '') DESC, updated_at DESC, slug DESC`,
  ).bind(includePrivate).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    slug: String(row.slug),
    date: row.date ? String(row.date) : null,
    title: row.title ? String(row.title) : null,
    topic: row.topic ? String(row.topic) : null,
    status: row.status ? String(row.status) : null,
    reviewRound: Math.max(1, Number(row.reviewRound || 1)),
    isPublic: Boolean(row.isPublic),
    hasHtml: Boolean(row.hasHtml),
    updatedAt: String(row.updatedAt || ""),
  }));
}

export async function getArticle(env: Env, slug: string) {
  await ensureSchema(env.DB);
  const targetId = normalizeTargetId("article", slug);
  const row = await env.DB.prepare("SELECT * FROM articles WHERE slug = ?").bind(targetId).first<Record<string, unknown>>();
  if (!row) return null;
  const articleHtml = row.article_html ? String(row.article_html) : "";
  const finalMd = row.final_md ? String(row.final_md) : "";
  const draftMd = row.draft_md ? String(row.draft_md) : "";
  const assetBase = `/api/articles/${targetId}/assets`;
  let renderedHtml = "";
  let htmlSource: "article.html" | "02-final.md" | "01-draft.md" | "none" = "none";
  if (articleHtml.trim()) {
    renderedHtml = sanitizeArticleHtml(articleHtml, { assetBase });
    htmlSource = "article.html";
  } else if (finalMd.trim()) {
    renderedHtml = renderMarkdownAsGzhHtml(finalMd, { assetBase });
    htmlSource = "02-final.md";
  } else if (draftMd.trim()) {
    renderedHtml = renderMarkdownAsGzhHtml(draftMd, { assetBase });
    htmlSource = "01-draft.md";
  }
  return {
    slug: targetId,
    date: row.date ? String(row.date) : null,
    title: row.title ? String(row.title) : null,
    topic: row.topic ? String(row.topic) : null,
    status: row.status ? String(row.status) : null,
    metaJson: row.meta_json ? String(row.meta_json) : "{}",
    draftMd,
    finalMd,
    qaReport: row.qa_report ? String(row.qa_report) : "",
    articleHtml,
    contentHash: row.content_hash ? String(row.content_hash) : "",
    reviewRound: Math.max(1, Number(row.review_round || 1)),
    isPublic: Boolean(row.is_public),
    topicId: row.topic_id === null || row.topic_id === undefined ? null : Number(row.topic_id),
    syncedAt: row.synced_at ? String(row.synced_at) : "",
    createdAt: row.created_at ? String(row.created_at) : "",
    updatedAt: row.updated_at ? String(row.updated_at) : "",
    renderedHtml,
    htmlSource,
  };
}

export async function setArticlePublic(env: Env, slug: string, isPublic: boolean) {
  await ensureSchema(env.DB);
  const targetId = normalizeTargetId("article", slug);
  await assertTargetExists(env, "article", targetId);
  if (typeof isPublic !== "boolean") throw new Error("公开状态不合法");
  await env.DB.prepare("UPDATE articles SET is_public = ?, updated_at = ? WHERE slug = ?").bind(isPublic ? 1 : 0, now(), targetId).run();
  return { slug: targetId, isPublic };
}

export async function getTopicReviewTarget(env: Env, topicId: number) {
  await ensureSchema(env.DB);
  const id = positiveId(topicId, "选题 ID");
  const row = await env.DB.prepare("SELECT id, title, draft_markdown AS draftMarkdown, publish_html AS publishHtml, review_status AS reviewStatus FROM topics WHERE id = ?")
    .bind(id).first<Record<string, unknown>>();
  if (!row) throw new Error("审稿对象不存在");
  const publishHtml = row.publishHtml ? String(row.publishHtml) : "";
  const draftMarkdown = row.draftMarkdown ? String(row.draftMarkdown) : "";
  let renderedHtml = "";
  let htmlSource: "publish_html" | "draft_markdown" | "none" = "none";
  if (publishHtml.trim()) {
    renderedHtml = sanitizeArticleHtml(publishHtml, { assetBase: "" });
    htmlSource = "publish_html";
  } else if (draftMarkdown.trim()) {
    renderedHtml = renderMarkdownAsGzhHtml(draftMarkdown, { assetBase: "" });
    htmlSource = "draft_markdown";
  }
  return {
    title: row.title ? String(row.title) : "",
    renderedHtml,
    htmlSource,
    round: await currentRound(env, "topic", String(id)),
    reviewStatus: row.reviewStatus ? String(row.reviewStatus) : null,
  };
}

// ─── 标记（划词）──────────────────────────────────────

export async function listMarks(env: Env, type: ReviewTargetType, id: string | number, options: { round?: number | string | null } = {}) {
  await ensureSchema(env.DB);
  const target = parseTargetType(type);
  const targetId = normalizeTargetId(target, id);
  await assertTargetExists(env, target, targetId);
  const round = options.round === undefined || options.round === null || options.round === ""
    ? await currentRound(env, target, targetId)
    : positiveId(options.round, "轮次");
  const rows = await env.DB.prepare(`${MARK_SELECT} WHERE m.target_type = ? AND m.target_id = ? AND m.round = ? ORDER BY (m.start_offset IS NULL), m.start_offset ASC, m.id ASC`)
    .bind(target, targetId, round).all<Record<string, unknown>>();
  return rows.results.map(mapMarkRow);
}

export async function listAllMarks(env: Env, type: ReviewTargetType, id: string | number, round: number) {
  await ensureSchema(env.DB);
  const target = parseTargetType(type);
  const targetId = normalizeTargetId(target, id);
  const rows = await env.DB.prepare(`${MARK_SELECT} WHERE m.target_type = ? AND m.target_id = ? AND m.round = ? ORDER BY (m.start_offset IS NULL), m.start_offset ASC, m.id ASC`)
    .bind(target, targetId, positiveId(round, "轮次")).all<Record<string, unknown>>();
  return rows.results.map(mapMarkRow);
}

export type MarkInput = {
  kind?: unknown; exact?: unknown; prefix?: unknown; suffix?: unknown;
  startOffset?: unknown; endOffset?: unknown; blockIndex?: unknown; comment?: unknown;
};

export async function addMark(env: Env, userId: number, type: ReviewTargetType, id: string | number, input: MarkInput) {
  await ensureSchema(env.DB);
  const target = parseTargetType(type);
  const targetId = normalizeTargetId(target, id);
  await assertTargetExists(env, target, targetId);
  const round = await currentRound(env, target, targetId);
  const kind = String(input.kind ?? "");
  if (kind !== "good" && kind !== "change") throw new Error("标记类型不合法");
  const exact = cleanText(input.exact, "划词内容", 2000);
  const prefix = cleanText(input.prefix, "上文", 200, false);
  const suffix = cleanText(input.suffix, "下文", 200, false);
  const comment = cleanText(input.comment, "批注", 2000, false);
  const startOffset = optionalOffset(input.startOffset, "起始位置");
  const endOffset = optionalOffset(input.endOffset, "结束位置");
  const blockIndex = optionalOffset(input.blockIndex, "段落位置");
  if (startOffset !== null && endOffset !== null && endOffset < startOffset) throw new Error("结束位置不能小于起始位置");
  const timestamp = now();
  const inserted = await env.DB.prepare(
    `INSERT INTO review_marks (target_type, target_id, round, user_id, kind, exact, prefix, suffix, start_offset, end_offset, block_index, comment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(target, targetId, round, userId, kind, exact, prefix, suffix, startOffset, endOffset, blockIndex, comment, timestamp, timestamp).run();
  const row = await env.DB.prepare(`${MARK_SELECT} WHERE m.id = ?`).bind(Number(inserted.meta.last_row_id)).first<Record<string, unknown>>();
  return row ? mapMarkRow(row) : null;
}

export async function updateMark(env: Env, userId: number, markId: number | string, input: { kind?: unknown; comment?: unknown }) {
  await ensureSchema(env.DB);
  const id = positiveId(markId, "标记 ID");
  const existing = await env.DB.prepare("SELECT id FROM review_marks WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!existing) throw new Error("只能修改自己的标记");
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.kind !== undefined) {
    const kind = String(input.kind);
    if (kind !== "good" && kind !== "change") throw new Error("标记类型不合法");
    sets.push("kind = ?");
    binds.push(kind);
  }
  if (input.comment !== undefined) {
    sets.push("comment = ?");
    binds.push(cleanText(input.comment, "批注", 2000, false));
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    binds.push(now(), id, userId);
    await env.DB.prepare(`UPDATE review_marks SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...binds).run();
  }
  const row = await env.DB.prepare(`${MARK_SELECT} WHERE m.id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? mapMarkRow(row) : null;
}

export async function deleteMark(env: Env, userId: number, markId: number | string) {
  await ensureSchema(env.DB);
  const id = positiveId(markId, "标记 ID");
  const result = await env.DB.prepare("DELETE FROM review_marks WHERE id = ? AND user_id = ?").bind(id, userId).run();
  if (!Number(result.meta.changes || 0)) throw new Error("这条标记不存在");
  return { ok: true };
}

// ─── 反馈构造 ─────────────────────────────────────────

export function buildFeedback(input: {
  target: ReviewFeedback["target"];
  round: number;
  verdict: ReviewVerdict;
  overallComment: string;
  reviewer: { id: number; nickname: string };
  submittedAt: string;
  contentHash: string;
  marks: Array<FeedbackMark & { userId?: number }>;
}): ReviewFeedback {
  const marks = [...input.marks]
    .sort((left, right) => {
      const a = left.startOffset === null ? Number.MAX_SAFE_INTEGER : left.startOffset;
      const b = right.startOffset === null ? Number.MAX_SAFE_INTEGER : right.startOffset;
      return a === b ? left.id - right.id : a - b;
    })
    .map((mark) => ({
      id: mark.id,
      type: mark.type,
      quote: mark.quote,
      prefix: mark.prefix,
      suffix: mark.suffix,
      blockIndex: mark.blockIndex,
      startOffset: mark.startOffset,
      endOffset: mark.endOffset,
      comment: mark.comment,
    }));
  return {
    schema: "dabaihua.review-feedback/v1",
    target: input.target,
    round: input.round,
    verdict: input.verdict,
    overallComment: input.overallComment,
    reviewer: input.reviewer,
    submittedAt: input.submittedAt,
    contentHash: input.contentHash,
    counts: {
      good: marks.filter((mark) => mark.type === "good").length,
      change: marks.filter((mark) => mark.type === "change").length,
    },
    marks,
  };
}

async function loadReviewContent(env: Env, target: ReviewTargetType, targetId: string) {
  if (target === "article") {
    const row = await env.DB.prepare("SELECT slug, title, topic_id AS topicId, article_html AS articleHtml, final_md AS finalMd, draft_md AS draftMd, content_hash AS contentHash FROM articles WHERE slug = ?")
      .bind(targetId).first<Record<string, unknown>>();
    if (!row) throw new Error("审稿对象不存在");
    const assetBase = `/api/articles/${targetId}/assets`;
    const articleHtml = row.articleHtml ? String(row.articleHtml) : "";
    const markdown = String(row.finalMd || row.draftMd || "");
    const html = articleHtml.trim() ? sanitizeArticleHtml(articleHtml, { assetBase }) : fallbackHtml(markdown, assetBase);
    const contentHash = row.contentHash ? String(row.contentHash) : await sha256Hex(markdown || html);
    return {
      title: String(row.title || targetId),
      slug: String(row.slug || targetId),
      topicId: row.topicId === null || row.topicId === undefined ? null : Number(row.topicId),
      html,
      markdown,
      contentHash,
    };
  }
  const row = await env.DB.prepare("SELECT id, title, draft_markdown AS draftMarkdown, publish_html AS publishHtml FROM topics WHERE id = ?")
    .bind(Number(targetId)).first<Record<string, unknown>>();
  if (!row) throw new Error("审稿对象不存在");
  const publishHtml = row.publishHtml ? String(row.publishHtml) : "";
  const markdown = row.draftMarkdown ? String(row.draftMarkdown) : "";
  const html = publishHtml.trim() ? sanitizeArticleHtml(publishHtml, { assetBase: "" }) : fallbackHtml(markdown, "");
  const contentHash = await sha256Hex(markdown || html);
  return {
    title: String(row.title || ""),
    slug: null,
    topicId: Number(row.id),
    html,
    markdown,
    contentHash,
  };
}

// ─── 提交审稿 ─────────────────────────────────────────

export type SubmitInput = { verdict?: unknown; comment?: unknown };

export async function submitReview(env: Env, user: SessionUser, type: ReviewTargetType, id: string | number, input: SubmitInput) {
  await ensureSchema(env.DB);
  const target = parseTargetType(type);
  const targetId = normalizeTargetId(target, id);
  await assertTargetExists(env, target, targetId);
  const verdict = String(input.verdict ?? "") as ReviewVerdict;
  if (verdict !== "approved" && verdict !== "changes_requested" && verdict !== "comments") throw new Error("审稿结论不合法");
  const comment = cleanText(input.comment, "审稿意见", 2000, false);
  const round = await currentRound(env, target, targetId);
  const allMarks = await listAllMarks(env, target, targetId, round);
  const changeCount = allMarks.filter((mark) => mark.type === "change").length;
  if (verdict === "changes_requested" && !comment && !changeCount) throw new Error("要求修改需要填写意见，或至少标记一处「要改」");

  const content = await loadReviewContent(env, target, targetId);
  const timestamp = now();

  await env.DB.prepare(
    `INSERT INTO article_versions (target_type, target_id, round, html, markdown, content_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(target_type, target_id, round) DO UPDATE SET html = excluded.html, markdown = excluded.markdown, content_hash = excluded.content_hash, created_at = excluded.created_at`,
  ).bind(target, targetId, round, content.html, content.markdown, content.contentHash, timestamp).run();

  const feedback = buildFeedback({
    target: { type: target, id: targetId, title: content.title, slug: content.slug, topicId: content.topicId },
    round,
    verdict,
    overallComment: comment,
    reviewer: { id: user.id, nickname: user.nickname },
    submittedAt: timestamp,
    contentHash: content.contentHash,
    marks: allMarks,
  });

  try {
    await env.DB.prepare(
      `INSERT INTO review_rounds (target_type, target_id, round, user_id, verdict, comment, mark_count, feedback_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(target, targetId, round, user.id, verdict, comment, feedback.marks.length, JSON.stringify(feedback), timestamp).run();
  } catch (error) {
    if (String(error).toLowerCase().includes("unique")) throw new Error("这一轮已经提交过审稿");
    throw error;
  }

  if (target === "article") {
    const status = verdict === "approved" ? "approved" : verdict === "changes_requested" ? "changes-requested" : null;
    if (status) {
      await env.DB.prepare("UPDATE articles SET review_round = ?, status = ?, updated_at = ? WHERE slug = ?")
        .bind(round + 1, status, timestamp, targetId).run();
    } else {
      await env.DB.prepare("UPDATE articles SET review_round = ?, updated_at = ? WHERE slug = ?")
        .bind(round + 1, timestamp, targetId).run();
    }
  } else {
    // topic：复用既有 topic_reviews 决策链路，绝不改动 topics.status。
    const topicId = Number(targetId);
    if (verdict === "approved") {
      await setReviewDecision(env, user.id, topicId, "approve", comment);
    } else if (verdict === "changes_requested" && comment) {
      await setReviewDecision(env, user.id, topicId, "reject", comment);
    } else if (verdict === "changes_requested") {
      await env.DB.prepare("INSERT INTO topic_reviews (topic_id, user_id, kind, block_index, quote, body, resolved, created_at, updated_at) VALUES (?, ?, 'reject', NULL, NULL, '', 0, ?, ?)")
        .bind(topicId, user.id, timestamp, timestamp).run();
      await env.DB.prepare("UPDATE topics SET review_status = 'rejected', review_comment = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
        .bind(null, timestamp, timestamp, topicId).run();
    } else {
      await env.DB.prepare("INSERT INTO topic_reviews (topic_id, user_id, kind, block_index, quote, body, resolved, created_at, updated_at) VALUES (?, ?, 'annotation', NULL, NULL, ?, 0, ?, ?)")
        .bind(topicId, user.id, comment, timestamp, timestamp).run();
    }
  }

  return { round, feedback };
}

// ─── 轮次 / 反馈读取 ──────────────────────────────────

export async function listRounds(env: Env, type: ReviewTargetType, id: string | number) {
  await ensureSchema(env.DB);
  const target = parseTargetType(type);
  const targetId = normalizeTargetId(target, id);
  const rows = await env.DB.prepare(
    `SELECT id, round, user_id AS userId, verdict, comment, mark_count AS markCount,
       exported_at AS exportedAt, export_path AS exportPath, created_at AS createdAt
     FROM review_rounds WHERE target_type = ? AND target_id = ? ORDER BY round DESC, id DESC`,
  ).bind(target, targetId).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: Number(row.id),
    round: Number(row.round),
    userId: Number(row.userId),
    verdict: String(row.verdict || ""),
    comment: String(row.comment || ""),
    markCount: Number(row.markCount || 0),
    exportedAt: row.exportedAt ? String(row.exportedAt) : null,
    exportPath: row.exportPath ? String(row.exportPath) : null,
    createdAt: String(row.createdAt || ""),
  }));
}

export async function getFeedback(env: Env, type: ReviewTargetType, id: string | number, round?: number | string | null) {
  await ensureSchema(env.DB);
  const target = parseTargetType(type);
  const targetId = normalizeTargetId(target, id);
  let targetRound: number;
  if (round === undefined || round === null || round === "" || round === "latest") {
    const latest = await env.DB.prepare("SELECT round FROM review_rounds WHERE target_type = ? AND target_id = ? ORDER BY round DESC, id DESC LIMIT 1")
      .bind(target, targetId).first<{ round: number }>();
    if (!latest) throw new Error("还没有审稿反馈");
    targetRound = Number(latest.round);
  } else {
    targetRound = positiveId(round, "轮次");
  }
  const row = await env.DB.prepare("SELECT feedback_json AS feedbackJson, round FROM review_rounds WHERE target_type = ? AND target_id = ? AND round = ?")
    .bind(target, targetId, targetRound).first<{ feedbackJson: string; round: number }>();
  if (!row) throw new Error("这一轮还没有审稿反馈");
  try {
    return JSON.parse(String(row.feedbackJson)) as ReviewFeedback;
  } catch {
    throw new Error("审稿反馈数据损坏");
  }
}
