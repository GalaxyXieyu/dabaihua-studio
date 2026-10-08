"use client";

// "今天"页的"新盖的章"栏目（规范 10 / 10.1 / 6.7 / 7.4 / 11.3）：默认收起成一行
// （fold bar，整行一个 disclosure 按钮），点一下原地展开成印谱叶（文武边、
// 昨日纸小卡、SealBookGrid 印位格、当天印条），再点收起；展开与否按设备记在
// localStorage 的 sheetOpen（8.6），缺省收起。
// 展开与否还有一套 DOM id 约定（规范 10.1 / TASK 第 4 节）：收起时印位 id（盖章动画
// 的落点）和小印位的"昨日"卡 id 在收起行上，印谱叶里的 SealBookGrid 不带 id、
// 昨日纸大卡和当天印条不渲染；展开时反过来。播放器按 id 找目标，两套版面都在
// DOM 里时 id 只出现一次。
// 服务端渲染时收起行照常出现（默认收起），印位是 unknown、小印位区空着，避免先闪
// 出印痕再消失；SealStage 用 lazy 按需加载，没有新事件时不加载那个 chunk（规范 11.3）。
// 跳过/打断的监听都在 SealStage 和 useSealQueue 里，本组件不另外监听。
import { lazy } from "react";
import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSealQueue, readStore, writeStore } from "./useSealQueue.ts";
import { usePauseWhenHidden } from "./usePauseWhenHidden.ts";
import { SealBookGrid } from "./SealBookGrid.tsx";
import type { SealBookItem } from "./SealBookGrid.tsx";
import { StampMark } from "./StampMark.tsx";
import { StampSlot } from "./StampSlot.tsx";
import { replaySheetHtml } from "./seal-sheet.ts";
import { markSvg } from "./seal-svg.ts";
import { cnDateText, eventCaption, foldCountText, foldSlots } from "./seal-book.ts";
import { REPLAY, WRAP, streakOpacity } from "./seal-tokens.ts";
import { STORE_KEY, addDays, isSheetOpen, parseStore, shanghaiDate, withSheetOpen } from "./seal-store.ts";
import type { SealDay, SealEvent } from "./seal-moments.ts";
import type { SealKind } from "./seal-tokens.ts";

const SealStage = lazy(() => import("./SealStage"));

const ACTOR_ID = "seal-actor-today";
const HINT_ID = "seal-hint-today";

/** useSyncExternalStore 的空订阅：从不通知，客户端快照恒为 true */
function noopSubscribe(): () => void {
  return () => {};
}

/** localStorage 里 sheetOpen 的客户端快照（规范 10.1）：水合后从设备读，缺省收起。
 *  按原始字符串缓存，同一渲染期快照稳定；订阅是空的，切换由 toggle 自己写状态 */
let sheetOpenCache: { raw: string | null; open: boolean } | null = null;
function sheetOpenSnapshot(): boolean {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORE_KEY);
  } catch {
    return false;
  }
  if (sheetOpenCache === null || sheetOpenCache.raw !== raw) {
    sheetOpenCache = { raw, open: isSheetOpen(parseStore(raw)) };
  }
  return sheetOpenCache.open;
}

export type TodaySealsProps = {
  days: SealDay[] | null;
  generatedAt: string | null;
};

