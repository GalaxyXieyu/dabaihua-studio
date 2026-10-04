// 印章 IP 设计令牌。数值真源是 /workspace/design/ip/spec/demo/index.html 的 T 常量，
// 规范见 /workspace/design/ip/spec/seal-spec.md 第 6、7 节。
// 同步副本写在 /workspace/design/motion/tokens.json（规范 11.1）。

export const SEAL_KINDS = ["fang", "yuan", "hulu", "tuoyuan", "yinshou"] as const;
export type SealKind = (typeof SEAL_KINDS)[number];

export type SealPose = "idle" | "pending" | "stamping" | "stamped" | "rest" | "offline";

export const SEAL_NAMES: Record<SealKind, string> = {
  fang: "方章",
  yuan: "圆章",
  hulu: "葫芦章",
  tuoyuan: "小椭圆章",
  yinshou: "长条引首章",
};

// 缓动曲线（规范 7.1 / 动效计划）
export const EASE = {
  wake: "cubic-bezier(.34,1.3,.64,1)",
  stamp: "cubic-bezier(.5,0,1,.6)",
  impact: "cubic-bezier(.2,1.6,.4,1)",
  lift: "cubic-bezier(.22,1,.36,1)",
  imp: "cubic-bezier(.25,.8,.3,1)",
  breathe: "cubic-bezier(.45,0,.55,1)",
  out: "cubic-bezier(.23,1,.32,1)",
  fade: "cubic-bezier(.4,0,.2,1)",
  dry: "cubic-bezier(.4,0,.8,.4)",
} as const;

// 盖章时间线基准时长（ms，64px 画布；各章按 FACTOR 缩放，取整到毫秒）
export const BASE = { wake: 220, stamp: 110, impact: 90, hold: 30, lift: 170, impOffset: 40, imp: 140 } as const;

// 各章时间系数：方/圆/葫芦 1，小椭圆 0.78，引首 1.45（规范 7.2）
export const FACTOR: Record<SealKind, number> = { fang: 1, yuan: 1, hulu: 1, tuoyuan: 0.78, yinshou: 1.45 };

// 连续天数四档（规范 6.4）：y 是 64px 画布上压下终点的 translateY，s 是压扁最低 scale，hold 是按住时长
export const TIERS = [
  { y: 2, s: 0.95, hold: 30 },
  { y: 2.5, s: 0.94, hold: 50 },
  { y: 3, s: 0.93, hold: 70 },
  { y: 3.5, s: 0.92, hold: 90 },
] as const;

// 补盖队列（规范 7.4）：章与章的间隔、最多播几个、超出的淡入时长
export const QUEUE = { gap: 260, maxAnimated: 5, fadeIn: 120, swap: 120 } as const;

// 单件完成（规范 6.1）：洇开 + 点头
export const SINGLE = { spreadDuration: 320, spreadScale: 1.04, spreadOpacity: 0.22, nodDelay: 80, nodDuration: 360, nodDeg: 4, nodPeak: 0.45 } as const;

// 一天收工（规范 6.2）：印条滑入与鞠躬
export const WRAP = { delay: 400, slide: 360, stagger: 40, beforeBow: 200, bowDown: 240, bowHold: 320, bowUp: 300, bowDeg: 10, stripMax: 8 } as const;

// 回来了（规范 6.6）：快速补盖 + 迎接
export const BACK = { days: 3, speed: 0.6, gap: 120, after: 300, jumpUp: 180, jumpDown: 220, land: 120, tilt: 200, tiltHold: 600, tiltBack: 300, jumpPx: 6, tiltDeg: 6 } as const;

// 昨日回放（规范 6.7）：纸、落印、日期章、收进栏
export const REPLAY = {
  sheetIn: 240, after: 60, drop: 240, maxStagger: 220, dropBudget: 1500, maxMarks: 8, beforeDate: 160, hold: 600, dock: 360,
  rot: [-2, 1.5, -1, 2, -1.5, 1, -2.5, 1.2], sheetW: 400, sheetH: 190, markSize: 32, dateSize: 72, dropFrom: 18, dropScale: 1.12,
} as const;

// 呼吸（规范 5 / 6.5）：打盹 3400ms，休息 4800ms
export const BREATH = { idle: { period: 3400, amp: 1.5, scale: 1.012 }, rest: { period: 4800, amp: 1, scale: 1.008 } } as const;

// 静态姿态（规范 5 / 2.2）
export const POSE = { idleDeg: -7, restDeg: -4, restScaleY: 0.97, eyeHalf: 0.35, eyeClosed: 0.2 } as const;

// localStorage 保留策略（规范 8.6）
export const SEEN_DAYS = 60;       // seen 只留最近 60 天的带日期键
export const SEEN_MAX_UNDATED = 2000; // 不带日期的键（read:/review:/mirror:）最多留 2000 个，超出丢最旧的
export const STAMPLOG_DAYS = 2;    // stampLog 只留今天和昨天
export const DRY_OPACITY = 0.3;    // 断更干印的不透明度（动效计划 5.2）

/** 线宽随尺寸（规范第 3 节）：≤32 用 2，≥96 用 1，其余 1.5 */
export function strokeFor(size: number): number {
  if (size <= 32) return 2;
  if (size >= 96) return 1;
  return 1.5;
}

/** 印痕不透明度随连续天数（动效计划 5.2）：clamp(0.30 + 0.70 × (1 − e^(−streak/5.5)), 0.30, 1)；streak<=0 返回 DRY_OPACITY */
export function streakOpacity(streak: number): number {
  if (streak <= 0) return DRY_OPACITY;
  return Math.min(1, Math.max(DRY_OPACITY, DRY_OPACITY + 0.7 * (1 - Math.exp(-streak / 5.5))));
}

/** 连续天数分档（规范 6.4）：>=14 第 3 档，>=7 第 2 档，>=3 第 1 档，否则第 0 档 */
export function tierOf(streak: number): 0 | 1 | 2 | 3 {
  if (streak >= 14) return 3;
  if (streak >= 7) return 2;
  if (streak >= 3) return 1;
  return 0;
}
