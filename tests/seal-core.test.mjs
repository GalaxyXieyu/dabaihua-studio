// 印章 IP 纯逻辑核心测试（tokens / machine / store / moments）。
// 数据全部虚构；now 固定，不依赖真实提交或真实标题。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { strokeFor, streakOpacity, tierOf } from "../app/_components/seal/seal-tokens.ts";
import {
  stampTimeline, bowTimeline, welcomeTimeline, wrapTimeline, replayTimeline,
  dateLabel, dateGlyphPaths,
} from "../app/_components/seal/seal-machine.ts";
import {
  shanghaiDate, addDays, daysBetween, keyDate, parseStore, serializeStore,
  pruneStore, recordInPageStamp, stampLogOn, markSeen, touchVisit,
} from "../app/_components/seal/seal-store.ts";
import {
  planVisit, skipAll, finishedStore, commitStreak, slotId, gitEvents, inPageEvents,
} from "../app/_components/seal/seal-moments.ts";

const NOW = "2026-10-04T09:00:00+08:00";
const TODAY = "2026-10-04";

// 虚构数据集：10-02 是空白日（commits 0）
const DAYS = [
  { date: "2026-09-28", commits: 2 },
  { date: "2026-09-29", commits: 1 },
  { date: "2026-09-30", commits: 4 },
  { date: "2026-10-01", commits: 2 },
  { date: "2026-10-02", commits: 0 },
  { date: "2026-10-03", commits: 3 },
  { date: "2026-10-04", commits: 2 },
];
const GIT_KEYS = DAYS.filter((d) => (d.commits ?? 0) > 0).map((d) => `git:${d.date}`);

// ---------- seal-machine：时长 ----------

test("stampTimeline 基准时长", () => {
  for (const k of ["fang", "yuan", "hulu"]) assert.equal(stampTimeline(k).total, 620);
  assert.equal(stampTimeline("tuoyuan").total, 484);
  assert.equal(stampTimeline("yinshou").total, 901);
  assert.equal(stampTimeline("fang", { streak: 14 }).total, 680); // 第 3 档按住 90ms
  assert.equal(stampTimeline("fang", { streak: 20 }).total, 680);
  // 带点头的单件完成总长 = 620 + 80 + 360
  assert.equal(stampTimeline("fang", { nod: true }).end, 1060);
  assert.equal(stampTimeline("fang", { nod: true }).nod.at, 700);
  // 位移按 size/64 换算（-4px × 1.125 = -4.5px）
  const t72 = stampTimeline("fang", { size: 72 });
  assert.ok(t72.body.frames.some((f) => f.transform.includes("translateY(-4.5px)")));
});

test("reduced：只剩印痕淡入", () => {
  const t = stampTimeline("fang", { reduced: true, nod: true, spread: true, streak: 7 });
  assert.equal(t.body, null);
  assert.equal(t.blink, null);
  assert.equal(t.dust, null);
  assert.equal(t.spread, null);
  assert.equal(t.nod, null);
  assert.equal(t.total, 120);
  assert.equal(t.end, 120);
  assert.equal(t.impression.at, 0);
  assert.equal(t.impression.duration, 120);
  assert.equal(t.impression.clip, false);
  assert.equal(t.impression.opacity, streakOpacity(7));
  assert.ok(!/translate|rotate|scale/.test(JSON.stringify(t)), "不出现任何 transform 帧");
});

test("dry：干印", () => {
  const t = stampTimeline("fang", { streak: 0 });
  assert.equal(t.dry, true);
  assert.equal(t.impression.opacity, 0.3);
  assert.equal(t.dust, null);
  assert.equal(t.spread, null);
  assert.equal(t.blink, null);
  // 干印动作总长 580（220+160+30+170，无回弹）
  assert.equal(t.total, 580);
});

