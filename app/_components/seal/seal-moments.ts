// 印章情绪时刻编排（规范第 6 节 + 8.6 规则），纯函数，可单测。
// planVisit 算出这次打开页面要演什么：开场（昨日回放）、补盖队列、收尾（6.8 优先级）。
import { BACK, QUEUE } from "./seal-tokens.ts";
import { tierOf } from "./seal-tokens.ts";
import type { SealKind, SealPose } from "./seal-tokens.ts";
import type { SealStore, StampLogEntry } from "./seal-store.ts";
import { addDays, daysBetween, isNewEvent, keyDate, markSeen, newDeviceStore, pruneStore, shanghaiDate, stampLogOn, touchVisit } from "./seal-store.ts";
import { GROWTH_NAMES } from "../../../lib/site-nav.ts";

export type SealEvent = { key: string; kind: SealKind; at: string; label: string; targetId: string };
export type SealDay = { date: string; commits: number | null };
export type Closing = "welcomeBack" | "dayWrap" | "nod" | null;

export type VisitPlan = {
  firstVisit: boolean;
  today: string;
  pageDate: string | null;
  streak: number;
  tier: 0 | 1 | 2 | 3;
  dry: boolean;
  events: SealEvent[];          // 页面上要显示的全部事件，按 at 升序
  stamped: string[];            // 一打开就显示成已盖的键
  replay: { date: string; events: SealEvent[] } | null; // 开场：昨日回放
  queue: SealEvent[];           // 补盖
  animated: SealEvent[];
  instant: SealEvent[];
  overflow: number;
  speed: number;
  gapMs: number;
  spread: boolean;
  nodLast: boolean;
  closing: Closing;
  welcomeBack: boolean;
  dayWrapDate: string | null;
  pose: SealPose;               // 开场前角色的静态姿态：offline / rest / idle / stamped
  momentKeys: string[];         // 开场和收尾演完（或被跳过）时要写进 seen 的键
  store: SealStore;             // 打开时立刻写回的 store（已 touchVisit；新设备时已把所有键写满）
};

