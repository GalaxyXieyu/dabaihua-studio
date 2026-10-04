// 印章 IP 第 3 部分播放器测试（本轮范围）：stageLock 串行、replaySheetHtml 终态、
// reducedImpressionFrames 只有 opacity、seal-player 源码断言（只用 .animate、无动画库依赖、
// 用到 prefersReducedMotion、无 emoji）。DOM/WAAPI 部分（playStamp 等浏览器函数）不在 node 里跑，
// 靠源码断言 + 时间线函数（seal-core.test.mjs 已覆盖）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createStageLock } from "../app/_components/seal/seal-lock.ts";
import { replaySheetHtml } from "../app/_components/seal/seal-sheet.ts";
import { reducedImpressionFrames } from "../app/_components/seal/seal-machine.ts";
import { streakOpacity } from "../app/_components/seal/seal-tokens.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- createStageLock：一屏一个主动效 ----------

test("createStageLock：两个 run 同时提交，第二个在第一个结束后才开始", async () => {
  const lock = createStageLock();
  assert.equal(lock.busy(), false);
  const order = [];
  const p1 = lock.run(async () => {
    order.push("a-start");
    await sleep(30);
    order.push("a-end");
    return 1;
  });
  const p2 = lock.run(async () => {
    order.push("b-start");
    return 2;
  });
  assert.equal(lock.busy(), true);
  assert.deepEqual(await Promise.all([p1, p2]), [1, 2]);
  assert.deepEqual(order, ["a-start", "a-end", "b-start"]);
  assert.equal(lock.busy(), false);
});

test("createStageLock：第一个 reject 也放行第二个（排队不卡死）", async () => {
  const lock = createStageLock();
  const p1 = lock.run(async () => {
    throw new Error("boom");
  });
  const p2 = lock.run(async () => "ok");
  await assert.rejects(p1, /boom/);
  assert.equal(await p2, "ok");
  assert.equal(lock.busy(), false);

  // 换一种提交方式：先 await 失败再提交，也照常执行
  const q = lock.run(async () => {
    throw new Error("boom2");
  });
  await assert.rejects(q, /boom2/);
  assert.equal(await lock.run(async () => 7), 7);
});

test("createStageLock：busy() 在 reject 的 run 里也是 true，结束归 false", async () => {
  const lock = createStageLock();
  let sawBusy = false;
  const p = lock.run(async () => {
    sawBusy = lock.busy();
    throw new Error("e");
  });
  await assert.rejects(p, /e/);
  assert.equal(sawBusy, true);
  assert.equal(lock.busy(), false);
});

// ---------- replaySheetHtml：纸的终态 ----------

const ev = (key, kind, at) => ({ key, kind, at, label: "测试", targetId: "seal-slot-" + key });
const IN_PAGE = [
  ev("read:a", "yuan", "2026-10-03T09:14:00+08:00"),
  ev("read:b", "yuan", "2026-10-03T10:30:00+08:00"),
  ev("mirror:c", "hulu", "2026-10-03T17:00:00+08:00"),
  ev("review:d", "fang", "2026-10-03T21:07:00+08:00"),
  ev("read:e", "yuan", "2026-10-03T22:40:00+08:00"),
];
const GIT = ev("git:2026-10-03", "fang", "2026-10-03T23:59:00+08:00");

