// Pure helpers for the server-rendered "今天" page.
//
// This module intentionally imports nothing and only uses erasable TypeScript
// syntax so Node's type-stripping test runner can load it directly.

/** Calendar date (`YYYY-MM-DD`) in Asia/Shanghai (UTC+8, no DST). */
export function shanghaiDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * ISO-8601 week (`YYYY-Www`) for a `YYYY-MM-DD` date string. Weeks start on
 * Monday and week 1 is the week containing the first Thursday of the year, so
 * dates around the new year can belong to the neighbouring year's week.
 */
export function isoWeekOf(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7; // Monday = 1 .. Sunday = 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The `topics.reason` marker scripts/daily-ai-digest.mjs writes for one day. */
export function digestReason(dateStr: string): string {
  return `daily-ai-digest:${dateStr}`;
}

/** A topic draft is pending review when it has content and no decision yet. */
export function isPendingTopicDraft(row: { draftMarkdown?: string | null; reviewStatus?: string | null }): boolean {
  const draft = (row.draftMarkdown ?? "").trim();
  if (!draft) return false;
  const status = (row.reviewStatus ?? "").trim();
  return status === "" || status === "pending";
}

/** An article is pending review unless it already has a final verdict. */
export function isPendingArticle(status: string | null | undefined): boolean {
  return status !== "approved" && status !== "published" && status !== "changes-requested";
}

/** One-line missing-number row, mirroring the wording on /career. */
export function missingLine(item: { display_title: string | null; skills: string[]; metric: string; unit: string }): string {
  const title = item.display_title
    ? item.display_title
    : item.skills.length > 0
      ? `未公开标题的成果（技能：${item.skills.join("、")}）`
      : "未公开标题的成果";
  return `${title}：缺「${item.metric}」，单位 ${item.unit}`;
}
