// 简报选题 → 选题看板 → 漱芳斋管线（服务端领域逻辑）。
//
// 数据落库优先：通知失败只回传状态，绝不抛出、绝不影响选题决定。所有状态码与
// 标签的唯一来源是 ./brief-pipeline-core.ts。

import { ensureSchema } from "./store.ts";
import { getBrief, upsertResponse, type ResponsePatch } from "./daily-brief.ts";
import type { DailyBrief, ShapedBriefResponse } from "./daily-brief-core.ts";
import {
  PIPELINE_LABELS,
  PIPELINE_NOTIFY_EVENTS,
  assistantStatusRule,
  parsePipelineStatus,
  type PipelineNotifyEvent,
  type PipelineStatus,
} from "./brief-pipeline-core.ts";
import {
  checkBaseRev,
  clearFeedback,
  outlineToMarkdown,
  validateOutlineJson,
  validateRegenerateBlocks,
  type OutlineV01,
  type RegenerateBlock,
} from "./outline-core.ts";
import { deliverBriefNotification, type BriefNotifyResult } from "./brief-notify.ts";

export type BriefPipelineEnv = {
  DB: D1Database;
  DABAIHUA_PUBLIC_BASE_URL?: string;
  SHUFANGZHAI_WEBHOOK_URL?: string;
  SHUFANGZHAI_WEBHOOK_SECRET?: string;
  SHUFANGZHAI_WEBHOOK_AUTH_HEADER?: string;
};

export type SelectionView = {
  date: string;
  topicId: string;
  boardTopicId: number | null;
  status: string;
  statusLabel: string;
  outlineMd: string;
  outlineJson: OutlineV01 | null;
  outlineRev: number;
  regenerating: RegenerateBlock[];
  outlineBy: string;
  outlineAt: string | null;
  statusBy: string;
  statusAt: string | null;
  selectedBy: number | null;
  selectedAt: string | null;
  notifyEvent: string | null;
  notifyState: string | null;
  notifyHttpStatus: number | null;
  notifyError: string | null;
  notifyAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelineFailure = { ok: false; status: number; error: string; field?: string; rev?: number };
export type PipelineSuccess = {
  ok: true;
  selection: SelectionView;
  response?: ShapedBriefResponse;
  notify?: BriefNotifyResult;
};

const now = () => new Date().toISOString();

const SELECTION_COLUMNS =
  "id, date, topic_id AS topicId, board_topic_id AS boardTopicId, status, outline_md AS outlineMd, outline_json AS outlineJson, outline_rev AS outlineRev, outline_regen_json AS outlineRegenJson, outline_by AS outlineBy, outline_at AS outlineAt, status_by AS statusBy, status_at AS statusAt, selected_by AS selectedBy, selected_at AS selectedAt, notify_event AS notifyEvent, notify_state AS notifyState, notify_http_status AS notifyHttpStatus, notify_error AS notifyError, notify_at AS notifyAt, created_at AS createdAt, updated_at AS updatedAt";

type SelectionRow = {
  id: number;
  date: string;
  topicId: string;
  boardTopicId: number | null;
  status: string;
  outlineMd: string;
  outlineJson: string;
  outlineRev: number;
  outlineRegenJson: string;
  outlineBy: string;
  outlineAt: string | null;
  statusBy: string;
  statusAt: string | null;
  selectedBy: number | null;
  selectedAt: string | null;
  notifyEvent: string | null;
  notifyState: string | null;
  notifyHttpStatus: number | null;
  notifyError: string | null;
  notifyAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseOutlineJson(value: unknown): OutlineV01 | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const result = validateOutlineJson(value);
  return result.ok ? result.outline : null;
}

function parseRegenerating(value: unknown): RegenerateBlock[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const result: RegenerateBlock[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const blockId = typeof (item as { blockId?: unknown }).blockId === "string" ? (item as { blockId: string }).blockId : "";
      const suggestion =
        typeof (item as { suggestion?: unknown }).suggestion === "string" ? (item as { suggestion: string }).suggestion : "";
      if (blockId) result.push({ blockId, suggestion });
    }
    return result;
  } catch {
    return [];
  }
}

