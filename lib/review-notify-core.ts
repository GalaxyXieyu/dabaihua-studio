// 文章审稿提交通知的纯函数与常量（设计见 docs/assistant-events-design.md §4）。
//
// 事件注册在 lib/assistant-events.ts（键 article.review_submitted）：Yu 在审稿页
// 提交一轮反馈后，把 payload 发给漱芳斋，由 handoff 字段说明实际该谁接手
// （紫薇改文字 / 小燕子重写 / 尔康排版）。payload 不带 reviewer 的 id 与邮箱。
//
// 纯模块：不依赖运行时环境，import 一律带 .ts 后缀，便于 node 的类型擦除测试
// 直接加载；类型只在本地声明 feedback 的最小结构（article-review 不是纯模块）。

export const REVIEW_NOTIFY_PROTOCOL = "dabaihua.review-notify/v1";
export const REVIEW_NOTIFY_EVENT = "article_review_submitted";

/** handoff 候选（也是提交体 handoff 的合法值，"auto" 除外）。 */
export const HANDOFF_ASSISTANTS = ["紫薇", "小燕子", "尔康"] as const;

export type HandoffAssistant = (typeof HANDOFF_ASSISTANTS)[number];
export type HandoffSource = "picked" | "auto";

export type ReviewHandoff = {
  assistant: HandoffAssistant;
  reason: string;
  source: HandoffSource;
};

/** 结构词命中 → 整篇推翻重来，交给小燕子。 */
const STRUCTURE_RE = /重写|换观点|改观点|改结构|推翻|整段|重来|换角度|换个角度/;
/** 排版 / 配图类意见。 */
const LAYOUT_RE = /排版|配图|图片|插图|封面|字号|行距|间距|样式|版式|配色|layout/i;
/** 文字类意见（与排版词互斥使用：全排版且零文字才归尔康）。 */
const TEXT_RE = /措辞|标题|段落|论点|事实|表述|错别字|删掉|改写|开头|结尾|语气/;

export type HandoffMark = { type: string; comment: string };

/**
 * 提交体 handoff 的合法值："auto"（自动判定）或三位助手名（手选优先）；
 * "auto" / 缺省存 null（表示走自动规则），非法名字抛错（路由回 400）。
 */
export function normalizeHandoffPick(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const picked = String(value).trim();
  if (picked === "auto") return null;
  if ((HANDOFF_ASSISTANTS as readonly string[]).includes(picked)) return picked;
  throw new Error("审稿接手人不合法");
}

/**
 * 自动 / 手选的接手人判定（设计 §4.1）。
 *
 * picked 为三位助手名字之一时直接采用（Yu 手选）；否则：
 * approved → 尔康（排版定稿）；意见里命中结构词 → 小燕子；
 * 所有非空意见都只谈排版配图（全命中排版词且零文字词）→ 尔康；其余 → 紫薇。
 */
export function suggestHandoff(
  verdict: string,
  overallComment: string,
  marks: HandoffMark[],
  picked?: string | null,
): ReviewHandoff {
  if (picked && (HANDOFF_ASSISTANTS as readonly string[]).includes(picked)) {
    return { assistant: picked as HandoffAssistant, reason: "Yu 指定", source: "picked" };
  }
  if (verdict === "approved") {
    return { assistant: "尔康", reason: "审稿通过，进入排版定稿", source: "auto" };
  }
  // 收集总体意见与所有「要改」标记的意见（非空）。
  const comments: string[] = [];
  const overall = typeof overallComment === "string" ? overallComment.trim() : "";
  if (overall) comments.push(overall);
  for (const mark of Array.isArray(marks) ? marks : []) {
    if (mark && mark.type === "change" && typeof mark.comment === "string" && mark.comment.trim()) {
      comments.push(mark.comment.trim());
    }
  }
  if (comments.some((comment) => STRUCTURE_RE.test(comment))) {
    return { assistant: "小燕子", reason: "结构性修改", source: "auto" };
  }
  if (
    comments.length > 0 &&
    comments.every((comment) => LAYOUT_RE.test(comment) && !TEXT_RE.test(comment))
  ) {
    return { assistant: "尔康", reason: "意见都是排版配图", source: "auto" };
  }
  return { assistant: "紫薇", reason: "文字修改", source: "auto" };
}

/** payload 里 review 的最小结构（ReviewFeedback 的脱敏投影，不带 reviewer id）。 */
export type ReviewFeedbackForNotify = {
  round: number;
  verdict: string;
  overallComment: string;
  reviewer: { nickname: string };
  submittedAt: string;
  contentHash: string;
  counts: { good: number; change: number };
  marks: Array<{
    id: number;
    type: string;
    quote: string;
    comment: string;
    prefix: string;
    suffix: string;
    blockIndex: number | null;
  }>;
};

export type ReviewNotifyArticleInput = {
  slug: string;
  title: string | null;
  status: string | null;
  /** articles.meta_json 原文；坏 JSON 当空。 */
  metaJson: string | null;
};

