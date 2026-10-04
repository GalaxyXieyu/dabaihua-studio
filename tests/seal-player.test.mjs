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
  // 日期章：竖长方模板边框 + 现算篆文
  assert.ok(html.includes('<rect x="17" y="2.75" width="14" height="42.5" rx="0.8"/>'));
  assert.ok(/data-date-mark/.test(html));
  // 小注：中文计数
  assert.ok(html.includes("昨日 · 六枚"), `6 枚应写「昨日 · 六枚」: ${html}`);
  // 流式布局：不再有绝对定位
  assert.ok(!html.includes("position:absolute"), "不应再出现 position:absolute");
});

test("replaySheetHtml：10 个事件 → 8 枚印痕 +「+2」", () => {
  const extra = [0, 1, 2, 3].map((i) => ev(`read:x${i}`, "yuan", `2026-10-03T1${i}:00:00+08:00`));
  const events = [...IN_PAGE, GIT, ...extra]; // 5 + 1 + 4 = 10
  const html = replaySheetHtml({ date: "2026-10-03", events, streak: 5, prefix: "t" });
  assert.equal((html.match(/data-i="/g) || []).length, 8);
  assert.ok(html.includes(`data-plus="2"`));
  assert.ok(html.includes("+2"));
});

test("replaySheetHtml：0 个事件 → 只有日期章和「昨日 · 未盖」，没有「没有完成」之类的字样", () => {
  const html = replaySheetHtml({ date: "2026-10-03", events: [], streak: 5, prefix: "t" });
  assert.equal((html.match(/data-i="/g) || []).length, 0);
  assert.equal((html.match(/data-plus/g) || []).length, 0);
  assert.equal((html.match(/data-date-mark/g) || []).length, 1);
  assert.ok(html.includes("昨日 · 未盖"), `0 枚应写「昨日 · 未盖」: ${html}`);
  assert.ok(!/没有完成|无记录|没有记录|空/.test(html), `不应出现空态文案: ${html}`);
});

test("replaySheetHtml：dry（streak 0）时用干印不透明度 0.3", () => {
  const html = replaySheetHtml({ date: "2026-10-03", events: [GIT], streak: 0, prefix: "t" });
  assert.ok(/opacity:0\.3/.test(html), "dry 印痕应为 0.3");
  assert.ok(html.includes("var(--seal-dry"), "dry 用干印色");
});

// ---------- 昨日纸改成居中流式小笺（卡片与回放遮罩共用） ----------

test("seal-sheet / seal-player：流式小笺，不再有 400×190 坐标系和文字题头", () => {
  assert.ok(SHEET.includes('"seal-sheet-in"'), "内层结构应是 .seal-sheet-in");
  assert.ok(SHEET.includes('class="seal-sheet-date" data-date-mark'), "日期章作题头（data-date-mark）");
  assert.ok(SHEET.includes('class="seal-sheet-marks"'), "印痕一行应是 .seal-sheet-marks");
  assert.ok(SHEET.includes("cnCount(events.length)"), "小注用中文计数");
  assert.ok(!SHEET.includes("position:absolute"), "seal-sheet.ts 不应再拼绝对定位");

  assert.ok(PLAYER.includes('"seal-replay-sheet seal-sheet"'), "遮罩里的纸应带 seal-sheet 类");
  assert.ok(!PLAYER.includes("REPLAY.sheetW") && !PLAYER.includes("REPLAY.sheetH"), "播放器不再用 sheetW/sheetH");
  assert.ok(!/seal-replay-title/.test(PLAYER), "不应再有单独的文字题头段落");
  assert.ok(PLAYER.includes("replayAriaLabel(date)"), "遮罩 aria-label 应带日期");
  const tokens = readFileSync(new URL("../app/_components/seal/seal-tokens.ts", import.meta.url), "utf8");
  assert.ok(!tokens.includes("sheetW") && !tokens.includes("sheetH"), "REPLAY 令牌不应再有 sheetW/sheetH");
  assert.ok(/dateSize: 88/.test(tokens), "日期章渲染尺寸应为 88");
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

// ---------- SealStage / useSealQueue / usePauseWhenHidden 源码断言（第 5 节） ----------
// 这些是 "use client" 的浏览器组件，node 里没法渲染，靠源码断言锁住结构和关键行为。

const STAGE = readFileSync(new URL("../app/_components/seal/SealStage.tsx", import.meta.url), "utf8");
const USEQUEUE = readFileSync(new URL("../app/_components/seal/useSealQueue.ts", import.meta.url), "utf8");
const PAUSE = readFileSync(new URL("../app/_components/seal/usePauseWhenHidden.ts", import.meta.url), "utf8");

test("SealStage 有 use client、默认导出（React.lazy 按需加载），不引动画库", () => {
  assert.ok(STAGE.includes('"use client"'), "SealStage 应是客户端组件");
  assert.ok(/export default function SealStage/.test(STAGE), "应默认导出");
  assert.ok(!/from "motion"|from 'motion'|gsap|lottie/i.test(STAGE), "不许引 motion/gsap/lottie");
  assert.ok(!/requestAnimationFrame|setInterval/.test(STAGE), "不走 rAF/interval");
  // 自己不做动画，只编排 seal-player 的动作
  assert.ok(!/\.animate\(/.test(STAGE), "SealStage 不直接调 .animate");
  for (const fn of ["playReplay", "playStamp", "playDayWrap", "playWelcome", "setActorKind", "prefersReducedMotion"]) {
    assert.ok(STAGE.includes(fn), `应从 seal-player 引 ${fn}`);
  }
});

test("SealStage 整次编排跑在 stageLock 里（7.4 第 8 条一屏一个主动效）", () => {
  assert.ok(/stageLock[\s\S]*?\.run\(/.test(STAGE), "应用 stageLock.run 跑整次编排");
  assert.ok(STAGE.includes('from "./seal-lock.ts"'), "从 seal-lock 引入");
});

test("SealStage 打断（7.4 第 6 条）：scroll/wheel/pointerdown/keydown/切后台/pagehide，AbortController + cancel", () => {
  for (const ev of ["scroll", "wheel", "pointerdown", "keydown"]) {
    assert.ok(STAGE.includes(`"${ev}"`), `应监听 ${ev}`);
  }
  assert.ok(STAGE.includes("visibilitychange"), "应监听 visibilitychange");
  assert.ok(STAGE.includes("pagehide"), "应监听 pagehide");
  assert.ok(STAGE.includes("AbortController"), "应用 AbortController");
  assert.ok(/a\.cancel\(\)/.test(STAGE), "打断时 cancel track 过的动画");
  assert.ok(STAGE.includes("onSkip"), "打断时调用 onSkip");
  // 卸载（切路由）时也 abort：StrictMode 第二次挂载能取消第一次
  assert.ok(/return \(\) => \{[\s\S]*?controller\.abort\(\)[\s\S]*?\};?\s*[\s\S]*?\};/m.test(STAGE) || /return \(\) => \{[\s\S]*?controller\.abort\(\)/.test(STAGE));
});

test("SealStage 铺位与收尾路由：昨日小卡、印条 id、welcomeBack 换回方章", () => {
  assert.ok(STAGE.includes('"seal-yesterday-card"'), "回放用 seal-yesterday-card");
  assert.ok(STAGE.includes('"seal-strip-"'), "印条 id 前缀 seal-strip-");
  assert.ok(STAGE.includes('setActorKind(actor, "fang"'), "welcomeBack 换回方章");
  assert.ok(STAGE.includes("BACK.after"), "补完 300ms 后再迎接（BACK.after）");
  assert.ok(STAGE.includes("onMoment(closing)"), "收尾演完调 onMoment(closing)");
});

test("SealStage reduced：全部新印痕一起淡入（复用 playStamp 的 reduced 分支），自己不写 transform 帧", () => {
  assert.ok(STAGE.includes("reduced: true"), "应有 reduced 淡入上下文 fadeCtx");
  assert.ok(!/transform:\s*["'`]/.test(STAGE), "SealStage 不自己写 transform 关键帧");
  assert.ok(STAGE.includes("onOverflow?.(p.overflow)"), "超出 maxAnimated 要报 overflow");
});

test("SealStage 无障碍：aria-live 播报新盖了 N 个章，可选文案 seal-copy", () => {
  assert.ok(STAGE.includes('aria-live="polite"'));
  assert.ok(STAGE.includes("新盖了"));
  assert.ok(STAGE.includes("seal-copy"));
});

test("useSealQueue：读 localStorage、planVisit、立刻写回、写回前重读再 pruneStore", () => {
  assert.ok(USEQUEUE.includes('"use client"'));
  assert.ok(USEQUEUE.includes("STORE_KEY"));
  assert.ok(USEQUEUE.includes("planVisit("));
  assert.ok(USEQUEUE.includes("writeStore(p.store)"), "读完立刻写回 plan.store");
  assert.ok(USEQUEUE.includes("readStore()"), "每次写前重读一遍");
  assert.ok(USEQUEUE.includes("pruneStore("));
  assert.ok(USEQUEUE.includes("markSeen("));
  assert.ok(USEQUEUE.includes("skipAll("), "onSkip/skip 用 skipAll");
  assert.ok(/export function readStore/.test(USEQUEUE), "导出 readStore 给页内盖章");
  assert.ok(/export function writeStore/.test(USEQUEUE), "导出 writeStore 给页内盖章");
  // moment 键口径与 planVisit 规则 12 一致
  assert.ok(USEQUEUE.includes("`replay:${plan.today}`"));
  assert.ok(USEQUEUE.includes("`wrap:${plan.replay.date}`"));
  assert.ok(USEQUEUE.includes("`back:${plan.today}`"));
  assert.ok(USEQUEUE.includes("`wrap:${plan.pageDate}`"));
  // 印条 / 小卡 / 需要演出的判定
  assert.ok(USEQUEUE.includes('closing === "dayWrap"'));
  assert.ok(USEQUEUE.includes("plan.replay"));
  assert.ok(USEQUEUE.includes("firstVisit"), "新设备不需要 stage");
});

test("usePauseWhenHidden：hidden 设 data-seal-paused、visible 移除（规范 6.5）", () => {
  assert.ok(PAUSE.includes('"use client"'));
  assert.ok(PAUSE.includes("visibilitychange"));
  assert.ok(PAUSE.includes('setAttribute("data-seal-paused"'));
  assert.ok(PAUSE.includes('removeAttribute("data-seal-paused"'));
  assert.ok(!/\.animate\(|requestAnimationFrame/.test(PAUSE), "hook 只改属性，不做动画");
});

test("新文件无 emoji（SealStage / useSealQueue / usePauseWhenHidden）", () => {
  for (const [name, src] of [
    ["SealStage.tsx", STAGE],
    ["useSealQueue.ts", USEQUEUE],
    ["usePauseWhenHidden.ts", PAUSE],
  ]) {
    assert.ok(!EMOJI_RE.test(src), `${name} 不应出现 emoji`);
  }
});
