"use client";

// 旧账日视图（GROWTH_NAMES.ledger）的印章区（规范 10 行 / 8.5 后三行 / 8.6 最后两条）。
// 只显示这一天的印位：git 方章 + 本台设备这一天页内当场盖的章（SealBookGrid 印位格），
// 加当天印条（收工用）。没有昨日回放、没有回来了（planVisit 已按 page 分开处理）。
// 空白日：事件列表为空，不渲染虚线印位也不给提示，角色在服务端就是 rest。
// SealStage 用 lazy 按需加载，没有要补盖的队列时不加载那个 chunk（规范 11.3）。
import { lazy } from "react";
import { Suspense, useEffect } from "react";
import { useSealQueue } from "./useSealQueue.ts";
import { usePauseWhenHidden } from "./usePauseWhenHidden.ts";
import { SealBookGrid } from "./SealBookGrid.tsx";
import type { SealBookItem } from "./SealBookGrid.tsx";
import { StampMark } from "./StampMark.tsx";
import { cnDateText, eventCaption } from "./seal-book.ts";
import { WRAP } from "./seal-tokens.ts";
import { shanghaiDate } from "./seal-store.ts";
import type { SealDay } from "./seal-moments.ts";

const SealStage = lazy(() => import("./SealStage"));

const ACTOR_ID = "seal-actor-ledger";

export type LedgerDaySealsProps = {
  days: SealDay[] | null;
  generatedAt: string | null;
  pageDate: string;
};

export function LedgerDaySeals({ days, generatedAt, pageDate }: LedgerDaySealsProps) {
  const { ready, plan, slotState, stripState, needsStage, stageProps } = useSealQueue({
    page: "ledger-day",
    days,
    generatedAt,
    pageDate,
  });
  usePauseWhenHidden();

  // 角色姿态：ready 前不动；ready 后摆 plan.pose（offline / rest / idle / stamped）
  useEffect(() => {
    if (!ready || !plan) return;
    const el = document.getElementById(ACTOR_ID);
    if (el) el.dataset.pose = plan.pose;
  }, [ready, plan]);

  // 队列结束后角色站直（SealStage 自己也会设，这里兜底）
  const callbacks = {
    ...stageProps,
    onDone: (summary: { stamped: number; skipped: boolean }): void => {
      stageProps.onDone(summary);
      const el = document.getElementById(ACTOR_ID);
      if (el) el.dataset.pose = "stamped";
    },
  };

  // 印条：这一页日期（=正在看的那天）的事件按时间排，最多 8 枚
  const stripEvents =
    plan && plan.pageDate !== null ? plan.events.filter((e) => shanghaiDate(e.at) === plan.pageDate) : [];
  const stripShown = stripEvents.slice(0, WRAP.stripMax);

  // 印位格：git 方章写「提交 N 次」，其他按事件键归类；日期用中文
  const bookItems: SealBookItem[] = (plan?.events ?? []).map((e) => {
    const isGit = e.key.startsWith("git:");
    const day = isGit ? days?.find((d) => `git:${d.date}` === e.key) : undefined;
    return {
      key: e.key,
      kind: e.kind,
      targetId: e.targetId,
      state: slotState(e.key),
      label: e.label,
      caption: isGit ? `提交 ${day?.commits ?? 0} 次` : eventCaption(e.key),
      date: cnDateText(isGit ? e.key.slice(4) : shanghaiDate(e.at)),
    };
  });

  return (
    <div className="daily-a-seal-body">
      <SealBookGrid items={bookItems} streak={plan?.streak} dry={plan?.dry} />

      {stripState !== "hidden" && plan?.pageDate != null && (
        <div id={"seal-strip-" + plan.pageDate} data-state={stripState} className="daily-a-seal-strip">
          <span className="daily-a-seal-strip-note">当天印条</span>
          <span className="daily-a-seal-strip-marks">
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
              <span className="daily-a-seal-strip-plus tabular-nums">
                +{stripEvents.length - WRAP.stripMax}
              </span>
            )}
          </span>
        </div>
      )}

      {needsStage && plan != null && (
        <Suspense fallback={null}>
          <SealStage plan={plan} actorId={ACTOR_ID} size={96} {...callbacks} />
        </Suspense>
      )}
    </div>
  );
}