function toView(row: SelectionRow): SelectionView {
  const parsed = parsePipelineStatus(row.status);
  const outlineRev = typeof row.outlineRev === "number" ? row.outlineRev : 0;
  const outlineJson = parseOutlineJson(row.outlineJson);
  if (outlineJson) outlineJson.rev = outlineRev;
  return {
    date: String(row.date ?? ""),
    topicId: String(row.topicId ?? ""),
    boardTopicId: typeof row.boardTopicId === "number" ? row.boardTopicId : null,
    status: String(row.status ?? ""),
    statusLabel: parsed ? PIPELINE_LABELS[parsed] : "",
    outlineMd: String(row.outlineMd ?? ""),
    outlineJson,
    outlineRev,
    regenerating: parseRegenerating(row.outlineRegenJson),
    outlineBy: String(row.outlineBy ?? ""),
    outlineAt: row.outlineAt ?? null,
    statusBy: String(row.statusBy ?? ""),
    statusAt: row.statusAt ?? null,
    selectedBy: typeof row.selectedBy === "number" ? row.selectedBy : null,
    selectedAt: row.selectedAt ?? null,
    notifyEvent: row.notifyEvent ?? null,
    notifyState: row.notifyState ?? null,
    notifyHttpStatus: typeof row.notifyHttpStatus === "number" ? row.notifyHttpStatus : null,
    notifyError: row.notifyError ?? null,
    notifyAt: row.notifyAt ?? null,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

/** 某一条选题的管线状态；没有则返回 null。 */
export async function getSelection(env: BriefPipelineEnv, date: string, topicId: string): Promise<SelectionView | null> {
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(`SELECT ${SELECTION_COLUMNS} FROM brief_selections WHERE date = ? AND topic_id = ?`)
    .bind(date, topicId)
    .first<SelectionRow>();
  return row ? toView(row) : null;
}

/** 某天所有选题的管线状态，一次查询给简报页用（part 2）。 */
export async function listSelections(env: BriefPipelineEnv, date: string): Promise<SelectionView[]> {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare(
    `SELECT ${SELECTION_COLUMNS} FROM brief_selections WHERE date = ? ORDER BY selected_at ASC, id ASC`,
  )
    .bind(date)
    .all<SelectionRow>();
  return rows.results.map(toView);
}

type ResponseContext = {
  scenarioIndex: number | null;
  scenarioText: string;
  scenarioCustom: string;
  answers: string[];
};

async function loadResponseContext(
  env: BriefPipelineEnv,
  date: string,
  topicId: string,
  userId: number | null,
): Promise<ResponseContext> {
  if (userId === null) return { scenarioIndex: null, scenarioText: "", scenarioCustom: "", answers: [] };
  const row = await env.DB.prepare(
    "SELECT scenario_index AS scenarioIndex, scenario_text AS scenarioText, scenario_custom AS scenarioCustom, answers_json AS answersJson FROM daily_brief_responses WHERE date = ? AND topic_id = ? AND user_id = ?",
  )
    .bind(date, topicId, userId)
    .first<{ scenarioIndex: number | null; scenarioText: string; scenarioCustom: string; answersJson: string }>();
  if (!row) return { scenarioIndex: null, scenarioText: "", scenarioCustom: "", answers: [] };
  let answers: string[] = [];
  try {
    const parsed = JSON.parse(String(row.answersJson || "[]"));
    if (Array.isArray(parsed)) answers = parsed.map((item) => String(item ?? ""));
  } catch {
    answers = [];
  }
  return {
    scenarioIndex: typeof row.scenarioIndex === "number" ? row.scenarioIndex : null,
    scenarioText: String(row.scenarioText || ""),
    scenarioCustom: String(row.scenarioCustom || ""),
    answers,
  };
}

function notifyTopicInput(brief: DailyBrief | null, date: string, topicId: string) {
  const topic = brief?.topics.find((item) => item.id === topicId) ?? null;
  return {
    id: topic?.id ?? topicId,
    date: brief?.date ?? date,
    type: topic?.type ?? "",
    label: topic?.label ?? "",
    title: topic?.title ?? "",
    oneLiner: topic?.oneLiner ?? "",
    detail: topic?.detail ?? "",
    scenarios: topic?.scenarios ?? [],
    questions: topic?.questions ?? [],
  };
}

/** 用当前 selection + response 的数据发送一次通知并记录。 */
async function notifySaved(
  env: BriefPipelineEnv,
  date: string,
  topicId: string,
  event: PipelineNotifyEvent,
  baseUrl: string,
): Promise<BriefNotifyResult> {
  const selection = await getSelection(env, date, topicId);
  const stored = await getBrief(env, date);
  const context = await loadResponseContext(env, date, topicId, selection?.selectedBy ?? null);
  const carriesOutlineJson = event === "confirm_outline" || event === "regenerate_outline";
  return deliverBriefNotification(env, {
    date,
    topicId,
    event,
    topic: notifyTopicInput(stored?.brief ?? null, date, topicId),
    scenarioIndex: context.scenarioIndex,
    scenarioText: context.scenarioText,
    scenarioCustom: context.scenarioCustom,
    answers: context.answers,
    outline: carriesOutlineJson ? selection?.outlineMd || null : null,
    outlineJson: carriesOutlineJson ? selection?.outlineJson ?? null : null,
    baseRev: carriesOutlineJson ? selection?.outlineRev : undefined,
    blocks: event === "regenerate_outline" ? selection?.regenerating ?? [] : undefined,
    status: selection?.status ?? "selected",
    boardTopicId: selection?.boardTopicId ?? null,
    baseUrl,
  });
}

async function createBoardTopic(env: BriefPipelineEnv, topic: { title: string; oneLiner: string; detail: string }): Promise<number> {
  const timestamp = now();
  const result = await env.DB.prepare(
    "INSERT INTO topics (title, angle, reason, platform, content_type, status, item_ids, created_at, updated_at) VALUES (?, ?, ?, '', '', 'approved', '[]', ?, ?)",
  )
    .bind(topic.title.slice(0, 200), topic.oneLiner.slice(0, 500), topic.detail.slice(0, 1000), timestamp, timestamp)
    .run();
  return Number(result.meta.last_row_id);
}

async function setBoardStatus(env: BriefPipelineEnv, boardTopicId: number | null, status: string): Promise<void> {
  if (boardTopicId === null) return;
  await env.DB.prepare("UPDATE topics SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), boardTopicId).run();
}

export type SelectInput = {
  date: string;
  topicId: string;
  userId: number;
  scenarioIndex?: number | null;
  scenarioCustom?: string;
  answers?: string[];
  baseUrl: string;
};

/**
 * 「就写这个」：保存 pick 回复 + 建/复用看板卡片（入选），再通知 select。
 * 重复选择已搁置的选题会把它恢复为 selected、卡片恢复 approved 并再次通知。
 */
export async function selectBriefTopic(env: BriefPipelineEnv, input: SelectInput): Promise<PipelineSuccess | PipelineFailure> {
  await ensureSchema(env.DB);
  const stored = await getBrief(env, input.date);
  if (!stored) return { ok: false, status: 404, error: "简报不存在" };
  const topic = stored.brief.topics.find((item) => item.id === input.topicId);
  if (!topic) return { ok: false, status: 404, error: "选题不在当日简报里" };

  let response: ShapedBriefResponse;
  try {
    const patch: ResponsePatch = { decision: "pick" };
    if (input.scenarioIndex !== undefined) patch.scenarioIndex = input.scenarioIndex;
    if (input.scenarioCustom !== undefined) patch.scenarioCustom = input.scenarioCustom;
    if (input.answers !== undefined) patch.answers = input.answers;
    response = await upsertResponse(env, input.date, input.topicId, input.userId, patch);
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : "保存失败" };
  }

  const existing = await getSelection(env, input.date, input.topicId);
  let boardTopicId = existing?.boardTopicId ?? null;
  if (boardTopicId === null) {
    boardTopicId = await createBoardTopic(env, topic);
  } else {
    await setBoardStatus(env, boardTopicId, "approved");
  }

  const timestamp = now();
  await env.DB.prepare(
    `INSERT INTO brief_selections (date, topic_id, board_topic_id, status, status_by, status_at, selected_by, selected_at, created_at, updated_at)
     VALUES (?, ?, ?, 'selected', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, topic_id) DO UPDATE SET
       board_topic_id = COALESCE(brief_selections.board_topic_id, excluded.board_topic_id),
       status = 'selected',
       status_by = excluded.status_by,
       status_at = excluded.status_at,
       selected_by = excluded.selected_by,
       selected_at = excluded.selected_at,
       updated_at = excluded.updated_at`,
  )
    .bind(input.date, input.topicId, boardTopicId, "Yu", timestamp, input.userId, timestamp, timestamp, timestamp)
    .run();

  const notify = await notifySaved(env, input.date, input.topicId, "select", input.baseUrl);
  const selection = await getSelection(env, input.date, input.topicId);
  if (!selection) return { ok: false, status: 500, error: "保存失败" };
  return { ok: true, selection, response, notify };
}

export type UndoInput = { date: string; topicId: string; userId: number; baseUrl: string };

/** 撤销选择：搁置选题、卡片 skipped、清空 decision，再通知 cancel。 */
export async function undoBriefTopic(env: BriefPipelineEnv, input: UndoInput): Promise<PipelineSuccess | PipelineFailure> {
  await ensureSchema(env.DB);
  const selection = await getSelection(env, input.date, input.topicId);
  if (!selection) return { ok: false, status: 409, error: "not_selected" };
  if (selection.status === "shelved") return { ok: false, status: 409, error: "shelved" };

  const timestamp = now();
  await env.DB.prepare(
    "UPDATE brief_selections SET status = 'shelved', status_by = ?, status_at = ?, updated_at = ? WHERE date = ? AND topic_id = ?",
  )
    .bind("Yu", timestamp, timestamp, input.date, input.topicId)
    .run();
  await setBoardStatus(env, selection.boardTopicId, "skipped");

  let response: ShapedBriefResponse | undefined;
  try {
    response = await upsertResponse(env, input.date, input.topicId, selection.selectedBy ?? input.userId, { decision: null });
  } catch {
    response = undefined;
  }

  const notify = await notifySaved(env, input.date, input.topicId, "cancel", input.baseUrl);
  const updated = await getSelection(env, input.date, input.topicId);
  if (!updated) return { ok: false, status: 500, error: "保存失败" };
  return { ok: true, selection: updated, response, notify };
}

export type ConfirmOutlineInput = { date: string; topicId: string; baseUrl: string; outlineJson?: unknown; baseRev?: unknown };

/** 确认大纲（仅 outline_pending 且有 JSON 或 Markdown）→ drafting，并通知 confirm_outline。 */
export async function confirmBriefOutline(
  env: BriefPipelineEnv,
  input: ConfirmOutlineInput,
): Promise<PipelineSuccess | PipelineFailure> {
  await ensureSchema(env.DB);
  const selection = await getSelection(env, input.date, input.topicId);
  if (!selection) return { ok: false, status: 409, error: "not_selected" };
  if (selection.status !== "outline_pending") return { ok: false, status: 409, error: "not_outline_pending" };

  // 可选：Yu 确认时带上的完整 outlineJson。
  let normalizedOutline: OutlineV01 | null = null;
  if (input.outlineJson !== undefined && input.outlineJson !== null) {
    const validated = validateOutlineJson(input.outlineJson);
    if (!validated.ok) {
      const failure: PipelineFailure = { ok: false, status: 422, error: validated.error };
      if (validated.field) failure.field = validated.field;
      return failure;
    }
    const base = checkBaseRev(selection.outlineRev, input.baseRev);
    if (!base.ok) {
      return base.error === "bad_base_rev"
        ? { ok: false, status: 422, error: base.error }
        : { ok: false, status: 409, error: base.error, rev: selection.outlineRev };
    }
    normalizedOutline = validated.outline;
  }

  // JSON 为准：有 JSON 就用它重新生成 Markdown；没有 JSON 的老流程仍要求 Markdown 非空。
  const effectiveOutline = normalizedOutline ?? selection.outlineJson;
  const markdown = effectiveOutline ? outlineToMarkdown(effectiveOutline) : selection.outlineMd;
  if (!markdown.trim()) return { ok: false, status: 409, error: "outline_required" };

  const timestamp = now();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (normalizedOutline) {
    sets.push("outline_json = ?", "outline_rev = outline_rev + 1");
    binds.push(JSON.stringify(normalizedOutline));
  }
  if (effectiveOutline) {
    sets.push("outline_md = ?", "outline_by = ?", "outline_at = ?");
    binds.push(markdown, "Yu", timestamp);
  }
  sets.push("status = 'drafting'", "status_by = ?", "status_at = ?", "outline_regen_json = '[]'", "updated_at = ?");
  binds.push("Yu", timestamp, timestamp, input.date, input.topicId);
  let sql = `UPDATE brief_selections SET ${sets.join(", ")} WHERE date = ? AND topic_id = ?`;
  if (normalizedOutline) {
    sql += " AND outline_rev = ?";
    binds.push(selection.outlineRev);
  }
  const result = await env.DB.prepare(sql).bind(...binds).run();
  if (normalizedOutline && Number(result.meta?.changes ?? 0) === 0) {
    const latest = await getSelection(env, input.date, input.topicId);
    return { ok: false, status: 409, error: "rev_conflict", rev: latest?.outlineRev ?? selection.outlineRev };
  }

  const notify = await notifySaved(env, input.date, input.topicId, "confirm_outline", input.baseUrl);
  const updated = await getSelection(env, input.date, input.topicId);
  if (!updated) return { ok: false, status: 500, error: "保存失败" };
  return { ok: true, selection: updated, notify };
}

export type OutlineDraftInput = { date: string; topicId: string; outlineJson?: unknown; baseRev?: unknown };

/**
 * Yu 页面侧自动保存：只更新 outline_json（rev+1），保留 feedback，不动 Markdown、不发通知。
 */
export async function saveOutlineDraft(
  env: BriefPipelineEnv,
  input: OutlineDraftInput,
): Promise<PipelineSuccess | PipelineFailure> {
  await ensureSchema(env.DB);
  const selection = await getSelection(env, input.date, input.topicId);
  if (!selection) return { ok: false, status: 409, error: "not_selected" };
  if (input.baseRev === undefined || input.baseRev === null) return { ok: false, status: 422, error: "base_rev_required" };
  if (selection.status !== "outline_pending") return { ok: false, status: 409, error: "not_outline_pending" };
  if (!selection.outlineJson) return { ok: false, status: 409, error: "outline_json_required" };

  const validated = validateOutlineJson(input.outlineJson);
  if (!validated.ok) {
    const failure: PipelineFailure = { ok: false, status: 422, error: validated.error };
    if (validated.field) failure.field = validated.field;
    return failure;
  }
  const base = checkBaseRev(selection.outlineRev, input.baseRev);
  if (!base.ok) {
    return base.error === "bad_base_rev"
      ? { ok: false, status: 422, error: base.error }
      : { ok: false, status: 409, error: base.error, rev: selection.outlineRev };
  }

  const result = await env.DB.prepare(
    "UPDATE brief_selections SET outline_json = ?, outline_rev = outline_rev + 1, updated_at = ? WHERE date = ? AND topic_id = ? AND outline_rev = ?",
  )
    .bind(JSON.stringify(validated.outline), now(), input.date, input.topicId, selection.outlineRev)
    .run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    const latest = await getSelection(env, input.date, input.topicId);
    return { ok: false, status: 409, error: "rev_conflict", rev: latest?.outlineRev ?? selection.outlineRev };
  }

  const updated = await getSelection(env, input.date, input.topicId);
  if (!updated) return { ok: false, status: 500, error: "保存失败" };
  return { ok: true, selection: updated };
}

export type RegenerateOutlineInput = {
  date: string;
  topicId: string;
  outlineJson?: unknown;
  baseRev?: unknown;
  blocks: unknown;
  baseUrl: string;
};

/**
 * 「按建议重生成」：先落 Yu 的最新 outlineJson（可选），再登记重写中的 blocks 并发通知。
 * 一次只能有一批；diagram 块在同一写里标成 redo。通知失败不回滚。
 */
export async function regenerateBriefOutline(
  env: BriefPipelineEnv,
  input: RegenerateOutlineInput,
): Promise<PipelineSuccess | PipelineFailure> {
  await ensureSchema(env.DB);
  const selection = await getSelection(env, input.date, input.topicId);
  if (!selection) return { ok: false, status: 409, error: "not_selected" };
  if (selection.status !== "outline_pending") return { ok: false, status: 409, error: "not_outline_pending" };
  if (!selection.outlineJson) return { ok: false, status: 409, error: "outline_json_required" };
  if (selection.regenerating.length) return { ok: false, status: 409, error: "regenerating" };

  let normalizedOutline: OutlineV01 | null = null;
  if (input.outlineJson !== undefined && input.outlineJson !== null) {
    const validated = validateOutlineJson(input.outlineJson);
    if (!validated.ok) {
      const failure: PipelineFailure = { ok: false, status: 422, error: validated.error };
      if (validated.field) failure.field = validated.field;
      return failure;
    }
    const base = checkBaseRev(selection.outlineRev, input.baseRev);
    if (!base.ok) {
      return base.error === "bad_base_rev"
        ? { ok: false, status: 422, error: base.error }
        : { ok: false, status: 409, error: base.error, rev: selection.outlineRev };
    }
    normalizedOutline = validated.outline;
  }

  const working = normalizedOutline ?? selection.outlineJson;
  const validatedBlocks = validateRegenerateBlocks(working, input.blocks);
  if (!validatedBlocks.ok) return { ok: false, status: 422, error: validatedBlocks.error };

  const redoIds = new Set(validatedBlocks.blocks.map((block) => block.blockId));
  const toStore: OutlineV01 = {
    ...working,
    diagrams: working.diagrams.map((diagram) => (redoIds.has(diagram.id) ? { ...diagram, status: "redo" as const } : { ...diagram })),
  };

  const result = await env.DB.prepare(
    "UPDATE brief_selections SET outline_json = ?, outline_rev = outline_rev + 1, outline_regen_json = ?, updated_at = ? WHERE date = ? AND topic_id = ? AND outline_rev = ?",
  )
    .bind(JSON.stringify(toStore), JSON.stringify(validatedBlocks.blocks), now(), input.date, input.topicId, selection.outlineRev)
    .run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    const latest = await getSelection(env, input.date, input.topicId);
    return { ok: false, status: 409, error: "rev_conflict", rev: latest?.outlineRev ?? selection.outlineRev };
  }

  const notify = await notifySaved(env, input.date, input.topicId, "regenerate_outline", input.baseUrl);
  const updated = await getSelection(env, input.date, input.topicId);
  if (!updated) return { ok: false, status: 500, error: "保存失败" };
  return { ok: true, selection: updated, notify };
}

