/**
 * 日报页的纯数据类型与展示助手。数据来自 scripts/build-daily.mjs 生成的
 * content/daily/daily.json（由 lib/daily-data.ts 载入）。这里不引入任何
 * 运行时依赖，方便 node 的类型擦除测试直接 import。
 */

import { splitSentences } from "./sentences.ts";

export type DailyRepoStat = {
  repo: string;
  commits: number;
  additions: number;
  deletions: number;
};

export type DailyWhatEntry = { title: string; body: string };

export type DailySections = {
  overview: string | null;
  what: DailyWhatEntry[];
  blockers: string | null;
  results: string | null;
  leading: string | null;
  unfinished: string | null;
};

export type DailyDay = {
  date: string;
  weekday: string;
  summary: string;
  commits: number | null;
  repos: string[];
  tokensM: number | null;
  sections: DailySections;
  repoStats: DailyRepoStat[];
};

export type DailyData = { generatedAt: string; days: DailyDay[] };

const WEEKDAYS = "日一二三四五六";

export function dateParts(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** `2026-09-30` → `周三`（仅在日报 front matter 缺 weekday 时兜底）。 */
export function weekdayOf(date: string): string {
  const parts = dateParts(date);
  if (!parts) return "";
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return `周${WEEKDAYS[value.getUTCDay()]}`;
}

/** `2026-09-30` → `9 月 30 日`。 */
export function formatMonthDay(date: string): string {
  const parts = dateParts(date);
  if (!parts) return date;
  return `${parts.month} 月 ${parts.day} 日`;
}

/** `2026-09-30` → `2026 年 9 月 30 日`。 */
export function formatFullDate(date: string): string {
  const parts = dateParts(date);
  if (!parts) return date;
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日`;
}

/** 保留一位小数，去掉无意义的 `.0`。 */
export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  const fixed = value.toFixed(digits);
  return digits > 0 ? fixed.replace(/\.0+$/, "") : fixed;
}

export function formatSigned(value: number, digits = 0): string {
  const text = formatNumber(Math.abs(value), digits);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : "0";
}

export type DailyDelta = { text: string; direction: "up" | "down" | "flat" };

/** 和前一天比的小差值；任一侧缺数据就不显示。 */
export function compareToPrevious(current: number | null, previous: number | null | undefined, digits = 0): DailyDelta | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 10 ** -digits / 2) return { text: "持平", direction: "flat" };
  return {
    text: `${diff > 0 ? "↑" : "↓"}${formatNumber(Math.abs(diff), digits)}`,
    direction: diff > 0 ? "up" : "down",
  };
}

/** 取 Markdown 正文的第一句，作为折叠条目的预览。 */
export function firstSentence(markdown: string): string {
  const text = String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[\s>]*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const sentences = splitSentences(text);
  return sentences.length > 0 ? sentences[0].text : text;
}

/** URL 里请求的日期若合法且存在就用它，否则回落到最新一天。 */
export function selectDay(days: DailyDay[], requested?: string | null): DailyDay | null {
  if (days.length === 0) return null;
  const wanted = requested && dateParts(requested) ? days.find((day) => day.date === requested) : null;
  return wanted || days[days.length - 1];
}

export type DailyTrendPoint = { date: string; label: string; commits: number; tokensM: number | null };

/** 以选中日为准，取最近 `limit` 条日报作为趋势图数据。 */
export function trendPoints(days: DailyDay[], selected: string, limit = 30): DailyTrendPoint[] {
  const end = days.findIndex((day) => day.date === selected);
  const slice = end >= 0 ? days.slice(0, end + 1) : days;
  return slice.slice(-limit).map((day) => ({
    date: day.date,
    label: formatMonthDay(day.date),
    commits: Number(day.commits || 0),
    tokensM: day.tokensM,
  }));
}

/** 选定日期所在月份的日历格（周一开头），空格用 null 占位。 */
export function monthCells(days: DailyDay[], selected: string): Array<DailyDay | null> {
  const parts = dateParts(selected);
  if (!parts) return [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  const first = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // 周一 = 0
  const cells: Array<DailyDay | null> = new Array(offset).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push(byDate.get(key) || null);
  }
  return cells;
}

/** 上/下一个月里最近一天有日报的日期，用于日历翻月。 */
export function nearestReportInMonth(days: DailyDay[], selected: string, offset: number): string | null {
  const parts = dateParts(selected);
  if (!parts) return null;
  const target = new Date(Date.UTC(parts.year, parts.month - 1 + offset, 1));
  const prefix = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-`;
  const matches = days.filter((day) => day.date.startsWith(prefix));
  if (matches.length === 0) return null;
  return offset < 0 ? matches[matches.length - 1].date : matches[0].date;
}
