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

/** 把 `YYYY-MM-DD` 往前/后推 `days` 天，返回新的日期字符串。 */
function shiftDate(date: string, days: number): string {
  const parts = dateParts(date);
  if (!parts) return date;
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

/**
 * 以选中日为右端点的固定 `limit` 天窗口。中间没有日报的日子补成 0 提交、
 * token 为 null，保证趋势图的 x 轴永远是连续的 30 格。
 */
export function trendPoints(days: DailyDay[], selected: string, limit = 30): DailyTrendPoint[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const points: DailyTrendPoint[] = [];
  for (let offset = limit - 1; offset >= 0; offset -= 1) {
    const date = shiftDate(selected, -offset);
    const day = byDate.get(date);
    points.push({
      date,
      label: formatMonthDay(date),
      commits: Number(day?.commits || 0),
      tokensM: day ? day.tokensM : null,
    });
  }
  return points;
}

export type MonthCell = { date: string; day: DailyDay | null };

/** 选定日期所在月份的日历格（周一开头）：前导空格用 null，其它日期始终带日期。 */
export function monthCells(days: DailyDay[], selected: string): Array<MonthCell | null> {
  const parts = dateParts(selected);
  if (!parts) return [];
  const byDate = new Map(days.map((day) => [day.date, day]));
  const first = new Date(Date.UTC(parts.year, parts.month - 1, 1));
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // 周一 = 0
  const cells: Array<MonthCell | null> = new Array(offset).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date: key, day: byDate.get(key) || null });
  }
  return cells;
}

export type DailyResultCard = { value: string; unit: string; label: string };

const RESULT_NUMBER_RE = /([+\-−]?\d[\d,]*(?:\.\d+)?)\s*(百万|亿|万|M|K|k|%|个|项|行|次|份|天|小时|分钟|秒)?/;

/**
 * 把「结果数字」那节的列表拆成数字卡片：每条顶层条目取第一个数字做大字，
 * 剩余文本做说明；解析不出数字的条目原样落到 `rest` 里以列表兜底。
 */
export function parseResultCards(markdown: string | null | undefined): { cards: DailyResultCard[]; rest: string } {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const entries: Array<{ top: string; nested: string[] }> = [];
  let current: { top: string; nested: string[] } | null = null;
  for (const line of lines) {
    const top = /^[-*+]\s+(.*)$/.exec(line);
    if (top) {
      current = { top: top[1].trim(), nested: [] };
      entries.push(current);
      continue;
    }
    const nested = /^\s+[-*+]\s+(.*)$/.exec(line);
    if (nested && current) {
      current.nested.push(nested[1].trim());
      continue;
    }
    if (current && line.trim()) current.nested.push(line.trim());
  }
  if (entries.length === 0) return { cards: [], rest: markdown ?? "" };

  const cards: DailyResultCard[] = [];
  const rest: string[] = [];
  for (const entry of entries) {
    const match = RESULT_NUMBER_RE.exec(entry.top);
    if (!match) {
      rest.push(`- ${entry.top}`);
      for (const nested of entry.nested) rest.push(`  - ${nested}`);
      continue;
    }
    const value = match[1].replace(/−/g, "-");
    const unit = match[2] || "";
    const before = entry.top.slice(0, match.index);
    const after = entry.top.slice(match.index + match[0].length);
    const head = `${before}${after}`.replace(/[\s:：,，、;；]+$/g, "").replace(/\s{2,}/g, " ").trim();
    const detail = head || entry.top;
    const label = entry.nested.length > 0 ? `${detail} · ${entry.nested.join(" · ")}` : detail;
    cards.push({ value, unit, label });
  }
  return { cards, rest: rest.join("\n") };
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
