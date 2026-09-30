/**
 * Daily topic brief storage (晴儿 → Yu → 晴儿).
 *
 * `daily_briefs` holds one normalized JSON document per day. Re-importing the
 * same day only ever updates that document: replies in `daily_brief_responses`
 * are never deleted, so a topic that disappears from a new import keeps its
 * history and is read back with `topicMissing: true`.
 */

import { ensureSchema } from "./store";
import {
  shapeResponse,
  validateBrief,
  isValidBriefDate,
  responseHasContent,
  type DailyBrief,
  type ShapedBriefResponse,
  type BriefResponseRow,
  type BriefDecision,
} from "./daily-brief-core";

type Env = { DB: D1Database };

const now = () => new Date().toISOString();

export type BriefDateSummary = {
  date: string;
  title: string;
  topicCount: number;
  responseCount: number;
  updatedAt: string;
};

export type StoredBrief = { brief: DailyBrief; updatedAt: string };

function parseStoredBrief(dataJson: string): DailyBrief | null {
  try {
    const result = validateBrief(JSON.parse(dataJson));
    return result.ok ? result.brief : null;
  } catch {
    return null;
  }
}

export async function upsertBrief(env: Env, brief: DailyBrief, importedBy: number | null): Promise<{ created: boolean }> {
  await ensureSchema(env.DB);
  const timestamp = now();
  const dataJson = JSON.stringify(brief);
  const existing = await env.DB.prepare("SELECT id FROM daily_briefs WHERE date = ?").bind(brief.date).first<{ id: number }>();
  if (existing) {
    await env.DB.prepare("UPDATE daily_briefs SET data_json = ?, topic_count = ?, imported_by = ?, updated_at = ? WHERE date = ?")
      .bind(dataJson, brief.topics.length, importedBy, timestamp, brief.date).run();
    return { created: false };
  }
  await env.DB.prepare("INSERT INTO daily_briefs (date, data_json, topic_count, imported_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(brief.date, dataJson, brief.topics.length, importedBy, timestamp, timestamp).run();
  return { created: true };
}

export async function getBrief(env: Env, date: string): Promise<StoredBrief | null> {
  await ensureSchema(env.DB);
  if (!isValidBriefDate(date)) return null;
  const row = await env.DB.prepare("SELECT data_json AS dataJson, updated_at AS updatedAt FROM daily_briefs WHERE date = ?")
    .bind(date).first<{ dataJson: string; updatedAt: string }>();
  if (!row) return null;
  const brief = parseStoredBrief(String(row.dataJson || ""));
  if (!brief) return null;
  return { brief, updatedAt: String(row.updatedAt || "") };
}

export async function listBriefDates(env: Env): Promise<BriefDateSummary[]> {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(
    `SELECT b.date, b.topic_count AS topicCount, b.data_json AS dataJson, b.updated_at AS updatedAt,
      (SELECT COUNT(*) FROM daily_brief_responses r WHERE r.date = b.date) AS responseCount
     FROM daily_briefs b ORDER BY b.date DESC LIMIT 400`,
  ).all<{ date: string; topicCount: number; dataJson: string; updatedAt: string; responseCount: number }>();
  return rows.results.map((row) => {
    const brief = parseStoredBrief(String(row.dataJson || ""));
    return {
      date: String(row.date),
      title: brief?.title || (brief ? `大白话讲AI · 每日选题简报 ${row.date}` : ""),
      topicCount: Number(row.topicCount || brief?.topics.length || 0),
      responseCount: Number(row.responseCount || 0),
      updatedAt: String(row.updatedAt || ""),
    };
  });
}

export async function getLatestBriefDate(env: Env): Promise<string | null> {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT date FROM daily_briefs ORDER BY date DESC LIMIT 1").first<{ date: string }>();
  return row ? String(row.date) : null;
}

export async function countResponses(env: Env, date: string): Promise<number> {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM daily_brief_responses WHERE date = ?").bind(date).first<{ count: number }>();
  return Number(row?.count || 0);
}

export type ResponsePatch = {
  rating?: number | null;
  ratingComment?: string;
  decision?: BriefDecision | null;
  scenarioIndex?: number | null;
  answers?: string[];
  rejectReason?: string;
};

type ResponseRow = {
  rating: number | null;
  ratingComment: string;
  createdAt: string;
  decision: string | null;
  scenarioIndex: number | null;
  scenarioText: string;
  answersJson: string;
  rejectReason: string;
};

const RESPONSE_COLUMNS =
  "r.date, r.topic_id AS topicId, u.account AS account, u.nickname AS nickname, r.rating, r.rating_comment AS ratingComment, r.decision, r.scenario_index AS scenarioIndex, r.scenario_text AS scenarioText, r.answers_json AS answersJson, r.reject_reason AS rejectReason, r.created_at AS createdAt, r.updated_at AS updatedAt";

const RESPONSE_SELECT = `SELECT ${RESPONSE_COLUMNS} FROM daily_brief_responses r JOIN users u ON u.id = r.user_id`;

function cleanText(value: unknown, label: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maxLength) throw new Error(`${label}最多 ${maxLength} 字`);
  return text;
}