test("正常时间线的附带细节", () => {
  const t = stampTimeline("fang", { streak: 3 });
  assert.equal(t.body.frames.length, 8);
  assert.equal(t.blink.at, 330);        // 命中
  assert.equal(t.impression.at, 370);   // 命中后 40ms
  assert.equal(t.impression.duration, 140);
  assert.equal(t.impression.clip, true);
  assert.equal(t.dust.at, 350);         // 命中后 20ms
  assert.equal(t.pressBlur.from, 220);  // 压下开始
  assert.equal(t.pressBlur.to, 470);    // 松开开始（第 1 档按住 50ms）
  assert.equal(t.spread.at, 510);       // 印痕显现结束后
  assert.equal(t.spread.duration, 320);
  assert.ok(Math.abs(t.spread.fromOpacity - 0.22 * streakOpacity(3)) < 1e-9);
  // speed 乘在所有段上
  const f = stampTimeline("fang", { speed: 0.6 });
  assert.equal(f.total, 372);
});

// ---------- seal-machine：情绪时刻时长 ----------

test("welcomeTimeline / bowTimeline", () => {
  const w = welcomeTimeline();
  assert.equal(w.total, 1620); // demo 实际时长（规范 6.6 写 1420 是算错的）
  assert.equal(w.jumpPx, 6);
  assert.equal(w.tiltDeg, 6);
  assert.deepEqual(w.steps.map((s) => s.name), ["up", "down", "land", "tilt", "hold", "back"]);
  assert.deepEqual(w.steps.map((s) => s.duration), [180, 220, 120, 200, 600, 300]);
  const b = bowTimeline();
  assert.equal(b.total, 860);
  assert.deepEqual([b.down, b.hold, b.up], [240, 320, 300]);
  assert.equal(b.deg, 10);
  assert.equal(b.dropPx, 1);
});

test("wrapTimeline", () => {
  const w = wrapTimeline(6);
  assert.equal(w.total, 2020);
  assert.equal(w.start, 400);
  assert.equal(w.slides.length, 6);
  assert.equal(w.slides[0].at, 400);
  assert.equal(w.slides[5].at, 600);
  assert.equal(w.slides[5].duration, 360);
  assert.equal(w.bowAt, 1160);
  // 超过 8 枚只算前 8
  const w10 = wrapTimeline(10);
  assert.equal(w10.slides.length, 8);
});

test("replayTimeline", () => {
  assert.equal(replayTimeline(6).total, 3244);
  assert.equal(replayTimeline(1).total, 2144);
  assert.equal(replayTimeline(0).total, 1904);
  assert.ok(Math.abs(replayTimeline(8).total - 3456) <= 16);
  const r = replayTimeline(6);
  assert.equal(r.dropsAt, 300);
  assert.equal(r.stagger, 220);
  assert.equal(r.drops[5].at, 300 + 5 * 220);
  assert.equal(r.drops[0].rot, -2);
  // n=10：只落 8 枚，plus = 2
  const r10 = replayTimeline(10);
  assert.equal(r10.plus, 2);
  assert.equal(r10.drops.length, 8);
  // 日期章用小椭圆章时间线（484），不点头
  assert.equal(r.date.kind, "tuoyuan");
  assert.equal(r.date.total, 484);
  assert.equal(r.date.nod, null);
  // reduced：整张 120ms 淡入
  const rr = replayTimeline(6, { reduced: true });
  assert.equal(rr.total, 120);
  assert.ok(rr.drops.every((d) => d.at === 0 && d.duration === 0));
  assert.equal(rr.date.reduced, true);
});

// ---------- seal-machine：日期章 ----------

test("dateLabel / dateGlyphPaths 与样张完全一致", () => {
  assert.equal(dateLabel("2026-10-03"), "10·03");
  assert.equal(dateLabel("2026-01-05"), "01·05");
  const svg = readFileSync(new URL("../app/_components/seal/svg/stamp-mark-date-example.svg", import.meta.url), "utf8");
  const ref = [...svg.matchAll(/<path transform="translate\(([\d.]+) ([\d.]+)\)" d="([^"]+)"\/>/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    d: m[3],
  }));
  assert.equal(ref.length, 5);
  const got = dateGlyphPaths("10·03");
  assert.equal(got.length, ref.length);
  for (let i = 0; i < ref.length; i++) {
    assert.equal(got[i].x, ref[i].x);
    assert.equal(got[i].y, ref[i].y);
    assert.equal(got[i].d, ref[i].d);
  }
});

// ---------- seal-tokens ----------