export type NotifyInput = { date: string; topicId: string; event?: string | null; baseUrl: string };

/** 手动重发：不传 event 就重发上一次的事件。 */
export async function notifyBriefTopic(env: BriefPipelineEnv, input: NotifyInput): Promise<PipelineSuccess | PipelineFailure> {
  await ensureSchema(env.DB);
  const selection = await getSelection(env, input.date, input.topicId);
  if (!selection) return { ok: false, status: 409, error: "not_selected" };
  const requested = typeof input.event === "string" ? input.event.trim() : "";
  const event = requested || selection.notifyEvent || "";
  if (!(PIPELINE_NOTIFY_EVENTS as readonly string[]).includes(event)) {
    return { ok: false, status: 400, error: "bad_event" };
  }
  if (event === "regenerate_outline" && selection.regenerating.length === 0) {
    return { ok: false, status: 409, error: "nothing_to_regenerate" };
  }
  const notify = await notifySaved(env, input.date, input.topicId, event as PipelineNotifyEvent, input.baseUrl);
  const updated = await getSelection(env, input.date, input.topicId);
  if (!updated) return { ok: false, status: 500, error: "保存失败" };
  return { ok: true, selection: updated, notify };
}

export type PipelineUpdateInput = {
  date: string;
  topicId: string;
  actorName: string;
  status?: unknown;
  outline?: unknown;
  outlineJson?: unknown;
  baseRev?: unknown;
};

