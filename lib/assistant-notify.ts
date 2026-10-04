// 助手事件的通用出站通知（设计见 docs/assistant-events-design.md §2–§3）。
//
// 只依赖纯注册表和注入进来的 env / D1。通知永不抛出：调用方的写库决定必须
// 成功，失败只记录并回传状态。日志 / 落库只保留 webhook 的 host，绝不写入
// 完整 URL 或 secret。发送细节原样搬自 lib/brief-notify.ts（后者 re-export 复用）。

import { getAssistantEvent, WEBHOOK_TARGETS, type WebhookTargetKey } from "./assistant-events.ts";

export type AssistantNotifyState = "delivered" | "failed" | "unconfigured" | "disabled";

export type AssistantNotifyResult = {
  state: AssistantNotifyState;
  httpStatus?: number;
  error?: string;
  at: string;
};

/** env 按 WEBHOOK_TARGETS 的变量名读取（Record<string, unknown>）；DB 可选，只影响日志。 */
export type AssistantNotifyEnv = { DB?: D1Database } & Record<string, unknown>;

export type SendAssistantEventOptions = {
  /** 业务引用（如 "2026-10-02/kb-3"），写进 assistant_notify_log 便于排查。 */
  ref?: string;
};

export const NOTIFY_TIMEOUT_MS = 8000;
export const NOTIFY_ERROR_MAX = 300;

/**
 * 默认 Authorization 头使用 `Bearer <secret>`；显式配置了自定义头时原样发送 secret。
 */
export function resolveAuthHeader(
  configuredHeader: string | null | undefined,
  secret: string,
): { name: string; value: string } {
  const name = typeof configuredHeader === "string" ? configuredHeader.trim() : "";
  if (!name) return { name: "Authorization", value: `Bearer ${secret}` };
  return { name, value: secret };
}

/** 只保留 host，用于日志与落库；解析失败返回空串。 */
export function webhookHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** 把错误压成短文本，并把完整 webhook URL 换成它的 host。 */
export function shortError(error: unknown, rawUrl: string, host: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  let text = message || "通知发送失败";
  if (rawUrl) text = text.split(rawUrl).join(host || "webhook");
  return text.replace(/\s+/g, " ").trim().slice(0, NOTIFY_ERROR_MAX);
}

/** env 读取：只接受字符串，其余当未配置。 */
function envString(env: Record<string, unknown>, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

type NotifyLogRow = {
  key: string;
  event: string;
  ref: string | null;
  state: AssistantNotifyState;
  httpStatus?: number;
  error?: string;
  durationMs: number;
  targetHost: string;
  createdAt: string;
};

/** 每次发送写一行通用日志；没有 DB 或写入失败都不抛。 */
async function writeNotifyLog(env: AssistantNotifyEnv, row: NotifyLogRow): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO assistant_notify_log (key, event, ref, state, http_status, error, duration_ms, target_host, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        row.key,
        row.event,
        row.ref,
        row.state,
        row.httpStatus ?? null,
        (row.error || "").slice(0, NOTIFY_ERROR_MAX) || null,
        row.durationMs,
        row.targetHost,
        row.createdAt,
      )
      .run();
  } catch {
    // 日志失败不能影响业务决定。
  }
}

/**
 * 按注册表发送一次助手事件并写 assistant_notify_log。
 *
 * 未知 key 或条目 disabled → state "disabled"，不发请求；目标没配 URL →
 * "unconfigured"；2xx → "delivered"；其余（含超时/网络错误）→ "failed"。
 */
export async function sendAssistantEvent(
  env: AssistantNotifyEnv,
  key: string,
  payload: unknown,
  opts?: SendAssistantEventOptions,
): Promise<AssistantNotifyResult> {
  const def = getAssistantEvent(key);
  const ref = typeof opts?.ref === "string" ? opts.ref : null;

  if (!def || !def.enabled) {
    const result: AssistantNotifyResult = { state: "disabled", at: new Date().toISOString() };
    await writeNotifyLog(env, {
      key,
      event: def?.event ?? "",
      ref,
      state: result.state,
      durationMs: 0,
      targetHost: "",
      createdAt: result.at,
    });
    return result;
  }

  const targetKey: WebhookTargetKey | null =
    def.target && def.target in WEBHOOK_TARGETS ? (def.target as WebhookTargetKey) : null;
  const target = targetKey ? WEBHOOK_TARGETS[targetKey] : null;
  const rawUrl = target ? envString(env, target.urlEnv) : "";
  const host = webhookHost(rawUrl);
  const started = Date.now();

  if (!target || !rawUrl) {
    const result: AssistantNotifyResult = { state: "unconfigured", at: new Date().toISOString() };
    await writeNotifyLog(env, {
      key: def.key,
      event: def.event,
      ref,
      state: result.state,
      durationMs: Date.now() - started,
      targetHost: "",
      createdAt: result.at,
    });
    return result;
  }

  const secret = envString(env, target.secretEnv);
  const authHeader = env[target.authHeaderEnv];
  const auth = resolveAuthHeader(typeof authHeader === "string" ? authHeader : undefined, secret);

  let state: AssistantNotifyState = "failed";
  let httpStatus: number | undefined;
  let error: string | undefined;
  try {
    const response = await fetch(rawUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dabaihua-event": def.event,
        [auth.name]: auth.value,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    httpStatus = response.status;
    if (response.ok) {
      state = "delivered";
    } else {
      error = `HTTP ${response.status}`;
    }
  } catch (caught) {
    error = shortError(caught, rawUrl, host);
  }

  const result: AssistantNotifyResult = { state, at: new Date().toISOString() };
  if (httpStatus !== undefined) result.httpStatus = httpStatus;
  if (error) result.error = error;
  await writeNotifyLog(env, {
    key: def.key,
    event: def.event,
    ref,
    state: result.state,
    httpStatus: result.httpStatus,
    error: result.error,
    durationMs: Date.now() - started,
    targetHost: host,
    createdAt: result.at,
  });
  return result;
}
