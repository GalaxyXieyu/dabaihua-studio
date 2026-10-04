// 印章 DOM 播放器（浏览器端，DOM + Web Animations API；不引 React、不引动画库）。
// 动作结构和 /workspace/design/ip/spec/demo/index.html 的 play()/setSeal()/stamp()/bow()
// 一致，但所有时长/关键帧都从 seal-machine.ts 的时间线函数取，不再写第二份数字。
// 约定：React 渲染终态，播放器只负责"从无到有"；每段演完把 data-state 改成 stamped，
// 再通过回调告诉 React（React 随后渲染出同样的值，不冲突）。
// 飞行动画（印条 FLIP、回放收纸）用 document.body 上 position:fixed 的临时克隆，
// 落位后删克隆、显示真身。

import { EASE, QUEUE, SINGLE, WRAP } from "./seal-tokens.ts";
import { strokeFor } from "./seal-tokens.ts";
import type { SealKind } from "./seal-tokens.ts";
import { bowTimeline, reducedImpressionFrames, replayTimeline, stampTimeline, welcomeTimeline, wrapTimeline } from "./seal-machine.ts";
import type { StampTimeline } from "./seal-machine.ts";
import { sealSvg } from "./seal-svg.ts";
import { replaySheetHtml } from "./seal-sheet.ts";
import { REPLAY } from "./seal-tokens.ts";
import type { SealEvent } from "./seal-moments.ts";

/** 系统级减少动效偏好（规范 7.5）；页面加载后值可能变化，每次演出前现查 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 播放上下文：signal 用于打断（SealStage 持有 AbortController），
 * track 把每个 Animation 登记起来，打断时统一 cancel。
 */
export type PlayerCtx = { signal: AbortSignal; reduced: boolean; track(a: Animation): Animation };

/** 播一帧序列：fill forwards，结束后 cancel（元素回到 DOM 终态，由 data-state 承接） */
function anim(
  el: Element,
  frames: Keyframe[],
  opts: KeyframeAnimationOptions,
  ctx: PlayerCtx,
): Promise<void> {
  // signal 已 abort 时直接拒绝：不再创建动画（打断要立刻落地，不等播完）
  if (ctx.signal.aborted) return Promise.reject(new DOMException("seal aborted", "AbortError"));
  const a = ctx.track(el.animate(frames, { fill: "forwards", ...opts }));
  return a.finished.then(
    () => {
      try {
        a.cancel();
      } catch {
        // 已被取消时忽略
      }
    },
    (err: unknown) => {
      try {
        a.cancel();
      } catch {
        // 同上
      }
      throw err;
    },
  );
}

/** 可中断的 sleep：signal abort 时立刻拒绝 */
function wait(ms: number, ctx: PlayerCtx): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ctx.signal.aborted) {
      reject(new DOMException("seal aborted", "AbortError"));
      return;
    }
    const done = () => {
      ctx.signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("seal aborted", "AbortError"));
    };
    const t = setTimeout(done, ms);
    ctx.signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 从角色身上读渲染尺寸（Seal 组件把 --seal-size 挂在行内样式上） */
function readSealSize(actor: HTMLElement): number {
  const raw = actor.style.getPropertyValue("--seal-size") || getComputedStyle(actor).getPropertyValue("--seal-size");
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 64;
}

let swapUid = 0;

/** 换章（demo setSeal）：换 .seal-breath 的 innerHTML，data-kind 同步；同种类不换 */
export async function setActorKind(
  actor: HTMLElement,
  kind: SealKind,
  ctx: PlayerCtx,
  animate = true,
): Promise<void> {
  const breath = actor.querySelector<HTMLElement>(".seal-breath");
  if (!breath) return;
  if (actor.dataset.kind === kind && breath.firstElementChild !== null) return;
  const size = readSealSize(actor);
  const fade = animate && breath.firstElementChild !== null && !ctx.reduced;
  if (fade) {
    // 先淡出 120ms（QUEUE.swap），按住不透明度换内容，再淡入
    await anim(actor, [{ opacity: 1 }, { opacity: 0 }], { duration: QUEUE.swap, easing: EASE.fade }, ctx);
    actor.style.opacity = "0";
  }
  actor.dataset.kind = kind;
  breath.innerHTML = sealSvg(kind, { size, prefix: `seal-player-${++swapUid}` });
  if (fade) {
    await anim(actor, [{ opacity: 0 }, { opacity: 1 }], { duration: QUEUE.swap, easing: EASE.fade }, ctx);
  }
  actor.style.opacity = "";
}