/** 印痕落点的 DOM id：键里除字母数字下划线连字符以外的字符都换成连字符 */
export function slotId(key: string): string {
  return "seal-slot-" + key.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** git 方章事件：commits > 0 的天各一枚，代表一整天，at 放在当天最后（23:59） */
export function gitEvents(days: SealDay[]): SealEvent[] {
  return days
    .filter((d) => (d.commits ?? 0) > 0)
    .map((d) => {
      const key = `git:${d.date}`;
      const m = Number(d.date.slice(5, 7));
      const day = Number(d.date.slice(8, 10));
      return {
        key,
        kind: "fang" as const,
        at: `${d.date}T23:59:00+08:00`,
        label: `${m} 月 ${day} 日 · 提交 ${d.commits} 次`,
        targetId: slotId(key),
      };
    });
}

/** 页内盖章事件：stampLog 里的条目转事件，label 按键前缀 */
export function inPageEvents(log: StampLogEntry[]): SealEvent[] {
  return log.map((e) => {
    const prefix = e.key.slice(0, e.key.indexOf(":"));
    const label =
      prefix === "read" ? "读完一篇" : prefix === "review" ? "审稿通过" : prefix === "mirror" ? GROWTH_NAMES.mirror.label : "页内盖章";
    return { key: e.key, kind: e.seal, at: e.at, label, targetId: slotId(e.key) };
  });
}

/** 连续提交天数：从数据集里最新的一天往前数，连续每天 commits > 0；缺的日期算断；最新一天为 0/null 时返回 0 */
export function commitStreak(days: SealDay[] | null): number {
  if (!days || days.length === 0) return 0;
  const commitsByDate = new Map<string, number>();
  for (const d of days) commitsByDate.set(d.date, d.commits ?? 0);
  const latest = [...days].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  let streak = 0;
  let cursor = latest.date;
  while ((commitsByDate.get(cursor) ?? 0) > 0) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 空白日：这天在数据集里、commits 为 0 或 null、并且 stampLog 里这天没有页内章 */
export function isBlankDay(days: SealDay[] | null, date: string, log: StampLogEntry[]): boolean {
  if (!days || !date) return false;
  const day = days.find((d) => d.date === date);
  if (!day) return false; // 不在数据集里不算空白日（数据缺失走 offline）
  if ((day.commits ?? 0) > 0) return false;
  return !log.some((e) => shanghaiDate(e.at) === date);
}

/** 回来了：距上次打开 ≥ BACK.days 个自然日，并且有新事件（规范 6.6） */
export function isWelcomeBack(lastVisitAt: string | null, now: string, hasNew: boolean): boolean {
  if (!lastVisitAt) return false;
  return daysBetween(shanghaiDate(lastVisitAt), shanghaiDate(now)) >= BACK.days && hasNew;
}

function sortByAt(events: SealEvent[]): SealEvent[] {
  return [...events].sort((a, b) => {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

function dedupeEvents(events: SealEvent[]): SealEvent[] {
  const set = new Set<string>();
  const out: SealEvent[] = [];
  for (const e of events) {
    if (set.has(e.key)) continue;
    set.add(e.key);
    out.push(e);
  }
  return out;
}

/**
 * 算这次打开页面的演出计划（规范 6.8：开场 → 补盖队列 → 收尾，最多一个开场一个收尾）。
 * 纯函数：不改入参；store 字段是要立刻写回 localStorage 的内容（已 touchVisit）。
 * 事件键不在这里写进 seen，由播放器在印痕真正显示时逐个写（规范 7.4 第 7 条）。
 */
export function planVisit(input: {
  store: SealStore | null;
  days: SealDay[] | null;
  generatedAt: string | null;
  now: string;
  page: "today" | "ledger-day";
  pageDate?: string;
  maxAnimated?: number;
}): VisitPlan {
  const today = shanghaiDate(input.now);
  const days = input.days && input.days.length > 0 ? input.days : null;
  const maxAnimated = input.maxAnimated ?? QUEUE.maxAnimated;

  // 规则 1：数据缺失或数据集为空 → offline，不播任何东西
  if (!days) {
    const base =
      input.store ??
      newDeviceStore([], { today, now: input.now, generatedAt: input.generatedAt, streak: 0 });
    return {
      firstVisit: false,
      today,
      pageDate: null,
      streak: 0,
      tier: 0,
      dry: true,
      events: [],
      stamped: [],
      replay: null,
      queue: [],
      animated: [],
      instant: [],
      overflow: 0,
      speed: 1,
      gapMs: QUEUE.gap,
      spread: true,
      nodLast: false,
      closing: null,
      welcomeBack: false,
      dayWrapDate: null,
      pose: "offline",
      momentKeys: [],
      store: touchVisit(base, { now: input.now, generatedAt: input.generatedAt, streak: 0 }),
    };
  }

  // 规则 2：页面日期（今天页 = 数据集里最新的一天）、连续天数、干印
  const streak = commitStreak(days);
  const dry = streak <= 0;
  const tier = tierOf(streak);
  const pageDate =
    input.page === "today"
      ? [...days].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0].date
      : (input.pageDate ?? null);

  // 老设备先裁剪（规则 5）；新设备（store 为 null）走规则 4
  const pruned = input.store ? pruneStore(input.store, today) : null;

  // 规则 3：页面上要显示的事件
  let events: SealEvent[];
  if (input.page === "today") {
    // 近 7 天的 git 方章照常显示，更早的只有“新”的才进来（回来了要补）
    const cutoff = addDays(today, -6);
    const seenSet = pruned ? new Set(pruned.seen) : null;
    const git = gitEvents(days).filter((e) => {
      const d = keyDate(e.key);
      if (d !== null && d >= cutoff) return true;
      return seenSet === null || !seenSet.has(e.key);
    });
    const inPage = inPageEvents(pruned?.stampLog ?? []);
    events = dedupeEvents([...git, ...inPage]);
  } else {
    const git = pageDate ? gitEvents(days).filter((e) => e.key === `git:${pageDate}`) : [];
    const inPage = pruned && pageDate ? inPageEvents(stampLogOn(pruned, pageDate)) : [];
    events = dedupeEvents([...git, ...inPage]);
  }
  events = sortByAt(events);

  const pageHasEvents = pageDate !== null && events.some((e) => shanghaiDate(e.at) === pageDate);

  // 规则 4：新设备第一次打开，不播任何动画，全部显示成已盖
  if (pruned === null) {
    const keys = [
      ...events.map((e) => e.key),
      `replay:${today}`,
      ...(pageDate !== null && pageHasEvents ? [`wrap:${pageDate}`] : []),
    ];
    const store = newDeviceStore(keys, { today, now: input.now, generatedAt: input.generatedAt, streak });
    const blank = pageDate !== null && isBlankDay(days, pageDate, []);
    return {
      firstVisit: true,
      today,
      pageDate,
      streak,
      tier,
      dry,
      events,
      stamped: events.map((e) => e.key),
      replay: null,
      queue: [],
      animated: [],
      instant: [],
      overflow: 0,
      speed: 1,
      gapMs: QUEUE.gap,
      spread: true,
      nodLast: false,
      closing: null,
      welcomeBack: false,
      dayWrapDate: null,
      pose: blank ? "rest" : "idle",
      momentKeys: [],
      store,
    };
  }

  // 规则 5：新事件 = 键不在 seen 里且事件日期不早于 firstSeenDate
  const newEvents = events.filter((e) => isNewEvent(pruned, e));
  const newKeys = new Set(newEvents.map((e) => e.key));
  const stamped = events.filter((e) => !newKeys.has(e.key)).map((e) => e.key);

  // 规则 6：回来了（只在今天页，每台设备每天只演一次）
  const backKey = `back:${today}`;
  const welcomeBack =
    input.page === "today" &&
    !pruned.seen.includes(backKey) &&
    isWelcomeBack(pruned.lastVisitAt, input.now, newEvents.length > 0);

  // 规则 7：昨日回放（只在今天页）。昨天数据没到就不演、也不写键；welcomeBack 时不演但写键。
  const replayKey = `replay:${today}`;
  const yesterday = addDays(today, -1);
  let replay: { date: string; events: SealEvent[] } | null = null;
  if (input.page === "today" && !welcomeBack && !pruned.seen.includes(replayKey)) {
    const yesterdayInDays = days.some((d) => d.date === yesterday);
    if (yesterdayInDays && pruned.firstSeenDate <= yesterday) {
      // 昨天的页内章按时间排，git 方章代表一整天排在最后；不管看没看过都放上纸
      const replayEvents = inPageEvents(stampLogOn(pruned, yesterday));
      const gitYesterday = gitEvents(days).find((e) => e.key === `git:${yesterday}`);
      if (gitYesterday) replayEvents.push(gitYesterday);
      replay = { date: yesterday, events: replayEvents };
    }
  }

  // 规则 8：补盖队列 = 新事件去掉回放里的，按 at 升序；最多播 maxAnimated 个，其余一起淡入
  const replayKeys = new Set(replay ? replay.events.map((e) => e.key) : []);
  const queue = newEvents.filter((e) => !replayKeys.has(e.key));
  const animated = queue.slice(0, maxAnimated);
  const instant = queue.slice(maxAnimated);
  const overflow = instant.length;

  // 规则 9：回来了走快速补盖（时长乘 0.6、间隔 120ms、不洇开、不点头）
  const speed = welcomeBack ? BACK.speed : 1;
  const gapMs = welcomeBack ? BACK.gap : QUEUE.gap;
  const spread = !welcomeBack;

  // 规则 10：一天收工。回放的那天不再单独收工（replay 就是昨天的收工）。
  const wrapKey = pageDate !== null ? `wrap:${pageDate}` : null;
  const dayWrapDate =
    wrapKey !== null &&
    pageHasEvents &&
    pageDate !== null &&
    pageDate >= pruned.firstSeenDate &&
    !pruned.seen.includes(wrapKey) &&
    replay?.date !== pageDate
      ? pageDate
      : null;

  // 规则 11：收尾最多一个（6.8 优先级）。nodLast 只在 closing === "nod" 时为 true。
  let closing: Closing;
  if (welcomeBack) closing = "welcomeBack";
  else if (dayWrapDate !== null) closing = "dayWrap";
  else if (queue.length > 0 && overflow === 0) closing = "nod";
  else closing = null;
  const nodLast = closing === "nod";

  // 规则 12：开场和收尾演完（或被跳过）时要写进 seen 的键
  const momentKeys: string[] = [];
  if (replay) {
    momentKeys.push(replayKey, `wrap:${replay.date}`);
  }
  if (welcomeBack) {
    // 回来了之后不再演一天收工、也不再演昨日回放
    momentKeys.push(backKey, replayKey);
    if (pageDate !== null && pageHasEvents) momentKeys.push(`wrap:${pageDate}`);
  }
  if (dayWrapDate !== null) momentKeys.push(`wrap:${dayWrapDate}`);
  const momentSet = new Set(momentKeys);

  // 规则 13：开场前角色的静态姿态
  const blank = pageDate !== null && isBlankDay(days, pageDate, pruned.stampLog);
  let pose: SealPose;
  if (blank && queue.length === 0 && replay === null) pose = "rest";
  else if (queue.length === 0 && replay === null) pose = "idle";
  else pose = "stamped";

  // 规则 14：立刻写回的 store 只 touchVisit；事件键由播放器逐个写
  const store = touchVisit(pruned, { now: input.now, generatedAt: input.generatedAt, streak });

  return {
    firstVisit: false,
    today,
    pageDate,
    streak,
    tier,
    dry,
    events,
    stamped,
    replay,
    queue,
    animated,
    instant,
    overflow,
    speed,
    gapMs,
    spread,
    nodLast,
    closing,
    welcomeBack,
    dayWrapDate,
    pose,
    momentKeys: [...momentSet],
    store,
  };
}

/** 打断或跳过：把队列全部键、回放事件键和 momentKeys 都写进 seen */
export function skipAll(store: SealStore, plan: VisitPlan): SealStore {
  const keys = [
    ...plan.queue.map((e) => e.key),
    ...(plan.replay ? plan.replay.events.map((e) => e.key) : []),
    ...plan.momentKeys,
  ];
  return markSeen(store, keys);
}

/** 正常播完后用，等同 skipAll */
export function finishedStore(store: SealStore, plan: VisitPlan): SealStore {
  return skipAll(store, plan);
}
