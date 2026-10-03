/**
 * 「翻翻旧账」(/ledger) 的纯数据类型与展示助手。日 / 周 / 月三个视图共用。
 *
 * 日期一律是 `YYYY-MM-DD`（Asia/Shanghai），所有推算都在 UTC 上做，
 * 不碰运行环境的本地时区，服务端与客户端结果一致。
 * 模块只引入纯模块并带显式 `.ts` 后缀，方便 node 的类型擦除测试直接 import。
 */

import { dateParts, type DailyDay, type DailyRepoStat } from "./daily.ts";
import { splitSentences } from "./sentences.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 周一开头的星期表头，和日报月历一致。 */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/** `Date`（UTC）→ `YYYY-MM-DD`。 */
function formatDate(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

/** 把 `YYYY-MM-DD` 往前/后推 `days` 天。 */
export function shiftDate(date: string, days: number): string {
  const parts = dateParts(date);
  if (!parts) return date;
  return formatDate(new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)));
}

/**
 * ISO-8601 周（`YYYY-Www`）。周一为一周之首，含当年第一个周四的那周是第 1 周，
 * 所以跨年日期可能落到相邻年份的周里。
 */
export function isoWeekOf(dateStr: string): string {
  const parts = dateParts(dateStr);
  if (!parts) return "";
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = date.getUTCDay() || 7; // 周一 = 1 .. 周日 = 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weekParts(week: string): { year: number; number: number } | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  return { year: Number(match[1]), number: Number(match[2]) };
}

/** 某个 ISO 周的周一日期。 */
function weekMonday(week: string): Date | null {
  const parts = weekParts(week);
  if (!parts) return null;
  const jan4 = new Date(Date.UTC(parts.year, 0, 4));
  const weekday = jan4.getUTCDay() || 7; // 周一 = 1 .. 周日 = 7
  const week1Monday = new Date(jan4.getTime() - (weekday - 1) * MS_PER_DAY);
  return new Date(week1Monday.getTime() + (parts.number - 1) * 7 * MS_PER_DAY);
}

/** 某个 ISO 周的 7 天，周一到周日。 */
export function weekDates(week: string): string[] {
  const monday = weekMonday(week);
  if (!monday) return [];
  return Array.from({ length: 7 }, (_, index) => formatDate(new Date(monday.getTime() + index * MS_PER_DAY)));
}

/** 前后移动若干个 ISO 周。 */
export function shiftWeek(week: string, offset: number): string {
  const dates = weekDates(week);
  if (dates.length === 0) return week;
  return isoWeekOf(shiftDate(dates[0], offset * 7));
}

export function previousWeek(week: string): string {
  return shiftWeek(week, -1);
}

export function nextWeek(week: string): string {
  return shiftWeek(week, 1);
}

/** `2026-W40` → `2026 年第 40 周`。 */
export function formatWeekLabel(week: string): string {
  const parts = weekParts(week);
  if (!parts) return week;
  return `${parts.year} 年第 ${parts.number} 周`;
}