test("strokeFor / streakOpacity / tierOf", () => {
  assert.equal(strokeFor(16), 2);
  assert.equal(strokeFor(32), 2);
  assert.equal(strokeFor(48), 1.5);
  assert.equal(strokeFor(96), 1);
  assert.equal(strokeFor(160), 1);
  assert.ok(Math.abs(streakOpacity(1) - 0.42) < 0.01);
  assert.ok(Math.abs(streakOpacity(3) - 0.6) < 0.01);
  assert.ok(Math.abs(streakOpacity(7) - 0.8) < 0.01);
  assert.ok(Math.abs(streakOpacity(14) - 0.92) < 0.03);
  assert.equal(streakOpacity(0), 0.3);
  assert.equal(streakOpacity(-2), 0.3);
  assert.ok(streakOpacity(100) > 0.9999); // 渐近 1，永不封顶到字面 1
  assert.deepEqual([2, 3, 6, 7, 13, 14].map(tierOf), [0, 1, 1, 2, 2, 3]);
});

// ---------- seal-store ----------

test("shanghaiDate / addDays / daysBetween", () => {
  assert.equal(shanghaiDate("2026-10-04T09:00:00+08:00"), "2026-10-04");
  assert.equal(shanghaiDate("2026-10-04T00:30:00+08:00"), "2026-10-04");
  assert.equal(shanghaiDate("2026-10-03T23:30:00+08:00"), "2026-10-03");
  assert.equal(shanghaiDate("2026-10-04T01:00:00+00:00"), "2026-10-04"); // UTC 1 点 = 上海 9 点
  assert.equal(addDays("2026-10-04", -1), "2026-10-03");
  assert.equal(addDays("2026-10-01", 3), "2026-10-04");
  assert.equal(daysBetween("2026-10-01", "2026-10-04"), 3);
  assert.equal(daysBetween("2026-10-04", "2026-10-01"), -3);
});

test("keyDate", () => {
  assert.equal(keyDate("git:2026-10-03"), "2026-10-03");
  assert.equal(keyDate("wrap:2026-10-03"), "2026-10-03");
  assert.equal(keyDate("back:2026-10-04"), "2026-10-04");
  assert.equal(keyDate("replay:2026-10-04"), "2026-10-04");
  assert.equal(keyDate("list:proj1:2026-10-03"), "2026-10-03");
  assert.equal(keyDate("habit:h1:20261003"), "2026-10-03");
  assert.equal(keyDate("read:abc"), null);
  assert.equal(keyDate("review:slug:2"), null);
  assert.equal(keyDate("mirror:c1:9"), null);
  assert.equal(keyDate("dida:task1"), null);
});

test("parseStore", () => {
  assert.equal(parseStore(null), null);
  assert.equal(parseStore("{oops"), null);
  assert.equal(parseStore('"string"'), null);
  // firstSeenDate 不是合法日期 → null（当新设备）
  assert.equal(parseStore('{"firstSeenDate":"2026-13-45"}'), null);
  assert.equal(parseStore('{"firstSeenDate":"x"}'), null);
  // 字段缺失补默认值
  const s = parseStore(JSON.stringify({ firstSeenDate: "2026-09-28", seen: ["git:2026-09-28", 3] }));
  assert.deepEqual(s, {
    firstSeenDate: "2026-09-28",
    lastSealSeenAt: null,
    lastVisitAt: null,
    seen: ["git:2026-09-28"],
    stampLog: [],
  });
  // 序列化可往返
  assert.deepEqual(parseStore(serializeStore(s)), s);
});

