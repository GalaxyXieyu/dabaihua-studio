// 印章时间线状态机（纯函数，不引 React、不碰 DOM）。
// 把 demo（/workspace/design/ip/spec/demo/index.html）里 stamp()/bow()/M.back()/replay()/lineUp()
// 的时间和关键帧算成数据，后面的 DOM 播放器只照着播。所有位移单位是 px，已按 size/64 换算。
import { BACK, BASE, DRY_OPACITY, EASE, FACTOR, REPLAY, SINGLE, TIERS, WRAP } from "./seal-tokens.ts";
import { streakOpacity, tierOf } from "./seal-tokens.ts";
import type { SealKind } from "./seal-tokens.ts";

/** 一帧：offset 取 0–1，transform 是最终字符串，easing 是进入这一段的缓动 */
export type Frame = { offset: number; transform: string; easing?: string };

export type StampTimeline = {
  kind: SealKind;
  reduced: boolean;
  dry: boolean;
  total: number;                          // 角色动作总长（reduced 时 = 120）
  body: { frames: Frame[]; duration: number } | null; // reduced 时 null
  blink: { at: number; duration: 60 } | null;         // 命中时闭眼 60ms；reduced/dry 时 null
  pressBlur: { from: number; to: number } | null;     // 压下开始到松开开始给印面 blur(0.3px)；reduced 时 null
  dust: { at: number; duration: number; distance: number } | null; // 4 点飞溅；reduced/dry 时 null
  impression: { at: number; duration: number; easing: string; opacity: number; clip: boolean };
  // clip=true 表示用 clip-path circle 0%→75% 从中心推开
  spread: { at: number; duration: number; fromOpacity: number } | null; // 洇开；spread=false/reduced/dry 时 null
  nod: { at: number; duration: number; frames: Frame[] } | null;        // 只有 opts.nod=true 且非 reduced 时
  end: number;                           // 包括点头在内的总结束时刻（单件完成 = 1060）
};

export type StampOptions = {
  size?: number;
  streak?: number;
  speed?: number;
  reduced?: boolean;
  spread?: boolean;
  nod?: boolean;
  startTransform?: string;
};