/**
 * PATCH-style upsert for one user's reply to one topic. Only keys present in
 * `patch` are touched, so a rating update never wipes a pick.
 */
export async function upsertResponse(
  env: Env,
  date: string,
  topicId: string,
  userId: number,
  patch: ResponsePatch,
): Promise<ShapedBriefResponse> {
  await ensureSchema(env.DB);
  const stored = await getBrief(env, date);
  if (!stored) throw new Error("简报不存在");
  const topic = stored.brief.topics.find((item) => item.id === topicId);
  if (!topic) throw new Error("选题不在当日简报里");

  const existing = await env.DB.prepare(
    "SELECT rating, rating_comment AS ratingComment, decision, scenario_index AS scenarioIndex, scenario_text AS scenarioText, answers_json AS answersJson, reject_reason AS rejectReason, created_at AS createdAt FROM daily_brief_responses WHERE date = ? AND topic_id = ? AND user_id = ?",
  ).bind(date, topicId, userId).first<ResponseRow>();

  let rating = existing && typeof existing.rating === "number" ? existing.rating : null;
  let ratingComment = existing ? String(existing.ratingComment || "") : "";
  let decision: BriefDecision | null = existing?.decision === "pick" || existing?.decision === "reject" ? existing.decision : null;
  let scenarioIndex = existing && typeof existing.scenarioIndex === "number" ? existing.scenarioIndex : null;
  let scenarioText = existing ? String(existing.scenarioText || "") : "";
  let answers: string[] = [];
  try {
    const parsed = JSON.parse(existing?.answersJson || "[]");
    if (Array.isArray(parsed)) answers = parsed.map((item) => String(item ?? ""));
  } catch {
    answers = [];
  }
  let rejectReason = existing ? String(existing.rejectReason || "") : "";

  if ("rating" in patch) {
    if (patch.rating === null || patch.rating === undefined) {
      rating = null;
    } else {
      const value = Number(patch.rating);
      if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error("rating 只能是 1 到 5");
      rating = value;
    }
  }

  if ("ratingComment" in patch) ratingComment = cleanText(patch.ratingComment, "评语", 500);
  if ("rejectReason" in patch) rejectReason = cleanText(patch.rejectReason, "理由", 500);

  if ("decision" in patch) {
    if (patch.decision === null || patch.decision === undefined) decision = null;
    else if (patch.decision === "pick" || patch.decision === "reject") decision = patch.decision;
    else throw new Error("decision 只能是 pick 或 reject");
  }

  if ("answers" in patch) {
    const list = Array.isArray(patch.answers) ? patch.answers : [];
    if (list.length > topic.questions.length) throw new Error("回答数量超过问题数量");
    answers = list.map((answer) => {
      const text = String(answer ?? "");
      if (text.length > 4000) throw new Error("单个回答最多 4000 字");
      return text;
    });
  }

  if ("scenarioIndex" in patch) {
    if (patch.scenarioIndex === null || patch.scenarioIndex === undefined) {
      scenarioIndex = null;
      scenarioText = "";
    } else {
      const index = Number(patch.scenarioIndex);
      if (!Number.isInteger(index) || index < 0 || index >= topic.scenarios.length) throw new Error("场景不在范围内");
      scenarioIndex = index;
      scenarioText = topic.scenarios[index];
    }
  }

  if (decision === "pick" && topic.scenarios.length > 0 && scenarioIndex === null) {
    throw new Error("选「就写这个」必须先选一个场景");
  }
  if (decision === "reject") {
    scenarioIndex = null;
    scenarioText = "";
  }

  const timestamp = now();
  const createdAt = existing?.createdAt || timestamp;
  await env.DB.prepare(
    `INSERT INTO daily_brief_responses (date, topic_id, user_id, rating, rating_comment, decision, scenario_index, scenario_text, answers_json, reject_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, topic_id, user_id) DO UPDATE SET
       rating = excluded.rating,
       rating_comment = excluded.rating_comment,
       decision = excluded.decision,
       scenario_index = excluded.scenario_index,
       scenario_text = excluded.scenario_text,
       answers_json = excluded.answers_json,
       reject_reason = excluded.reject_reason,
       updated_at = excluded.updated_at`,
  )
    .bind(date, topicId, userId, rating, ratingComment, decision, scenarioIndex, scenarioText, JSON.stringify(answers), rejectReason, createdAt, timestamp)
    .run();

  const row = await env.DB.prepare(`${RESPONSE_SELECT} WHERE r.date = ? AND r.topic_id = ? AND r.user_id = ?`)
    .bind(date, topicId, userId).first<BriefResponseRow>();
  if (!row) throw new Error("回复保存失败");
  return shapeResponse(row, stored.brief);
}