test("pruneStore：seen 去重、60 天裁剪、stampLog 只留两天", () => {
  const s = {
    firstSeenDate: "2026-06-01",
    lastSealSeenAt: null,
    lastVisitAt: null,
    seen: [
      "git:2026-08-04", // 61 天前，删
      "git:2026-08-05", // 60 天前，留
      "git:2026-09-30",
      "read:a1",
      "read:a2",
      "git:2026-10-04",
      "git:2026-10-04", // 重复
    ],
    stampLog: [
      { key: "read:old", seal: "yuan", at: "2026-10-01T10:00:00+08:00" }, // 3 天前，删
      { key: "read:yday", seal: "yuan", at: "2026-10-03T10:00:00+08:00" },
      { key: "review:today", seal: "fang", at: "2026-10-04T11:00:00+08:00" },
    ],
  };
  const p = pruneStore(s, TODAY);
  assert.ok(!p.seen.includes("git:2026-08-04"));
  assert.ok(p.seen.includes("git:2026-08-05"));
  assert.ok(p.seen.includes("git:2026-09-30"));
  assert.ok(p.seen.includes("read:a1"));
  assert.ok(p.seen.includes("read:a2"));
  assert.equal(p.seen.filter((k) => k === "git:2026-10-04").length, 1);
  assert.deepEqual(p.stampLog.map((e) => e.key), ["read:yday", "review:today"]);
});

test("recordInPageStamp：null 时建新 store 并写 seen", () => {
  const s = recordInPageStamp(null, { key: "read:abc", seal: "yuan", at: "2026-10-04T09:30:00+08:00" }, TODAY);
  assert.equal(s.firstSeenDate, TODAY);
  assert.deepEqual(s.seen, ["read:abc"]);
  assert.deepEqual(s.stampLog, [{ key: "read:abc", seal: "yuan", at: "2026-10-04T09:30:00+08:00" }]);
  // 同 key 不重复追加
  const s2 = recordInPageStamp(s, { key: "read:abc", seal: "yuan", at: "2026-10-04T09:40:00+08:00" }, TODAY);
  assert.equal(s2.stampLog.length, 1);
  assert.equal(s2.stampLog[0].at, "2026-10-04T09:30:00+08:00");
});

test("stampLogOn 按 at 升序", () => {
  const s = {
    firstSeenDate: "2026-10-01",
    lastSealSeenAt: null,
    lastVisitAt: null,
    seen: [],
    stampLog: [
      { key: "mirror:m1:2", seal: "tuoyuan", at: "2026-10-03T21:07:00+08:00" },
      { key: "read:a", seal: "yuan", at: "2026-10-03T09:14:00+08:00" },
      { key: "read:b", seal: "yuan", at: "2026-10-04T08:00:00+08:00" },
    ],
  };
  assert.deepEqual(stampLogOn(s, "2026-10-03").map((e) => e.key), ["read:a", "mirror:m1:2"]);
  assert.deepEqual(stampLogOn(s, "2026-10-02"), []);
});

test("touchVisit 更新访问信息", () => {
  const s = { firstSeenDate: "2026-10-01", lastSealSeenAt: "old", lastVisitAt: null, seen: [], stampLog: [] };
  const t = touchVisit(s, { now: NOW, generatedAt: "g1", streak: 3 });
  assert.equal(t.lastVisitAt, NOW);
  assert.equal(t.lastSealSeenAt, "g1");
  assert.equal(t.streak, 3);
  assert.deepEqual(t.seen, []); // 不动事件键
});

// ---------- seal-moments：事件工具 ----------

test("slotId / gitEvents / inPageEvents", () => {
  assert.equal(slotId("git:2026-10-03"), "seal-slot-git-2026-10-03");
  assert.equal(slotId("read:abc 1"), "seal-slot-read-abc-1");
  const ev = gitEvents([{ date: "2026-10-03", commits: 3 }]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].label, "10 月 3 日 · 提交 3 次");
  assert.equal(ev[0].kind, "fang");
  assert.equal(ev[0].targetId, "seal-slot-git-2026-10-03");
  assert.equal(gitEvents([{ date: "2026-10-03", commits: 0 }]).length, 0);
  const ip = inPageEvents([
    { key: "read:a", seal: "yuan", at: "2026-10-04T09:00:00+08:00" },
    { key: "review:s:1", seal: "fang", at: "2026-10-04T10:00:00+08:00" },
    { key: "mirror:m:2", seal: "tuoyuan", at: "2026-10-04T11:00:00+08:00" },
    { key: "other:x", seal: "fang", at: "2026-10-04T12:00:00+08:00" },
  ]);
  assert.deepEqual(ip.map((e) => e.label), ["读完一篇", "审稿通过", "照照镜子", "页内盖章"]);
});

// ---------- planVisit：队列 ----------