/** px 数值格式化：保留两位小数再抹掉尾零 */
function px(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * 单次盖章时间线（规范第 7 节）。
 * f = FACTOR[kind] × speed；各段时长取整到毫秒后相加（规范 7.2）：
 * fang/yuan/hulu 第 0 档 620，tuoyuan 484，yinshou 901，fang 第 3 档 680。
 */
export function stampTimeline(kind: SealKind, opts?: StampOptions): StampTimeline {
  const size = opts?.size ?? 64;
  const streak = opts?.streak ?? 1;
  const speed = opts?.speed ?? 1;
  const reduced = opts?.reduced ?? false;
  const wantSpread = opts?.spread ?? true;
  const wantNod = opts?.nod ?? false;
  const startTransform = opts?.startTransform;
  const PX = size / 64;
  const dry = streak <= 0;
  const opacity = streakOpacity(streak);

  // reduced：只剩印痕 120ms 淡入，无任何位移帧（规范 7.5）
  if (reduced) {
    return {
      kind,
      reduced: true,
      dry,
      total: 120,
      body: null,
      blink: null,
      pressBlur: null,
      dust: null,
      impression: { at: 0, duration: 120, easing: "ease-out", opacity, clip: false },
      spread: null,
      nod: null,
      end: 120,
    };
  }

  const f = FACTOR[kind] * speed;
  const tier = TIERS[tierOf(streak)];

  // 各段时长（ms，取整）
  const wake = Math.round(BASE.wake * f);
  const press = Math.round((dry ? 160 : BASE.stamp) * f); // dry 的压下段更长、发涩
  const impact = dry ? 0 : Math.round(BASE.impact * f);   // dry 没有压扁回弹段
  const hold = Math.round(tier.hold * f);
  const lift = Math.round(BASE.lift * f);
  const total = Math.round(wake + press + impact + hold + lift);

  const t1 = wake;                          // 抬起结束 = 压下开始
  const t2 = t1 + press;                    // 命中
  const t3 = t2 + impact;                   // 回弹结束
  const t4 = t3 + hold;                     // 按住结束 = 松开开始

  const at = (t: number) => t / total;
  const rest = startTransform ?? "translateY(0px) scale(1)";

  let frames: Frame[];
  if (dry) {
    // 干印（规范 7.1 dry）：幅度乘 0.7，无回弹
    frames = [
      { offset: 0, transform: rest, easing: EASE.wake },
      { offset: at(t1), transform: `translateY(${px(-6.3 * PX)}px) scale(.98)`, easing: EASE.dry },
      { offset: at(t2), transform: `translateY(${px(1.4 * PX)}px) scale(1.03)`, easing: "linear" },
      { offset: at(t4), transform: `translateY(${px(1.4 * PX)}px) scale(1.03)`, easing: EASE.lift },
      { offset: 1, transform: "translateY(0px) scale(1)" },
    ];
  } else {
    frames = [
      { offset: 0, transform: rest, easing: EASE.wake },
      { offset: at(t1), transform: `translateY(${px(-9 * PX)}px) scale(.97)`, easing: EASE.stamp },
      { offset: at(t2), transform: `translateY(${px(tier.y * PX)}px) scale(1.08)`, easing: EASE.impact },
      { offset: at(t2 + impact / 2), transform: `translateY(${px(-PX)}px) scale(${tier.s})`, easing: EASE.impact },
      { offset: at(t3), transform: `translateY(${px(PX)}px) scale(1)`, easing: "linear" },
      { offset: at(t4), transform: `translateY(${px(PX)}px) scale(1)`, easing: EASE.lift },
      { offset: at(t4 + lift / 2), transform: `translateY(${px(-4 * PX)}px) scale(1.02)`, easing: EASE.lift },
      { offset: 1, transform: "translateY(0px) scale(1)" },
    ];
  }

  // 印痕显现：命中后 40ms，140ms（dry 同口径，t2 = wake+press）
  const impAt = t2 + Math.round(BASE.impOffset * f);
  const impDur = Math.round(BASE.imp * f);

  const spread = wantSpread && !dry
    ? {
        at: impAt + impDur,
        duration: Math.round(SINGLE.spreadDuration * speed),
        fromOpacity: SINGLE.spreadOpacity * opacity,
      }
    : null;

  const nod = wantNod
    ? {
        at: total + SINGLE.nodDelay,
        duration: SINGLE.nodDuration,
        frames: [
          { offset: 0, transform: "rotate(0deg)", easing: EASE.breathe },
          { offset: SINGLE.nodPeak, transform: `rotate(${SINGLE.nodDeg}deg)`, easing: EASE.breathe },
          { offset: 1, transform: "rotate(0deg)" },
        ] as Frame[],
      }
    : null;

  return {
    kind,
    reduced: false,
    dry,
    total,
    body: { frames, duration: total },
    blink: dry ? null : { at: t2, duration: 60 },
    pressBlur: { from: t1, to: t4 },
    dust: dry ? null : { at: t2 + Math.round(20 * f), duration: Math.round(180 * f), distance: 8 * PX },
    impression: {
      at: impAt,
      duration: impDur,
      easing: EASE.imp,
      opacity: dry ? DRY_OPACITY : opacity,
      clip: true,
    },
    spread,
    nod,
    end: nod ? nod.at + nod.duration : total,
  };
}

/**
 * reduced-motion 时印痕显现的关键帧（规范 7.5）：只有 opacity 一个键，
 * 任何位移/缩放/裁剪都不许出现。播放器 reduced 分支只播这一份，测试靠它锁住“无 transform”。
 */
export function reducedImpressionFrames(opacity: number): { opacity: number }[] {
  return [{ opacity: 0 }, { opacity }];
}

/** 鞠躬（规范 6.2 第 3 步）：240 下沉 / 320 停 / 300 回正，dropPx = 1×PX */
export function bowTimeline(deg: number = WRAP.bowDeg, size: number = 64): {
  down: number; hold: number; up: number; total: number; deg: number; dropPx: number;
} {
  return {
    down: WRAP.bowDown,
    hold: WRAP.bowHold,
    up: WRAP.bowUp,
    total: WRAP.bowDown + WRAP.bowHold + WRAP.bowUp,
    deg,
    dropPx: (size / 64),
  };
}

/**
 * 回来了的迎接（规范 6.6 第 3 步）。
 * up 180 / down 220 / land 120 / tilt 200 / hold 600 / back 300，共 1620。
 * 注意：规范 6.6 正文写的 1420 是把 land 120 和 hold 600 漏加了一项，demo 实际是 1620，以 demo 为准。
 */
export function welcomeTimeline(size: number = 64): {
  steps: { name: "up" | "down" | "land" | "tilt" | "hold" | "back"; at: number; duration: number; easing: string }[];
  total: number;
  jumpPx: number;
  tiltDeg: number;
} {
  const def: ["up" | "down" | "land" | "tilt" | "hold" | "back", number, string][] = [
    ["up", BACK.jumpUp, EASE.wake],
    ["down", BACK.jumpDown, EASE.stamp],
    ["land", BACK.land, EASE.impact],
    ["tilt", BACK.tilt, EASE.lift],
    ["hold", BACK.tiltHold, "linear"],
    ["back", BACK.tiltBack, EASE.lift],
  ];
  let t = 0;
  const steps = def.map(([name, duration, easing]) => {
    const s = { name, at: t, duration, easing };
    t += duration;
    return s;
  });
  return {
    steps,
    total: t, // 180+220+120+200+600+300 = 1620
    jumpPx: BACK.jumpPx * (size / 64),
    tiltDeg: BACK.tiltDeg,
  };
}

/** 一天收工（规范 6.2）：start = 400（最后一个章松开后），第 i 枚 at = 400+40i、各 360，超过 8 枚只算前 8 */
export function wrapTimeline(n: number): {
  start: number; slides: { at: number; duration: number }[]; bowAt: number; total: number;
} {
  const m = Math.min(Math.max(n, 0), WRAP.stripMax);
  const slides = Array.from({ length: m }, (_, i) => ({ at: WRAP.delay + WRAP.stagger * i, duration: WRAP.slide }));
  const lastEnd = slides.length ? slides[slides.length - 1].at + WRAP.slide : WRAP.delay;
  const bowAt = lastEnd + WRAP.beforeBow;
  const total = bowAt + WRAP.bowDown + WRAP.bowHold + WRAP.bowUp;
  return { start: WRAP.delay, slides, bowAt, total };
}

/**
 * 昨日回放（规范 6.7）。以 demo replay() 为真源：
 * 纸 240ms 进场，+60 后开始落印；落印 240ms，间隔 min(220, 1500/枚数)；
 * 落完 +160 盖日期章（小椭圆章时间线，72px）；停 600；收进栏 360。
 * n=6 → 3244，n=1 → 2144，n=0 → 1904，n=8 ≈ 3456。
 */
export function replayTimeline(n: number, opts?: { streak?: number; reduced?: boolean }): {
  sheetIn: number;
  dropsAt: number;
  stagger: number;
  drops: { at: number; duration: number; rot: number }[];
  plus: number; // max(0, n-8)，纸上写 "+N" 不再落
  dateAt: number;
  date: StampTimeline;
  holdUntil: number;
  dockAt: number;
  dockDuration: number;
  total: number;
} {
  const streak = opts?.streak ?? 1;
  const shown = Math.min(Math.max(n, 0), REPLAY.maxMarks);
  const plus = Math.max(0, n - REPLAY.maxMarks);

  // reduced：整张 120ms 淡入，印痕和日期章都已在纸上，不落印不盖章（规范 6.7）
  if (opts?.reduced) {
    return {
      sheetIn: 120,
      dropsAt: 0,
      stagger: 0,
      drops: Array.from({ length: shown }, (_, i) => ({ at: 0, duration: 0, rot: REPLAY.rot[i % REPLAY.rot.length] })),
      plus,
      dateAt: 0,
      date: stampTimeline("tuoyuan", { streak, reduced: true, spread: true, nod: false, size: REPLAY.dateSize }),
      holdUntil: 120,
      dockAt: 120,
      dockDuration: 0,
      total: 120,
    };
  }

  const dropsAt = REPLAY.sheetIn + REPLAY.after;
  const stagger = shown ? Math.min(REPLAY.maxStagger, REPLAY.dropBudget / shown) : 0;
  const drops = Array.from({ length: shown }, (_, i) => ({
    at: dropsAt + i * stagger,
    duration: REPLAY.drop,
    rot: REPLAY.rot[i % REPLAY.rot.length],
  }));
  const lastDropEnd = shown ? dropsAt + (shown - 1) * stagger + REPLAY.drop : dropsAt;
  const dateAt = lastDropEnd + REPLAY.beforeDate;
  const date = stampTimeline("tuoyuan", { streak, spread: true, nod: false, size: REPLAY.dateSize });
  const holdUntil = dateAt + date.total + REPLAY.hold;
  return {
    sheetIn: REPLAY.sheetIn,
    dropsAt,
    stagger,
    drops,
    plus,
    dateAt,
    date,
    holdUntil,
    dockAt: holdUntil,
    dockDuration: REPLAY.dock,
    total: holdUntil + REPLAY.dock,
  };
}
