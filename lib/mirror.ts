/**
 * 照照镜子页的纯数据类型与展示助手。数据来自 D1 cards / card_revisions
 * （lib/cards.ts 读取），cardsToMirrorEntries 负责把卡片转成页面形状。
 * 这里不引入运行时依赖，方便 node 的类型擦除测试直接 import。
 */

import { revisionSummary, shanghaiDate, type Card, type CardRevision } from "./cards-core.ts";

export type MirrorSource = { agent: string; date: string; ref: string };

export type MirrorHistoryItem = {
  version: number;
  action: string;
  actor: string;
  summary: string;
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
  decidedAt: string;
  supersedes: string[];
  supersededBy: string;
  reviewAfter: string;
  reason: string;
  addedBy: string;
  options: string[];
  owner: string;
  recordedAt: string;
  version: number;
  deletedAt: string;
  deletedBy: string;
  deleteReason: string;
  history: MirrorHistoryItem[];
};

/** 卡片 API 形状 → 页面条目；historyById 支持 Map（服务端）或普通对象（客户端 props）。 */
export function cardsToMirrorEntries(
  cards: Card[],
  historyById: Map<string, CardRevision[]> | Record<string, CardRevision[]>,
): MirrorEntry[] {
  const lookup = (id: string): CardRevision[] => {
    if (historyById instanceof Map) return historyById.get(id) || [];
    return historyById[id] || [];
  };
  return cards.map((card) => ({
    id: card.id,
    category: card.category,
    title: card.title,
    body: card.body,
    scope: card.scope || [],
    sources: card.sources || [],
    status: card.status,
    confirmedBy: card.confirmed_by || "",
    confirmedAt: card.confirmed_at || "",
    decidedAt: card.confirmed_at || "",
    supersedes: card.supersedes || [],
    supersededBy: card.superseded_by || "",
    reviewAfter: card.review_after || "",
    reason: card.reason || "",
    addedBy: card.added_by || "",
    options: card.options || [],
    owner: card.owner || "",
    recordedAt: card.recorded_at || "",
    version: card.version,
    deletedAt: card.deleted_at || "",
    deletedBy: card.deleted_by || "",
    deleteReason: card.delete_reason || "",
    history: lookup(card.id).map((revision) => ({
      version: revision.version,
      action: revision.action,
      actor: revision.actor,
      summary: revisionSummary(revision),
      title: revision.snapshot.title,
      body: revision.snapshot.body,
      status: revision.snapshot.status,
      reason: revision.reason || "",
      // 上海日期：快照里的 recorded_at 优先，没有再从 created_at 换算。
      recordedAt: revision.snapshot.recorded_at || (revision.created_at ? shanghaiDate(new Date(revision.created_at)) : ""),
      supersededBy: revision.snapshot.superseded_by || "",
    })),
  }));
}

/** 进过正本且没被删除：正本 tab 的成员。 */
export function isMirrorCanonical(entry: MirrorEntry): boolean {
  return entry.deletedAt === "" && entry.status !== "待确认" && entry.confirmedAt !== "";
}

/** 收件箱（等你确认）：待确认且未删除。 */
export function isMirrorInbox(entry: MirrorEntry): boolean {
  return entry.deletedAt === "" && entry.status === "待确认";
}

/** 最近删除：只要 deleted_at 非空，不论状态。 */
export function isMirrorDeleted(entry: MirrorEntry): boolean {
  return entry.deletedAt !== "";
}

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

/** 摘要里固定展示的类别顺序（复盘等为空也占一个数字，显示 0）。 */
export const SUMMARY_CATEGORIES = ["画像", "偏好", "方法论", "决策", "复盘结论", "待调整"];
export type CategoryCount = { category: string; count: number };

export type MirrorMonthPoint = { month: string; label: string; added: number; superseded: number };

export const CATEGORY_ORDER = ["画像", "待调整", "偏好", "方法论", "决策", "复盘结论"];
export const PREFERENCE_SCOPES = ["沟通", "内容", "职业", "工作", "工作台"];

/** 页面上的一排类型标签：计数本身就是标签，点了切换下面一类的卡片带。 */
export type MirrorTabDef = {
  key: string;
  label: string;
  category: string;
  inbox?: boolean;
};

export const MIRROR_TABS: MirrorTabDef[] = [
  { key: "profile", label: "画像", category: "画像" },
  { key: "preference", label: "偏好", category: "偏好" },
  { key: "method", label: "方法论", category: "方法论" },
  { key: "decision", label: "决策", category: "决策" },
  { key: "adjustment", label: "正在调整", category: "待调整" },
  { key: "inbox", label: "等你确认", category: "", inbox: true },
];

export const DEFAULT_MIRROR_TAB = MIRROR_TABS[0].key;

export type MirrorTabCount = { key: string; label: string; count: number };

/** 某个 ?tab= 解析成标签定义；未知或缺省都回到画像。 */
export function resolveMirrorTab(key?: string | null): MirrorTabDef {
  return MIRROR_TABS.find((tab) => tab.key === key) ?? MIRROR_TABS[0];
}