function sevenNewStore() {
  // firstSeenDate = 今天：昨天的 git 事件不算新，也不会触发回放
  return {
    firstSeenDate: TODAY,
    lastSealSeenAt: null,
    lastVisitAt: "2026-10-04T08:00:00+08:00",
    seen: [],
    stampLog: [
      { key: "read:a", seal: "yuan", at: "2026-10-04T09:01:00+08:00" },
      { key: "read:b", seal: "yuan", at: "2026-10-04T09:02:00+08:00" },
      { key: "read:c", seal: "yuan", at: "2026-10-04T09:03:00+08:00" },
      { key: "read:d", seal: "yuan", at: "2026-10-04T09:04:00+08:00" },
      { key: "review:x:1", seal: "fang", at: "2026-10-04T09:05:00+08:00" },
      { key: "mirror:m1:3", seal: "tuoyuan", at: "2026-10-04T09:06:00+08:00" },
    ],
  };
}

test("新设备第一次打开：0 个动画、全部已盖、seen 写满", () => {
  const plan = planVisit({ store: null, days: DAYS, generatedAt: "2026-10-04T06:00:00+08:00", now: NOW, page: "today" });
  assert.equal(plan.firstVisit, true);
  assert.equal(plan.queue.length, 0);
  assert.equal(plan.animated.length, 0);
  assert.equal(plan.overflow, 0);
  assert.equal(plan.replay, null);
  assert.equal(plan.closing, null);
  assert.equal(plan.welcomeBack, false);
  assert.deepEqual([...plan.stamped].sort(), [...plan.events.map((e) => e.key)].sort());
  for (const k of plan.events.map((e) => e.key)) assert.ok(plan.store.seen.includes(k));
  assert.ok(plan.store.seen.includes("replay:2026-10-04"));
  assert.ok(plan.store.seen.includes("wrap:2026-10-04")); // pageDate 有事件
  assert.equal(plan.store.firstSeenDate, TODAY);
  assert.equal(plan.store.lastVisitAt, NOW);
});

test("7 个新事件：animated 5、overflow 2", () => {
  const plan = planVisit({ store: sevenNewStore(), days: DAYS, generatedAt: null, now: NOW, page: "today" });
  assert.equal(plan.queue.length, 7); // 6 个页内 + git:2026-10-04
  assert.equal(plan.animated.length, 5);
  assert.equal(plan.instant.length, 2);
  assert.equal(plan.overflow, 2);
  assert.equal(plan.queue[0].key, "read:a"); // 按 at 升序
  assert.equal(plan.queue[6].key, "git:2026-10-04");
  assert.equal(plan.closing, "dayWrap"); // 收工优先于点头，有 overflow 只是不点头
  assert.equal(plan.pose, "stamped");
});

test("skipAll / finishedStore：打断后全部记为已看过", () => {
  const plan = planVisit({ store: sevenNewStore(), days: DAYS, generatedAt: null, now: NOW, page: "today" });
  const after = skipAll(plan.store, plan);
  const plan2 = planVisit({ store: after, days: DAYS, generatedAt: null, now: "2026-10-04T12:00:00+08:00", page: "today" });
  assert.equal(plan2.queue.length, 0);
  assert.equal(plan2.replay, null);
  assert.deepEqual(finishedStore(plan.store, plan).seen, after.seen);
});

test("中途关页：只把前 3 个键 markSeen，再开只补剩下的", () => {
  const plan = planVisit({ store: sevenNewStore(), days: DAYS, generatedAt: null, now: NOW, page: "today" });
  const partial = markSeen(plan.store, plan.queue.slice(0, 3).map((e) => e.key));
  const plan2 = planVisit({ store: partial, days: DAYS, generatedAt: null, now: "2026-10-04T12:00:00+08:00", page: "today" });
  assert.deepEqual(plan2.queue.map((e) => e.key), plan.queue.slice(3).map((e) => e.key));
});

// ---------- planVisit：情绪时刻 ----------

