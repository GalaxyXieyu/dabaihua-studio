// assistant_notify_log 的只读查询（设计见 docs/assistant-events-design.md）。
//
// 用途：漏收 webhook 时的兜底拉取（superme events / GET /api/assistant-events）。
// 纯查询：按 id 升序分页，payload_json 解析成对象（未存 / 超 64KB / 坏 JSON → null）。
// 只读，绝不写入；也绝不返回 webhook URL / secret（表里本来只有 target_host）。

export type AssistantEventLogQuery = {
  /** 只取 id 大于该值的事件（默认 0 = 全部）。 */
  afterId?: number;
  /** ISO 时间：只取 created_at >= since 的事件。 */
  since?: string;
  /** 注册表 key 精确匹配（多值 OR）。 */
  keys?: string[];
  /** 返回条数，1–200，默认 50。 */
  limit?: number;
};

export type AssistantEventLogEvent = {
  id: number;
  key: string;
  event: string;
  ref: string | null;
  state: string;
  httpStatus: number | null;
  error: string | null;
  createdAt: string;
  /** 解析后的 payload 对象；未留档时为 null。 */
  payload: unknown;
};

export type AssistantEventLogPage = {
  events: AssistantEventLogEvent[];
  /** 最后一条的 id；没有命中时沿用传入的 afterId。 */
  nextAfterId: number;
};

export const ASSISTANT_EVENT_LOG_DEFAULT_LIMIT = 50;
export const ASSISTANT_EVENT_LOG_MAX_LIMIT = 200;

type LogRow = {
  id: number;
  key: string;
  event: string;
  ref: string | null;
  state: string;
  http_status: number | null;
  error: string | null;
  created_at: string;
  payload_json: string | null;
};

/** payload_json → 对象；空 / 坏 JSON 返回 null。 */
export function parseAssistantEventPayload(text: string | null | undefined): unknown {
  if (typeof text !== "string" || text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 查询 assistant_notify_log。查询参数会先归一化（afterId 取整、limit 夹到
 * 1–200、key 去空白去空项），因此路由层只负责把 query string 转成本类型。
 */
export async function listAssistantEventLog(
  db: D1Database,
  query: AssistantEventLogQuery = {},
): Promise<AssistantEventLogPage> {
  const rawAfterId = query.afterId ?? 0;
  const afterId = Number.isInteger(rawAfterId) && rawAfterId > 0 ? rawAfterId : 0;
  const since = typeof query.since === "string" ? query.since.trim() : "";
  const keys = Array.isArray(query.keys)
    ? query.keys.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
  const rawLimit = query.limit ?? ASSISTANT_EVENT_LOG_DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(rawLimit) || ASSISTANT_EVENT_LOG_DEFAULT_LIMIT, 1), ASSISTANT_EVENT_LOG_MAX_LIMIT);

  const clauses: string[] = ["id > ?"];
  const params: unknown[] = [afterId];
  if (since) {
    clauses.push("created_at >= ?");
    params.push(since);
  }
  if (keys.length) {
    clauses.push(`key IN (${keys.map(() => "?").join(", ")})`);
    params.push(...keys);
  }
  params.push(limit);

  const { results } = await db
    .prepare(
      `SELECT id, key, event, ref, state, http_status, error, created_at, payload_json FROM assistant_notify_log WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`,
    )
    .bind(...params)
    .all<LogRow>();

  const events: AssistantEventLogEvent[] = results.map((row) => ({
    id: Number(row.id),
    key: row.key,
    event: row.event,
    ref: row.ref ?? null,
    state: row.state,
    httpStatus: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
    error: row.error ?? null,
    createdAt: row.created_at,
    payload: parseAssistantEventPayload(row.payload_json),
  }));
  return { events, nextAfterId: events.length ? events[events.length - 1].id : afterId };
}
