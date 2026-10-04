// 简报选题 → 漱芳斋（写作助手）的出站通知。
//
// 发送细节已搬进 lib/assistant-notify.ts（通用助手事件发送），本模块只负责：
// 用 buildNotifyPayload 构造负载、按 "brief.<event>" 调注册表发送、把结果落回
// brief_notify_log / brief_selections（行为不变）。通知永远不抛出：写库决定必须
// 成功，失败只记录并回传状态。任何日志/落库都只保留 webhook 的 host，绝不写入
// 完整 URL 或 secret。

import {
  buildNotifyPayload,
  type BuildNotifyPayloadInput,
  type PipelineNotifyEvent,
  type PipelineNotifyState,
} from "./brief-pipeline-core.ts";
import type { OutlineV01 } from "./outline-core.ts";
import {
  NOTIFY_ERROR_MAX,
  NOTIFY_TIMEOUT_MS,
  resolveAuthHeader,
  sendAssistantEvent,
  shortError,
  webhookHost,
} from "./assistant-notify.ts";

// 发送细节搬去 assistant-notify 后，这里继续导出旧名字，避免现有测试/调用断。
export { NOTIFY_ERROR_MAX, NOTIFY_TIMEOUT_MS, resolveAuthHeader, shortError, webhookHost };

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
  outlineJson?: OutlineV01 | null;
  baseRev?: number;
  blocks?: { blockId: string; suggestion: string }[];
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

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 固定 +08:00 的 ISO 时间，例如 2026-10-03T21:10:00+08:00。 */
export function shanghaiIso(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "+08:00");
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
 * 发送一次简报通知并记录结果。负载由 buildNotifyPayload 构造，请求经
 * sendAssistantEvent（注册表键 "brief.<event>"）发出，payload 与请求头保持
 * 逐字节不变；没有配置 URL 时不发请求，状态为 unconfigured。
 */
export async function deliverBriefNotification(
  env: BriefNotifyEnv,
  input: BriefNotifyInput,
): Promise<BriefNotifyResult> {
  const rawUrl = (env.SHUFANGZHAI_WEBHOOK_URL || "").trim();
  const host = webhookHost(rawUrl);
  const started = Date.now();

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
    outlineJson: input.outlineJson,
    baseRev: input.baseRev,
    blocks: input.blocks,
    status: input.status,
    boardTopicId: input.boardTopicId,
    baseUrl: input.baseUrl,
  });

  const sent = await sendAssistantEvent(env, `brief.${input.event}`, payload, {
    ref: `${input.date}/${input.topicId}`,
  });

  // 注册表里四个简报事件都是 enabled，disabled 只在注册表被改坏时兜底。
  const result: BriefNotifyResult = {
    state: sent.state === "disabled" ? "failed" : sent.state,
    at: sent.at,
  };
  if (sent.httpStatus !== undefined) result.httpStatus = sent.httpStatus;
  if (sent.error) result.error = sent.error;
  if (sent.state === "disabled" && !result.error) result.error = "简报通知事件未启用";

  await recordAttempt(env, input, result, Date.now() - started, host);
  return result;
}
