"use client";

// "今天"页的"新盖的章"栏目（规范 10 行 / 6.7 / 7.4 / 11.3）：印谱叶（文武边），
// 居中标题 + SealBookGrid 行均衡印位格 + 昨天小卡 + 当天印条。
// 服务端渲染时印位是 unknown、小卡和印条不渲染，避免先闪出印痕再消失；
// SealStage 用 lazy 按需加载，没有新事件时不加载那个 chunk（规范 11.3）。
// 跳过/打断的监听都在 SealStage 和 useSealQueue 里，本组件不另外监听。
import { lazy } from "react";
import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useSealQueue } from "./useSealQueue.ts";
import { usePauseWhenHidden } from "./usePauseWhenHidden.ts";
import { SealBookGrid } from "./SealBookGrid.tsx";
import type { SealBookItem } from "./SealBookGrid.tsx";
import { StampMark } from "./StampMark.tsx";
import { replaySheetHtml } from "./seal-sheet.ts";
import { cnCount, cnDateText, eventCaption } from "./seal-book.ts";
import { REPLAY, WRAP } from "./seal-tokens.ts";
import { addDays, shanghaiDate } from "./seal-store.ts";
import type { SealDay, SealEvent } from "./seal-moments.ts";

const SealStage = lazy(() => import("./SealStage"));

const ACTOR_ID = "seal-actor-today";
const HINT_ID = "seal-hint-today";

/** useSyncExternalStore 的空订阅：从不通知，客户端快照恒为 true */
function noopSubscribe(): () => void {
  return () => {};
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

  const count = plan?.events.length ?? 0;

  // 印位格条目：释文按事件键归类，日期用中文（git 方章的日期在键里）
  const bookItems: SealBookItem[] = (plan?.events ?? []).map((e) => ({
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
    <section className="td-a-seals seal-book" aria-labelledby="td-a-row-seals">
      <div className="seal-book-in">
        <header className="seal-book-head">
          <h2 className="seal-book-title" id="td-a-row-seals">
            新盖的章
          </h2>
          <p className="seal-book-sub">{count === 0 ? "近七日 · 未盖" : `近七日 · ${cnCount(count)}枚`}</p>
        </header>

        {cardState !== "hidden" && yesterday !== null && (
          <div className="td-a-seal-card-wrap">
            <p className="td-a-seal-card-note">昨天 · {monthDay(yesterday)}</p>
            <a
              id="seal-yesterday-card"
              data-state={cardState}
              href={"/ledger?view=day&date=" + yesterday}
              className="td-a-seal-card"
              aria-label={"昨天的章，" + monthDay(yesterday)}
            >
              <span
                className="td-a-seal-card-sheet"
                style={{ width: REPLAY.sheetW, height: REPLAY.sheetH }}
                dangerouslySetInnerHTML={{
                  __html: replaySheetHtml({
                    date: yesterday,
                    events: cardEvents,
                    streak: plan?.streak ?? 0,
                    prefix: "seal-card",
                  }),
                }}
              />
            </a>
          </div>
        )}

        <SealBookGrid items={bookItems} streak={plan?.streak} dry={plan?.dry} />

        {stripState !== "hidden" && plan?.pageDate != null && (
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