export type ResponseQuery = { date?: string; since?: string; latest?: boolean };

function emptyBrief(date: string): DailyBrief {
  return { version: 1, date, title: "", intro: "", recommendation: null, topics: [], notes: "", sources: [] };
}

/**
 * Reads back replies for 晴儿. Exactly one of `date`, `since` or `latest`
 * applies; with nothing given it falls back to the latest brief. Only replies
 * with real content are returned.
 */
export async function listResponses(env: Env, query: ResponseQuery): Promise<ShapedBriefResponse[]> {
  await ensureSchema(env.DB);

  let targetDate = query.date;
  if (!targetDate && !query.since) targetDate = await getLatestBriefDate(env) ?? undefined;
  if (!targetDate && !query.since) return [];

  let rows: BriefResponseRow[];
  if (targetDate) {
    const result = await env.DB.prepare(`${RESPONSE_SELECT} WHERE r.date = ? ORDER BY r.updated_at ASC, r.id ASC`)
      .bind(targetDate).all<BriefResponseRow>();
    rows = result.results;
  } else {
    const result = await env.DB.prepare(`${RESPONSE_SELECT} WHERE r.updated_at > ? ORDER BY r.updated_at ASC, r.id ASC`)
      .bind(query.since).all<BriefResponseRow>();
    rows = result.results;
  }

  const meaningful = rows.filter((row) => responseHasContent(row));

  if (targetDate) {
    const stored = await getBrief(env, targetDate);
    const brief = stored?.brief ?? emptyBrief(targetDate);
    const order = new Map(brief.topics.map((topic, index) => [topic.id, index]));
    meaningful.sort((left, right) => {
      const leftIndex = order.get(left.topicId ?? "") ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = order.get(right.topicId ?? "") ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return String(left.updatedAt).localeCompare(String(right.updatedAt));
    });
    return meaningful.map((row) => shapeResponse(row, brief));
  }

  const dates = Array.from(new Set(meaningful.map((row) => String(row.date))));
  const briefs = new Map<string, DailyBrief>();
  for (const date of dates) {
    const stored = await getBrief(env, date);
    briefs.set(date, stored?.brief ?? emptyBrief(date));
  }
  return meaningful.map((row) => shapeResponse(row, briefs.get(String(row.date)) ?? emptyBrief(String(row.date))));
}
