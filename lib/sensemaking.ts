import { ensureSchema } from "./store";

type Env = { DB: D1Database };

const now = () => new Date().toISOString();

export const EXPLORATION_STATUSES = ["open", "researching", "synthesized", "closed"] as const;
export const DIRECTION_STATUSES = ["candidate", "confirmed", "rejected", "retired"] as const;
export const DIRECTION_CONFIDENCE = ["low", "medium", "high"] as const;

type DirectionStatus = (typeof DIRECTION_STATUSES)[number];

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

function positiveId(value: unknown, label: string) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${label} ID 不合法`);
  return id;
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 字`);
  return text;
}

function optionalText(value: unknown, maxLength: number) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (text.length > maxLength) throw new Error(`文本不能超过 ${maxLength} 字`);
  return text;
}

function structuredJson(value: unknown, label: string) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${label}必须是合法 JSON`);
    }
  }
  if (parsed === null || typeof parsed !== "object") throw new Error(`${label}必须是对象或数组`);
  const encoded = JSON.stringify(parsed);
  if (encoded.length > 100_000) throw new Error(`${label}不能超过 100KB`);
  return encoded;
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value ?? [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function decodeStructured<T extends Record<string, unknown>>(row: T | null) {
  if (!row) return row;
  const decoded = { ...row };
  for (const key of ["questionTree", "materialMap", "counterEvidence", "evidenceGaps", "evidenceFor", "evidenceAgainst"]) {
    if (key in decoded) decoded[key as keyof T] = parseJson(decoded[key]) as T[keyof T];
  }
  return decoded;
}

async function requireOwnedItch(env: Env, userId: number, value: unknown) {
  const id = positiveId(value, "心结");
  const itch = await env.DB.prepare("SELECT id FROM itches WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!itch) throw new Error("心结不存在");
  return id;
}

async function requireOwnedExploration(env: Env, userId: number, itchId: number, value: unknown) {
  const id = positiveId(value, "探索");
  const row = await env.DB.prepare("SELECT id FROM explorations WHERE id = ? AND itch_id = ? AND user_id = ?")
    .bind(id, itchId, userId).first();
  if (!row) throw new Error("探索不存在");
  return id;
}

async function requireOwnedDirection(env: Env, userId: number, itchId: number, value: unknown) {
  const id = positiveId(value, "方向");
  const row = await env.DB.prepare("SELECT id FROM directions WHERE id = ? AND itch_id = ? AND user_id = ?")
    .bind(id, itchId, userId).first();
  if (!row) throw new Error("方向不存在");
  return id;
}

const EXPLORATION_SELECT = `SELECT id, itch_id AS itchId, round, status,
  trigger_context AS triggerContext, core_conflict AS coreConflict,
  personal_stake AS personalStake, desired_change AS desiredChange,
  question_tree AS questionTree, material_map AS materialMap,
  counter_evidence AS counterEvidence, evidence_gaps AS evidenceGaps,
  note, created_at AS createdAt, updated_at AS updatedAt
  FROM explorations`;

const DIRECTION_SELECT = `SELECT id, itch_id AS itchId, exploration_id AS explorationId,
  claim, audience, tension, personal_connection AS personalConnection,
  evidence_for AS evidenceFor, evidence_against AS evidenceAgainst,
  evidence_gaps AS evidenceGaps, confidence, status,
  confirmation_note AS confirmationNote, confirmed_at AS confirmedAt,
  created_at AS createdAt, updated_at AS updatedAt
  FROM directions`;

export async function createExploration(env: Env, userId: number, itchInput: unknown, input: {
  triggerContext?: unknown;
  coreConflict?: unknown;
  personalStake?: unknown;
  desiredChange?: unknown;
  note?: unknown;
}) {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const triggerContext = optionalText(input.triggerContext, 4000);
  const coreConflict = optionalText(input.coreConflict, 4000);
  const personalStake = optionalText(input.personalStake, 4000);
  const desiredChange = optionalText(input.desiredChange, 4000);
  const note = optionalText(input.note, 4000);
  if (![triggerContext, coreConflict, personalStake, desiredChange].some(Boolean)) {
    throw new Error("至少填写四问中的一项回答");
  }
  const timestamp = now();
  const result = await env.DB.prepare(`INSERT INTO explorations
    (itch_id, user_id, round, status, trigger_context, core_conflict, personal_stake, desired_change, note, created_at, updated_at)
    SELECT ?, ?, COALESCE(MAX(round), 0) + 1, 'open', ?, ?, ?, ?, ?, ?, ?
    FROM explorations WHERE itch_id = ? AND user_id = ?`)
    .bind(itchId, userId, triggerContext, coreConflict, personalStake, desiredChange, note, timestamp, timestamp, itchId, userId).run();
  const id = Number(result.meta.last_row_id);
  await env.DB.prepare("INSERT INTO itch_events (itch_id, user_id, type, body, metadata, created_at) VALUES (?, ?, 'exploration_created', ?, ?, ?)")
    .bind(itchId, userId, note, JSON.stringify({ explorationId: id }), timestamp).run();
  return getExploration(env, userId, itchId, id);
}

export async function listExplorations(env: Env, userId: number, itchInput: unknown) {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const rows = await env.DB.prepare(`${EXPLORATION_SELECT} WHERE itch_id = ? AND user_id = ? ORDER BY round DESC, id DESC`)
    .bind(itchId, userId).all<Record<string, unknown>>();
  return rows.results.map((row) => decodeStructured(row));
}

export async function getExploration(env: Env, userId: number, itchInput: unknown, explorationInput: unknown) {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const id = await requireOwnedExploration(env, userId, itchId, explorationInput);
  const row = await env.DB.prepare(`${EXPLORATION_SELECT} WHERE id = ? AND itch_id = ? AND user_id = ?`)
    .bind(id, itchId, userId).first<Record<string, unknown>>();
  return decodeStructured(row);
}

export async function updateExploration(env: Env, userId: number, itchInput: unknown, explorationInput: unknown, input: Record<string, unknown>) {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const id = await requireOwnedExploration(env, userId, itchId, explorationInput);
  const textFields: Record<string, [string, number]> = {
    triggerContext: ["trigger_context", 4000],
    coreConflict: ["core_conflict", 4000],
    personalStake: ["personal_stake", 4000],
    desiredChange: ["desired_change", 4000],
    note: ["note", 4000],
  };
  const jsonFields: Record<string, [string, string]> = {
    questionTree: ["question_tree", "研究问题树"],
    materialMap: ["material_map", "材料地图"],
    counterEvidence: ["counter_evidence", "对立证据"],
    evidenceGaps: ["evidence_gaps", "证据缺口"],
  };
  const sets: string[] = [];
  const binds: unknown[] = [];
  const changed: string[] = [];
  for (const [key, [column, maxLength]] of Object.entries(textFields)) {
    if (input[key] !== undefined) {
      sets.push(`${column} = ?`);
      binds.push(optionalText(input[key], maxLength));
      changed.push(key);
    }
  }
  for (const [key, [column, label]] of Object.entries(jsonFields)) {
    if (input[key] !== undefined) {
      sets.push(`${column} = ?`);
      binds.push(structuredJson(input[key], label));
      changed.push(key);
    }
  }
  if (input.status !== undefined) {
    const status = String(input.status);
    if (!includes(EXPLORATION_STATUSES, status)) throw new Error("探索状态不合法");
    sets.push("status = ?");
    binds.push(status);
    changed.push("status");
  }
  if (!sets.length) throw new Error("没有可更新的探索内容");
  const timestamp = now();
  sets.push("updated_at = ?");
  binds.push(timestamp, id, itchId, userId);
  await env.DB.batch([
    env.DB.prepare(`UPDATE explorations SET ${sets.join(", ")} WHERE id = ? AND itch_id = ? AND user_id = ?`).bind(...binds),
    env.DB.prepare("INSERT INTO itch_events (itch_id, user_id, type, body, metadata, created_at) VALUES (?, ?, 'research_updated', NULL, ?, ?)")
      .bind(itchId, userId, JSON.stringify({ explorationId: id, fields: changed }), timestamp),
  ]);
  return getExploration(env, userId, itchId, id);
}

export async function createDirection(env: Env, userId: number, itchInput: unknown, input: Record<string, unknown>) {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const explorationId = input.explorationId === undefined || input.explorationId === null
    ? null
    : await requireOwnedExploration(env, userId, itchId, input.explorationId);
  const claim = requiredText(input.claim, "方向主张", 1200);
  const confidenceInput = String(input.confidence || "low");
  if (!includes(DIRECTION_CONFIDENCE, confidenceInput)) throw new Error("方向信心不合法");
  const timestamp = now();
  const result = await env.DB.prepare(`INSERT INTO directions
    (itch_id, exploration_id, user_id, claim, audience, tension, personal_connection,
     evidence_for, evidence_against, evidence_gaps, confidence, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`)
    .bind(
      itchId,
      explorationId,
      userId,
      claim,
      optionalText(input.audience, 1200),
      optionalText(input.tension, 2000),
      optionalText(input.personalConnection, 2000),
      structuredJson(input.evidenceFor ?? [], "支持证据"),
      structuredJson(input.evidenceAgainst ?? [], "反对证据"),
      structuredJson(input.evidenceGaps ?? [], "证据缺口"),
      confidenceInput,
      timestamp,
      timestamp,
    ).run();
  const id = Number(result.meta.last_row_id);
  await env.DB.prepare("INSERT INTO itch_events (itch_id, user_id, type, body, metadata, created_at) VALUES (?, ?, 'direction_created', ?, ?, ?)")
    .bind(itchId, userId, claim, JSON.stringify({ directionId: id, explorationId }), timestamp).run();
  return getDirection(env, userId, itchId, id);
}

export async function listDirections(env: Env, userId: number, itchInput: unknown, statusInput = "") {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const status = String(statusInput || "");
  if (status && !includes(DIRECTION_STATUSES, status)) throw new Error("方向状态不合法");
  const rows = await env.DB.prepare(`${DIRECTION_SELECT} WHERE itch_id = ? AND user_id = ? AND (? = '' OR status = ?) ORDER BY updated_at DESC, id DESC`)
    .bind(itchId, userId, status, status).all<Record<string, unknown>>();
  return rows.results.map((row) => decodeStructured(row));
}

export async function getDirection(env: Env, userId: number, itchInput: unknown, directionInput: unknown) {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const id = await requireOwnedDirection(env, userId, itchId, directionInput);
  const row = await env.DB.prepare(`${DIRECTION_SELECT} WHERE id = ? AND itch_id = ? AND user_id = ?`)
    .bind(id, itchId, userId).first<Record<string, unknown>>();
  return decodeStructured(row);
}

export async function updateDirection(env: Env, userId: number, itchInput: unknown, directionInput: unknown, input: Record<string, unknown>) {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const id = await requireOwnedDirection(env, userId, itchId, directionInput);
  const textFields: Record<string, [string, number, boolean?]> = {
    claim: ["claim", 1200, true],
    audience: ["audience", 1200],
    tension: ["tension", 2000],
    personalConnection: ["personal_connection", 2000],
  };
  const jsonFields: Record<string, [string, string]> = {
    evidenceFor: ["evidence_for", "支持证据"],
    evidenceAgainst: ["evidence_against", "反对证据"],
    evidenceGaps: ["evidence_gaps", "证据缺口"],
  };
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [key, [column, maxLength, required]] of Object.entries(textFields)) {
    if (input[key] !== undefined) {
      sets.push(`${column} = ?`);
      binds.push(required ? requiredText(input[key], "方向主张", maxLength) : optionalText(input[key], maxLength));
    }
  }
  for (const [key, [column, label]] of Object.entries(jsonFields)) {
    if (input[key] !== undefined) {
      sets.push(`${column} = ?`);
      binds.push(structuredJson(input[key], label));
    }
  }
  if (input.confidence !== undefined) {
    const confidence = String(input.confidence);
    if (!includes(DIRECTION_CONFIDENCE, confidence)) throw new Error("方向信心不合法");
    sets.push("confidence = ?");
    binds.push(confidence);
  }
  if (!sets.length) throw new Error("没有可更新的方向内容");
  sets.push("updated_at = ?");
  binds.push(now(), id, itchId, userId);
  await env.DB.prepare(`UPDATE directions SET ${sets.join(", ")} WHERE id = ? AND itch_id = ? AND user_id = ?`).bind(...binds).run();
  return getDirection(env, userId, itchId, id);
}

export async function setDirectionStatus(env: Env, userId: number, itchInput: unknown, directionInput: unknown, statusInput: unknown, noteInput?: unknown) {
  await ensureSchema(env.DB);
  const itchId = await requireOwnedItch(env, userId, itchInput);
  const id = await requireOwnedDirection(env, userId, itchId, directionInput);
  const status = String(statusInput || "") as DirectionStatus;
  if (!includes(DIRECTION_STATUSES, status)) throw new Error("方向状态不合法");
  const note = optionalText(noteInput, 2000);
  const timestamp = now();
  const confirmedAt = status === "confirmed" ? timestamp : null;
  await env.DB.batch([
    env.DB.prepare("UPDATE directions SET status = ?, confirmation_note = ?, confirmed_at = ?, updated_at = ? WHERE id = ? AND itch_id = ? AND user_id = ?")
      .bind(status, note, confirmedAt, timestamp, id, itchId, userId),
    env.DB.prepare("INSERT INTO itch_events (itch_id, user_id, type, body, metadata, created_at) VALUES (?, ?, 'direction_status_changed', ?, ?, ?)")
      .bind(itchId, userId, note, JSON.stringify({ directionId: id, status }), timestamp),
  ]);
  return getDirection(env, userId, itchId, id);
}