/** "2026-10-03" → "10 月 3 日"（昨日小卡与当天印条的题头） */
function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`;
}

export function TodaySeals({ days, generatedAt }: TodaySealsProps) {
  const { ready, plan, slotState, stripState, cardState, needsStage, stageProps } = useSealQueue({
    page: "today",
    days,
    generatedAt,
  });
  usePauseWhenHidden();

  // "还有 N 个"：onOverflow 时显示，队列结束后保留（规范 7.4 第 5 条）
  const [overflowN, setOverflowN] = useState<number | null>(null);
  // 客户端判定不走 effect setState：空订阅的 external store，服务端/水合前 false、客户端 true
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // 展开 / 收起（规范 10.1）：服务端和水合前一律收起；水合后按设备读 localStorage
  //（同上面的 mounted：空订阅快照，水合后 React 自动对账，不用 effect 写状态）。
  // override：toggle 后以本地状态为准（订阅是空的，写 localStorage 不会自动通知）。
  // animOn：首次用户点击前是 false——水合时如果本来就是展开，直接就位不播高度动画。
  const storedOpen = useSyncExternalStore(noopSubscribe, sheetOpenSnapshot, () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const [animOn, setAnimOn] = useState(false);
  const open = override ?? storedOpen;

  const toggle = useCallback(() => {
    setAnimOn(true);
    const next = !open;
    // 写回前重读一遍（别的标签页可能也在写 seen），再合并；localStorage 读不到时只在内存切换
    const fresh = readStore();
    const merged = withSheetOpen(fresh, next);
    if (fresh && merged) writeStore(merged);
    setOverride(next);
  }, [open]);

  // 角色姿态：ready 前不动；ready 后摆 plan.pose（offline / rest / idle / stamped）
  useEffect(() => {
    if (!ready || !plan) return;
    const el = document.getElementById(ACTOR_ID);
    if (el) el.dataset.pose = plan.pose;
  }, [ready, plan]);

  const callbacks = useMemo(
    () => ({
      ...stageProps,
      onOverflow: (n: number): void => {
        setOverflowN(n);
      },
      onDone: (summary: { stamped: number; skipped: boolean }): void => {
        stageProps.onDone(summary);
        // 队列结束后角色站直（SealStage 自己也会设，这里兜底）
        const el = document.getElementById(ACTOR_ID);
        if (el) el.dataset.pose = "stamped";
      },
    }),
    [stageProps],
  );

  const yesterday = plan ? addDays(plan.today, -1) : null;

  // 小卡上的昨天事件：回放要演时用 plan.replay 的（顺序一致），否则从 plan.events 里筛昨天
  const cardEvents: SealEvent[] = plan
    ? plan.replay?.events ?? plan.events.filter((e) => shanghaiDate(e.at) === yesterday)
    : [];

  // 印条：本页日期（数据集里最新的一天）的事件按时间排，最多 8 枚
  const stripEvents =
    plan && plan.pageDate !== null ? plan.events.filter((e) => shanghaiDate(e.at) === plan.pageDate) : [];
  const stripShown = stripEvents.slice(0, WRAP.stripMax);

  // 收起行的计数（规范 10.1 第 3 条）："已盖"按 slotState 判，补盖每盖一枚计数加一；
  // ready 前渲染空串占位，不跳
  const stampedKinds: SealKind[] = plan
    ? plan.events.filter((e) => slotState(e.key) === "stamped").map((e) => e.kind)
    : [];
  const countText = ready ? foldCountText(stampedKinds) : "";

  // 收起行的小印位（规范 10.1 第 2 条）：近七日的印痕按早→晚，桌面取最近 8 枚、
  // 手机 4 枚（名额 / 隐藏 / +N 的算法在 seal-book 的 foldSlots）；"昨日"小印位占一个名额
  const ydaySlot = cardState !== "hidden";
  const fold = foldSlots(plan?.events.length ?? 0, ydaySlot);
  const foldEvents = plan ? plan.events.slice(fold.deskFrom) : [];

  // 印位格条目：释文按事件键归类，日期用中文（git 方章的日期在键里）。
  // 最新在前（照 mockup：十月四日左上……最旧在末），只反交给格子的数组，
  // plan.events 本身不动（补盖队列的时序仍按时间正序）。
  const bookItems: SealBookItem[] = [...(plan?.events ?? [])].reverse().map((e) => ({
    key: e.key,
    kind: e.kind,
    targetId: e.targetId,
    state: slotState(e.key),
    label: e.label,
    caption: eventCaption(e.key),
    date: cnDateText(e.key.startsWith("git:") ? e.key.slice(4) : shanghaiDate(e.at)),
  }));

  const hintTarget = mounted && overflowN !== null ? document.getElementById(HINT_ID) : null;

  return (
    <section className="td-a-seals seal-fold" data-open={open ? "true" : "false"} aria-labelledby="td-a-row-seals">
      <h2 className="seal-fold-h">
        <button type="button" className="seal-fold-bar" aria-expanded={open} aria-controls="seal-fold-sheet" onClick={toggle}>
          <span className="seal-fold-title" id="td-a-row-seals">
            新盖的章
          </span>
          <span className="seal-fold-marks" aria-hidden="true">
            {fold.plusD > 0 && <span className="seal-fold-plus seal-fold-plus-d">+{fold.plusD}</span>}
            {fold.plusM > 0 && <span className="seal-fold-plus seal-fold-plus-m">+{fold.plusM}</span>}
            {ydaySlot && yesterday !== null && (
              <span
                className="seal-fold-yday"
                id={open ? undefined : "seal-yesterday-card"}
                data-state={cardState}
                role="img"
                aria-label={"昨天的章，" + monthDay(yesterday)}
              >
                <span
                  className="seal-mark"
                  style={{ opacity: streakOpacity(plan?.streak ?? 0) }}
                  dangerouslySetInnerHTML={{
                    __html: markSvg("tuoyuan", {
                      size: 24,
                      prefix: "seal-fold-yday",
                      date: yesterday,
                      tier: 0,
                      dry: plan?.dry ?? false,
                    }),
                  }}
                />
              </span>
            )}
            {foldEvents.map((e, i) => (
              <span
                key={e.key}
                className="seal-fold-mark"
                data-m-hide={i < fold.phoneHideBefore || undefined}
                style={{ transform: `rotate(${REPLAY.rot[i % REPLAY.rot.length]}deg)` }}
              >
                <StampSlot
                  targetId={open ? undefined : e.targetId}
                  state={slotState(e.key)}
                  kind={e.kind}
                  size={24}
                  streak={plan?.streak}
                  dry={plan?.dry}
                  label={e.label}
                />
              </span>
            ))}
          </span>
          <span className="seal-fold-count tabular-nums">{countText}</span>
          <span className="seal-fold-toggle">
            {open ? "收起" : "展开"}
            <svg className="seal-fold-arrow" width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" focusable="false">
              <polyline
                points="1,1 4,4 7,1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
      </h2>

      <div id="seal-fold-sheet" className="seal-fold-sheet" data-anim={animOn ? "on" : "off"}>
        <div className="seal-fold-sheet-in" inert={!open || undefined} aria-hidden={!open ? "true" : undefined}>
          <div className="seal-book">
            <div className="seal-book-in">
              {open && cardState !== "hidden" && yesterday !== null && (
                <a
                  id="seal-yesterday-card"
                  data-state={cardState}
                  href={"/ledger?view=day&date=" + yesterday}
                  className="td-a-seal-card seal-sheet"
                  aria-label={"昨天的章，" + monthDay(yesterday)}
                  dangerouslySetInnerHTML={{
                    __html: replaySheetHtml({
                      date: yesterday,
                      events: cardEvents,
                      streak: plan?.streak ?? 0,
                      prefix: "seal-card",
                    }),
                  }}
                />
              )}

              <SealBookGrid items={bookItems} streak={plan?.streak} dry={plan?.dry} withIds={open} />

              {open && stripState !== "hidden" && plan?.pageDate != null && (
                <div id={"seal-strip-" + plan.pageDate} data-state={stripState} className="td-a-seal-strip">
                  <span className="td-a-seal-strip-note">当天印条 · {monthDay(plan.pageDate)}</span>
                  <span className="td-a-seal-strip-marks">
                    {stripShown.map((e) => (
                      <StampMark
                        key={e.key}
                        kind={e.kind}
                        size={32}
                        streak={plan?.streak}
                        dry={plan?.dry}
                        dataKey={e.key}
                      />
                    ))}
                    {stripEvents.length > WRAP.stripMax && (
                      <span className="td-a-seal-strip-plus tabular-nums">
                        +{stripEvents.length - WRAP.stripMax}
                      </span>
                    )}
                  </span>
                </div>
              )}

              {days === null ? (
                <p className="td-a-seal-note">还没有日报数据</p>
              ) : plan != null && plan.streak >= 1 ? (
                <p className="td-a-seal-note">连续提交 {plan.streak} 天</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {needsStage && plan != null && (
        <Suspense fallback={null}>
          <SealStage plan={plan} actorId={ACTOR_ID} size={160} {...callbacks} />
        </Suspense>
      )}

      {hintTarget !== null && overflowN !== null
        ? createPortal(
            <span className="td-a-seal-hint-text tabular-nums">还有 {overflowN} 个</span>,
            hintTarget,
          )
        : null}
    </section>
  );
}