/** 飞溅 4 点（demo stamp 的 dust）：印面四角 2px 圆点，斜着抛出后删除 */
function spawnDust(actor: HTMLElement, dust: NonNullable<StampTimeline["dust"]>, ctx: PlayerCtx): void {
  const parent = actor.parentElement;
  if (!parent) return;
  const ar = actor.getBoundingClientRect();
  const base = (actor.offsetParent as HTMLElement | null) ?? parent;
  const br = base.getBoundingClientRect();
  // 印面在角色底部：四角取 [fx, fy, dx, dy]（dx/dy 是抛出方向，照 demo 的 dirs）
  const corners: [number, number, number, number][] = [
    [0.14, 0.92, -1, -0.6],
    [0.86, 0.92, 1, -0.6],
    [0.22, 1, -1.2, -0.2],
    [0.78, 1, 1.2, -0.2],
  ];
  for (const [fx, fy, dx, dy] of corners) {
    const s = document.createElement("span");
    s.className = "seal-dust";
    s.style.position = "absolute";
    s.style.width = "2px";
    s.style.height = "2px";
    s.style.borderRadius = "50%";
    s.style.background = "var(--seal-red, #B23A2B)";
    s.style.left = `${ar.left - br.left + ar.width * fx}px`;
    s.style.top = `${ar.top - br.top + ar.height * fy}px`;
    parent.appendChild(s);
    void anim(
      s,
      [
        { opacity: 0.5, transform: "translate(0, 0)" },
        { opacity: 0, transform: `translate(${dx * dust.distance}px, ${dy * dust.distance}px)` },
      ],
      { duration: dust.duration, easing: "ease-out" },
      ctx,
    )
      .catch(() => {})
      .finally(() => s.remove());
  }
}