/** 类别名反查标签 key，用来做「取代」跨 tab 链接。 */
export function tabKeyForCategory(category: string): string {
  return MIRROR_TABS.find((tab) => !tab.inbox && tab.category === category)?.key ?? "";
}

/** 当前标签下要展示的条目：收件箱单独一类，其余按类别取。 */
export function entriesForTab(entries: MirrorEntry[], inbox: MirrorEntry[], tab: MirrorTabDef): MirrorEntry[] {
  return tab.inbox ? inbox : entries.filter((entry) => entry.category === tab.category);
}

/** 每个标签的条数，顺序与 MIRROR_TABS 一致。 */
export function mirrorTabCounts(entries: MirrorEntry[], inbox: MirrorEntry[]): MirrorTabCount[] {
  return MIRROR_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    count: tab.inbox ? inbox.length : entries.filter((entry) => entry.category === tab.category).length,
  }));
}

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

/**
 * 条目自己的日期：优先第一条来源日期，其次显式决策日期，最后才是版本写入日期。
 * 时间线和趋势都用它，避免同一批条目因为构建时间统一显示成写入日期。
 */
export function entryOwnDate(entry: MirrorEntry): string {
  const source = (entry.sources || [])[0]?.date;
  if (isMirrorDate(source)) return source;
  if (isMirrorDate(entry.decidedAt)) return entry.decidedAt;
  const recorded = entry.history?.[0]?.recordedAt;
  if (isMirrorDate(recorded)) return recorded;
  return entryDate(entry);
}

/** `2026-10-01` → `2026 年 10 月 1 日`。 */
export function formatMirrorDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  if (!match) return date || "";
  return `${Number(match[1])} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

/** `2026-10-01` → `10-01`；元信息里统一用短日期。 */
export function formatShortDate(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date || "");
  if (!match) return date || "";
  return `${match[1]}-${match[2]}`;
}

/** 来源小字：`福伦 · 10-01`，多条来源只显示第一条。 */
export function sourceLine(entry: MirrorEntry): string {
  const source = (entry.sources || [])[0];
  if (!source) return "";
  const parts = [source.agent, formatShortDate(source.date)].filter(Boolean);
  return parts.join(" · ");
}

/** 只取来源里的作者，用在已经有独立日期列的地方，避免日期重复出现。 */
export function sourceAgent(entry: MirrorEntry): string {
  return (entry.sources || [])[0]?.agent || "";
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

/**
 * 「我喜欢这样」：每条偏好只归到它的第一个 scope 下，避免多 scope 的条目重复出现；
 * 其它 scope 由页面作为小标签展示。没有 scope 的进「通用」。
 */
export function preferenceGroups(entries: MirrorEntry[]): MirrorScopeGroup[] {
  const preferences = entries.filter((entry) => entry.category === "偏好");
  const buckets = new Map<string, MirrorEntry[]>();
  for (const entry of preferences) {
    const key = entry.scope[0] || "通用";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(entry);
    else buckets.set(key, [entry]);
  }
  const known = PREFERENCE_SCOPES.filter((scope) => buckets.has(scope));
  const extra = [...buckets.keys()].filter((scope) => scope !== "通用" && !PREFERENCE_SCOPES.includes(scope)).sort();
  const general = buckets.has("通用") ? ["通用"] : [];
  return [...known, ...extra, ...general].map((scope) => ({
    scope,
    entries: buckets.get(scope) as MirrorEntry[],
  }));
}

/** 摘要用的类别条数，固定顺序、缺的补 0。 */
export function categoryCounts(entries: MirrorEntry[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  return SUMMARY_CATEGORIES.map((category) => ({ category, count: counts.get(category) ?? 0 }));
}

/** 按月统计新增（按条目自己的日期）和推翻（按最新版本的写入日期）。 */
export function monthlyTrend(entries: MirrorEntry[]): MirrorMonthPoint[] {
  const buckets = new Map<string, { added: number; superseded: number }>();
  const bucketOf = (month: string) => {
    let bucket = buckets.get(month);
    if (!bucket) {
      bucket = { added: 0, superseded: 0 };
      buckets.set(month, bucket);
    }
    return bucket;
  };
  for (const entry of entries) {
    const addedMonth = monthOf(entryOwnDate(entry));
    if (addedMonth) bucketOf(addedMonth).added += 1;
    if (entry.status === "已推翻") {
      const latest = entry.history?.[entry.history.length - 1];
      const supersededMonth = monthOf(latest?.recordedAt || "");
      if (supersededMonth) bucketOf(supersededMonth).superseded += 1;
    }
  }
  return [...buckets.keys()].sort().map((month) => ({
    month,
    label: `${Number(month.slice(5, 7))} 月`,
    added: buckets.get(month)?.added ?? 0,
    superseded: buckets.get(month)?.superseded ?? 0,
  }));
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