/** `YYYY-MM` 的解析。 */
export function monthParts(month: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** `2026-10-02` → `2026-10`。 */
export function monthOf(date: string): string {
  const parts = dateParts(date);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

/** 前后移动若干个自然月。 */
export function shiftMonth(month: string, offset: number): string {
  const parts = monthParts(month);
  if (!parts) return month;
  const date = new Date(Date.UTC(parts.year, parts.month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string): string {
  return shiftMonth(month, -1);
}

export function nextMonth(month: string): string {
  return shiftMonth(month, 1);
}

/** `2026-10` → `2026 年 10 月`。 */
export function formatMonthLabel(month: string): string {
  const parts = monthParts(month);
  if (!parts) return month;
  return `${parts.year} 年 ${parts.month} 月`;
}

/** 整个自然月的日期列表。 */
export function monthDates(month: string): string[] {
  const parts = monthParts(month);
  if (!parts) return [];
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

/** 月历格：周一开头，前后补 null；每个在月内的格子带日期和日号。 */
export type ReviewMonthCell = { date: string; dayNumber: number };

export function monthCalendar(month: string): Array<ReviewMonthCell | null> {
  const parts = monthParts(month);
  if (!parts) return [];
  const first = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // 周一 = 0
  const cells: Array<ReviewMonthCell | null> = new Array(offset).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: `${month}-${String(day).padStart(2, "0")}`, dayNumber: day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** 一周 / 一月的汇总数字。 */
export type ReviewTotals = {
  commits: number;
  tokensM: number;
  additions: number;
  deletions: number;
  repos: number;
  recordedDays: number;
  hasData: boolean;
};

/** 把若干天的日报汇总成一段时间（周或月）的总量。 */
export function aggregateDays(days: DailyDay[], dates: string[]): ReviewTotals {
  const wanted = new Set(dates);
  const repoSet = new Set<string>();
  let commits = 0;
  let tokensM = 0;
  let additions = 0;
  let deletions = 0;
  let recordedDays = 0;
  for (const day of days) {
    if (!wanted.has(day.date)) continue;
    recordedDays += 1;
    commits += Number(day.commits || 0);
    tokensM += Number(day.tokensM || 0);
    for (const repo of day.repos || []) repoSet.add(repo);
    for (const stat of day.repoStats || []) {
      repoSet.add(stat.repo);
      additions += Number(stat.additions || 0);
      deletions += Number(stat.deletions || 0);
    }
  }
  return { commits, tokensM, additions, deletions, repos: repoSet.size, recordedDays, hasData: recordedDays > 0 };
}

export function aggregateWeek(days: DailyDay[], week: string): ReviewTotals {
  return aggregateDays(days, weekDates(week));
}

export function aggregateMonth(days: DailyDay[], month: string): ReviewTotals {
  return aggregateDays(days, monthDates(month));
}

/** 一周内按仓库聚合，提交数降序。 */
export function aggregateRepos(days: DailyDay[], dates: string[]): DailyRepoStat[] {
  const wanted = new Set(dates);
  const byRepo = new Map<string, DailyRepoStat>();
  for (const day of days) {
    if (!wanted.has(day.date)) continue;
    for (const stat of day.repoStats || []) {
      const current = byRepo.get(stat.repo) ?? { repo: stat.repo, commits: 0, additions: 0, deletions: 0 };
      current.commits += Number(stat.commits || 0);
      current.additions += Number(stat.additions || 0);
      current.deletions += Number(stat.deletions || 0);
      byRepo.set(stat.repo, current);
    }
  }
  return [...byRepo.values()].sort((a, b) => b.commits - a.commits || a.repo.localeCompare(b.repo));
}

/**
 * 周 / 月视图的锚点日期：接受任意合法的 `YYYY-MM-DD`（那一天没有日报也要停在那一周 / 那一月），
 * 非法或缺省时回落到数据里最新的一天。日视图不走这里，必须吸附到有记录的一天。
 */
export function reviewAnchorDate(days: DailyDay[], requested?: string | null): string | null {
  if (days.length === 0) return null;
  return requested && dateParts(requested) ? requested : days[days.length - 1].date;
}

/** 目标 ISO 周是否有内容：有周记，或周内有任意一天的日报。 */
export function weekHasContent(week: string, days: DailyDay[], reportWeeks: string[]): boolean {
  if (reportWeeks.includes(week)) return true;
  return days.some((day) => isoWeekOf(day.date) === week);
}

/** 目标自然月是否有内容：有日报，或有周一落在这个月的周记。 */
export function monthHasContent(month: string, days: DailyDay[], reportWeeks: string[]): boolean {
  if (days.some((day) => monthOf(day.date) === month)) return true;
  return reportWeeks.some((week) => {
    const monday = weekDates(week)[0];
    return Boolean(monday) && monthOf(monday) === month;
  });
}

/**
 * 热力格深浅：0 = 没有记录，1–4 = 相对当月最大值递增。
 * 有记录但远小于峰值时至少是 1，保证「有 / 无」一眼可分。
 */
export function heatmapLevel(commits: number | null | undefined, max: number): 0 | 1 | 2 | 3 | 4 {
  const value = Number(commits || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const ceiling = Number(max) > 0 && Number.isFinite(Number(max)) ? Number(max) : value;
  return Math.min(4, Math.max(1, Math.ceil((value / ceiling) * 4))) as 1 | 2 | 3 | 4;
}

export type WeeklyTakeaway = { title: string; description: string };

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** 只解基础 HTML 实体（命名 + 十进制 / 十六进制数字）。 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (/^#x/i.test(entity)) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** 去标签、解实体、压空白。纯字符串处理，不建 DOM。 */
export function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagText(html: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html);
  return match ? stripTags(match[1]) : "";
}

/** 取标签属性值，双引号 / 单引号 / 无引号都认。 */
function attributeValue(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/** 取 `<meta name="description" content="...">` 的正文；没有就返回 null。 */
export function metaDescription(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = attributeValue(tag, "name");
    if (!name || name.toLowerCase() !== "description") continue;
    const content = attributeValue(tag, "content");
    if (content != null && content.trim() !== "") return stripTags(content);
  }
  return null;
}

/**
 * 从存储的周记 HTML 里提取「本周要点」：`<h1>`（退回 `<title>`）和 meta description。
 * description 只取前 `maxSentences` 句，原样保留（不重写、不补话术）；
 * 没有 description 时返回 null，页面就不渲染这一块。
 */
export function extractWeeklyTakeaway(html: string, maxSentences = 4): WeeklyTakeaway | null {
  const description = metaDescription(html);
  if (!description) return null;
  const title = tagText(html, "h1") || tagText(html, "title");
  const spans = splitSentences(description);
  const limited = spans.length > maxSentences ? description.slice(0, spans[maxSentences - 1].end) : description;
  return { title, description: limited };
}