/** 单次盖章（demo stamp）。印痕落在 slot 的 .seal-mark 上，演完 slot data-state="stamped" */
export async function playStamp(
  actor: HTMLElement,
  slot: HTMLElement,
  opts: { kind: SealKind; streak: number; speed?: number; spread?: boolean; nod?: boolean; size: number },
  ctx: PlayerCtx,
): Promise<void> {
  const tl = stampTimeline(opts.kind, {
    size: opts.size,
    streak: opts.streak,
    speed: opts.speed,
    spread: opts.spread,
    nod: opts.nod,
    reduced: ctx.reduced,
    startTransform: (() => {
      const t = getComputedStyle(actor).transform;
      return t && t !== "none" ? t : undefined;
    })(),
  });
  const mark = slot.querySelector<HTMLElement>(".seal-mark");

  // reduced（规范 7.5）：只做 120ms 淡入，不动角色、不生成飞溅节点
  if (ctx.reduced) {
    if (mark) {
      await anim(mark, reducedImpressionFrames(tl.impression.opacity), { duration: tl.impression.duration, easing: "ease-out" }, ctx);
    }
    slot.dataset.state = "stamped";
    return;
  }

  // 盖章中：站直、眼睛睁开（seal.css 的 stamping 姿态）
  actor.dataset.pose = "stamping";

  const timers: ReturnType<typeof setTimeout>[] = [];
  const schedule = (at: number, fn: () => void): void => {
    if (!ctx.signal.aborted) timers.push(setTimeout(fn, at));
  };

  let impressionDone: Promise<void> = Promise.resolve();
  try {
    // 身体关键帧播在 .seal-actor 上（demo stamp 的 body）
    const body = tl.body!;
    const bodyDone = anim(
      actor,
      body.frames,
      { duration: body.duration },
      ctx,
    );

    // 命中时闭眼 60ms（demo）
    if (tl.blink) {
      const { at, duration } = tl.blink;
      schedule(at, () => {
        for (const eye of actor.querySelectorAll(".seal-eye")) {
          void anim(
            eye,
            [
              { transform: "scaleY(1)" },
              { transform: "scaleY(.2)" },
              { transform: "scaleY(1)" },
            ],
            { duration },
            ctx,
          ).catch(() => {});
        }
      });
    }

    // 压下到松开给印面 blur(0.3px)，松开后归零（时点来自时间线）
    if (tl.pressBlur) {
      const face = actor.querySelector(".seal-face");
      if (face) {
        const { from, to } = tl.pressBlur;
        const back = Math.max(0, body.duration - to);
        void anim(face, [{ filter: "blur(0px)" }, { filter: "blur(0.3px)" }], { delay: from, duration: to - from, easing: "linear" }, ctx).catch(() => {});
        if (back > 0) {
          void anim(face, [{ filter: "blur(0.3px)" }, { filter: "blur(0px)" }], { delay: to, duration: back, easing: EASE.lift }, ctx).catch(() => {});
        }
      }
    }

    // 飞溅 4 点（命中后 dust.at）
    if (tl.dust) {
      const { at } = tl.dust;
      schedule(at, () => spawnDust(actor, tl.dust!, ctx));
    }

    // 印痕显现：命中后 impression.at，从中心推开（clip-path circle）
    const imp = tl.impression;
    schedule(imp.at, () => {
      if (!mark) return;
      impressionDone = anim(
        mark,
        [
          { opacity: 0, transform: "scale(.98)", clipPath: "circle(0% at 50% 50%)" },
          { opacity: imp.opacity, transform: "scale(1)", clipPath: `circle(${imp.clip ? 75 : 100}% at 50% 50%)` },
        ],
        { duration: imp.duration, easing: imp.easing },
        ctx,
      )
        .then(() => {
          slot.dataset.state = "stamped";
        })
        .catch(() => {
          slot.dataset.state = "stamped";
        });
      // 洇开：克隆一份叠在 slot 里，向外扩 SINGLE.spreadScale 后删除
      if (tl.spread && mark) {
        const { at: sAt, duration, fromOpacity } = tl.spread;
        schedule(sAt, () => {
          const ghost = mark.cloneNode(true) as HTMLElement;
          ghost.removeAttribute("id");
          slot.appendChild(ghost);
          void anim(
            ghost,
            [
              { opacity: fromOpacity, transform: "scale(1)" },
              { opacity: 0, transform: `scale(${SINGLE.spreadScale})` },
            ],
            { duration, easing: EASE.out },
            ctx,
          )
            .catch(() => {})
            .finally(() => ghost.remove());
        });
      }
    });

    await bodyDone;
    actor.style.transform = "";

    // 点头（单件完成）：身体落定后停 nodDelay 再点头
    if (tl.nod) {
      const { at, duration, frames } = tl.nod;
      await wait(at - body.duration, ctx);
      await anim(actor, frames, { duration, easing: EASE.breathe }, ctx);
    }

    // 等印痕落地（提前于身体结束，这里只是保险）
    await impressionDone;
  } finally {
    for (const t of timers) clearTimeout(t);
    actor.dataset.pose = "stamped";
    actor.style.transform = "";
  }
}

/** 鞠躬（一天收工的收尾，demo bow）：240 下沉 / 320 停 / 300 回正；reduced 直接不演 */
export async function playBow(actor: HTMLElement, size: number, ctx: PlayerCtx): Promise<void> {
  if (ctx.reduced) return;
  const tl = bowTimeline(WRAP.bowDeg, size);
  await anim(
    actor,
    [{ transform: "rotate(0deg) translateY(0)" }, { transform: `rotate(${tl.deg}deg) translateY(${tl.dropPx}px)` }],
    { duration: tl.down, easing: EASE.breathe },
    ctx,
  );
  await wait(tl.hold, ctx);
  await anim(
    actor,
    [{ transform: `rotate(${tl.deg}deg) translateY(${tl.dropPx}px)` }, { transform: "rotate(0deg) translateY(0)" }],
    { duration: tl.up, easing: EASE.lift },
    ctx,
  );
}