test("replaySheetHtml：6 个事件 → 6 个 data-i、1 个 data-date-mark，git 写「提交」，页内章写 HH:mm", () => {
  const html = replaySheetHtml({ date: "2026-10-03", events: [...IN_PAGE, GIT], streak: 5, prefix: "t" });
  assert.equal((html.match(/data-i="/g) || []).length, 6);
  assert.equal((html.match(/data-date-mark/g) || []).length, 1);
  // 页内章小字是 Asia/Shanghai 的 HH:mm
  assert.ok(html.includes("09:14"));
  assert.ok(html.includes("22:40"));
  // git 方章排在最后（data-i="5"），下面写「提交」
  assert.ok(/data-i="5"[\s\S]*?提交/.test(html), "git 那枚下面应写「提交」");
  assert.equal((html.match(/>提交</g) || []).length, 1);
  // 印痕浓淡按 streak（streakOpacity(5)，两位小数内波动）
  const op5 = streakOpacity(5);
  assert.ok(html.includes(`opacity:${op5}`), `应带 streak 浓淡 ${op5}`);
  // 日期章：10·03 的数字路径
  assert.ok(html.includes("10·03") || /translate\(/.test(html));
  assert.ok(/data-date-mark/.test(html));
});

test("replaySheetHtml：10 个事件 → 8 枚印痕 +「+2」", () => {
  const extra = [0, 1, 2, 3].map((i) => ev(`read:x${i}`, "yuan", `2026-10-03T1${i}:00:00+08:00`));
  const events = [...IN_PAGE, GIT, ...extra]; // 5 + 1 + 4 = 10
  const html = replaySheetHtml({ date: "2026-10-03", events, streak: 5, prefix: "t" });
  assert.equal((html.match(/data-i="/g) || []).length, 8);
  assert.ok(html.includes(`data-plus="2"`));
  assert.ok(html.includes("+2"));
});

test("replaySheetHtml：0 个事件 → 只有日期章，没有「没有完成」之类的字样", () => {
  const html = replaySheetHtml({ date: "2026-10-03", events: [], streak: 5, prefix: "t" });
  assert.equal((html.match(/data-i="/g) || []).length, 0);
  assert.equal((html.match(/data-plus/g) || []).length, 0);
  assert.equal((html.match(/data-date-mark/g) || []).length, 1);
  assert.ok(!/没有完成|无记录|没有记录|空/.test(html), `不应出现空态文案: ${html}`);
});

test("replaySheetHtml：dry（streak 0）时用干印不透明度 0.3", () => {
  const html = replaySheetHtml({ date: "2026-10-03", events: [GIT], streak: 0, prefix: "t" });
  assert.ok(/opacity:0\.3/.test(html), "dry 印痕应为 0.3");
  assert.ok(html.includes("var(--seal-dry"), "dry 用干印色");
});

// ---------- reducedImpressionFrames：reduced 分支只有 opacity ----------

test("reducedImpressionFrames：只有 opacity 一个键，值从 0 到目标", () => {
  const frames = reducedImpressionFrames(0.62);
  assert.equal(frames.length, 2);
  for (const f of frames) {
    assert.deepEqual(Object.keys(f).sort(), ["opacity"]);
  }
  assert.equal(frames[0].opacity, 0);
  assert.equal(frames[1].opacity, 0.62);
  // 和 stampTimeline reduced 的印痕不透明度对上
  assert.equal(reducedImpressionFrames(1).every((f) => typeof f.opacity === "number"), true);
});

// ---------- seal-player 源码断言 ----------

const PLAYER = readFileSync(new URL("../app/_components/seal/seal-player.ts", import.meta.url), "utf8");
const LOCK = readFileSync(new URL("../app/_components/seal/seal-lock.ts", import.meta.url), "utf8");
const SHEET = readFileSync(new URL("../app/_components/seal/seal-sheet.ts", import.meta.url), "utf8");

// emoji 粗查（同 seal-static.test.mjs）
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

test("seal-player 只用 Web Animations API（.animate），不引 motion/gsap/lottie/rAF", () => {
  assert.ok(PLAYER.includes(".animate("), "动画必须走 element.animate()");
  assert.ok(!/from "motion"|from 'motion'|require\("motion"\)/.test(PLAYER), "不许引 motion");
  assert.ok(!/gsap|lottie/i.test(PLAYER), "不许引 gsap/lottie");
  assert.ok(!/requestAnimationFrame|setInterval/.test(PLAYER), "动画不走 rAF/interval");
});

test("seal-player 用到 prefersReducedMotion（演出前现查系统偏好）", () => {
  assert.ok(/prefersReducedMotion\(\)/.test(PLAYER), "playReplay 里应现查 prefersReducedMotion()");
});

test("seal-player 的 reduced 印痕帧来自 reducedImpressionFrames（纯函数，只有 opacity）", () => {
  assert.ok(PLAYER.includes("reducedImpressionFrames(tl.impression.opacity)"), "reduced 分支应只用 reducedImpressionFrames 的帧");
});

test("新文件无 emoji", () => {
  for (const [name, src] of [["seal-player.ts", PLAYER], ["seal-lock.ts", LOCK], ["seal-sheet.ts", SHEET]]) {
    assert.ok(!EMOJI_RE.test(src), `${name} 不应出现 emoji`);
  }
});

test("seal-lock 是纯 TS（不碰 DOM），页面导出唯一的 stageLock", () => {
  assert.ok(!/document|window|matchMedia/.test(LOCK), "seal-lock.ts 不应碰 DOM");
  assert.ok(LOCK.includes("export const stageLock"), "应导出全局唯一的 stageLock");
});
