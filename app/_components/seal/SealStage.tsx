"use client";

// SealStage：整次打开页面的印章编排（规范 6.8：开场、补盖、收尾）。
// 页面用 React.lazy(() => import("./SealStage")) 按需加载，把最终静态 DOM
// （Seal / StampSlot / 印条 / 昨日小卡）先渲染好，本组件只负责"从无到有"的演出。
// 全程跑在 stageLock 里（7.4 第 8 条一屏一个主动效）；用户 scroll / wheel /
// pointerdown / keydown / 切后台 / pagehide 立刻打断（7.4 第 6 条），
// 剩下的印痕直接显示成已盖并调用 onSkip；卸载（切路由）同样当打断处理。
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { shanghaiDate } from "./seal-store.ts";
import { stageLock } from "./seal-lock.ts";
import { prefersReducedMotion, playDayWrap, playReplay, playStamp, playWelcome, setActorKind } from "./seal-player.ts";
import type { PlayerCtx } from "./seal-player.ts";
import { BACK } from "./seal-tokens.ts";
import type { SealEvent, VisitPlan } from "./seal-moments.ts";

export type SealStageProps = {
  plan: VisitPlan;
  actorId: string;
  size: number;
  /** 可选文案（规范第 6 节）：在角色旁显示"昨天 / 回来了 / 今天收工 / 日日如此"，默认关 */
  copy?: boolean;
  onStamped(key: string): void;
  onMoment(moment: "replay" | "dayWrap" | "welcomeBack" | "nod"): void;
  onSkip(): void;
  onDone(summary: { stamped: number; skipped: boolean }): void;
  onOverflow?(n: number): void;
};

/** 打断用的 AbortError（和 seal-player 的 wait/anim 同口径） */
function sealAbort(): DOMException {
  return new DOMException("seal aborted", "AbortError");
}

