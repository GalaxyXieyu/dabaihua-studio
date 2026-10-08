// 印章 localStorage 规则（规范 8.6），纯函数，不碰 window。
// 读写由播放器（第 3 部分）负责，这里只做数据整形与裁剪。
import { SEEN_DAYS, SEEN_MAX_UNDATED, STAMPLOG_DAYS } from "./seal-tokens.ts";
import type { SealKind } from "./seal-tokens.ts";

export const STORE_KEY = "superme.seal.v1";

export type StampLogEntry = { key: string; seal: SealKind; at: string };

export type SealStore = {
  firstSeenDate: string;
  lastSealSeenAt: string | null; // 最后一次打开时数据集的 generatedAt
  lastVisitAt: string | null;    // 最后一次打开的本地时间，给“回来了”用
  seen: string[];                // 已看过的事件键，不带时间
  stampLog: StampLogEntry[];     // 本设备页内当场盖的章，只留最近 2 天，给昨日回放用
  streak?: number;               // 今天页算出的连续提交天数缓存（页内章定力度用）
  sheetOpen?: boolean;           // 今天页盖章区是否展开，规范 10.1；缺省 = 收起
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Asia/Shanghai 日历日 YYYY-MM-DD。固定 +8 偏移计算，不用 Intl */
export function shanghaiDate(t: string | number | Date): string {
  const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
}

/** 日期字符串按 UTC 平移 n 天（日历日运算，不涉时区） */
export function addDays(date: string, n: number): string {
  const ms = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(ms)) return date;
  return new Date(ms + n * 86400e3).toISOString().slice(0, 10);
}

/** b − a 的自然日数（可为负；非法输入返回 NaN） */
export function daysBetween(a: string, b: string): number {
  const ma = Date.parse(a + "T00:00:00Z");
  const mb = Date.parse(b + "T00:00:00Z");
  if (!Number.isFinite(ma) || !Number.isFinite(mb)) return NaN;
  return Math.round((mb - ma) / 86400e3);
}

function isDate(s: string): boolean {
  return DATE_RE.test(s) && Number.isFinite(Date.parse(s + "T00:00:00Z"));
}

/**
 * 事件键里的日期：git:/wrap:/back:/replay: 后面直接是日期；list:<id>:<日期> 取最后一段；
 * habit:<id>:<yyyyMMdd> 转成 YYYY-MM-DD；其余（read:/review:/mirror:/dida:）不带日期，返回 null。
 */
export function keyDate(key: string): string | null {
  const i = key.indexOf(":");
  if (i < 0) return null;
  const prefix = key.slice(0, i);
  const rest = key.slice(i + 1);
  if (prefix === "git" || prefix === "wrap" || prefix === "back" || prefix === "replay") {
    return isDate(rest) ? rest : null;
  }
  if (prefix === "list") {
    const last = rest.split(":").pop() ?? "";
    return isDate(last) ? last : null;
  }
  if (prefix === "habit") {
    const last = rest.split(":").pop() ?? "";
    return /^\d{8}$/.test(last) ? `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}` : null;
  }
  return null;
}

/** JSON 解析；字段缺失/类型不对时尽量补默认值；firstSeenDate 不是合法日期返回 null（当新设备） */
export function parseStore(raw: string | null): SealStore | null {
  if (raw == null) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const firstSeenDate = typeof o.firstSeenDate === "string" ? o.firstSeenDate : "";
  if (!isDate(firstSeenDate)) return null;
  const seen = Array.isArray(o.seen)
    ? o.seen.filter((k): k is string => typeof k === "string")
    : [];
  const stampLog: StampLogEntry[] = Array.isArray(o.stampLog)
    ? o.stampLog.filter(
        (e): e is StampLogEntry =>
          e != null &&
          typeof e === "object" &&
          typeof (e as Record<string, unknown>).key === "string" &&
          typeof (e as Record<string, unknown>).seal === "string" &&
          typeof (e as Record<string, unknown>).at === "string",
      )
    : [];
  const store: SealStore = {
    firstSeenDate,
    lastSealSeenAt: typeof o.lastSealSeenAt === "string" ? o.lastSealSeenAt : null,
    lastVisitAt: typeof o.lastVisitAt === "string" ? o.lastVisitAt : null,
    seen,
    stampLog,
  };
  if (typeof o.streak === "number") store.streak = o.streak;
  if (typeof o.sheetOpen === "boolean") store.sheetOpen = o.sheetOpen;
  return store;
}

