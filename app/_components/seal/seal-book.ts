// 印谱式版面的纯计算（规范 v3-zhuan「印谱式版面」：balancedRows / 光学尺寸 / 中文数字）。
// 不依赖 React，node --test 可直接测；布局细节由 SealBookGrid / seal.css 消费。

import type { SealKind } from "./seal-tokens.ts";

/** 桌面 / 手机两种断点的印谱参数：每行枚数、最多显示枚数、格宽上限、印痕基准尺寸。 */
export const BOOK = {
  desktop: { perRow: 6, max: 12, cap: 124, imp: 56 },
  phone: { perRow: 3, max: 9, cap: 104, imp: 46 },
  /** 只有一枚时放大，像单页孤品 */
  singleScale: 1.35,
} as const;

/**
 * n 枚分成若干行（每行不超过 perRow）：行数 = ceil(n/perRow)，
 * 行与行最多差 1，多的行放上面。每行是否居中由 bookLayout 的半列网格负责。
 */
export function balancedRows(n: number, perRow: number): number[] {
  if (n <= 0 || perRow <= 0) return [];
  const rows = Math.ceil(n / perRow);
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

export type BookCell = {
  /** 1 起的行号 */
  row: number;
  /** 起始半列（1 起，跨 2 个半列） */
  col: number;
  /** 是否本行第一格（首格不画竖界栏） */
  first: boolean;
};

/**
 * 印位格布局：总列数 = 2 × 最长一行的枚数（半列网格），
 * r 枚的一行里第 j 格（j 从 0 起）从半列 (k - r) + 2j + 1 开始跨 2 列，
 * 所以每一行都整行居中；返回的 cells 按行优先顺序排列。
 */
export function bookLayout(n: number, perRow: number): { cols: number; cells: BookCell[] } {
  const rows = balancedRows(n, perRow);
  const longest = rows.length > 0 ? Math.max(...rows) : 0;
  const cells: BookCell[] = [];
  rows.forEach((r, i) => {
    for (let j = 0; j < r; j++) {
      cells.push({ row: i + 1, col: longest - r + 2 * j + 1, first: j === 0 });
    }
  });
  return { cols: 2 * longest, cells };
}

/** 光学尺寸补偿：同一格高内按视觉分量缩放；方章满白文再乘 .96 压暗分量。
 * 半通印不放大：本来就该比方章小一半（v3-zhuan 印谱 README）。 */
export function opticalScale(kind: SealKind): number {
  const OPTICAL: Record<SealKind, number> = {
    fang: 0.92 * 0.96,
    yuan: 1,
    hulu: 1.1,
    tuoyuan: 1,
    yinshou: 1.18,
  };
  return OPTICAL[kind];
}

const CN_DIGITS = "〇一二三四五六七八九";

/** 1–99 的中文数字（十、十一、二十、二十一…）；越界回退阿拉伯数字。 */
function cnNum(n: number): string {
  if (n <= 0) return CN_DIGITS[0];
  if (n < 10) return "一二三四五六七八九"[n - 1];
  if (n === 10) return "十";
  if (n < 20) return "十" + CN_DIGITS[n - 10];
  const tens = "一二三四五六七八九"[Math.floor(n / 10) - 1] + "十";
  const ones = n % 10;
  return ones === 0 ? tens : tens + CN_DIGITS[ones];
}

/** 近七日枚数的中文数字（「近七日 · 六枚」）。 */
export function cnCount(n: number): string {
  return n >= 0 && n < 100 ? cnNum(n) : String(n);
}

/** "2026-10-03" → 「十月三日」（月、日都用中文数字）。 */
export function cnDateText(isoDate: string): string {
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return isoDate;
  }
  return `${cnNum(month)}月${cnNum(day)}日`;
}

const EVENT_CAPTIONS: ReadonlyArray<readonly [prefix: string, caption: string]> = [
  ["git:", "提交"],
  ["read:", "阅读"],
  ["review:", "审稿"],
  ["mirror:", "照镜"],
];

/** 印位格的释文：按键前缀归类，认不出的都叫盖章。 */
export function eventCaption(key: string): string {
  for (const [prefix, caption] of EVENT_CAPTIONS) {
    if (key.startsWith(prefix)) return caption;
  }
  return "盖章";
}

/** 收起那一行的计数（规范 10.1 第 3 条）。kinds 是已盖（不含待盖）的近七日事件种类。
 *  0 枚 → 「近七日 · 还没有章」；只有一种章 → 「近七日 · 五枚」（cnCount）；
 *  两种及以上 → 按印文分类计数，固定顺序 事 习 力 日 收官，只写出现过的，阿拉伯数字：「事 3 · 习 1 · 日 2」。
 *  印文用规范 10.1 的简体（「习」），不是刻印用的 SEAL_GLYPHS（「習」）。 */
const FOLD_GLYPHS: ReadonlyArray<readonly [kind: SealKind, glyph: string]> = [
  ["fang", "事"],
  ["yuan", "习"],
  ["hulu", "力"],
  ["tuoyuan", "日"],
  ["yinshou", "收官"],
];

export function foldCountText(kinds: SealKind[]): string {
  if (kinds.length === 0) return "近七日 · 还没有章";
  const counts = new Map<SealKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  if (counts.size === 1) return `近七日 · ${cnCount(kinds.length)}枚`;
  const parts: string[] = [];
  for (const [k, glyph] of FOLD_GLYPHS) {
    const n = counts.get(k);
    if (n !== undefined) parts.push(`${glyph} ${n}`);
  }
  return parts.join(" · ");
}

/** 收起那一行的小印位名额（规范 10.1 第 2 条）：桌面 8 枚、手机 4 枚，
 *  "昨日"小印位占一个名额（昨日 + 7 枚 / 昨日 + 3 枚）。
 *  foldSlots(total, hasYday)：total 是近七日已盖事件总数，返回
 *  deskFrom（取最近桌面名额枚的 slice 起点）、phoneHideBefore（手机多渲染的
 *  前几枚用 data-m-hide 藏，是相对 slice(deskFrom) 之后 foldEvents 的下标，
 *  不是相对 total）、plusD / plusM（两边各写 "+N"，都按 total 算）。 */
export const FOLD_DESK_MAX = 8;
export const FOLD_PHONE_MAX = 4;

export function foldSlots(total: number, hasYday: boolean): {
  deskFrom: number;
  phoneHideBefore: number;
  plusD: number;
  plusM: number;
} {
  const deskSlots = Math.max(0, (hasYday ? FOLD_DESK_MAX - 1 : FOLD_DESK_MAX));
  const phoneSlots = Math.max(0, (hasYday ? FOLD_PHONE_MAX - 1 : FOLD_PHONE_MAX));
  // 桌面：取最近的 deskSlots 枚（多的在左边写 +N）
  const plusD = Math.max(0, total - deskSlots);
  const deskFrom = plusD;
  const shown = total - deskFrom;                          // 实际渲染的枚数
  const phoneHideBefore = Math.max(0, shown - phoneSlots); // foldEvents 下标
  const plusM = Math.max(0, total - phoneSlots);           // 手机 +N 仍按 total
  return { deskFrom, phoneHideBefore, plusD, plusM };
}
