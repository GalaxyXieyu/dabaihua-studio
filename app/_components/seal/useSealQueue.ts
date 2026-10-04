"use client";

// 页面客户端组件用它拿印章队列状态（规范 8.6 的读写 + 6.8 的 plan）：
// ready 之前所有印位是 "unknown"（服务端初始）；读完 localStorage、planVisit 之后
// 立刻写回 plan.store；onStamped / onMoment / onSkip 已接好 localStorage，
// 直接把 stageProps 铺进 SealStage 就能演。
// 也导出 readStore / writeStore 两个小工具，第 5 部分页内盖章（阅读/审稿/镜子卡片）要用。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORE_KEY, addDays, markSeen, parseStore, pruneStore, serializeStore, shanghaiDate } from "./seal-store.ts";
import type { SealStore } from "./seal-store.ts";
import { planVisit, skipAll } from "./seal-moments.ts";
import type { SealDay, VisitPlan } from "./seal-moments.ts";

/** SealStage 的回调形状（SealStage.tsx 的 SealStageProps 去掉 plan/actorId/size/copy） */
export type SealStageCallbacks = {
  onStamped(key: string): void;
  onMoment(moment: "replay" | "dayWrap" | "welcomeBack" | "nod"): void;
  onSkip(): void;
  onDone(summary: { stamped: number; skipped: boolean }): void;
  onOverflow?(n: number): void;
};

export type SealSlotState = "unknown" | "pending" | "stamped";
export type SealAuxState = "hidden" | "pending" | "stamped";

/** 读 localStorage 里的印章 store（不可用/没有/坏 JSON 都返回 null）；第 5 部分页内盖章也用它 */
export function readStore(): SealStore | null {
  try {
    return parseStore(window.localStorage.getItem(STORE_KEY));
  } catch {
    return null;
  }
}

/** 写回 store（try/catch 包好）。返回 false 表示 localStorage 不可写（隐私模式等），之后调用方可以不再写 */
export function writeStore(s: SealStore): boolean {
  try {
    window.localStorage.setItem(STORE_KEY, serializeStore(s));
    return true;
  } catch {
    return false;
  }
}

/** moment 演完（或被跳过）要写进 seen 的键（与 planVisit 规则 12 的口径一致） */
function momentKeysFor(plan: VisitPlan, moment: "replay" | "dayWrap" | "welcomeBack" | "nod"): string[] {
  const keys: string[] = [];
  if (moment === "replay") {
    keys.push(`replay:${plan.today}`);
    if (plan.replay) keys.push(`wrap:${plan.replay.date}`);
  } else if (moment === "dayWrap") {
    if (plan.dayWrapDate) keys.push(`wrap:${plan.dayWrapDate}`);
  } else if (moment === "welcomeBack") {
    // 回来了之后不再演一天收工、也不再演昨日回放，键都写上
    keys.push(`back:${plan.today}`, `replay:${plan.today}`);
    if (plan.pageDate) keys.push(`wrap:${plan.pageDate}`);
  }
  return keys;
}

export type UseSealQueueInput = {
  page: "today" | "ledger-day";
  days: SealDay[] | null;
  generatedAt: string | null;
  pageDate?: string;
  maxAnimated?: number;
  gapMs?: number;
};