export type BuildReviewNotifyPayloadInput = {
  feedback: ReviewFeedbackForNotify;
  article: ReviewNotifyArticleInput;
  /** 站点根地址（DABAIHUA_PUBLIC_BASE_URL 或请求 origin），用于 links。 */
  origin: string;
  eventId: string;
  sentAt: string;
  /** 提交体里的手选接手人（"auto" / 空 / 非法值都走自动规则）。 */
  picked?: string | null;
};

export type ReviewNotifyPayload = {
  protocol: typeof REVIEW_NOTIFY_PROTOCOL;
  event: typeof REVIEW_NOTIFY_EVENT;
  eventId: string;
  sentAt: string;
  article: {
    slug: string;
    title: string | null;
    status: string | null;
    sourcePath: string | null;
    articleDir: string | null;
    assistant: string | null;
    brief: { date: string; topicId: string } | null;
    boardTopicId: number | null;
    stage: Record<string, unknown> | null;
  };
  review: {
    round: number;
    verdict: string;
    overallComment: string;
    reviewer: { nickname: string };
    submittedAt: string;
    contentHash: string;
    counts: { marks: number; good: number; change: number };
    marks: Array<{
      id: number;
      type: string;
      quote: string;
      comment: string;
      prefix: string;
      suffix: string;
      blockIndex: number | null;
    }>;
  };
  handoff: ReviewHandoff;
  links: { review: string; feedback: string };
};

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** 从 meta_json 解析 article 扩展字段；坏 JSON 或缺字段一律 null。 */
function parseArticleMeta(metaJson: string | null) {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(String(metaJson ?? "")) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    parsed = {};
  }
  const sourcePath = trimmedString(parsed.sourcePath);
  // articleDir = sourcePath 的首段目录名（如 "content/proj/x.md" → "content"）；没有就 null。
  const articleDir = sourcePath && sourcePath.includes("/") ? sourcePath.split("/")[0] || null : null;
  let assistant: string | null = null;
  if (typeof parsed.assistant === "string" && parsed.assistant.trim()) {
    assistant = parsed.assistant.trim();
  }
  let brief: { date: string; topicId: string } | null = null;
  if (parsed.brief && typeof parsed.brief === "object" && !Array.isArray(parsed.brief)) {
    const raw = parsed.brief as Record<string, unknown>;
    if (typeof raw.date === "string" && typeof raw.topicId === "string") {
      brief = { date: raw.date, topicId: raw.topicId };
    }
  }
  const boardTopicId =
    typeof parsed.boardTopicId === "number" && Number.isSafeInteger(parsed.boardTopicId)
      ? parsed.boardTopicId
      : null;
  const stage =
    parsed.stage && typeof parsed.stage === "object" && !Array.isArray(parsed.stage)
      ? (parsed.stage as Record<string, unknown>)
      : null;
  return { sourcePath, articleDir, assistant, brief, boardTopicId, stage };
}

/**
 * 构造发给助手的审稿提交 payload（纯函数，不含时间 / 随机数，不带 reviewer id）。
 *
 * review 是反馈的脱敏投影：只留 reviewer.nickname，marks 只留 id/type/quote/
 * comment/prefix/suffix/blockIndex；counts 额外补了 marks 总数。
 */
export function buildReviewNotifyPayload(input: BuildReviewNotifyPayloadInput): ReviewNotifyPayload {
  const origin = (typeof input.origin === "string" ? input.origin : "").trim().replace(/\/+$/, "");
  const slug = input.article.slug;
  const meta = parseArticleMeta(input.article.metaJson);
  const feedback = input.feedback;
  return {
    protocol: REVIEW_NOTIFY_PROTOCOL,
    event: REVIEW_NOTIFY_EVENT,
    eventId: input.eventId,
    sentAt: input.sentAt,
    article: {
      slug,
      title: input.article.title,
      status: input.article.status,
      sourcePath: meta.sourcePath,
      articleDir: meta.articleDir,
      assistant: meta.assistant,
      brief: meta.brief,
      boardTopicId: meta.boardTopicId,
      stage: meta.stage,
    },
    review: {
      round: feedback.round,
      verdict: feedback.verdict,
      overallComment: feedback.overallComment,
      // 不带 reviewer id / 邮箱，只留昵称。
      reviewer: { nickname: feedback.reviewer?.nickname ?? "" },
      submittedAt: feedback.submittedAt,
      contentHash: feedback.contentHash,
      counts: {
        marks: feedback.marks.length,
        good: feedback.counts.good,
        change: feedback.counts.change,
      },
      marks: feedback.marks.map((mark) => ({
        id: mark.id,
        type: mark.type,
        quote: mark.quote,
        comment: mark.comment,
        prefix: mark.prefix,
        suffix: mark.suffix,
        blockIndex: mark.blockIndex,
      })),
    },
    handoff: suggestHandoff(
      feedback.verdict,
      feedback.overallComment,
      feedback.marks,
      input.picked ?? null,
    ),
    links: {
      review: `${origin}/articles/${encodeURIComponent(slug)}`,
      feedback: `${origin}/api/review/article/${encodeURIComponent(slug)}/feedback?round=${feedback.round}`,
    },
  };
}
