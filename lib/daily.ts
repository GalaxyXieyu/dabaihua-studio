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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

/** 保留 `digits` 位小数（去掉无意义的 `.0`），整数部分加千分位。 */
export function formatNumber(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  let fixed = value.toFixed(digits);
  if (digits > 0) fixed = fixed.replace(/\.0+$/, "");
  const negative = fixed.startsWith("-");
  const body = negative ? fixed.slice(1) : fixed;
  const [intPart, decPart] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${decPart ? `.${decPart}` : ""}`;
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

/** 去掉 Markdown 记号后的纯文本，供预览和折叠判断使用。 */
export function markdownPlainText(markdown: string | null | undefined): string {
  return String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[\s>]*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** 取 Markdown 正文的第一句，作为折叠条目的预览。 */
export function firstSentence(markdown: string): string {
  const text = markdownPlainText(markdown);
  if (!text) return "";
  const sentences = splitSentences(text);
  return sentences.length > 0 ? sentences[0].text : text;
}

const CN_PUNCT = "，。；：、！？…—·「」『』（）《》〈〉【】“”‘’";

function isCjkChar(ch: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
}

function isWordChar(ch: string): boolean {
  return /[0-9A-Za-z_-]/.test(ch);
}

/** 这个位置能不能当预览截断点：空格、中文标点或中文字符边界，不能落在单词/路径/数字中间。 */
function canBreakPreview(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
  const prev = text[index - 1];
  const next = text[index];
  if (/\s/.test(prev) || /\s/.test(next)) return true;
  // 千分位、小数点、时间里的冒号都不是边界，避免把 11,342 / 23:33 截成两半。
  if (/[,.:：]/.test(prev) && /\d/.test(next) && index >= 2 && /\d/.test(text[index - 2])) return false;
  if (isCjkChar(prev) || isCjkChar(next)) return true;
  if (CN_PUNCT.includes(prev) || CN_PUNCT.includes(next)) return true;
  if (prev === "/" || next === "/" || prev === "／" || next === "／") return true;
  // 两边都是英文/数字/下划线，说明截在单词或路径中间。
  if (isWordChar(prev) && isWordChar(next)) return false;
  return true;
}

/**
 * 折叠条目的预览：正文前约 `limit` 个字，回退到最近的空格、中文标点或中文字符边界，
 * 尽量让预览落在 30–44 字之间，避免把英文单词、路径或数字截成两半。
 */
export function previewText(markdown: string | null | undefined, limit = 40): string {
  const text = markdownPlainText(markdown);
  if (text.length <= limit) return text;
  let cut = limit;
  for (let index = limit; index >= 1; index -= 1) {
    if (canBreakPreview(text, index)) {
      cut = index;
      break;
    }
  }
  // 回退太多（长单词/长路径）时，再往后找一个更接近 40 字的边界。
  if (cut < Math.min(30, limit)) {
    for (let index = limit + 1; index <= Math.min(limit + 4, text.length); index += 1) {
      if (canBreakPreview(text, index)) {
        cut = index;
        break;
      }
    }
  }
  return `${text.slice(0, cut).trimEnd()}…`;
}

/** 正文不足 60 字就不折叠，直接铺开显示。 */
export const FOLD_MIN_LENGTH = 60;

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

function dayOrdinal(date: string): number {
  const parts = dateParts(date);
  if (!parts) return Number.NaN;
  return Date.UTC(parts.year, parts.month - 1, parts.day) / MS_PER_DAY;
}

/** 补到 7 天以上的连续窗口；日报不足 7 天时由 `trendPoints` 直接只画有日报的那几天。 */
export function trendWindowLength(days: DailyDay[], selected: string, limit = 30, min = 7): number {
  const dates = days.map((day) => day.date).filter((date) => dateParts(date));
  if (dates.length === 0) return min;
  const earliest = dates.reduce((minDate, date) => (date < minDate ? date : minDate), dates[0]);
  const span = dayOrdinal(selected) - dayOrdinal(earliest) + 1;
  if (!Number.isFinite(span) || span < 1) return min;
  return Math.max(min, Math.min(limit, span));
}

/** 到选中日为止的日报少到不足以画出连续窗口（不足 7 天）。 */
export const TREND_SPARSE_THRESHOLD = 7;

/**
 * 以选中日为右端点的趋势点：
 * - 日报不足 7 天：只画有日报的那几天，不铺空白日期位；
 * - 够 7 天：从第一份日报起补成连续窗口（缺日报的日子提交为 0、token 为 null），最多 `limit` 天。
 */
export function trendPoints(days: DailyDay[], selected: string, limit = 30): DailyTrendPoint[] {
  const dated = days.filter((day) => dateParts(day.date));
  const visible = dated.filter((day) => day.date <= selected);
  if (visible.length === 0) return [];
  if (visible.length < TREND_SPARSE_THRESHOLD) {
    return visible.map((day) => ({
      date: day.date,
      label: formatMonthDay(day.date),
      commits: Number(day.commits || 0),
      tokensM: day.tokensM,
    }));
  }
  const byDate = new Map(dated.map((day) => [day.date, day]));
  const length = trendWindowLength(dated, selected, limit);
  const points: DailyTrendPoint[] = [];
  for (let offset = length - 1; offset >= 0; offset -= 1) {
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

/** 一周的日历格（含前导空位），用于手机端整行收起没有日报的空周。 */
export type CalendarWeek = {
  index: number;
  cells: Array<MonthCell | null>;
  hasReport: boolean;
  isCurrent: boolean;
};

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

/**
 * 按周切分日历格。只有「含日报的周」或「选中日所在周」需要保留，
 * 手机端把其余整行空周收起，桌面端仍然显示完整月历。
 */
export function monthWeeks(days: DailyDay[], selected: string): CalendarWeek[] {
  const cells = monthCells(days, selected);
  const weeks: CalendarWeek[] = [];
  for (let index = 0; index < cells.length; index += 7) {
    const slice = cells.slice(index, index + 7);
    weeks.push({
      index: weeks.length,
      cells: slice,
      hasReport: slice.some((cell) => Boolean(cell?.day)),
      isCurrent: slice.some((cell) => cell?.date === selected),
    });
  }
  return weeks;
}

export type DailyResultCard = { value: string; unit: string; label: string };

/** 说明太长（多半带细分子列表）时退回普通列表，避免把卡片撑成一块大豆腐。 */
const RESULT_CARD_LABEL_MAX = 80;
const RESULT_UNIT = "百万|亿|万|千|[MKk]|%|个|项|行|次|份|条|天|小时|分钟|秒|元|美元|刀";
const RESULT_NUMBER = "[+\\-−]?\\d[\\d,]*(?:\\.\\d+)?";
/** 一对增减行数（+11,342 / −525）优先做成一张卡片。 */
const RESULT_PAIR_RE = new RegExp(`(${RESULT_NUMBER}\\s*[/／]\\s*${RESULT_NUMBER})\\s*(${RESULT_UNIT})?`);
const RESULT_SINGLE_RE = new RegExp(`([¥$€£]?${RESULT_NUMBER})\\s*(${RESULT_UNIT})?`);

/** 给每个数字串加千分位，其它字符（含 − 号、货币符号、斜杠）原样保留。 */
function groupThousands(text: string): string {
  return text.replace(/\d[\d,]*(?:\.\d+)?/g, (num) => {
    const [intPart, ...decParts] = num.replace(/,/g, "").split(".");
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decParts.length > 0 ? `${grouped}.${decParts.join(".")}` : grouped;
  });
}

/** 按顶层标点切句，括号里的逗号不当分隔符，避免把「（不是实际花费，截至 23:33）」拆碎。 */
function splitResultClauses(text: string): string[] {
  const opening = "（(【[《「『";
  const closing = "）)】]》」』";
  const clauses: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (opening.includes(ch)) depth += 1;
    else if (closing.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && "，。；;".includes(ch)) {
      clauses.push(text.slice(start, index));
      start = index + 1;
    } else if (depth === 0 && ch === "," && !(/\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? ""))) {
      // 英文逗号只在不是千分位时当分隔符。
      clauses.push(text.slice(start, index));
      start = index + 1;
    }
  }
  clauses.push(text.slice(start));
  return clauses.map((clause) => clause.trim()).filter(Boolean);
}

function cleanResultLabel(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
    .replace(/\s+([，。；：、）)】（(【])/g, "$1")
    .replace(/^[\s:：,，、;；。.]+/, "")
    .replace(/[\s:：,，、;；。.]+$/, "")
    .trim();
}

/** 从一句里抠出「数字（或增减行数对）+ 单位 + 短说明」；只有数字没有说明或太长的返回 null。 */
function resultStatFromClause(clause: string): { value: string; unit: string; label: string } | null {
  const pair = RESULT_PAIR_RE.exec(clause);
  const single = RESULT_SINGLE_RE.exec(clause);
  const match = pair && (!single || pair.index <= single.index) ? pair : single;
  if (!match) return null;
  const unit = match[2] || "";
  // 没有单位也不是货币的裸数字（日期、年份、编号）不做卡片。
  if (!unit && !/^[¥$€£]/.test(match[1])) return null;
  const before = clause.slice(0, match.index);
  const after = clause.slice(match.index + match[0].length);
  return { value: groupThousands(match[1]), unit, label: cleanResultLabel(`${before}${after}`) };
}

/**
 * 把「结果数字」那节拆成数字卡片：每条顶层条目按标点切句，凡是有「数字 + 单位 + 短说明」
 * 的都做一张小卡片（和顶部大数字重复也保留，因为口径不同）；说明超过 80 字、没有单位
 * 或没有说明的句子落到卡片下方的列表。nested 缩进通常是细分子列表，原样留在列表里。
 */
export function parseResultCards(markdown: string | null | undefined): { cards: DailyResultCard[]; rest: string } {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  type Item = { own: string; nested: string[]; raw: string[] };
  const items: Item[] = [];
  let current: Item | null = null;
  for (const line of lines) {
    const top = /^[-*+]\s+(.*)$/.exec(line);
    if (top) {
      current = { own: top[1].trim(), nested: [], raw: [line] };
      items.push(current);
      continue;
    }
    const nested = /^\s+[-*+]\s+(.*)$/.exec(line);
    if (nested && current) {
      current.nested.push(line);
      current.raw.push(line);
      continue;
    }
    if (line.trim()) {
      if (current) {
        current.nested.push(line);
        current.raw.push(line);
      } else {
        current = { own: line.trim(), nested: [], raw: [line] };
        items.push(current);
      }
    }
  }
  if (items.length === 0) return { cards: [], rest: markdown ?? "" };

  const cards: DailyResultCard[] = [];
  const restBlocks: string[][] = [];
  for (const item of items) {
    const itemCards: DailyResultCard[] = [];
    const leftovers: string[] = [];
    let prefix = "";
    for (const clause of splitResultClauses(item.own)) {
      const stat = resultStatFromClause(clause);
      if (!stat) {
        // 卡片之前的前缀先攒着，补到第一张卡片的说明里。
        if (itemCards.length === 0) prefix = prefix ? `${prefix}，${clause}` : clause;
        else leftovers.push(clause);
        continue;
      }
      const base = stat.label || (stat.unit === "行" ? "改动行" : "");
      const label = prefix && itemCards.length === 0 && base ? `${prefix} · ${base}` : base;
      if (!label || label.length > RESULT_CARD_LABEL_MAX) {
        leftovers.push(clause);
        continue;
      }
      itemCards.push({ value: stat.value, unit: stat.unit, label });
      if (prefix && itemCards.length === 1) prefix = "";
    }
    if (itemCards.length === 0) {
      restBlocks.push(item.raw);
      continue;
    }
    cards.push(...itemCards);
    const block: string[] = [];
    if (prefix) leftovers.unshift(prefix);
    if (leftovers.length > 0) block.push(`- ${leftovers.join("，")}`);
    block.push(...item.nested);
    if (block.length > 0) restBlocks.push(block);
  }
  return { cards, rest: restBlocks.map((block) => block.join("\n")).join("\n\n") };
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