export function useSealQueue(input: UseSealQueueInput) {
  const { page, days, generatedAt, pageDate, maxAnimated, gapMs } = input;

  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState<VisitPlan | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set<string>());

  // 内存里的 store（读不到 localStorage 时也维护，只是不写回）
  const storeRef = useRef<SealStore | null>(null);
  // localStorage 是否可写（不可用时当新设备、并且之后不写）
  const writableRef = useRef(true);
  const plannedKeyRef = useRef<string | null>(null);
  const planRef = useRef<VisitPlan | null>(null);
  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  // days 是数组，父组件每次渲染都可能换引用；用内容 key 判变化，避免无谓地重算 plan
  const daysKey = days == null ? "" : days.map((d) => `${d.date}:${d.commits ?? ""}`).join(",");

  useEffect(() => {
    const key = `${page}|${daysKey}|${generatedAt ?? ""}|${pageDate ?? ""}|${maxAnimated ?? ""}|${gapMs ?? ""}`;
    if (plannedKeyRef.current === key) return;
    plannedKeyRef.current = key;

    let available = true;
    let store: SealStore | null = null;
    try {
      store = parseStore(window.localStorage.getItem(STORE_KEY));
    } catch {
      available = false; // localStorage 本身不可用：当新设备（store 为 null），之后不写
    }
    const p = planVisit({
      store,
      days,
      generatedAt,
      now: new Date().toISOString(),
      page,
      pageDate,
      maxAnimated,
    });
    if (available) {
      // 打开页面立刻写回（touchVisit / 新设备补全键）
      available = writeStore(p.store);
    }
    writableRef.current = available;
    storeRef.current = p.store;

    const withGap = gapMs != null ? { ...p, gapMs } : p;
    setPlan(withGap);
    setSeen(new Set(p.store.seen));
    setReady(true);
  }, [page, daysKey, generatedAt, pageDate, maxAnimated, gapMs, days]);

  /** 先重新读一遍 localStorage 再合并（别的标签页可能也在写），再 pruneStore，写回并更新 seen */
  const persist = useCallback((mutate: (s: SealStore) => SealStore): SealStore | null => {
    const fresh = writableRef.current ? readStore() : null;
    const base = fresh ?? storeRef.current;
    if (!base) return null;
    const today = shanghaiDate(Date.now());
    const next = pruneStore(mutate(base), today);
    storeRef.current = next;
    if (writableRef.current) {
      writableRef.current = writeStore(next); // 写失败一次之后不再写
    }
    setSeen(new Set(next.seen));
    return next;
  }, []);

  const onStamped = useCallback(
    (key: string): void => {
      persist((s) => markSeen(s, [key]));
    },
    [persist],
  );

  const onMoment = useCallback(
    (moment: "replay" | "dayWrap" | "welcomeBack" | "nod"): void => {
      const p = planRef.current;
      if (!p) return;
      persist((s) => markSeen(s, momentKeysFor(p, moment)));
    },
    [persist],
  );

  // 打断或手动跳过：把队列全部键、回放事件键和 momentKeys 都写进 seen
  const onSkip = useCallback((): void => {
    const p = planRef.current;
    if (!p) return;
    persist((s) => skipAll(s, p));
  }, [persist]);

  const onDone = useCallback((): void => {
    // 键都已在 onStamped / onMoment 里逐个写过，这里没有要写的
  }, []);

  const onOverflow = useCallback((): void => {
    // “还有 N 个” 由页面用返回值 overflow 自行渲染
  }, []);

  const stageProps = useMemo<SealStageCallbacks>(
    () => ({ onStamped, onMoment, onSkip, onDone, onOverflow }),
    [onStamped, onMoment, onSkip, onDone, onOverflow],
  );

  // pendingKeys：这页要补盖/回放显示的新事件键（动画前是 pending 虚线印位）
  const pendingKeys = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    if (!plan) return set;
    for (const e of plan.queue) set.add(e.key);
    if (plan.replay) for (const e of plan.replay.events) set.add(e.key);
    return set;
  }, [plan]);

  const slotState = useCallback(
    (key: string): SealSlotState => {
      if (!ready || !plan) return "unknown";
      if (seen.has(key)) return "stamped";
      if (pendingKeys.has(key)) return "pending";
      // 不在补盖队列里的（打开时就已看过，或不在本页数据里）显示成已盖
      return "stamped";
    },
    [ready, plan, seen, pendingKeys],
  );

  const stripState = useMemo<SealAuxState>(() => {
    if (!ready || !plan) return "hidden";
    // 印条：wrap:<本页日期> 已在 seen 则 stamped；closing 是 dayWrap 则 pending；否则 hidden
    const wrapKey = plan.pageDate ? `wrap:${plan.pageDate}` : null;
    if (wrapKey && seen.has(wrapKey)) return "stamped";
    if (plan.closing === "dayWrap") return "pending";
    return "hidden";
  }, [ready, plan, seen]);

  const cardState = useMemo<SealAuxState>(() => {
    if (!ready || !plan) return "hidden";
    // 昨日小卡：replay:<今天> 已在 seen 且数据里有昨天且不是回来了则 stamped；plan.replay 则 pending
    const replayKey = `replay:${plan.today}`;
    const hasYesterday = days != null && days.some((d) => d.date === addDays(plan.today, -1));
    if (seen.has(replayKey) && hasYesterday && !plan.welcomeBack) return "stamped";
    if (plan.replay) return "pending";
    return "hidden";
  }, [ready, plan, seen, days]);

  const needsStage =
    ready &&
    plan !== null &&
    !plan.firstVisit &&
    (plan.queue.length > 0 || plan.replay !== null || plan.closing === "welcomeBack" || plan.closing === "dayWrap");

  return {
    ready,
    plan,
    slotState,
    stripState,
    cardState,
    needsStage,
    overflow: plan?.overflow ?? 0,
    stageProps,
    skip: onSkip,
  };
}
