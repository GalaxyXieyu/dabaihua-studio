// 简报生产管线（brief → 漱芳斋）的纯函数与常量。
// 只依赖类型/纯模块，import 带 .ts 后缀，便于 node 的类型擦除测试直接加载。

import type { OutlineV01 } from "./outline-core.ts";

/** 管线状态（按流程顺序）。数据库只存 code，展示只看 label。 */
export const PIPELINE_STATUSES = [
  "selected",
  "outline_pending",
  "drafting",
  "pending_review",
  "reviewing",
  "typesetting",
  "published",
  "shelved",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** code → 中文标签，唯一定义处。 */
export const PIPELINE_LABELS: Record<PipelineStatus, string> = {
  selected: "已选",
  outline_pending: "大纲待确认",
  drafting: "写稿中",
  pending_review: "待审",
  reviewing: "审稿中",
  typesetting: "排版中",
  published: "已发",
  shelved: "搁置",
};

/** 通知事件：选题、确认大纲、撤销、按建议重生成。 */
export const PIPELINE_NOTIFY_EVENTS = ["select", "confirm_outline", "cancel", "regenerate_outline"] as const;
export type PipelineNotifyEvent = (typeof PIPELINE_NOTIFY_EVENTS)[number];

/** 通知状态。 */
export const PIPELINE_NOTIFY_STATES = ["delivered", "failed", "unconfigured"] as const;
export type PipelineNotifyState = (typeof PIPELINE_NOTIFY_STATES)[number];

const STATUS_BY_LABEL = new Map<string, PipelineStatus>(
  PIPELINE_STATUSES.map((code) => [PIPELINE_LABELS[code], code]),
);

/** 接受 code 或中文 label，返回 code；无法识别时返回 null。 */
export function parsePipelineStatus(value: unknown): PipelineStatus | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if ((PIPELINE_STATUSES as readonly string[]).includes(text)) return text as PipelineStatus;
  return STATUS_BY_LABEL.get(text) ?? null;
}

/** 通知负载和简报选题的输入类型。 */
export type NotifyScenario =
  | { kind: "preset"; index: number; text: string }
  | { kind: "custom"; text: string }
  | null;

export type NotifyAnswer = { question: string; answer: string };

export type NotifyPayload = {
  protocol: "dabaihua.brief-notify/v1";
  event: PipelineNotifyEvent;
  eventId: string;
  sentAt: string;
  topic: {
    id: string;
    date: string;
    type: string;
    label: string;
    title: string;
    summary: string;
    detail: string;
  };
  scenario: NotifyScenario;
  answers: NotifyAnswer[];
  outline: string | null;
  outlineJson?: OutlineV01 | null;
  baseRev?: number;
  blocks?: { blockId: string; suggestion: string }[];
  status: { code: string; label: string };
  boardTopicId: number | null;
  links: { topic: string; board: string };
};