test("一天收工同一天只演一次", () => {
  const store = {
    firstSeenDate: "2026-09-28",
    lastSealSeenAt: null,
    lastVisitAt: "2026-10-03T22:00:00+08:00",
    seen: [...GIT_KEYS, "replay:2026-10-04"], // 事件全看过，但 wrap 没写过
    stampLog: [],
  };
  const plan = planVisit({ store, days: DAYS, generatedAt: null, now: NOW, page: "today" });
  assert.equal(plan.queue.length, 0);
  assert.equal(plan.closing, "dayWrap");
  assert.equal(plan.dayWrapDate, TODAY);
  assert.ok(plan.momentKeys.includes("wrap:2026-10-04"));
  const after = markSeen(plan.store, plan.momentKeys);
  const plan2 = planVisit({ store: after, days: DAYS, generatedAt: null, now: "2026-10-04T15:00:00+08:00", page: "today" });
  assert.notEqual(plan2.closing, "dayWrap");
  assert.equal(plan2.closing, null);
});

test("回来了：3 天触发、2 天不触发、无新事件不触发", () => {
  const far = {
    firstSeenDate: "2026-09-28",
    lastSealSeenAt: null,
    lastVisitAt: "2026-10-01T09:00:00+08:00",
    seen: ["replay:2026-10-04", "git:2026-10-03"],
    stampLog: [],
  };
  const plan = planVisit({ store: far, days: DAYS, generatedAt: null, now: NOW, page: "today" });
  assert.equal(plan.welcomeBack, true);
  assert.equal(plan.closing, "welcomeBack"); // 同时满足 dayWrap 时只给 welcomeBack
  assert.equal(plan.dayWrapDate, TODAY); // dayWrap 条件也成立
  assert.equal(plan.replay, null);
  assert.equal(plan.speed, 0.6);
  assert.equal(plan.gapMs, 120);
  assert.equal(plan.spread, false);
  assert.equal(plan.nodLast, false);
  assert.ok(plan.momentKeys.includes("back:2026-10-04"));
  assert.ok(plan.momentKeys.includes("replay:2026-10-04"));
  assert.ok(plan.momentKeys.includes("wrap:2026-10-04")); // 回来了之后不再演一天收工
  // 2 天前 → 不触发
  const p2 = planVisit({ store: { ...far, lastVisitAt: "2026-10-02T09:00:00+08:00" }, days: DAYS, generatedAt: null, now: NOW, page: "today" });
  assert.equal(p2.welcomeBack, false);
  // 3 天前但没有新事件 → 不触发
  const p3 = planVisit({ store: { ...far, seen: [...GIT_KEYS, "replay:2026-10-04"] }, days: DAYS, generatedAt: null, now: NOW, page: "today" });
  assert.equal(p3.welcomeBack, false);
});

test("空白日：pose rest 且没有 queue", () => {
  const store = { firstSeenDate: "2026-09-28", lastSealSeenAt: null, lastVisitAt: "2026-10-04T08:00:00+08:00", seen: [], stampLog: [] };
  const plan = planVisit({ store, days: DAYS, generatedAt: null, now: NOW, page: "ledger-day", pageDate: "2026-10-02" });
  assert.equal(plan.pose, "rest");
  assert.equal(plan.queue.length, 0);
  assert.equal(plan.replay, null);
  assert.equal(plan.events.length, 0);
  assert.equal(plan.closing, null);
});

test("连续天数：缺一天算断", () => {
  assert.equal(commitStreak(DAYS), 2); // 10-04、10-03 连续，10-02 断
  assert.equal(commitStreak([
    { date: "2026-10-04", commits: 1 },
    { date: "2026-10-02", commits: 1 }, // 10-03 缺
    { date: "2026-10-01", commits: 1 },
  ]), 1);
  assert.equal(commitStreak([{ date: "2026-10-04", commits: 0 }]), 0);
  assert.equal(commitStreak([{ date: "2026-10-04", commits: null }]), 0);
  assert.equal(commitStreak(null), 0);
  assert.equal(commitStreak([]), 0);
});

// ---------- planVisit：昨日回放 ----------

