// 简报反馈（Yu → 晴儿）出站通知的纯函数与常量（设计见 docs/assistant-events-design.md §5）。
//
// 事件注册在 lib/assistant-events.ts（键 brief.response_decided）：Yu 在今日简报
// 里「不要」/ 清空决定（decision 实际变化）时，把决定与当时的反馈快照发给晴儿；
// 打分 / 评语 / 答案逐字段自动保存，不逐次推送。payload 不带用户 id。
//
// 纯模块：import 一律带 .ts 后缀，便于 node 的类型擦除测试直接加载。

import type { BriefAnswer, BriefDecision, ShapedBriefResponse } from "./daily-brief-core.ts";

export const BRIEF_RESPONSE_PROTOCOL = "dabaihua.brief-response/v1";
export const BRIEF_RESPONSE_EVENT = "response_decided";
/** 固定抄送名单，与注册表条目 brief.response_decided 的 cc 一致。 */
export const BRIEF_RESPONSE_CC = ["晴儿"];

export type BriefResponseNotifyPayload = {
  protocol: typeof BRIEF_RESPONSE_PROTOCOL;
  event: typeof BRIEF_RESPONSE_EVENT;
  eventId: string;
  sentAt: string;
  date: string;
  topicId: string;
  decision: BriefDecision | null;
  rejectReason: string;
  rating: number | null;
  ratingComment: string;
  scenario: { index: number | null; custom: string };
  answers: BriefAnswer[];
  cc: string[];
  links: { brief: string; responses: string };
};

export type BuildBriefResponsePayloadInput = {
  date: string;
  topicId: string;
  /** upsert 后读回的回复（反馈快照来源）。 */
  response: ShapedBriefResponse;
  /** 站点根地址（DABAIHUA_PUBLIC_BASE_URL 或请求 origin），用于 links。 */
  origin: string;
  eventId: string;
  sentAt: string;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 构造发给晴儿的 JSON 负载（纯函数，不含时间 / 随机数，不带用户 id）。
 *
 * scenario 折叠成 `{ index, custom }`：预设场景记下标，自定义场景记文本，
 * 互斥存储所以至多一个非空。links 用简报页与反馈接口的真实路径。
 */
export function buildBriefResponsePayload(input: BuildBriefResponsePayloadInput): BriefResponseNotifyPayload {
  const origin = trimmed(input.origin).replace(/\/+$/, "");
  const date = trimmed(input.date);
  const response = input.response;
  return {
    protocol: BRIEF_RESPONSE_PROTOCOL,
    event: BRIEF_RESPONSE_EVENT,
    eventId: input.eventId,
    sentAt: input.sentAt,
    date,
    topicId: trimmed(input.topicId),
    decision: response.decision ?? null,
    rejectReason: trimmed(response.rejectReason),
    rating: typeof response.rating === "number" ? response.rating : null,
    ratingComment: trimmed(response.ratingComment),
    scenario: {
      index:
        response.scenario && typeof response.scenario.index === "number" ? response.scenario.index : null,
      custom: trimmed(response.scenarioCustom),
    },
    answers: Array.isArray(response.answers) ? response.answers : [],
    cc: [...BRIEF_RESPONSE_CC],
    links: {
      brief: `${origin}/content?view=brief&date=${encodeURIComponent(date)}`,
      responses: `${origin}/api/briefs/responses?date=${encodeURIComponent(date)}`,
    },
  };
}