/** 读展开状态：store 为 null 或没有字段 → false */
export function isSheetOpen(s: SealStore | null): boolean {
  return s?.sheetOpen === true;
}

/** 不可变地写展开状态；s 为 null 时返回 null（还没有 store 就不建，避免把新设备当成老设备） */
export function withSheetOpen(s: SealStore | null, open: boolean): SealStore | null {
  if (s == null) return null;
  return { ...s, sheetOpen: open };
}

export function serializeStore(s: SealStore): string {
  return JSON.stringify(s);
}

/**
 * 裁剪：seen 去重保序；带日期的键早于 addDays(today, -SEEN_DAYS) 的删掉；
 * 不带日期的键只留最后 SEEN_MAX_UNDATED 个；stampLog 只留最近 STAMPLOG_DAYS 天。
 */
export function pruneStore(s: SealStore, today: string): SealStore {
  // 去重保序
  const seen: string[] = [];
  const seenSet = new Set<string>();
  for (const k of s.seen) {
    if (typeof k !== "string" || seenSet.has(k)) continue;
    seenSet.add(k);
    seen.push(k);
  }
  const cutoff = addDays(today, -SEEN_DAYS);
  const undated = seen.filter((k) => keyDate(k) === null);
  const undatedKeep = new Set(undated.slice(Math.max(0, undated.length - SEEN_MAX_UNDATED)));
  const prunedSeen = seen.filter((k) => {
    const d = keyDate(k);
    if (d === null) return undatedKeep.has(k);
    return d >= cutoff;
  });
  const logCutoff = addDays(today, -(STAMPLOG_DAYS - 1));
  const stampLog = s.stampLog.filter((e) => {
    const d = shanghaiDate(e.at);
    return d !== "" && d >= logCutoff;
  });
  return { ...s, seen: prunedSeen, stampLog };
}

/** 新设备（或清过浏览器数据）：不播任何动画，把现有事件全部写进 seen，firstSeenDate 记今天 */
export function newDeviceStore(
  keys: string[],
  opts: { today: string; now: string; generatedAt: string | null; streak?: number },
): SealStore {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const k of keys) {
    if (typeof k !== "string" || set.has(k)) continue;
    set.add(k);
    seen.push(k);
  }
  const store: SealStore = {
    firstSeenDate: opts.today,
    lastSealSeenAt: opts.generatedAt,
    lastVisitAt: opts.now,
    seen,
    stampLog: [],
  };
  if (opts.streak !== undefined) store.streak = opts.streak;
  return store;
}

/** 新事件 = 键不在 seen 里，并且事件日期不早于 firstSeenDate */
export function isNewEvent(s: SealStore, ev: { key: string; at: string }): boolean {
  if (s.seen.includes(ev.key)) return false;
  const d = shanghaiDate(ev.at);
  return d !== "" && d >= s.firstSeenDate;
}

/** 不可变地把键写进 seen（去重） */
export function markSeen(s: SealStore, keys: string[]): SealStore {
  const set = new Set(s.seen);
  const seen = [...s.seen];
  for (const k of keys) {
    if (set.has(k)) continue;
    set.add(k);
    seen.push(k);
  }
  return { ...s, seen };
}

/** 页内当场盖章（阅读/审稿/镜子卡片等页内写操作）：写 seen、追加 stampLog（同 key 不重复追加），然后裁剪 */
export function recordInPageStamp(s: SealStore | null, entry: StampLogEntry, today: string): SealStore {
  const base: SealStore =
    s ?? { firstSeenDate: today, lastSealSeenAt: null, lastVisitAt: null, seen: [], stampLog: [] };
  const seen = base.seen.includes(entry.key) ? base.seen : [...base.seen, entry.key];
  const stampLog = base.stampLog.some((e) => e.key === entry.key)
    ? base.stampLog
    : [...base.stampLog, entry];
  return pruneStore({ ...base, seen, stampLog }, today);
}

/** stampLog 里某天的条目，按 at 升序 */
export function stampLogOn(s: SealStore, date: string): StampLogEntry[] {
  return s.stampLog
    .filter((e) => shanghaiDate(e.at) === date)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** 打开页面时立刻更新访问信息（事件键不在这里写进 seen，由播放器逐个写） */
export function touchVisit(
  s: SealStore,
  opts: { now: string; generatedAt: string | null; streak?: number },
): SealStore {
  const out: SealStore = { ...s, lastVisitAt: opts.now, lastSealSeenAt: opts.generatedAt };
  if (opts.streak !== undefined) out.streak = opts.streak;
  return out;
}
