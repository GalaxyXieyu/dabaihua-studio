/**
 * article-status.ts — 文章状态 / 排版来源的中文标签（服务端与客户端共用，无 "use client"）
 */

const STATUS_LABELS: Record<string, string> = {
  drafting: "写作中",
  "changes-requested": "待修改",
  approved: "已通过",
  published: "已发布",
  edited: "已编辑",
  "draft-by-yu": "初稿",
  pending: "待审",
  rejected: "已打回",
};

export function statusLabelFor(status: string | null | undefined) {
  const key = String(status || "").trim();
  if (!key) return "未审";
  return STATUS_LABELS[key] || key;
}

export function htmlSourceLabel(source: string | null | undefined) {
  const key = String(source || "").trim();
  if (!key || key === "none") return "无排版";
  if (key === "article.html" || key === "publish_html") return key;
  if (key === "02-final.md" || key === "01-draft.md") return `markdown 回退（${key}）`;
  if (key === "draft_markdown") return "markdown 回退";
  return key;
}
