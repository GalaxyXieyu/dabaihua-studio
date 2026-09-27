import { ensureSchema } from "./store";

type Env = { DB: D1Database };

const now = () => new Date().toISOString();

export type ReviewDecision = "approve" | "reject";

const REVIEW_SELECT = "SELECT r.id, r.topic_id AS topicId, r.user_id AS userId, u.nickname, r.kind, r.block_index AS blockIndex, r.quote, r.body, r.resolved, r.created_at AS createdAt, r.updated_at AS updatedAt";

function cleanText(value: unknown, label: string, limit: number, required = true) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  if (text.length > limit) throw new Error(`${label}最多 ${limit} 个字符`);
  return text;
}

function positiveId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}不合法`);
  return id;
}

export async function listTopicReviews(env: Env, topicId: number) {
  await ensureSchema(env.DB);
  const id = positiveId(topicId, "选题 ID");
  const rows = await env.DB.prepare(`${REVIEW_SELECT} FROM topic_reviews r JOIN users u ON u.id = r.user_id WHERE r.topic_id = ? ORDER BY r.created_at ASC, r.id ASC`)
    .bind(id).all();
  return rows.results;
}

export async function addAnnotation(env: Env, userId: number, topicId: number, input: { blockIndex?: unknown; quote?: unknown; body?: unknown }) {
  await ensureSchema(env.DB);
  const id = positiveId(topicId, "选题 ID");
  const topic = await env.DB.prepare("SELECT id, draft_markdown AS draftMarkdown FROM topics WHERE id = ?").bind(id).first<{ id: number; draftMarkdown: string | null }>();
  if (!topic) throw new Error("选题不存在");
  if (!topic.draftMarkdown || !topic.draftMarkdown.trim()) throw new Error("这个选题还没有草稿");
  const blockIndex = Number(input.blockIndex);
  if (!Number.isInteger(blockIndex) || blockIndex < 0) throw new Error("段落位置不合法");
  const quote = cleanText(input.quote, "引用原文", 300, false);
  const body = cleanText(input.body, "批注", 1000);
  const timestamp = now();
  const inserted = await env.DB.prepare("INSERT INTO topic_reviews (topic_id, user_id, kind, block_index, quote, body, resolved, created_at, updated_at) VALUES (?, ?, 'annotation', ?, ?, ?, 0, ?, ?)")
    .bind(id, userId, blockIndex, quote, body, timestamp, timestamp).run();
  const row = await env.DB.prepare(`${REVIEW_SELECT} FROM topic_reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ?`)
    .bind(Number(inserted.meta.last_row_id)).first();
  return row;
}

export async function deleteAnnotation(env: Env, userId: number, reviewId: number) {
  await ensureSchema(env.DB);
  const id = positiveId(reviewId, "批注 ID");
  const row = await env.DB.prepare("SELECT id FROM topic_reviews WHERE id = ? AND user_id = ? AND kind = 'annotation'").bind(id, userId).first();
  if (!row) throw new Error("这条批注不存在");
  await env.DB.prepare("DELETE FROM topic_reviews WHERE id = ? AND user_id = ? AND kind = 'annotation'").bind(id, userId).run();
  return { ok: true };
}

export async function setReviewDecision(env: Env, userId: number, topicId: number, decision: ReviewDecision, comment: unknown) {
  await ensureSchema(env.DB);
  const id = positiveId(topicId, "选题 ID");
  if (decision !== "approve" && decision !== "reject") throw new Error("审稿操作不合法");
  const topic = await env.DB.prepare("SELECT id FROM topics WHERE id = ?").bind(id).first();
  if (!topic) throw new Error("选题不存在");
  const trimmed = String(comment ?? "").trim();
  if (decision === "reject" && !trimmed) throw new Error("打回必须填写意见");
  if (trimmed.length > 2000) throw new Error("意见最多 2000 个字符");
  const timestamp = now();
  const reviewStatus = decision === "approve" ? "approved" : "rejected";
  const inserted = await env.DB.prepare("INSERT INTO topic_reviews (topic_id, user_id, kind, block_index, quote, body, resolved, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, 0, ?, ?)")
    .bind(id, userId, decision, trimmed, timestamp, timestamp).run();
  await env.DB.prepare("UPDATE topics SET review_status = ?, review_comment = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
    .bind(reviewStatus, trimmed || null, timestamp, timestamp, id).run();
  const review = await env.DB.prepare(`${REVIEW_SELECT} FROM topic_reviews r JOIN users u ON u.id = r.user_id WHERE r.id = ?`)
    .bind(Number(inserted.meta.last_row_id)).first();
  return { review, reviewStatus, comment: trimmed, reviewedAt: timestamp };
}