/** 可中断的 sleep：signal abort 时立刻拒绝 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(sealAbort());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(t);
      reject(sealAbort());
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const INTERRUPT_EVENTS = ["scroll", "wheel", "pointerdown", "keydown"] as const;

export default function SealStage(props: SealStageProps) {
  const { plan, actorId, size } = props;
  const [announced, setAnnounced] = useState("");
  const [copyText, setCopyText] = useState("");

  // 回调走 ref：父组件重渲染换了回调身份，也不会把整次编排重演一遍（渲染后同步）
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    const tracked: Animation[] = [];
    const track = (a: Animation): Animation => {
      tracked.push(a);
      return a;
    };
    const ctx: PlayerCtx = { signal, reduced: prefersReducedMotion(), track };
    // 印痕一起 120ms 淡入（instant / reduced）用的上下文：复用 playStamp 的
    // reduced 分支（只有 opacity 淡入、不动角色、不生成飞溅节点，规范 7.5）
    const fadeCtx: PlayerCtx = { signal, reduced: true, track };

    let interrupted = false;
    const cancelAll = (): void => {
      for (const a of tracked) {
        try {
          a.cancel();
        } catch {
          // 已结束的动画 cancel 可能抛错，忽略
        }
      }
      // 删掉可能还挂着的飞溅点和 FLIP 克隆
      for (const el of document.querySelectorAll(".seal-dust, .seal-fly")) el.remove();
    };
    const interrupt = (): void => {
      if (interrupted) return;
      interrupted = true;
      controller.abort();
      cancelAll();
    };
    const onVis = (): void => {
      if (document.visibilityState === "hidden") interrupt();
    };
    for (const type of INTERRUPT_EVENTS) {
      window.addEventListener(type, interrupt, { capture: true, passive: true });
    }
    window.addEventListener("pagehide", interrupt);
    document.addEventListener("visibilitychange", onVis);
    const removeListeners = (): void => {
      for (const type of INTERRUPT_EVENTS) {
        window.removeEventListener(type, interrupt, { capture: true });
      }
      window.removeEventListener("pagehide", interrupt);
      document.removeEventListener("visibilitychange", onVis);
    };

    const stampedKeys = new Set<string>();
    let stampedCount = 0;
    let skipped = false;
    let settled = false;

    const showFinal = (e: SealEvent): void => {
      const slot = document.getElementById(e.targetId);
      if (slot) slot.dataset.state = "stamped";
    };

    const run = async (): Promise<void> => {
      const p = propsRef.current.plan;
      const call = propsRef.current;
      const actor = document.getElementById(call.actorId);
      const stampSize = call.size;

      // 1) 开场：昨日回放（6.7）。被点击跳过时 signal 已 abort，记为打断（见下）
      if (p.replay) {
        if (call.copy && p.replay.events.length > 0) setCopyText("昨天");
        const card = document.getElementById("seal-yesterday-card");
        await playReplay({ date: p.replay.date, events: p.replay.events, streak: p.streak, card }, ctx);
        if (signal.aborted) throw sealAbort();
        call.onMoment("replay");
        for (const e of p.replay.events) {
          call.onStamped(e.key);
          stampedKeys.add(e.key);
        }
      }

      // 页面没渲染角色（布局异常）：全部直接终态，不演
      if (!actor) {
        for (const e of p.queue) {
          call.onStamped(e.key);
          stampedKeys.add(e.key);
          showFinal(e);
        }
        stampedCount = p.queue.length;
        if (p.overflow > 0) call.onOverflow?.(p.overflow);
        if (p.closing) call.onMoment(p.closing);
        return;
      }

      // 2) 补盖队列（7.4）
      if (ctx.reduced) {
        // reduced：全部新印痕一起 120ms 淡入，不动角色
        const all = [...p.animated, ...p.instant];
        for (const e of all) {
          await setActorKind(actor, e.kind, ctx, true); // reduced 时无淡出淡入，瞬间换
        }
        await Promise.all(
          all.map((e) => {
            const slot = document.getElementById(e.targetId);
            if (!slot) return Promise.resolve();
            return playStamp(
              actor,
              slot,
              { kind: e.kind, streak: p.streak, speed: p.speed, spread: p.spread, nod: false, size: stampSize },
              fadeCtx,
            );
          }),
        );
        for (const e of all) {
          call.onStamped(e.key);
          stampedKeys.add(e.key);
          stampedCount++;
          showFinal(e);
        }
        if (p.overflow > 0) call.onOverflow?.(p.overflow);
      } else {
        for (let i = 0; i < p.animated.length; i++) {
          const e = p.animated[i];
          await setActorKind(actor, e.kind, ctx, true); // 换章淡出淡入各 120ms，同种类不换
          const slot = document.getElementById(e.targetId);
          if (!slot) {
            call.onStamped(e.key);
            stampedKeys.add(e.key);
            stampedCount++;
            continue;
          }
          await playStamp(
            actor,
            slot,
            {
              kind: e.kind,
              streak: p.streak,
              speed: p.speed,
              spread: p.spread,
              nod: p.nodLast && i === p.animated.length - 1,
              size: stampSize,
            },
            ctx,
          );
          call.onStamped(e.key);
          stampedKeys.add(e.key);
          stampedCount++;
          if (i < p.animated.length - 1) await sleep(p.gapMs, signal);
        }
        // 超出 maxAnimated 的：一起 120ms 淡入，然后"还有 N 个"
        if (p.instant.length > 0) {
          await Promise.all(
            p.instant.map((e) => {
              const slot = document.getElementById(e.targetId);
              if (!slot) return Promise.resolve();
              return playStamp(
                actor,
                slot,
                { kind: e.kind, streak: p.streak, spread: p.spread, nod: false, size: stampSize },
                fadeCtx,
              );
            }),
          );
          for (const e of p.instant) {
            call.onStamped(e.key);
            stampedKeys.add(e.key);
            stampedCount++;
            showFinal(e);
          }
        }
        if (p.overflow > 0) call.onOverflow?.(p.overflow);
      }

      // 3) 收尾（只演 plan.closing 一个，6.8 优先级）
      const closing = p.closing;
      if (closing === "welcomeBack") {
        await sleep(BACK.after, signal); // 补完 300ms
        await setActorKind(actor, "fang", ctx, true); // 换回方章（交叉淡入 120ms）
        if (call.copy) setCopyText("回来了");
        await playWelcome(actor, stampSize, ctx);
      } else if (closing === "dayWrap") {
        if (call.copy) setCopyText("今天收工");
        const strip = p.dayWrapDate !== null ? document.getElementById("seal-strip-" + p.dayWrapDate) : null;
        const daySlots = p.events
          .filter((e) => p.dayWrapDate !== null && shanghaiDate(e.at) === p.dayWrapDate)
          .map((e) => document.getElementById(e.targetId))
          .filter((s): s is HTMLElement => s !== null);
        if (strip && daySlots.length > 0) {
          await playDayWrap(actor, daySlots, strip, stampSize, ctx);
        } else if (strip) {
          strip.dataset.state = "stamped"; // 印条在但源印位缺失：至少收工
        }
      } else if (closing === "nod" && call.copy && p.tier >= 2) {
        setCopyText("日日如此"); // 只在第 2、3 档显示（6.4）
      }
      if (closing) call.onMoment(closing);
    };

    void stageLock
      .run(async () => {
        try {
          await run();
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            // 被打断（用户操作 / 切路由 / 回放被点击跳过）：剩下的印痕全部直接
            // 显示成已盖，调用 onSkip，不再演收尾（7.4 第 6 条）
            skipped = true;
            const p = propsRef.current.plan;
            for (const e of [...p.queue, ...(p.replay ? p.replay.events : [])]) {
              if (!stampedKeys.has(e.key)) showFinal(e);
            }
            propsRef.current.onSkip();
          } else {
            throw err;
          }
        } finally {
          removeListeners();
          settled = true;
          const actor = document.getElementById(propsRef.current.actorId);
          if (actor) actor.dataset.pose = "stamped"; // 结束后站直
          if (stampedCount > 0) setAnnounced(`新盖了 ${stampedCount} 个章`);
          propsRef.current.onDone({ stamped: stampedCount, skipped });
        }
      })
      .catch((err: unknown) => {
        // 非 Abort 的编排错误：不再抛给全局（页面保持静态终态，不白屏）
        console.error("[seal] stage aborted with error", err);
      });

    return () => {
      removeListeners();
      if (!settled) {
        // 卸载（切路由）或换了 plan：abort 并把剩下的当成打断处理（onSkip 由 run 的 catch 完成）
        interrupted = true;
        controller.abort();
        cancelAll();
      }
    };
  }, [plan, actorId, size]);

  // 可选文案（规范第 6 节）：--muted 色、宋体 15px、200ms 淡入，停在那里
  const copyStyle: CSSProperties = {
    opacity: copyText ? 1 : 0,
    transition: "opacity 200ms cubic-bezier(.4,0,.2,1)",
  };

  return (
    <>
      {props.copy ? (
        <span className="seal-copy" aria-hidden="true" style={copyStyle}>
          {copyText}
        </span>
      ) : null}
      {/* 队列结束后播报"新盖了 N 个章"（N=0 不写） */}
      <p aria-live="polite" style={SR_ONLY}>
        {announced}
      </p>
    </>
  );
}

/** 视觉隐藏（读屏可见） */
const SR_ONLY: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  margin: 0,
  padding: 0,
};