test("昨日回放：第一次打开有值、git 方章排最后、昨天的新事件不进 queue", () => {
  const store = {
    firstSeenDate: "2026-09-28",
    lastSealSeenAt: null,
    lastVisitAt: "2026-10-03T22:00:00+08:00",
    seen: [],
    stampLog: [
      { key: "read:a", seal: "yuan", at: "2026-10-03T09:14:00+08:00" },
      { key: "mirror:m1:2", seal: "tuoyuan", at: "2026-10-03T21:07:00+08:00" },
    ],
  };
  const plan = planVisit({ store, days: DAYS, generatedAt: null, now: NOW, page: "today" });
  assert.ok(plan.replay);
  assert.equal(plan.replay.date, "2026-10-03");
  assert.deepEqual(plan.replay.events.map((e) => e.key), ["read:a", "mirror:m1:2", "git:2026-10-03"]);
  assert.ok(!plan.queue.some((e) => e.key === "git:2026-10-03"));
  assert.ok(!plan.queue.some((e) => e.key === "read:a"));
  assert.ok(plan.momentKeys.includes("replay:2026-10-04"));
  assert.ok(plan.momentKeys.includes("wrap:2026-10-03"));
  // momentKeys 写回后同日再开 → replay null
  const after = markSeen(plan.store, plan.momentKeys);
  const plan2 = planVisit({ store: after, days: DAYS, generatedAt: null, now: "2026-10-04T12:00:00+08:00", page: "today" });
  assert.equal(plan2.replay, null);
});

test("昨日回放：数据没到不演也不写键，数据到了再开会演", () => {
  const daysNoY = DAYS.filter((d) => d.date !== "2026-10-03");
  const store = { firstSeenDate: "2026-09-28", lastSealSeenAt: null, lastVisitAt: "2026-10-03T22:00:00+08:00", seen: [], stampLog: [] };
  const plan = planVisit({ store, days: daysNoY, generatedAt: null, now: NOW, page: "today" });
  assert.equal(plan.replay, null);
  assert.ok(!plan.momentKeys.some((k) => k.startsWith("replay:")));
  const plan2 = planVisit({ store: plan.store, days: DAYS, generatedAt: null, now: "2026-10-04T12:00:00+08:00", page: "today" });
  assert.ok(plan2.replay);
});

test("昨日回放：昨天没有章时仍然演，只盖日期章", () => {
  const days = [
    { date: "2026-10-02", commits: 0 },
    { date: "2026-10-03", commits: 2 },
  ];
  const store = { firstSeenDate: "2026-10-01", lastSealSeenAt: null, lastVisitAt: "2026-10-02T22:00:00+08:00", seen: [], stampLog: [] };
  const plan = planVisit({ store, days, generatedAt: null, now: "2026-10-03T09:00:00+08:00", page: "today" });
  assert.ok(plan.replay);
  assert.equal(plan.replay.date, "2026-10-02");
  assert.deepEqual(plan.replay.events, []);
});

test("昨日回放：firstSeenDate = 今天时不回放", () => {
  const store = { firstSeenDate: TODAY, lastSealSeenAt: null, lastVisitAt: "2026-10-03T22:00:00+08:00", seen: [], stampLog: [] };
  const plan = planVisit({ store, days: DAYS, generatedAt: null, now: NOW, page: "today" });
  assert.equal(plan.replay, null);
});

// ---------- planVisit：数据兼容 ----------

test("days 带额外字段不影响；days 为 null → offline", () => {
  const days = DAYS.map((d) => ({ ...d, summary: "虚构摘要", dida: { completed: [] }, repoStats: [] }));
  const store = { firstSeenDate: "2026-09-28", lastSealSeenAt: null, lastVisitAt: "2026-10-03T22:00:00+08:00", seen: [], stampLog: [] };
  const plan = planVisit({ store, days, generatedAt: null, now: NOW, page: "today" });
  assert.equal(plan.events.length, GIT_KEYS.length);
  const offline = planVisit({ store: null, days: null, generatedAt: null, now: NOW, page: "today" });
  assert.equal(offline.pose, "offline");
  assert.equal(offline.events.length, 0);
  assert.equal(offline.queue.length, 0);
  assert.equal(offline.store.firstSeenDate, TODAY);
  const emptyDays = planVisit({ store: null, days: [], generatedAt: null, now: NOW, page: "today" });
  assert.equal(emptyDays.pose, "offline");
});
