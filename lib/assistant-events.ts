// 助手事件注册表（设计见 docs/assistant-events-design.md §1–§3、§5）。
//
// Yu 在网页上做的、需要助手接手的决定都登记在这里：新增一个事件 = 加一条配置。
// 纯模块：不依赖任何运行时环境，import 带 .ts 后缀，便于 node 的类型擦除测试
// 与文档生成脚本直接加载。

export type AssistantEventDef = {
  /** 注册表键，如 "article.review_submitted"。 */
  key: string;
  /** 线上事件名：payload.event 与请求头 x-dabaihua-event。 */
  event: string;
  /** payload.protocol，如 "dabaihua.review-notify/v1"。 */
  protocol: string;
  /** Yu 在哪个页面 / 接口做决定。 */
  page: string;
  /** webhook 目标键（见 WEBHOOK_TARGETS）；null = 目标待定。 */
  target: string | null;
  /** 实际该谁接手；固定名字或 "rule:<说明>"。 */
  handoff: string;
  /** 仅文档用：线上事件名早于命名约定、作为旧别名保留时，注明对应的规范名。 */
  aliasOf?: string;
  /** 固定抄送名单（payload.cc）；仅文档展示。 */
  cc?: string[];
  /** false：不发送（sendAssistantEvent 返回 state "disabled"）。 */
  enabled: boolean;
  /** payload 顶层字段，文档与测试都用它。 */
  payloadFields: string[];
  /** 助手重新读取状态的 superme 命令 / 接口；"-" 表示无。 */
  read: string;
  /** 助手做完后的写回命令（可选）。 */
  writeBack?: string;
};

/** webhook 目标：env 变量名集中定义，发送函数按 target 键取。 */
export const WEBHOOK_TARGETS = {
  shufangzhai: {
    urlEnv: "SHUFANGZHAI_WEBHOOK_URL",
    secretEnv: "SHUFANGZHAI_WEBHOOK_SECRET",
    authHeaderEnv: "SHUFANGZHAI_WEBHOOK_AUTH_HEADER",
  },
} as const;

export type WebhookTargetKey = keyof typeof WEBHOOK_TARGETS;

// 简报通知的顶层字段来自 buildNotifyPayload 的实际输出；
// outlineJson / baseRev / blocks 只在部分事件出现（见各条 payloadFields）。
const BRIEF_BASE_FIELDS = [
  "protocol",
  "event",
  "eventId",
  "sentAt",
  "topic",
  "scenario",
  "answers",
  "outline",
  "status",
  "boardTopicId",
  "links",
];

const BRIEF_CONFIRM_FIELDS = [
  "protocol",
  "event",
  "eventId",
  "sentAt",
  "topic",
  "scenario",
  "answers",
  "outline",
  "outlineJson",
  "baseRev",
  "status",
  "boardTopicId",
  "links",
];

const BRIEF_REGEN_FIELDS = [
  "protocol",
  "event",
  "eventId",
  "sentAt",
  "topic",
  "scenario",
  "answers",
  "outline",
  "outlineJson",
  "baseRev",
  "blocks",
  "status",
  "boardTopicId",
  "links",
];

