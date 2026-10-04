// 简报反馈（Yu → 晴儿）的出站通知编排：decision 实际变化才发送。
//
// 「是否该发 + 发送」集中在 maybeNotifyResponseDecision：路由在 upsert 前用
// getResponse 取旧 decision、保存成功后调用本函数；不该发时返回 null（响应里
// 不带 notify），发送结果原样回传给页面。发送经 lib/assistant-notify.ts（注册表
// 键 brief.response_decided），永不抛出，失败由调用方兜底。

import { sendAssistantEvent, type AssistantNotifyResult } from "./assistant-notify.ts";
import { shanghaiIso } from "./brief-notify.ts";
import { buildBriefResponsePayload } from "./brief-response-notify-core.ts";
import type { BriefDecision, ShapedBriefResponse } from "./daily-brief-core.ts";

export type { AssistantNotifyResult };

export type BriefResponseNotifyEnv = {
  DB: D1Database;
  SHUFANGZHAI_WEBHOOK_URL?: string;
  SHUFANGZHAI_WEBHOOK_SECRET?: string;
  SHUFANGZHAI_WEBHOOK_AUTH_HEADER?: string;
};

export type MaybeNotifyResponseDecisionInput = {
  date: string;
  topicId: string;
  /** upsert 后读回的回复（payload 的反馈快照来源）。 */
  response: ShapedBriefResponse;
  /** 请求体里是否显式提交了 decision；打分 / 评语 / 答案变化时为 false。 */
  hasDecision: boolean;
  /** upsert 前的旧 decision；没有旧回复时为 null。 */
  previousDecision: BriefDecision | null;
  /** 站点根地址（DABAIHUA_PUBLIC_BASE_URL 或请求 origin），用于 links。 */
  origin: string;
};

/**
 * decision 实际变化（pick / reject / 清空）时发一次 brief.response_decided；
 * 其余情况（未提交 decision、decision 相同）返回 null，不发请求。
 */
export async function maybeNotifyResponseDecision(
  env: BriefResponseNotifyEnv,
  input: MaybeNotifyResponseDecisionInput,
): Promise<AssistantNotifyResult | null> {
  if (!input.hasDecision) return null;
  const decision = input.response.decision ?? null;
  if (decision === (input.previousDecision ?? null)) return null;
  const payload = buildBriefResponsePayload({
    date: input.date,
    topicId: input.topicId,
    response: input.response,
    origin: input.origin,
    eventId: crypto.randomUUID(),
    sentAt: shanghaiIso(),
  });
  return sendAssistantEvent(env, "brief.response_decided", payload, {
    ref: `${input.date}/${input.topicId}`,
  });
}