/**
 * 漱芳斋助手的写回：改 status、Markdown outline，或结构化 outlineJson。
 * 规则见 assistantStatusRule；带 outlineJson 时用 outline_rev 条件更新防并发。
 */
export async function updateBriefPipeline(
  env: BriefPipelineEnv,
  input: PipelineUpdateInput,
): Promise<PipelineSuccess | PipelineFailure> {
  await ensureSchema(env.DB);
  const selection = await getSelection(env, input.date, input.topicId);
  if (!selection) return { ok: false, status: 409, error: "not_selected" };

  let nextStatus: PipelineStatus | null = null;
  const rawStatus = input.status;
  if (rawStatus !== undefined && rawStatus !== null && String(rawStatus).trim() !== "") {
    const parsed = parsePipelineStatus(rawStatus);
    if (!parsed) return { ok: false, status: 422, error: "bad_status" };
    nextStatus = parsed;
  }

  let outlineProvided = false;
  let newOutline = "";
  if (input.outline !== undefined && input.outline !== null) {
    if (typeof input.outline !== "string") return { ok: false, status: 422, error: "bad_outline" };
    if (input.outline.length > 20000) return { ok: false, status: 422, error: "outline_too_long" };
    outlineProvided = true;
    newOutline = input.outline.trim();
  }

  // 可选的结构化大纲：校验、并发检查，并清掉原来在重写中的块的 feedback。
  let outlineJsonProvided = false;
  let normalizedOutline: OutlineV01 | null = null;
  if (input.outlineJson !== undefined && input.outlineJson !== null) {
    const validated = validateOutlineJson(input.outlineJson);
    if (!validated.ok) {
      const failure: PipelineFailure = { ok: false, status: 422, error: validated.error };
      if (validated.field) failure.field = validated.field;
      return failure;
    }
    const base = checkBaseRev(selection.outlineRev, input.baseRev);
    if (!base.ok) {
      return base.error === "bad_base_rev"
        ? { ok: false, status: 422, error: base.error }
        : { ok: false, status: 409, error: base.error, rev: selection.outlineRev };
    }
    normalizedOutline = selection.regenerating.length
      ? clearFeedback(validated.outline, selection.regenerating.map((block) => block.blockId))
      : validated.outline;
    outlineJsonProvided = true;
  }

  // 只给 outlineJson 时服务器生成 Markdown（JSON 为准）。
  let markdownToWrite: string | null = null;
  let writeOutline = outlineProvided;
  if (outlineJsonProvided && !outlineProvided) {
    markdownToWrite = outlineToMarkdown(normalizedOutline as OutlineV01);
    writeOutline = true;
  } else if (outlineProvided) {
    markdownToWrite = newOutline;
  }

  const hasOutline = (markdownToWrite ?? "").trim().length > 0 || selection.outlineMd.trim().length > 0;
  const rule = assistantStatusRule(selection.status, nextStatus, hasOutline);
  if (!rule.ok) {
    const status = rule.code === "owner_only" ? 403 : rule.code === "not_selected" || rule.code === "shelved" ? 409 : 422;
    return { ok: false, status, error: rule.code };
  }

  const timestamp = now();
  const statusChanged = rule.status !== selection.status;
  const sets: string[] = ["status = ?"];
  const binds: unknown[] = [rule.status];
  if (statusChanged) {
    sets.push("status_by = ?", "status_at = ?");
    binds.push(input.actorName, timestamp);
  }
  if (outlineJsonProvided) {
    sets.push("outline_json = ?", "outline_rev = outline_rev + 1", "outline_regen_json = '[]'");
    binds.push(JSON.stringify(normalizedOutline));
  }
  if (writeOutline) {
    sets.push("outline_md = ?", "outline_by = ?", "outline_at = ?");
    binds.push(markdownToWrite ?? "", input.actorName, timestamp);
  }
  sets.push("updated_at = ?");
  binds.push(timestamp, input.date, input.topicId);
  let sql = `UPDATE brief_selections SET ${sets.join(", ")} WHERE date = ? AND topic_id = ?`;
  if (outlineJsonProvided) {
    sql += " AND outline_rev = ?";
    binds.push(selection.outlineRev);
  }
  const result = await env.DB.prepare(sql).bind(...binds).run();
  if (outlineJsonProvided && Number(result.meta?.changes ?? 0) === 0) {
    const latest = await getSelection(env, input.date, input.topicId);
    return { ok: false, status: 409, error: "rev_conflict", rev: latest?.outlineRev ?? selection.outlineRev };
  }

  const updated = await getSelection(env, input.date, input.topicId);
  if (!updated) return { ok: false, status: 500, error: "保存失败" };
  return { ok: true, selection: updated };
}
