"use client";

// "今天"页的"新盖的章"栏目（规范 10 行 / 6.7 / 7.4 / 11.3）。
// 服务端渲染时印位是 unknown、小卡和印条不渲染，避免先闪出印痕再消失；
// SealStage 用 lazy 按需加载，没有新事件时不加载那个 chunk（规范 11.3）。
// 跳过/打断的监听都在 SealStage 和 useSealQueue 里，本组件不另外监听。
import { lazy } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSealQueue } from "./useSealQueue.ts";
import { usePauseWhenHidden } from "./usePauseWhenHidden.ts";
import { StampSlot } from "./StampSlot.tsx";
import { StampMark } from "./StampMark.tsx";
import { replaySheetHtml } from "./seal-sheet.ts";
import { REPLAY, WRAP } from "./seal-tokens.ts";
import { addDays, shanghaiDate } from "./seal-store.ts";
import type { SealDay, SealEvent } from "./seal-moments.ts";

const SealStage = lazy(() => import("./SealStage"));

const ACTOR_ID = "seal-actor-today";
const HINT_ID = "seal-hint-today";

export type TodaySealsProps = {
  days: SealDay[] | null;
  generatedAt: string | null;
};

/** Asia/Shanghai 的 HH:mm（固定 +8 偏移，不用 Intl；和 seal-sheet 同口径） */
function shanghaiTime(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 8 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "2026-10-03" → "10·03"（git 方章下面的小字） */
function mmdd(date: string): string {
  return `${date.slice(5, 7)}·${date.slice(8, 10)}`;
}

/** "2026-10-03" → "10 月 3 日" */
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
  const hintTarget = mounted && overflowN !== null ? document.getElementById(HINT_ID) : null;

  return (
    <section className="td-a-row td-a-seals" aria-labelledby="td-a-row-seals">
      <div className="td-a-col-label">
        <span className="td-a-roman" aria-hidden="true"> </span>
        <span className="td-a-label" id="td-a-row-seals">新盖的章</span>
      </div>
      <div className="td-a-col-body">
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

        <ol className="td-a-seal-cells">
          {(plan?.events ?? []).map((e) => {
            const isGit = e.key.startsWith("git:");
            return (
              <li key={e.key} className="td-a-seal-cell">
                <StampSlot
                  targetId={e.targetId}
                  state={slotState(e.key)}
                  kind={e.kind}
                  size={48}
                  streak={plan?.streak}
                  dry={plan?.dry}
                  label={e.label}
                />
                <span className="td-a-seal-cell-note">
                  <span>{isGit ? mmdd(e.key.slice(4)) : e.label}</span>
                  <span>{isGit ? "提交" : shanghaiTime(e.at)}</span>
                </span>
              </li>
            );
          })}
        </ol>

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

        {needsStage && plan != null && (
          <Suspense fallback={null}>
            <SealStage plan={plan} actorId={ACTOR_ID} size={160} {...callbacks} />
          </Suspense>
        )}
      </div>
      <div className="td-a-col-figure">
        <span className={count > 0 ? "td-a-index tabular-nums" : "td-a-index tabular-nums is-zero"}>{count}</span>
        <span className="td-a-unit">枚</span>
        <span className="td-a-unit-note">近 7 天</span>
      </div>
      {hintTarget !== null && overflowN !== null
        ? createPortal(
            <span className="td-a-seal-hint-text tabular-nums">还有 {overflowN} 个</span>,
            hintTarget,
          )
        : null}
    </section>
  );
}