/** 回来了的迎接（demo M.back 的迎接部分）：起跳/落地/歪头/回正，时长全部来自 welcomeTimeline */
export async function playWelcome(actor: HTMLElement, size: number, ctx: PlayerCtx): Promise<void> {
  if (ctx.reduced) return;
  const tl = welcomeTimeline(size);
  const step = (name: "up" | "down" | "land" | "tilt" | "hold" | "back") => tl.steps.find((s) => s.name === name)!;
  await anim(
    actor,
    [{ transform: "translateY(0)" }, { transform: `translateY(-${tl.jumpPx}px)` }],
    { duration: step("up").duration, easing: step("up").easing },
    ctx,
  );
  await anim(
    actor,
    [{ transform: `translateY(-${tl.jumpPx}px)` }, { transform: "translateY(0) scale(1)" }],
    { duration: step("down").duration, easing: step("down").easing },
    ctx,
  );
  await anim(
    actor,
    [{ transform: "scale(.97)" }, { transform: "scale(1)" }],
    { duration: step("land").duration, easing: step("land").easing },
    ctx,
  );
  await anim(
    actor,
    [{ transform: "rotate(0deg)" }, { transform: `rotate(${tl.tiltDeg}deg)` }],
    { duration: step("tilt").duration, easing: step("tilt").easing },
    ctx,
  );
  await wait(step("hold").duration, ctx);
  await anim(
    actor,
    [{ transform: `rotate(${tl.tiltDeg}deg)` }, { transform: "rotate(0deg)" }],
    { duration: step("back").duration, easing: step("back").easing },
    ctx,
  );
}

/**
 * 一天收工（demo lineUp，规范 6.2）：印痕从各条目 FLIP 滑进印条，落位后显示真身，
 * 最后躺躬。条目上的原印痕不动；飞行动画用 body 上 position:fixed 的临时克隆。
 * 时序全部来自 wrapTimeline（360ms、错开 40ms、最多 8 枚、最后 200ms 后躺躬）。
 */
