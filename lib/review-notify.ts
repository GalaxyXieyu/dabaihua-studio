// 文章审稿提交（Yu → 助手）的出站通知编排：读库、构造 payload、发送、写回。
//
// notifyArticleReview 只做三件事：把某轮 review_rounds 的 feedback_json 脱敏成
// payload（含 handoff 判定）→ 经 lib/assistant-notify.ts 发送（注册表键
// article.review_submitted）→ 把结果写回 review_rounds 的 notify_* 列。整个函数
// try/catch，绝不抛出：审稿的写库决定必须成功，失败只回传 state "failed" 与
// 简短 error。找不到那一轮 / 文章时返回 null（调用方决定 404 或忽略）。

import { shanghaiIso } from "./brief-notify.ts";
import { sendAssistantEvent, type AssistantNotifyResult, type AssistantNotifyState } from "./assistant-notify.ts";
import { buildReviewNotifyPayload, suggestHandoff, type ReviewFeedbackForNotify } from "./review-notify-core.ts";

export type { AssistantNotifyResult, AssistantNotifyState };

export type ReviewNotifyEnv = {
  DB: D1Database;
  SHUFANGZHAI_WEBHOOK_URL?: string;
  SHUFANGZHAI_WEBHOOK_SECRET?: string;
  SHUFANGZHAI_WEBHOOK_AUTH_HEADER?: string;
};

export type ReviewNotifyResult = {
  state: AssistantNotifyState;
  httpStatus?: number;
  error?: string;
  at: string;
  /** handoff 判定的接手人（紫薇 / 小燕子 / 尔康）。 */
  handoff?: string;
};

export type NotifyArticleReviewInput = {
  slug: string;
  /** 审稿轮次；缺省取最新已提交轮。 */
  round?: number | null;
  /** 站点根地址（DABAIHUA_PUBLIC_BASE_URL 或请求 origin），用于 links。 */
  origin: string;
};

const ERROR_MAX = 300;

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.replace(/\s+/g, " ").trim().slice(0, ERROR_MAX) || "通知发送失败";
}

/** feedback_json → payload 需要的最小结构（防御式投影，字段缺失给空值）。 */
function toFeedbackForNotify(raw: unknown, round: number): ReviewFeedbackForNotify {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const counts = value.counts && typeof value.counts === "object" ? (value.counts as Record<string, unknown>) : {};
  const reviewer = value.reviewer && typeof value.reviewer === "object" ? (value.reviewer as Record<string, unknown>) : {};
  const marks = Array.isArray(value.marks) ? value.marks : [];
  return {
    round: typeof value.round === "number" ? value.round : round,
    verdict: typeof value.verdict === "string" ? value.verdict : "",
    overallComment: typeof value.overallComment === "string" ? value.overallComment : "",
    reviewer: { nickname: typeof reviewer.nickname === "string" ? reviewer.nickname : "" },
    submittedAt: typeof value.submittedAt === "string" ? value.submittedAt : "",
    contentHash: typeof value.contentHash === "string" ? value.contentHash : "",
    counts: {
      good: Number(counts.good) || 0,
      change: Number(counts.change) || 0,
    },
    marks: marks
      .filter((mark) => mark && typeof mark === "object")
      .map((mark) => {
        const item = mark as Record<string, unknown>;
        return {
          id: Number(item.id) || 0,
          type: typeof item.type === "string" ? item.type : "",
          quote: typeof item.quote === "string" ? item.quote : "",
          comment: typeof item.comment === "string" ? item.comment : "",
          prefix: typeof item.prefix === "string" ? item.prefix : "",
          suffix: typeof item.suffix === "string" ? item.suffix : "",
          blockIndex: item.blockIndex === null || item.blockIndex === undefined ? null : Number(item.blockIndex),
        };
      }),
  };
}

/**
 * 给某轮已提交的文章审稿发一次 article.review_submitted 通知，并把结果写回
 * review_rounds 的 notify_* 列（notify_handoff = handoff.assistant）。
 *
 * 绝不抛出：出错返回 state "failed"；那一轮 / 文章不存在返回 null。
 */
export async function notifyArticleReview(
  env: ReviewNotifyEnv,
  input: NotifyArticleReviewInput,
): Promise<ReviewNotifyResult | null> {
  try {
    // 调用方（submitReview / 重试路由）已 ensureSchema；这里只读写的表都在那之后才碰。
    const slug = String(input.slug ?? "").trim();
    let round = input.round === undefined || input.round === null ? null : Number(input.round);
    if (round === null || !Number.isInteger(round) || round < 1) {
      const latest = await env.DB.prepare(
        "SELECT round FROM review_rounds WHERE target_type = 'article' AND target_id = ? ORDER BY round DESC, id DESC LIMIT 1",
      ).bind(slug).first<{ round: number }>();
      if (!latest) return null;
      round = Number(latest.round);
    }

    const roundRow = await env.DB.prepare(
      "SELECT feedback_json AS feedbackJson, handoff_pick AS handoffPick FROM review_rounds WHERE target_type = 'article' AND target_id = ? AND round = ?",
    ).bind(slug, round).first<{ feedbackJson: string | null; handoffPick: string | null }>();
    if (!roundRow) return null;
    let feedbackJson: unknown;
    try {
      feedbackJson = JSON.parse(String(roundRow.feedbackJson ?? ""));
    } catch {
      throw new Error("审稿反馈数据损坏");
    }
    const feedback = toFeedbackForNotify(feedbackJson, round);

    const article = await env.DB.prepare("SELECT title, status, meta_json AS metaJson FROM articles WHERE slug = ?")
      .bind(slug).first<{ title: string | null; status: string | null; metaJson: string | null }>();
    if (!article) return null;

    const payload = buildReviewNotifyPayload({
      feedback,
      article: {
        slug,
        title: article.title ?? null,
        status: article.status ?? null,
        metaJson: article.metaJson ?? null,
      },
      origin: input.origin,
      eventId: crypto.randomUUID(),
      sentAt: shanghaiIso(),
      picked: roundRow.handoffPick ?? null,
    });

    const sent = await sendAssistantEvent(env, "article.review_submitted", payload, {
      ref: `${slug}#${round}`,
    });

    // 写回 notify_* 列（notify_handoff = handoff 判定的接手人）；写库失败不吞掉发送结果。
    const handoffName = suggestHandoff(feedback.verdict, feedback.overallComment, feedback.marks, roundRow.handoffPick).assistant;
    try {
      await env.DB.prepare(
        "UPDATE review_rounds SET notify_state = ?, notify_http_status = ?, notify_error = ?, notify_at = ?, notify_handoff = ? WHERE target_type = 'article' AND target_id = ? AND round = ?",
      ).bind(sent.state, sent.httpStatus ?? null, sent.error ?? null, sent.at, handoffName, slug, round).run();
    } catch {
      // 写回失败只影响页面展示，不影响通知本身的结果。
    }

    const result: ReviewNotifyResult = { state: sent.state, at: sent.at, handoff: handoffName };
    if (sent.httpStatus !== undefined) result.httpStatus = sent.httpStatus;
    if (sent.error) result.error = sent.error;
    return result;
  } catch (error) {
    return { state: "failed", error: shortError(error), at: new Date().toISOString() };
  }
}