/** 事件注册表：顺序即文档顺序。 */
export const ASSISTANT_EVENTS: AssistantEventDef[] = [
  {
    key: "brief.select",
    event: "select",
    protocol: "dabaihua.brief-notify/v1",
    page: "简报页 POST /api/briefs/<date>/topics/<topicId>/select",
    target: "shufangzhai",
    handoff: "小燕子",
    aliasOf: "brief_select",
    enabled: true,
    payloadFields: BRIEF_BASE_FIELDS,
    read: "superme brief pipeline <date> <topicId>",
    writeBack: "PATCH /api/briefs/<date>/topics/<topicId>/pipeline",
  },
  {
    key: "brief.confirm_outline",
    event: "confirm_outline",
    protocol: "dabaihua.brief-notify/v1",
    page: "简报页 POST /api/briefs/<date>/topics/<topicId>/confirm-outline",
    target: "shufangzhai",
    handoff: "小燕子",
    aliasOf: "brief_confirm_outline",
    enabled: true,
    payloadFields: BRIEF_CONFIRM_FIELDS,
    read: "superme brief pipeline <date> <topicId>",
    writeBack: "PATCH /api/briefs/<date>/topics/<topicId>/pipeline",
  },
  {
    key: "brief.regenerate_outline",
    event: "regenerate_outline",
    protocol: "dabaihua.brief-notify/v1",
    page: "简报页 POST /api/briefs/<date>/topics/<topicId>/regenerate-outline",
    target: "shufangzhai",
    handoff: "小燕子",
    aliasOf: "brief_regenerate_outline",
    enabled: true,
    payloadFields: BRIEF_REGEN_FIELDS,
    read: "superme brief pipeline <date> <topicId>",
    writeBack: "PATCH /api/briefs/<date>/topics/<topicId>/pipeline",
  },
  {
    key: "brief.cancel",
    event: "cancel",
    protocol: "dabaihua.brief-notify/v1",
    page: "简报页 POST /api/briefs/<date>/topics/<topicId>/undo",
    target: "shufangzhai",
    handoff: "小燕子",
    aliasOf: "brief_cancel",
    enabled: true,
    payloadFields: BRIEF_BASE_FIELDS,
    read: "superme brief pipeline <date> <topicId>",
    writeBack: "PATCH /api/briefs/<date>/topics/<topicId>/pipeline",
  },
  {
    // 第 2b 步接调用点：简报反馈的「不要」/ 清空决定（decision 实际变化时）。
    // 打分 / 评语 / 答案逐字段自动保存，不逐次推送（见 brief.responses_digest）。
    key: "brief.response_decided",
    event: "response_decided",
    protocol: "dabaihua.brief-response/v1",
    page: "今日简报「不要」/ 清空决定（POST /api/briefs/<date>/responses，decision 变化时）",
    target: "shufangzhai",
    handoff: "晴儿",
    cc: ["晴儿"],
    enabled: true,
    payloadFields: [
      "protocol",
      "event",
      "eventId",
      "sentAt",
      "date",
      "topicId",
      "decision",
      "rejectReason",
      "rating",
      "ratingComment",
      "scenario",
      "answers",
      "cc",
      "links",
    ],
    read: "superme brief responses --date <date>",
  },
  {
    // 第 2 步才接调用点：文章审稿页提交（approved / changes_requested / comments）。
    key: "article.review_submitted",
    event: "article_review_submitted",
    protocol: "dabaihua.review-notify/v1",
    page: "文章审稿页 POST /api/review/article/<slug>/submit",
    target: "shufangzhai",
    handoff: "rule:要求修改/批注→紫薇（全是排版配图意见→尔康）；通过→尔康",
    enabled: true,
    payloadFields: [
      "protocol",
      "event",
      "eventId",
      "sentAt",
      "article",
      "review",
      "handoff",
      "links",
    ],
    read: "superme article feedback <slug> [--round N]",
    writeBack: "superme article push <文章目录> --assistant 紫薇 --round N",
  },
  {
    // 以下五条先登记、暂不启用（目标助手不明确）；启用时定目标、改条目、接调用点。
    key: "topic.review_decision",
    event: "topic_review_decision",
    protocol: "dabaihua.topic-notify/v1",
    page: "选题看板 POST /api/topics/<id>/reviews",
    target: null,
    handoff: "TBD",
    enabled: false,
    payloadFields: ["topicId", "decision", "comment"],
    read: "superme board",
  },
  {
    key: "cards.decision",
    event: "cards_decision",
    protocol: "dabaihua.cards-notify/v1",
    page: "照照镜子 POST /api/cards/<id>/confirm|reject",
    target: null,
    handoff: "TBD",
    enabled: false,
    payloadFields: ["cardId", "action", "reason", "version"],
    read: "GET /api/cards",
  },
  {
    key: "itch.status",
    event: "itch_status",
    protocol: "dabaihua.itch-notify/v1",
    page: "心结页 PATCH /api/itches/<id>",
    target: null,
    handoff: "TBD",
    enabled: false,
    payloadFields: ["itchId", "status", "note"],
    read: "superme itch",
  },
  {
    // 简报反馈的打分 / 评语 / 答案逐字段自动保存，不逐次推送；汇总推送记为 next。
    key: "brief.responses_digest",
    event: "responses_digest",
    protocol: "dabaihua.brief-response/v1",
    page: "简报页打分 / 评语 / 答案（逐字段自动保存）",
    target: null,
    handoff: "晴儿",
    enabled: false,
    payloadFields: ["date", "responses"],
    read: "superme brief responses --date <date>",
  },
  {
    // 简报大纲配图（diagrams.status ok/redo）人工确认后交给尔康换图。
    key: "brief.diagram_reviewed",
    event: "diagram_reviewed",
    protocol: "dabaihua.brief-notify/v1",
    page: "简报页大纲配图 diagrams.status ok/redo",
    target: null,
    handoff: "尔康",
    enabled: false,
    payloadFields: ["date", "topicId", "diagrams"],
    read: "superme brief pipeline <date> <topicId>",
  },
];

/** 按注册表键取条目；未知键返回 null。 */
export function getAssistantEvent(key: string): AssistantEventDef | null {
  return ASSISTANT_EVENTS.find((def) => def.key === key) ?? null;
}
