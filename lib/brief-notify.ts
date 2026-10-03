// 简报选题 → 漱芳斋（写作助手）的出站通知。
//
// 只依赖纯模块（便于 node 类型擦除测试直接加载）和注入进来的 D1。通知永远不
// 抛出：写库决定必须成功，失败只记录并回传状态。任何日志/落库都只保留 webhook
// 的 host，绝不写入完整 URL 或 secret。

import {
  buildNotifyPayload,
  type BuildNotifyPayloadInput,
  type PipelineNotifyEvent,
  type PipelineNotifyState,
} from "./brief-pipeline-core.ts";

export type BriefNotifyEnv = {
  DB: D1Database;
  SHUFANGZHAI_WEBHOOK_URL?: string;
  SHUFANGZHAI_WEBHOOK_SECRET?: string;
  SHUFANGZHAI_WEBHOOK_AUTH_HEADER?: string;
};

export type BriefNotifyInput = {
  date: string;
  topicId: string;
  event: PipelineNotifyEvent;
  topic: BuildNotifyPayloadInput["topic"];
  scenarioIndex?: number | null;
  scenarioText?: string;
  scenarioCustom?: string;
  answers?: string[];
  outline?: string | null;
  status: string;
  boardTopicId?: number | null;
  baseUrl: string;
};

export type BriefNotifyResult = {
  state: PipelineNotifyState;
  httpStatus?: number;
  error?: string;
  at: string;
};

export const NOTIFY_TIMEOUT_MS = 8000;
export const NOTIFY_ERROR_MAX = 300;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 固定 +08:00 的 ISO 时间，例如 2026-10-03T21:10:00+08:00。 */
export function shanghaiIso(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

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
function shortError(error: unknown, rawUrl: string, host: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  let text = message || "通知发送失败";
  if (rawUrl) text = text.split(rawUrl).join(host || "webhook");
  return text.replace(/\s+/g, " ").trim().slice(0, NOTIFY_ERROR_MAX);
}

/** 记录一次通知尝试：落 brief_notify_log，并把最近结果写回 brief_selections。 */
async function recordAttempt(
  env: BriefNotifyEnv,
  input: BriefNotifyInput,
  result: BriefNotifyResult,
  durationMs: number,
  host: string,
): Promise<void> {
  const errorText = (result.error || "").slice(0, NOTIFY_ERROR_MAX) || null;
  try {
    await env.DB.prepare(
      "INSERT INTO brief_notify_log (date, topic_id, event, state, http_status, error, duration_ms, target_host, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(input.date, input.topicId, input.event, result.state, result.httpStatus ?? null, errorText, durationMs, host, result.at)
      .run();
  } catch {
    // 日志失败不能影响选题决定。
  }
  try {
    await env.DB.prepare(
      "UPDATE brief_selections SET notify_event = ?, notify_state = ?, notify_http_status = ?, notify_error = ?, notify_at = ?, updated_at = ? WHERE date = ? AND topic_id = ?",
    )
      .bind(input.event, result.state, result.httpStatus ?? null, errorText, result.at, result.at, input.date, input.topicId)
      .run();
  } catch {
    // 存储失败同样不抛出。
  }
}

/**
 * 发送一次简报通知并记录结果。没有配置 URL 时不发请求，状态为 unconfigured。
 */
export async function deliverBriefNotification(
  env: BriefNotifyEnv,
  input: BriefNotifyInput,
): Promise<BriefNotifyResult> {
  const rawUrl = (env.SHUFANGZHAI_WEBHOOK_URL || "").trim();
  const host = webhookHost(rawUrl);
  const started = Date.now();

  if (!rawUrl) {
    const result: BriefNotifyResult = { state: "unconfigured", at: new Date().toISOString() };
    await recordAttempt(env, input, result, 0, host);
    return result;
  }

  const secret = (env.SHUFANGZHAI_WEBHOOK_SECRET || "").trim();
  const auth = resolveAuthHeader(env.SHUFANGZHAI_WEBHOOK_AUTH_HEADER, secret);
  const payload = buildNotifyPayload({
    event: input.event,
    eventId: crypto.randomUUID(),
    sentAt: shanghaiIso(),
    topic: input.topic,
    scenarioIndex: input.scenarioIndex,
    scenarioText: input.scenarioText,
    scenarioCustom: input.scenarioCustom,
    answers: input.answers,
    outline: input.outline,
    status: input.status,
    boardTopicId: input.boardTopicId,
    baseUrl: input.baseUrl,
  });

  let state: PipelineNotifyState = "failed";
  let httpStatus: number | undefined;
  let error: string | undefined;
  try {
    const response = await fetch(rawUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dabaihua-event": input.event,
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

  const result: BriefNotifyResult = { state, at: new Date().toISOString() };
  if (httpStatus !== undefined) result.httpStatus = httpStatus;
  if (error) result.error = error;
  await recordAttempt(env, input, result, Date.now() - started, host);
  return result;
}
