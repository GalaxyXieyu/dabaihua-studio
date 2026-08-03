import { ensureSchema } from "./store";
import { listDirections, listExplorations } from "./sensemaking";

type Env = { DB: D1Database };

const now = () => new Date().toISOString();

export const ITCH_STATUSES = ["open", "dormant", "resolved", "archived"] as const;
export const ITCH_EVENT_TYPES = [
  "captured", "resurfaced", "note", "status_changed", "feedback",
  "exploration_created", "research_updated", "direction_created", "direction_status_changed",
] as const;
export const ITCH_TARGET_TYPES = ["item", "annotation", "conversation", "project", "itch", "exploration", "direction", "topic"] as const;
export const ITCH_RELATIONS = ["triggered_by", "supports", "contradicts", "related_to", "derived_from", "tested_by", "spawned"] as const;

export type ItchStatus = (typeof ITCH_STATUSES)[number];
export type ItchEventType = (typeof ITCH_EVENT_TYPES)[number];
export type ItchTargetType = (typeof ITCH_TARGET_TYPES)[number];
export type ItchRelation = (typeof ITCH_RELATIONS)[number];

const ACTIVE_STATUSES: ItchStatus[] = ["open", "dormant"];

function cleanText(value: unknown, label: string, maxLength: number) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 字`);
  return text;
}

function optionalText(value: unknown, maxLength: number) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeBody(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

function itchId(value: unknown) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error("心结 ID 不合法");
  return id;
}

async function requireOwnedItch(env: Env, userId: number, idInput: unknown) {
  const id = itchId(idInput);
  const row = await env.DB.prepare("SELECT id FROM itches WHERE id = ? AND user_id = ?").bind(id, userId).first<{ id: number }>();
  if (!row) throw new Error("心结不存在");
  return id;
}

async function validateTarget(env: Env, userId: number, itch: number, targetType: ItchTargetType, targetId: string) {
  if (["item", "annotation", "itch", "exploration", "direction", "topic"].includes(targetType)) {
    const numericId = Number(targetId);
    if (!Number.isInteger(numericId) || numericId <= 0) throw new Error("关联目标 ID 不合法");
    if (targetType === "itch") {
      if (numericId === itch) throw new Error("不能关联心结自身");
      const target = await env.DB.prepare("SELECT id FROM itches WHERE id = ? AND user_id = ?").bind(numericId, userId).first();
      if (!target) throw new Error("关联心结不存在");
    } else if (targetType === "annotation") {
      const target = await env.DB.prepare("SELECT id FROM annotations WHERE id = ? AND user_id = ?").bind(numericId, userId).first();
      if (!target) throw new Error("关联批注不存在");
    } else if (targetType === "exploration" || targetType === "direction") {
      const table = targetType === "exploration" ? "explorations" : "directions";
      const target = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ? AND itch_id = ? AND user_id = ?`)
        .bind(numericId, itch, userId).first();
      if (!target) throw new Error("关联目标不存在");
    } else {
      const table = targetType === "item" ? "items" : "topics";
      const target = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(numericId).first();
      if (!target) throw new Error("关联目标不存在");
    }
  }
}