export type BuildNotifyPayloadInput = {
  event: PipelineNotifyEvent;
  eventId: string;
  sentAt: string;
  topic: {
    id: string;
    date: string;
    type: string;
    label: string;
    title: string;
    oneLiner: string;
    detail: string;
    scenarios?: string[];
    questions?: string[];
  };
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

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 把已存的场景信息折叠成通知里的 scenario：
 * 自定义优先，其次预设下标，都没有则为 null。
 */
export function buildNotifyScenario(
  scenarios: string[] | undefined,
  scenarioIndex: number | null | undefined,
  scenarioText: string | null | undefined,
  scenarioCustom: string | null | undefined,
): NotifyScenario {
  const custom = trimmed(scenarioCustom);
  if (custom) return { kind: "custom", text: custom };
  if (typeof scenarioIndex === "number" && Number.isInteger(scenarioIndex) && scenarioIndex >= 0) {
    const list = Array.isArray(scenarios) ? scenarios : [];
    const text = trimmed(scenarioText) || trimmed(list[scenarioIndex]);
    if (text) return { kind: "preset", index: scenarioIndex, text };
  }
  return null;
}

/** 回答与问题一一配对，空回答跳过。 */
export function pairAnswers(questions: string[] | undefined, answers: string[] | undefined): NotifyAnswer[] {
  const qs = Array.isArray(questions) ? questions : [];
  const as = Array.isArray(answers) ? answers : [];
  const pairs: NotifyAnswer[] = [];
  for (let index = 0; index < as.length; index += 1) {
    const answer = trimmed(as[index]);
    if (!answer) continue;
    pairs.push({ question: trimmed(qs[index]), answer });
  }
  return pairs;
}

/** 构造发给漱芳斋的 JSON 负载（纯函数，不含时间/随机数）。 */
export function buildNotifyPayload(input: BuildNotifyPayloadInput): NotifyPayload {
  const base = trimmed(input.baseUrl).replace(/\/+$/, "");
  const topic = input.topic;
  const boardTopicId =
    typeof input.boardTopicId === "number" && Number.isInteger(input.boardTopicId) ? input.boardTopicId : null;
  const status = parsePipelineStatus(input.status) ?? input.status;
  const payload: NotifyPayload = {
    protocol: "dabaihua.brief-notify/v1",
    event: input.event,
    eventId: input.eventId,
    sentAt: input.sentAt,
    topic: {
      id: trimmed(topic.id),
      date: trimmed(topic.date),
      type: trimmed(topic.type),
      label: trimmed(topic.label),
      title: trimmed(topic.title),
      summary: trimmed(topic.oneLiner),
      detail: trimmed(topic.detail),
    },
    scenario: buildNotifyScenario(topic.scenarios, input.scenarioIndex, input.scenarioText, input.scenarioCustom),
    answers: pairAnswers(topic.questions, input.answers),
    outline: trimmed(input.outline) || null,
    status: { code: status, label: PIPELINE_LABELS[status as PipelineStatus] ?? "" },
    boardTopicId,
    links: {
      topic: `${base}/content?view=brief&date=${encodeURIComponent(trimmed(topic.date))}&topic=${encodeURIComponent(trimmed(topic.id))}`,
      board:
        boardTopicId === null
          ? `${base}/content?view=board`
          : `${base}/content?view=board&card=${boardTopicId}`,
    },
  };
  // select / cancel 保持原样；confirm_outline 有 JSON 时补上；regenerate_outline 一定带上。
  if (input.event === "regenerate_outline") {
    payload.blocks = Array.isArray(input.blocks) ? input.blocks : [];
    payload.outlineJson = input.outlineJson ?? null;
    if (typeof input.baseRev === "number" && Number.isInteger(input.baseRev)) payload.baseRev = input.baseRev;
  } else if (input.event === "confirm_outline" && input.outlineJson) {
    payload.outlineJson = input.outlineJson;
    if (typeof input.baseRev === "number" && Number.isInteger(input.baseRev)) payload.baseRev = input.baseRev;
  }
  return payload;
}

export type AssistantRuleCode =
  | "not_selected"
  | "shelved"
  | "owner_only"
  | "outline_required"
  | "bad_status";

export type AssistantRuleResult =
  | { ok: true; status: PipelineStatus }
  | { ok: false; code: AssistantRuleCode };

/**
 * 助手（漱芳斋）能对选题管线做什么。
 *
 * - 必须已有 selection（否则 not_selected），且不能是 shelved（否则 shelved）；
 * - 不能设 selected / shelved（那是 Yu 的选/撤销）→ owner_only；
 * - 不能把 outline_pending 推到 drafting（那是 Yu 的确认大纲）→ owner_only；
 * - outline_pending 必须有 outline（本次或已存）→ outline_required；
 * - 只传 outline 不传状态、且当前是 selected → outline_pending；
 * - 其余 8 个 code 前进/后退都允许。
 */
export function assistantStatusRule(
  current: string | null,
  next: string | null,
  hasOutline: boolean,
): AssistantRuleResult {
  if (!current) return { ok: false, code: "not_selected" };
  if (current === "shelved") return { ok: false, code: "shelved" };
  if (next !== null && !(PIPELINE_STATUSES as readonly string[]).includes(next)) {
    return { ok: false, code: "bad_status" };
  }
  if (next === "selected" || next === "shelved") return { ok: false, code: "owner_only" };
  if (current === "outline_pending" && next === "drafting") return { ok: false, code: "owner_only" };

  let effective: PipelineStatus = (next as PipelineStatus | null) ?? (current as PipelineStatus);
  if (next === null && current === "selected" && hasOutline) effective = "outline_pending";
  if (effective === "outline_pending" && !hasOutline) return { ok: false, code: "outline_required" };
  return { ok: true, status: effective };
}