export async function playDayWrap(
  actor: HTMLElement,
  sourceSlots: HTMLElement[],
  strip: HTMLElement,
  size: number,
  ctx: PlayerCtx,
): Promise<void> {
  if (ctx.reduced) {
    // reduced：不滑、不躺躬，直接终态（React 已渲染静态印痕）
    strip.dataset.state = "stamped";
    return;
  }

  const tl = wrapTimeline(Math.min(sourceSlots.length, WRAP.stripMax));
  strip.dataset.state = "playing";

  // strip 里的静态印痕先透明，落位后逐个显回真身
  const stripMarks = [...strip.querySelectorAll<HTMLElement>(".seal-mark")];
  stripMarks.forEach((m) => {
    m.style.opacity = "0";
  });

  const srcMarks = sourceSlots
    .map((s) => s.querySelector<HTMLElement>(".seal-mark"))
    .filter((m): m is HTMLElement => m !== null)
    .slice(0, WRAP.stripMax);

  if (srcMarks.length > 0 && stripMarks.length > 0) {
    const flights: Promise<void>[] = [];
    srcMarks.forEach((mark, i) => {
      const dst = stripMarks[i];
      if (!dst) return;
      const from = mark.getBoundingClientRect();
      const to = dst.getBoundingClientRect();
      // 克隆：不直接 cloneNode（会复制 SVG 的 id），重拼 innerHTML 并给 id 加 -fly 后缀
      const fly = document.createElement("span");
      fly.className = "seal-mark seal-fly";
      fly.style.position = "fixed";
      fly.style.left = `${to.left}px`;
      fly.style.top = `${to.top}px`;
      fly.style.width = `${to.width}px`;
      fly.style.height = `${to.height}px`;
      fly.style.lineHeight = "0";
      fly.innerHTML = mark.innerHTML
        .replace(/id="([^"]+)"/g, (_m, id: string) => `id="${id}-fly"`)
        .replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${id}-fly)`);
      document.body.appendChild(fly);
      const slide = tl.slides[i] ?? { at: WRAP.delay + WRAP.stagger * i, duration: WRAP.slide };
      flights.push(
        anim(
          fly,
          [
            { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
            { transform: "translate(0, 0)" },
          ],
          { delay: slide.at, duration: slide.duration, easing: EASE.out },
          ctx,
        )
          .catch(() => {})
          .finally(() => {
            dst.style.opacity = "";
            fly.remove();
          }),
      );
    });
    await Promise.all(flights);
  }

  stripMarks.forEach((m) => {
    m.style.opacity = "";
  });
  strip.dataset.state = "stamped";

  // 最后 beforeBow（200ms）后躺躬，时点来自 wrapTimeline
  const lastEnd = tl.slides.length
    ? tl.slides[tl.slides.length - 1].at + WRAP.slide
    : tl.start;
  await wait(Math.max(0, tl.bowAt - lastEnd), ctx);
  await playBow(actor, size, ctx);
}

// ---------- 昨日回放（规范 6.7；Yu 2026-10-04 定全屏遮罩版） ----------

/** 纸的内容（终态）：纯函数，回放遮罩和收起后的小卡共用 */
export { replaySheetHtml };

function replayTitle(date: string): string {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `昨天 · ${m} 月 ${d} 日`;
}

/** 昨日回放：全屏遮罩 + 一张纸，落印、盖日期章，最后收进 card（FLIP）。
 * 点一下（pointerdown / keydown / wheel / touchmove / 切后台 / pagehide）跳到终态，正常 resolve。
 */
export async function playReplay(
  input: { date: string; events: SealEvent[]; streak: number; card: HTMLElement | null },
  ctx: PlayerCtx,
): Promise<void> {
  const { date, events, streak, card } = input;
  // 演出前现查系统偏好（ctx.reduced 是打开页面时的值，可能已变化）
  const reduced = ctx.reduced || prefersReducedMotion();
  const tl = replayTimeline(events.length, { streak, reduced });
  let replayUid = 0;
  const prefix = `seal-replay-${++replayUid}`;

  // 跳过：一个 promise，skip 时 resolve，正在等的 wait 立刻抛 AbortError
  let skipped = false;
  let wakeSkip: (() => void) | null = null;
  const skipHappened = new Promise<void>((res) => {
    wakeSkip = res;
  });
  const skipErr = skipHappened.then(() => {
    throw new DOMException("replay skipped", "AbortError");
  });
  skipErr.catch(() => {}); // 防止没人接时的 unhandled rejection
  const localAnims: Animation[] = [];
  const replayCtx: PlayerCtx = {
    signal: ctx.signal,
    reduced,
    track: (a) => {
      localAnims.push(a);
      return ctx.track(a);
    },
  };
  const skip = (): void => {
    if (skipped) return;
    skipped = true;
    for (const a of localAnims) {
      try {
        a.cancel();
      } catch {
        // 已结束的动画 cancel 可能抛错，忽略
      }
    }
    wakeSkip?.();
  };
  const wait2 = (ms: number): Promise<void> => Promise.race([wait(ms, ctx), skipErr]);

  // ---------- 遮罩与纸的骨架 ----------
  const doc = document.documentElement;
  const prevOverflow = doc.style.overflow;
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  doc.style.overflow = "hidden";

  const mask = document.createElement("div");
  mask.className = "seal-replay";
  mask.style.position = "fixed";
  mask.style.inset = "0";
  mask.style.zIndex = "80";
  mask.setAttribute("role", "dialog");
  mask.setAttribute("aria-label", "昨日回放");
  mask.tabIndex = -1;

  const bg = document.createElement("div");
  bg.className = "seal-replay-bg";
  bg.style.position = "absolute";
  bg.style.inset = "0";
  bg.style.background = "rgba(27,25,21,.46)";
  mask.appendChild(bg);

  const content = document.createElement("div");
  content.className = "seal-replay-content";
  content.style.position = "absolute";
  content.style.inset = "0";
  content.style.display = "flex";
  content.style.alignItems = "center";
  content.style.justifyContent = "center";
  content.style.padding = "16px";
  mask.appendChild(content);

  // scaleWrap（FLIP 目标）> fit（窄屏缩放）> 标题 + 纸 + 小椭圆章
  const scaleWrap = document.createElement("div");
  scaleWrap.className = "seal-replay-scale";
  scaleWrap.style.position = "relative";
  content.appendChild(scaleWrap);

  const fit = document.createElement("div");
  fit.className = "seal-replay-fit";
  fit.style.transformOrigin = "center";
  scaleWrap.appendChild(fit);

  const title = document.createElement("p");
  title.className = "seal-replay-title";
  title.textContent = replayTitle(date);
  title.style.margin = "0 0 8px";
  title.style.fontFamily = "var(--font-serif, serif)";
  title.style.fontSize = "13px";
  title.style.letterSpacing = ".06em";
  title.style.color = "var(--faint, #8A8274)";
  fit.appendChild(title);

  const sheet = document.createElement("div");
  sheet.className = "seal-replay-sheet";
  sheet.style.position = "relative";
  sheet.style.width = `${REPLAY.sheetW}px`;
  sheet.style.height = `${REPLAY.sheetH}px`;
  sheet.style.background = "#FFFDF8";
  sheet.style.border = "1px solid var(--line, #D8CFBE)";
  sheet.style.boxSizing = "border-box";
  sheet.innerHTML = replaySheetHtml({ date, events, streak, prefix });
  fit.appendChild(sheet);

  // 小椭圆章角色：站在纸底边那条线上；宽屏在纸左侧，窄屏（≤640px）在纸上方
  const actor = document.createElement("span");
  actor.className = "seal-actor";
  actor.dataset.kind = "tuoyuan";
  actor.dataset.pose = "stamped";
  const narrow = window.innerWidth <= 640;
  actor.style.position = "absolute";
  if (narrow) {
    actor.style.top = "-108px";
    actor.style.left = "0";
  } else {
    actor.style.left = "-112px";
    actor.style.bottom = "0";
  }
  actor.style.setProperty("--seal-size", "96px");
  actor.style.setProperty("--seal-stroke", String(strokeFor(96)));
  actor.style.setProperty("--seal-px", "1.5px");
  const breath = document.createElement("span");
  breath.className = "seal-breath";
  breath.innerHTML = sealSvg("tuoyuan", { size: 96, prefix: `${prefix}-actor` });
  actor.appendChild(breath);
  fit.appendChild(actor);

  // 窄屏缩放：整张纸按 min(1, (innerWidth - 32) / 400)
  const s = Math.min(1, (window.innerWidth - 32) / REPLAY.sheetW);
  fit.style.transform = `scale(${s})`;

  document.body.appendChild(mask);
  try {
    mask.focus();
  } catch {
    // 忽略焦点异常
  }

  // 印痕和小字先透明，落位后恢复（记录原不透明度）
  const opOf = new Map<HTMLElement, string>();
  for (const el of [...sheet.querySelectorAll<HTMLElement>(".seal-mark"), sheet.querySelector<HTMLElement>("[data-plus]")]) {
    if (!el) continue;
    opOf.set(el, el.style.opacity);
    el.style.opacity = "0";
  }

  // 遮罩存在期间的跳过监听：遮罩自己吃掉这次点击（不穿透到下面的链接）
  const onSkipPointer = () => skip();
  const onVis = () => {
    if (document.visibilityState === "hidden") skip();
  };
  mask.addEventListener("pointerdown", onSkipPointer);
  mask.addEventListener("wheel", onSkipPointer, { passive: true });
  mask.addEventListener("touchmove", onSkipPointer, { passive: true });
  window.addEventListener("keydown", onSkipPointer);
  window.addEventListener("pagehide", onSkipPointer);
  document.addEventListener("visibilitychange", onVis);

  const cleanup = (): void => {
    mask.removeEventListener("pointerdown", onSkipPointer);
    mask.removeEventListener("wheel", onSkipPointer);
    mask.removeEventListener("touchmove", onSkipPointer);
    window.removeEventListener("keydown", onSkipPointer);
    window.removeEventListener("pagehide", onSkipPointer);
    document.removeEventListener("visibilitychange", onVis);
    mask.remove();
    if (doc.style.overflow === "hidden") doc.style.overflow = prevOverflow;
    if (prevFocus && prevFocus.isConnected) {
      try {
        prevFocus.focus();
      } catch {
        // 忽略焦点异常
      }
    }
    if (card) card.dataset.state = "stamped";
  };

  try {
    if (reduced) {
      // reduced（任务第 8 条）：终态直接出现，整体 120ms 淡入，停 1200，120ms 淡出
      for (const [el, op] of opOf) el.style.opacity = op;
      await anim(mask, [{ opacity: 0 }, { opacity: 1 }], { duration: tl.sheetIn, easing: "ease-out" }, replayCtx);
      await wait2(1200);
      await anim(mask, [{ opacity: 1 }, { opacity: 0 }], { duration: tl.sheetIn, easing: "ease-out" }, replayCtx);
      return;
    }

    // 纸进场：背景淡入 + 纸上移淡入（240ms，t.sheetIn）
    await Promise.all([
      anim(bg, [{ opacity: 0 }, { opacity: 1 }], { duration: tl.sheetIn, easing: EASE.out }, replayCtx),
      anim(sheet, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: tl.sheetIn, easing: EASE.out }, replayCtx),
    ]);
    await wait2(tl.dropsAt - tl.sheetIn);

    // 落印：一枚一枚从上方 18px、scale 1.12、透明落到原位（带固定角度）
    const drops = tl.drops.map((d, i) => {
      const cell = sheet.querySelector<HTMLElement>(`[data-i="${i}"]`);
      const mark = cell?.querySelector<HTMLElement>(".seal-mark");
      if (!mark) return Promise.resolve();
      const op = opOf.get(mark) ?? "1";
      return anim(
        mark,
        [
          { opacity: 0, transform: `translateY(-${REPLAY.dropFrom}px) scale(${REPLAY.dropScale}) rotate(${d.rot}deg)` },
          { opacity: op, transform: `translateY(0) scale(1) rotate(${d.rot}deg)` },
        ],
        { delay: d.at - tl.dropsAt, duration: d.duration, easing: EASE.out },
        replayCtx,
      )
        .then(() => {
          mark.style.opacity = op;
        })
        .catch(() => {});
    });
    await Promise.all(drops);
    const plus = sheet.querySelector<HTMLElement>("[data-plus]");
    if (plus) plus.style.opacity = opOf.get(plus) ?? "1";

    // 落完 beforeDate（160ms）后盖日期章（昨天没章时也直接盖）
    const lastDropEnd = tl.drops.length
      ? tl.drops[tl.drops.length - 1].at + tl.drops[tl.drops.length - 1].duration
      : tl.dropsAt;
    await wait2(tl.dateAt - lastDropEnd);
    const dmCell = sheet.querySelector<HTMLElement>("[data-date-mark]");
    const dmMark = dmCell?.querySelector<HTMLElement>(".seal-mark") ?? null;
    if (dmCell && dmMark) {
      dmMark.style.opacity = opOf.get(dmMark) ?? "1"; // playStamp 印象动画从 0 播到它
      await playStamp(actor, dmCell, { kind: "tuoyuan", streak, spread: true, nod: false, size: 96 }, replayCtx);
    }

    // 停 600ms
    // 停 600ms（dockAt − 日期章结束，时点来自 replayTimeline）
    await wait2(Math.max(0, tl.dockAt - (tl.dateAt + tl.date.total)));

    // 收起：角色淡出 120ms；纸以右下角为原点 FLIP 到 card 的位置和大小，背景同步淡出
    const actorFade = anim(actor, [{ opacity: 1 }, { opacity: 0 }], { duration: QUEUE.swap, easing: EASE.fade }, replayCtx).catch(() => {});
    const bgFade = anim(bg, [{ opacity: 1 }, { opacity: 0 }], { duration: tl.dockDuration, easing: EASE.out }, replayCtx).catch(() => {});
    if (card) {
      const from = sheet.getBoundingClientRect();
      const to = card.getBoundingClientRect();
      scaleWrap.style.transformOrigin = "right bottom";
      await anim(
        scaleWrap,
        [
          { transform: "translate(0, 0) scale(1, 1)" },
          { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${from.width ? to.width / from.width : 1}, ${from.height ? to.height / from.height : 1})` },
        ],
        { duration: tl.dockDuration, easing: EASE.out },
        replayCtx,
      ).catch(() => {});
    } else {
      await anim(sheet, [{ opacity: 1 }, { opacity: 0 }], { duration: tl.dockDuration, easing: EASE.fade }, replayCtx).catch(() => {});
    }
    await Promise.all([actorFade, bgFade]);
    if (card) card.dataset.state = "stamped";
  } catch (err) {
    // 跳过/中断：不再抛，正常 resolve（调用方当被打断处理）
    if (!(err instanceof DOMException && err.name === "AbortError")) throw err;
  } finally {
    cleanup();
  }
}
