// 今天页"新盖的章"栏目测试：服务端只发 date/commits、TodaySeals 的按需加载、
// 假数据脚本全部虚构且能过 validateDailyData、构建产物把播放器拆成独立 chunk。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateDailyData } from "../lib/private-data.ts";
import { commitStreak } from "../app/_components/seal/seal-moments.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// ---------- app/page.tsx：数据权限与角色挂载点 ----------

test("loadDailyData 只在 isAdmin 时调用，且与 getTodayData 并行", () => {
  const src = read("app/page.tsx");
  // 唯一一处调用在 isAdmin 三元里
  const calls = [...src.matchAll(/loadDailyData\(/g)];
  assert.equal(calls.length, 1, "page.tsx 只该有一处 loadDailyData 调用");
  assert.match(src, /isAdmin\s*\?\s*loadDailyData\(env\.DB\)\s*:\s*Promise\.resolve\(null\)/);
});

test("传给 TodaySeals 的只有 date/commits 映射和 generatedAt", () => {
  const src = read("app/page.tsx");
  // 映射对象只挑 date 和 commits，summary/sections/repoStats 不发给浏览器
  assert.match(src, /daily\.days\.map\(\(d\) => \(\{ date: d\.date, commits: d\.commits \}\)\)/);
  const jsx = /<TodaySeals\b[^>]*>/.exec(src);
  assert.ok(jsx, "page.tsx 里应有 <TodaySeals …>");
  const props = jsx[0];
  assert.match(props, /days=\{sealDays\}/);
  assert.match(props, /generatedAt=\{daily\?\.generatedAt \?\? null\}/);
  for (const field of ["summary", "sections", "repoStats", "repos", "tokensM", "weekday"]) {
    assert.ok(!props.includes(field), `<TodaySeals> 不该收到 ${field}`);
  }
});

test("刊头里有 160px 角色挂载点和提示挂载点", () => {
  const src = read("app/page.tsx");
  assert.ok(src.includes('<Seal id="seal-actor-today" kind="fang" size={160} pose="idle" />'));
  assert.ok(src.includes('id="seal-hint-today"'));
  assert.ok(src.includes('className="td-a-seal-mount"'));
  assert.ok(src.includes('<TodaySeals'), "briefing 第一行应渲染 TodaySeals");
});

// ---------- TodaySeals.tsx：客户端组件与按需加载 ----------

test('TodaySeals 有 "use client"，SealStage 用 lazy 动态加载', () => {
  const src = read("app/_components/seal/TodaySeals.tsx");
  assert.ok(src.startsWith('"use client"'), "TodaySeals 应是客户端组件");
  assert.ok(src.includes('lazy(() => import("./SealStage"))'), "SealStage 应 lazy 加载");
  // 顶层不能静态 import SealStage / seal-player（否则 chunk 会被合进页面包）
  for (const dep of ["./SealStage", "./seal-player"]) {
    const re = new RegExp(`^import[^;]*from\\s*["']${dep.replace(/\./g, "\\.")}["']`, "m");
    assert.ok(!re.test(src), `TodaySeals 顶层不该静态 import ${dep}`);
  }
  assert.ok(src.includes("needsStage &&"), "SealStage 应只在 needsStage 时渲染");
});

// ---------- 印谱叶：新盖的章改成居中、行均衡的印谱版面 ----------

test("新盖的章是印谱叶：文武边 + seal-book-grid，去掉右侧大号计数列", () => {
  const src = read("app/_components/seal/TodaySeals.tsx");
  assert.ok(src.includes('className="td-a-seals seal-book"'), "外层应是印谱叶（不再用 td-a-row 网格）");
  assert.ok(src.includes('className="seal-book-in"'));
  assert.ok(src.includes('className="seal-book-title"'));
  assert.ok(src.includes('id="td-a-row-seals"'), "标题 id 保留（aria-labelledby）");
  assert.ok(src.includes("新盖的章"), "标题文字");
  assert.ok(src.includes("近七日 · 未盖"), "零枚时写未盖");
  assert.ok(src.includes("cnCount(count)"), "枚数用中文数字并进副行");
  assert.ok(src.includes("<SealBookGrid"), "印位格应交给 SealBookGrid");
  for (const gone of ["td-a-col-figure", "td-a-index", "td-a-unit", "td-a-seal-cells", "td-a-col-label"]) {
    assert.ok(!src.includes(gone), `不该再出现 ${gone}`);
  }
  // 昨天小卡 / 当天印条 / 连续天数原样保留
  assert.ok(src.includes('id="seal-yesterday-card"'));
  assert.ok(src.includes("seal-strip-"));
  assert.ok(src.includes("td-a-seal-note"));
});

test("旧账日视图的印章区也用 SealBookGrid", () => {
  const src = read("app/_components/seal/LedgerDaySeals.tsx");
  assert.ok(src.includes("<SealBookGrid"), "印位格应交给 SealBookGrid");
  assert.ok(!src.includes("daily-a-seal-cells"), "旧格子列表应删掉");
  assert.ok(src.includes("seal-strip-"), "当天印条保留");
});

test("seal.css：印谱叶与印位格规则都在，today.css 里旧格子规则已删", () => {
  const css = read("app/_components/seal/seal.css");
  for (const rule of [
    ".seal-book {",
    ".seal-book-in {",
    ".seal-book-title::before,",
    ".seal-book-sub {",
    ".seal-book-grid {",
    ".seal-book-cell[data-d-first]::before",
    ".seal-book-cell[data-m-hide]",
    ".seal-book-imp .seal-slot",
  ]) {
    assert.ok(css.includes(rule), `seal.css 缺少 ${rule}`);
  }
  const today = read("app/today.css");
  for (const gone of [".td-a-seal-cells", ".td-a-seal-cell", ".td-a-seal-cell-note"]) {
    assert.ok(!today.includes(gone), `today.css 不该再有 ${gone}`);
  }
  const daily = read("app/ledger/daily.css");
  for (const gone of [".daily-a-seal-cells", ".daily-a-seal-cell", ".daily-a-seal-cell-note"]) {
    assert.ok(!daily.includes(gone), `daily.css 不该再有 ${gone}`);
  }
});

// ---------- scripts/seal-mock-daily.mjs：假数据 ----------

const MOCK = ["scripts/seal-mock-daily.mjs"];
const TODAY = "2026-03-10"; // 固定日期，测试可复现
const YESTERDAY = "2026-03-09";
const SCENARIOS = ["streak", "catchup", "blank", "noyesterday", "gap"];

function runMock(...args) {
  return execFileSync(process.execPath, [...MOCK, ...args], { encoding: "utf8" });
}

test("每个 scenario 都能通过 validateDailyData 且不含私密字样", () => {
  for (const scenario of SCENARIOS) {
    const out = runMock("--today", TODAY, "--scenario", scenario);
    const validated = validateDailyData(JSON.parse(out));
    assert.ok(validated.ok, `${scenario} 应通过校验：${validated.ok ? "" : validated.error}`);
    // 全部虚构：不出现本机路径、职业数据模块名或邮箱样式
    for (const forbidden of ["/workspace", "career", "@"]) {
      assert.ok(!out.includes(forbidden), `${scenario} 输出不该包含 ${forbidden}`);
    }
    // 正文与仓库都是示例占位
    for (const day of validated.data.days) {
      assert.equal(day.summary, "示例数据");
      assert.ok(day.repos.every((r) => r === "example-repo"));
      assert.equal(Object.values(day.sections).filter((v) => v != null && !(Array.isArray(v) && v.length === 0)).length, 0, "sections 应全空");
    }
  }
});

test("默认 scenario 是 streak；streak 的 commitStreak 是 9 且今天没记录", () => {
  const out = runMock("--today", TODAY);
  const validated = validateDailyData(JSON.parse(out));
  assert.ok(validated.ok);
  const days = validated.data.days.map((d) => ({ date: d.date, commits: d.commits }));
  assert.equal(commitStreak(days), 9, "连续 9 天有提交");
  assert.ok(!days.some((d) => d.date === TODAY), "今天不应有记录（早上还没上传）");
  assert.ok(days.some((d) => d.date === YESTERDAY && (d.commits ?? 0) > 0), "昨天应有提交");

  const explicit = runMock("--today", TODAY, "--scenario", "streak");
  assert.equal(explicit, out, "省略 --scenario 等价于 streak");
});

test("catchup 昨天和今天都有记录；blank 最新一天 commits 为 0", () => {
  const catchup = validateDailyData(JSON.parse(runMock("--today", TODAY, "--scenario", "catchup")));
  assert.ok(catchup.ok);
  const cDays = catchup.data.days.map((d) => ({ date: d.date, commits: d.commits }));
  assert.ok(cDays.some((d) => d.date === TODAY && (d.commits ?? 0) > 0), "今天应有提交");
  assert.ok(cDays.some((d) => d.date === YESTERDAY && (d.commits ?? 0) > 0), "昨天应有提交");

  const blank = validateDailyData(JSON.parse(runMock("--today", TODAY, "--scenario", "blank")));
  assert.ok(blank.ok);
  const latest = blank.data.days[blank.data.days.length - 1];
  assert.equal(latest.date, YESTERDAY, "最新一天是昨天");
  assert.equal(latest.commits, 0, "blank 最新一天 commits 应为 0");
});

test("noyesterday 数据只到前天；gap 连续天数从断点后重算", () => {
  const noy = validateDailyData(JSON.parse(runMock("--today", TODAY, "--scenario", "noyesterday")));
  assert.ok(noy.ok);
  assert.ok(!noy.data.days.some((d) => d.date === YESTERDAY), "不应有昨天的记录");
  const latest = noy.data.days[noy.data.days.length - 1];
  assert.equal(latest.date, "2026-03-08", "数据应止于前天");

  const gap = validateDailyData(JSON.parse(runMock("--today", TODAY, "--scenario", "gap")));
  assert.ok(gap.ok);
  const gDays = gap.data.days.map((d) => ({ date: d.date, commits: d.commits }));
  assert.equal(commitStreak(gDays), 4, "断点（today-5）之后只有 4 天连续");
  assert.equal(gDays.find((d) => d.date === "2026-03-05").commits, 0, "中间断的那天应为 0");
});

test("非法参数会被拒绝而不是产出坏数据", () => {
  for (const [label, args] of [["坏日期", ["--today", "2026-3-8"]], ["坏场景", ["--scenario", "bogus"]]]) {
    assert.throws(() => runMock(...args), { status: 1 }, `${label} 应以非零退出码失败`);
  }
});

// ---------- 构建产物：播放器拆成按需加载的 chunk ----------

test("seal-replay 播放器 chunk 与页面 chunk 不是同一个文件", { skip: !existsSync("dist/client") }, () => {
  const clientDir = new URL("../dist/client/", import.meta.url);
  const jsFiles = readdirSync(clientDir, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(fileURLToPath(clientDir), f));
  const contents = new Map(jsFiles.map((f) => [f, readFileSync(f, "utf8")]));
  const has = (needle) => [...contents].filter(([, c]) => c.includes(needle)).map(([f]) => f);
  const replayFiles = has("seal-replay");
  const stripFiles = has("seal-strip-");
  assert.ok(replayFiles.length >= 1, "应有一个包含 seal-replay 的 js chunk（SealStage/播放器）");
  assert.ok(stripFiles.length >= 1, "应有一个包含 seal-strip- 的 js chunk（页面栏目）");
  // 页面 chunk（有印条标记、但没有播放器）与播放器 chunk 是两个文件：
  // 没有新事件时页面 chunk 正常渲染，播放器 chunk 不会被加载
  const pageChunk = stripFiles.find((f) => !replayFiles.includes(f));
  assert.ok(pageChunk, "页面 chunk（含 seal-strip- 但不含 seal-replay）应单独存在");
  // 页面 chunk 以文件名引用播放器 chunk（lazy 动态 import 的证据）
  const replayNames = replayFiles.map((f) => path.basename(f));
  assert.ok(
    replayNames.some((name) => contents.get(pageChunk).includes(name)),
    "页面 chunk 应按文件名引用播放器 chunk（动态 import）",
  );
});
