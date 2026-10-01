/**
 * 照照镜子页的纯数据类型与展示助手。数据来自 scripts/build-mirror.mjs 生成的
 * content/mirror/mirror.json（由 lib/mirror-data.ts 载入）。这里不引入任何
 * 运行时依赖，方便 node 的类型擦除测试直接 import。
 */

export type MirrorSource = { agent: string; date: string; ref: string };

export type MirrorHistoryItem = {
  version: number;
  title: string;
  body: string;
  status: string;
  reason: string;
  recordedAt: string;
  supersededBy: string;
};

export type MirrorEntry = {
  id: string;
  category: string;
  title: string;
  body: string;
  scope: string[];
  sources: MirrorSource[];
  status: string;
  confirmedBy: string;
  confirmedAt: string;
  supersedes: string[];
  supersededBy: string;
  reviewAfter: string;
  reason: string;
  addedBy: string;
  options: string[];
  owner: string;
  recordedAt: string;
  history: MirrorHistoryItem[];
};

export type MirrorStats = {
  entryCount: number;
  inboxCount: number;
  newThisMonth: number;
  supersededThisMonth: number;
  latestDate: string;
  monthLabel: string;
};

export type MirrorData = {
  generatedAt: string;
  entries: MirrorEntry[];
  inbox: MirrorEntry[];
  warnings?: Array<{ file: string; line: number; message: string }>;
};

export type MirrorScopeGroup = { scope: string; entries: MirrorEntry[] };

export const CATEGORY_ORDER = ["画像", "待调整", "偏好", "方法论", "决策", "复盘结论"];
export const PREFERENCE_SCOPES = ["沟通", "内容", "职业", "工作", "工作台"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isMirrorDate(value: string | null | undefined): boolean {
  return typeof value === "string" && DATE_RE.test(value);
}

function last(items: string[]): string {
  return items.length > 0 ? items[items.length - 1] : "";
}

/** 一条条目的最新日期：优先看版本写入日期，其次看来源日期。 */
export function entryDate(entry: MirrorEntry): string {
  const dates = [
    ...(entry.history || []).map((item) => item.recordedAt).filter(isMirrorDate),
    ...(entry.sources || []).map((item) => item.date).filter(isMirrorDate),
  ];
  return last(dates.sort());
}

export function monthOf(date: string): string {
  return isMirrorDate(date) ? date.slice(0, 7) : "";
}

/** `2026-10-01` → `2026 年 10 月 1 日`。 */
export function formatMirrorDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!match) return date || "";
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

/** 来源小字：`福伦 · 2026-10-01`，多条来源只显示第一条。 */
export function sourceLine(entry: MirrorEntry): string {
  const source = (entry.sources || [])[0];
  if (!source) return "";
  const parts = [source.agent, source.date].filter(Boolean);
  return parts.join(" · ");
}

export function entriesByCategory(entries: MirrorEntry[], category: string): MirrorEntry[] {
  return entries.filter((entry) => entry.category === category);
}

/** 「定过的事」：按日期倒序；给了 scope 就只留命中该范围的。 */
export function decisionEntries(entries: MirrorEntry[], scope?: string | null): MirrorEntry[] {
  let rows = entries.filter((entry) => entry.category === "决策");
  if (scope) rows = rows.filter((entry) => entry.scope.includes(scope));
  return rows.sort((a, b) => {
    const left = `${entryDate(b)} ${b.id}`;
    const right = `${entryDate(a)} ${a.id}`;
    return left.localeCompare(right);
  });
}

/** 决策里出现过的 scope，按固定顺序去重。 */
export function decisionScopes(entries: MirrorEntry[]): string[] {
  const present = new Set(entries.filter((entry) => entry.category === "决策").flatMap((entry) => entry.scope));
  return PREFERENCE_SCOPES.filter((scope) => present.has(scope));
}

/** 「我喜欢这样」：按 scope 分组；一条偏好属于多个 scope 时会在每组各出现一次。 */
export function preferenceGroups(entries: MirrorEntry[]): MirrorScopeGroup[] {
  const preferences = entries.filter((entry) => entry.category === "偏好");
  const groups: MirrorScopeGroup[] = [];
  for (const scope of PREFERENCE_SCOPES) {
    const items = preferences.filter((entry) => entry.scope.includes(scope));
    if (items.length > 0) groups.push({ scope, entries: items });
  }
  const general = preferences.filter((entry) => entry.scope.length === 0);
  if (general.length > 0) groups.push({ scope: "通用", entries: general });
  return groups;
}

/** 本月新增 / 推翻统计，按数据算。now 传入 build 时的时间，测试可固定。 */
export function computeStats(entries: MirrorEntry[], inbox: MirrorEntry[], now: Date = new Date()): MirrorStats {
  const monthLabel = Number.isNaN(now.getTime()) ? "" : now.toISOString().slice(0, 7);
  let newThisMonth = 0;
  let supersededThisMonth = 0;
  for (const entry of entries) {
    const firstDate = entry.history?.[0]?.recordedAt || entryDate(entry);
    if (monthLabel && monthOf(firstDate) === monthLabel) newThisMonth += 1;
    const latest = entry.history?.[entry.history.length - 1];
    if (entry.status === "已推翻" && monthLabel && monthOf(latest?.recordedAt || "") === monthLabel) supersededThisMonth += 1;
  }
  const dates = [...entries, ...inbox].map(entryDate).filter(isMirrorDate).sort();
  return {
    entryCount: entries.length,
    inboxCount: inbox.length,
    newThisMonth,
    supersededThisMonth,
    latestDate: last(dates),
    monthLabel,
  };
}