export async function createItch(
  env: Env,
  userId: number,
  input: { body: unknown; note?: unknown; sourceType?: unknown; sourceId?: unknown },
) {
  await ensureSchema(env.DB);
  const body = cleanText(input.body, "心结内容", 500);
  const normalizedBody = normalizeBody(body);
  const note = optionalText(input.note, 2000);
  const timestamp = now();
  const existing = await env.DB.prepare("SELECT id FROM itches WHERE user_id = ? AND normalized_body = ? ORDER BY id DESC LIMIT 1")
    .bind(userId, normalizedBody).first<{ id: number }>();
  const sourceType = String(input.sourceType || "").trim();
  const sourceId = String(input.sourceId || "").trim();
  if (sourceType || sourceId) {
    if (!includes(ITCH_TARGET_TYPES, sourceType) || !sourceId) throw new Error("触发来源不完整");
    await validateTarget(env, userId, existing?.id ?? -1, sourceType, sourceId);
  }

  let id: number;
  let resurfaced = false;
  if (existing) {
    id = existing.id;
    resurfaced = true;
    await env.DB.batch([
      env.DB.prepare("UPDATE itches SET body = ?, note = COALESCE(note, ?), status = 'open', felt_count = felt_count + 1, last_felt_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(body, note, timestamp, timestamp, id, userId),
      env.DB.prepare("INSERT INTO itch_events (itch_id, user_id, type, body, metadata, created_at) VALUES (?, ?, 'resurfaced', ?, '{}', ?)")
        .bind(id, userId, note, timestamp),
    ]);
  } else {
    const result = await env.DB.prepare("INSERT INTO itches (user_id, body, normalized_body, note, status, felt_count, first_felt_at, last_felt_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', 1, ?, ?, ?, ?)")
      .bind(userId, body, normalizedBody, note, timestamp, timestamp, timestamp, timestamp).run();
    id = Number(result.meta.last_row_id);
    await env.DB.prepare("INSERT INTO itch_events (itch_id, user_id, type, body, metadata, created_at) VALUES (?, ?, 'captured', ?, '{}', ?)")
      .bind(id, userId, note, timestamp).run();
  }

  if (sourceType || sourceId) {
    await addItchLink(env, userId, id, { targetType: sourceType, targetId: sourceId, relation: "triggered_by" });
  }

  return { id, resurfaced };
}

export async function listItches(env: Env, userId: number, statusFilter: string) {
  await ensureSchema(env.DB);
  const statuses = statusFilter
    ? statusFilter.split(",").map((status) => status.trim()).filter((status): status is ItchStatus => includes(ITCH_STATUSES, status))
    : ACTIVE_STATUSES;
  if (!statuses.length) return [];
  const placeholders = statuses.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT it.id, it.body, it.note, it.status, it.felt_count AS feltCount,
            it.first_felt_at AS firstFeltAt, it.last_felt_at AS lastFeltAt,
            it.created_at AS createdAt, it.updated_at AS updatedAt,
            (SELECT COUNT(*) FROM itch_events e WHERE e.itch_id = it.id) AS eventCount,
            (SELECT COUNT(*) FROM itch_links l WHERE l.itch_id = it.id) AS linkCount
     FROM itches it
     WHERE it.user_id = ? AND it.status IN (${placeholders})
     ORDER BY it.last_felt_at DESC, it.id DESC LIMIT 100`,
  ).bind(userId, ...statuses).all();
  return rows.results;
}

export async function getItch(env: Env, userId: number, idInput: unknown) {
  await ensureSchema(env.DB);
  const id = await requireOwnedItch(env, userId, idInput);
  const [itch, events, links, explorations, directions] = await Promise.all([
    env.DB.prepare("SELECT id, body, note, status, felt_count AS feltCount, first_felt_at AS firstFeltAt, last_felt_at AS lastFeltAt, created_at AS createdAt, updated_at AS updatedAt FROM itches WHERE id = ? AND user_id = ?")
      .bind(id, userId).first(),
    env.DB.prepare("SELECT id, type, body, metadata, created_at AS createdAt FROM itch_events WHERE itch_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100")
      .bind(id, userId).all(),
    env.DB.prepare("SELECT id, target_type AS targetType, target_id AS targetId, relation, note, created_at AS createdAt FROM itch_links WHERE itch_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100")
      .bind(id, userId).all(),
    listExplorations(env, userId, id),
    listDirections(env, userId, id),
  ]);
  return { ...itch, events: events.results, links: links.results, explorations, directions };
}

export async function setItchStatus(env: Env, userId: number, idInput: unknown, statusInput: unknown, noteInput?: unknown) {
  await ensureSchema(env.DB);
  const id = await requireOwnedItch(env, userId, idInput);
  const status = String(statusInput || "");
  if (!includes(ITCH_STATUSES, status)) throw new Error("状态不合法");
  const note = optionalText(noteInput, 2000);
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE itches SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(status, timestamp, id, userId),
    env.DB.prepare("INSERT INTO itch_events (itch_id, user_id, type, body, metadata, created_at) VALUES (?, ?, 'status_changed', ?, ?, ?)")
      .bind(id, userId, note, JSON.stringify({ status }), timestamp),
  ]);
  return { id, status };
}

export async function addItchEvent(
  env: Env,
  userId: number,
  idInput: unknown,
  input: { type?: unknown; body?: unknown; metadata?: unknown },
) {
  await ensureSchema(env.DB);
  const id = await requireOwnedItch(env, userId, idInput);
  const type = String(input.type || "note");
  if (!includes(ITCH_EVENT_TYPES, type)) throw new Error("事件类型不合法");
  const body = optionalText(input.body, 2000);
  const metadata = JSON.stringify(input.metadata && typeof input.metadata === "object" ? input.metadata : {});
  const timestamp = now();
  const update = type === "resurfaced"
    ? env.DB.prepare("UPDATE itches SET status = 'open', felt_count = felt_count + 1, last_felt_at = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(timestamp, timestamp, id, userId)
    : env.DB.prepare("UPDATE itches SET updated_at = ? WHERE id = ? AND user_id = ?").bind(timestamp, id, userId);
  const inserted = env.DB.prepare("INSERT INTO itch_events (itch_id, user_id, type, body, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, userId, type, body, metadata, timestamp);
  const results = await env.DB.batch([update, inserted]);
  return { id: Number(results[1].meta.last_row_id), itchId: id, type };
}

export async function addItchLink(
  env: Env,
  userId: number,
  idInput: unknown,
  input: { targetType?: unknown; targetId?: unknown; relation?: unknown; note?: unknown },
) {
  await ensureSchema(env.DB);
  const id = await requireOwnedItch(env, userId, idInput);
  const targetType = String(input.targetType || "");
  const targetId = cleanText(input.targetId, "关联目标", 160);
  const relation = String(input.relation || "related_to");
  if (!includes(ITCH_TARGET_TYPES, targetType)) throw new Error("关联目标类型不合法");
  if (!includes(ITCH_RELATIONS, relation)) throw new Error("关联关系不合法");
  await validateTarget(env, userId, id, targetType, targetId);
  const note = optionalText(input.note, 1000);
  const result = await env.DB.prepare("INSERT OR IGNORE INTO itch_links (itch_id, user_id, target_type, target_id, relation, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, userId, targetType, targetId, relation, note, now()).run();
  if (Number(result.meta.changes || 0) === 0) {
    const existing = await env.DB.prepare("SELECT id FROM itch_links WHERE itch_id = ? AND user_id = ? AND target_type = ? AND target_id = ? AND relation = ?")
      .bind(id, userId, targetType, targetId, relation).first<{ id: number }>();
    return { id: existing?.id, itchId: id, existing: true };
  }
  return { id: Number(result.meta.last_row_id), itchId: id, existing: false };
}

export async function deleteItchLink(env: Env, userId: number, idInput: unknown, linkIdInput: unknown) {
  await ensureSchema(env.DB);
  const id = await requireOwnedItch(env, userId, idInput);
  const linkId = Number(linkIdInput);
  if (!Number.isInteger(linkId) || linkId <= 0) throw new Error("关联 ID 不合法");
  const result = await env.DB.prepare("DELETE FROM itch_links WHERE id = ? AND itch_id = ? AND user_id = ?").bind(linkId, id, userId).run();
  if (Number(result.meta.changes || 0) === 0) throw new Error("关联不存在");
  return { id: linkId, itchId: id };
}
