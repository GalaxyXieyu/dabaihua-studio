// 页内盖章（第 5 部分）测试：阅读 / 审稿 / 照照镜子的当场盖章、旧账日视图补盖、
// 月视图静态印痕。这些是大组件，不在 node 里渲染，以源码断言为主；
// recordInPageStamp / planVisit 的纯逻辑按 seal-core.test.mjs 的方式真跑。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { recordInPageStamp } from "../app/_components/seal/seal-store.ts";
import { planVisit } from "../app/_components/seal/seal-moments.ts";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const DESK = read("app/_components/DeskApp.tsx");
const REVIEWER = read("app/_components/ArticleReviewer.tsx");
const MIRROR = read("app/mirror/_components/MirrorBoard.tsx");
const LEDGER = read("app/ledger/page.tsx");

// ---------- useInPageStamp.ts：数据先落库、播放器按需加载 ----------

test("useInPageStamp：recordInPageStamp 写库、stageLock 串行、播放器动态加载", () => {
  const src = read("app/_components/seal/useInPageStamp.ts");
  assert.ok(src.startsWith('"use client"'), "useInPageStamp 应是客户端 hook");
  assert.ok(src.includes("recordInPageStamp"), "应调用 recordInPageStamp 落库");
  assert.ok(src.includes("readStore"), "应从 readStore 读当前 store");
  assert.ok(src.includes("writeStore"), "应写回 localStorage");
  // 播放器按需加载：顶层静态 import 只允许类型（import type PlayerCtx）
  const dyn = /import\(["']\.\/seal-player["']\)/.exec(src);
  assert.ok(dyn, "应动态 import seal-player");
  const re = new RegExp(`^import\\s+[^;]*from\\s*["']\\.\\/seal-player["']`, "m");
  assert.ok(!re.test(src), "顶层不该静态 import seal-player（值导入）");
  assert.ok(src.includes("stageLock"), "应在全局 stageLock 里播放");
  assert.ok(src.includes("playStamp"), "应调用 playStamp");
  assert.ok(src.includes("prefersReducedMotion"), "reduced-motion 交给 player 判断");
  // 异常吞掉，只 console.warn
  assert.ok(src.includes("console.warn"), "异常时只 console.warn 一行");
  assert.ok(!/throw\s/.test(src), "hook 不该向外抛异常");
});

test("useInPageStamp：已盖过不重盖、seen 挂载时读取", () => {
  const src = read("app/_components/seal/useInPageStamp.ts");
  assert.match(src, /seenRef\.current\.has\(input\.key\)/, "key 已在 seen 里直接 resolve");
  assert.match(src, /new Set\(store\.seen\)/, "挂载时从 localStorage 读 seen");
  assert.match(src, /input\.slotId \? document\.getElementById\(input\.slotId\) : null/, "slotId 可选");
});

// ---------- DeskApp：阅读圆章 ----------

test("DeskApp：列表栏 tab 行右端有 48px 圆章角色，只此一处 seal-actor", () => {
  assert.ok(DESK.includes('<Seal id="seal-actor-reading" kind="yuan" size={48} pose="stamped" />'));
  assert.equal([...DESK.matchAll(/id="seal-actor-[\w-]+"/g)].length, 1, "DeskApp 只该有阅读这一个角色");
  assert.match(DESK, /article-tabs-seal-actor/, "角色放在列表栏 tab 行");
});

test("DeskApp：正文阅读区里没有 seal-actor", () => {
  const open = DESK.indexOf('<section className="reader-pane"');
  assert.ok(open >= 0, "应有 reader-pane 正文区");
  const close = DESK.indexOf("</section>", open);
  const pane = DESK.slice(open, close);
  assert.ok(!pane.includes("seal-actor"), "正文阅读区不该有印章角色");
  assert.ok(!pane.includes("<Seal"), "正文阅读区不该渲染 Seal 组件");
});

test("DeskApp：两处 mark-read 成功后都调 stamp，key 以 read: 开头", () => {
  assert.equal([...DESK.matchAll(/post\("\/api\/items", \{ action: "mark-read"/g)].length, 2, "应有两处 mark-read 请求");
  assert.equal([...DESK.matchAll(/stampRead\(selectedItem\.id\)/g)].length, 2, "两处成功后都调 stampRead");
  // stampRead 是盖章包装：key 前缀 read:、带 slotId、不 await（不阻塞主流程）
  const wrap = /function stampRead\(id: number\) \{[\s\S]*?\n  \}/.exec(DESK);
  assert.ok(wrap, "应有 stampRead 包装函数");
  assert.match(wrap[0], /const key = `read:\$\{id\}`/, "key 应以 read: 开头");
  assert.match(wrap[0], /readingStamp\.stamp\(\{ key, slotId: slotId\(key\) \}\)/, "应带 slotId 调 stamp");
  assert.match(wrap[0], /void readingStamp\.stamp/, "不该 await（不阻塞主流程）");
  assert.ok(/useInPageStamp\(\{ kind: "yuan", actorId: "seal-actor-reading", size: 48 \}\)/.test(DESK), "hook 应配圆章 48px");
});

test("DeskApp：已读行渲染 24px 印位，seen 命中才渲染", () => {
  assert.match(DESK, /readingStamp\.seen\.has\(`read:\$\{item\.id\}`\)/, "行渲染以 seen 为准");
  assert.match(DESK, /<StampSlot targetId=\{slotId\(`read:\$\{item\.id\}`\)\} state=\{pendingReadKeys\.has\(`read:\$\{item\.id\}`\) \? "pending" : "stamped"\} kind="yuan" size=\{24\} label="已读" \/>/, "已读印位 24px、先 pending 再 stamped");
});

// ---------- ArticleReviewer：审稿方章 ----------

test("ArticleReviewer：96px 方章角色 + 48px 印位，本轮已通过则 stamped", () => {
  assert.ok(REVIEWER.includes('<Seal id="seal-actor-review" kind="fang" size={96} pose="stamped" />'));
  assert.ok(/useInPageStamp\(\{ kind: "fang", actorId: "seal-actor-review", size: 96 \}\)/.test(REVIEWER), "hook 应配方章 96px");
  assert.match(REVIEWER, /targetId=\{slotId\(reviewSealKey\)\}/, "印位 targetId 由 key 生成");
  assert.match(REVIEWER, /state=\{roundApproved \|\| reviewStamp\.seen\.has\(reviewSealKey\) \? "stamped" : "unknown"\}/, "未通过时 unknown 不显示虚线");
  assert.match(REVIEWER, /const reviewSealKey = `review:\$\{target\.id\}:\$\{round\}`/, "key 以 review: 开头且带轮次");
});

test("ArticleReviewer：只有 approved 分支盖章，key 带 round", () => {
  // 全文件只有一处 reviewStamp.stamp，且落在 approved 分支内
  assert.equal([...REVIEWER.matchAll(/reviewStamp\.stamp\(/g)].length, 1, "reviewStamp.stamp 只该出现一次");
  const approved = REVIEWER.indexOf('if (verdict === "approved")');
  const stampAt = REVIEWER.indexOf("reviewStamp.stamp(");
  const elseAt = REVIEWER.indexOf("} else {", approved);
  assert.ok(approved >= 0 && stampAt > approved, "stamp 调用应在 approved 分支里");
  assert.ok(elseAt < 0 || stampAt < elseAt, "stamp 调用不该在非 approved 分支里");
  assert.match(REVIEWER, /const key = `review:\$\{target\.id\}:\$\{submittedRound\}`/, "key 用服务端返回的轮次");
  assert.match(REVIEWER, /slotId: slotId\(key\)/, "应带 slotId");
  // 盖章最多等 1600ms；reload 等盖章结束和原 1400ms 两者都到
  assert.match(REVIEWER, /Promise\.race\(\[\s*\n\s*reviewStamp\.stamp\(\{ key, slotId: slotId\(key\) \}\),\s*\n\s*new Promise<void>\(\(resolve\) => \{ window\.setTimeout\(resolve, 1600\); \}\),\s*\n\s*\]\)/, "Promise.race 限时 1600ms");
  assert.match(REVIEWER, /window\.setTimeout\(resolve, 1400\)/, "原 1400ms 仍保留");
  assert.match(REVIEWER, /await reloadDue;\s*\n\s*setSheet\(null\);\s*\n\s*window\.location\.reload\(\)/, "盖章结束且满 1400ms 后才 reload");
  // 非 approved 分支：原流程不变，reload 仍存在
  assert.match(REVIEWER, /window\.setTimeout\(\(\) => window\.location\.reload\(\), 1400\)/, "非 approved 分支 reload 流程不变");
});

// ---------- MirrorBoard：小椭圆章 ----------

test("MirrorBoard：key 由 mirrorSealKey 生成，带 card.version", () => {
  assert.match(MIRROR, /const mirrorSealKey = \(card: Card\) => `mirror:\$\{card\.id\}:\$\{card\.version\}`/, "key = mirror:<id>:<version>");
  assert.ok(/useInPageStamp\(\{ kind: "tuoyuan", actorId: "seal-actor-mirror", size: 48 \}\)/.test(MIRROR), "hook 应配小椭圆章 48px");
  assert.ok(MIRROR.includes('<Seal id="seal-actor-mirror" kind="tuoyuan" size={48} pose="stamped" />'), "卡片区右上角一只角色");
});

test("MirrorBoard：五个 handler 成功路径都传 mirrorSealKey", () => {
  for (const name of ["handleConfirm", "handleReject", "handleExpire", "handleReactivate", "handleEditAndConfirm"]) {
    const start = MIRROR.indexOf(`const ${name} = `);
    assert.ok(start >= 0, `应有 ${name}`);
    // 函数体到下一个 handler 定义为止
    const next = MIRROR.indexOf("\n  const handle", start + 1);
    const body = MIRROR.slice(start, next < 0 ? undefined : next);
    assert.match(body, /\(r\) => mirrorSealKey\(r\.card\)/, `${name} 的成功路径应传 mirrorSealKey`);
  }
  // 全文件恰好五处：替换 / 删除 / 仅编辑保存不盖
  assert.equal([...MIRROR.matchAll(/mirrorSealKey\(r\.card\)/g)].length, 5, "只有这五个写操作传 seal key");
});

test("MirrorBoard：盖章走 succeed/runSimple 的 seal 参数，undo 回调里没有", () => {
  // seal 参数可选地穿 succeed / runSimple，成功才生成 key 并延时盖章
  assert.match(MIRROR, /seal\?: \(result: WriteResult\) => string/, "succeed 的 seal 参数可选");
  assert.match(MIRROR, /const sealKey = seal\?\.\(result\)/, "成功后由 seal 函数生成 key");
  assert.match(MIRROR, /if \(sealKey\) window\.setTimeout\(\(\) => \{ void mirrorStamp\.stamp\(\{ key: sealKey, slotId: slotId\(sealKey\) \}\); \}, 50\)/, "盖章带 slotId 且不阻塞");
  // undo（withUndo）只 notify，不盖章
  const undoAt = MIRROR.indexOf("const withUndo = ");
  const undoEnd = MIRROR.indexOf("const succeed = ", undoAt);
  const undoBody = MIRROR.slice(undoAt, undoEnd);
  assert.ok(undoAt >= 0 && undoEnd > undoAt, "应能切出 withUndo 函数体");
  assert.ok(!undoBody.includes("stamp"), "撤销回调不该盖章");
  // notify 的 sealKey 是第 4 个可选参数，不改现有调用
  assert.match(MIRROR, /sealKey\?: string/, "toast 状态带可选 sealKey");
  assert.match(MIRROR, /<StampSlot targetId=\{slotId\(toast\.sealKey\)\} state="pending" kind="tuoyuan" size=\{24\}/, "成功提示前的 24px 印位由 key 生成");
});

// ---------- 翻翻旧账：日视图 + 月视图 ----------

test("ledger：DayView 渲染 LedgerDaySeals，只传 date/commits", () => {
  assert.ok(LEDGER.includes('<Seal id="seal-actor-ledger" kind="fang" size={96} pose="idle" />'), "日视图应有 96px 角色挂载点");
  const jsx = /<LedgerDaySeals\b[\s\S]*?\/>/.exec(LEDGER);
  assert.ok(jsx, "DayView 应渲染 LedgerDaySeals");
  const props = jsx[0];
  assert.match(props, /days=\{days\.map\(\(d\) => \(\{ date: d\.date, commits: d\.commits \}\)\)\}/, "days 只挑 date/commits");
  assert.match(props, /generatedAt=\{generatedAt\}/);
  assert.match(props, /pageDate=\{day\.date\}/);
  for (const field of ["summary", "sections", "repoStats", "repos", "tokensM", "weekday"]) {
    assert.ok(!props.includes(field), `<LedgerDaySeals> 不该收到 ${field}`);
  }
});

test("LedgerDaySeals：客户端组件、ledger-day 页、stage 按需加载", () => {
  const src = read("app/_components/seal/LedgerDaySeals.tsx");
  assert.ok(src.startsWith('"use client"'), "LedgerDaySeals 应是客户端组件");
  assert.match(src, /page: "ledger-day"/, "useSealQueue 应按 ledger-day 页规划");
  assert.ok(src.includes('lazy(() => import("./SealStage"))'), "SealStage 应 lazy 加载");
  assert.ok(src.includes('"seal-actor-ledger"'), "角色 id 应是 seal-actor-ledger");
});

test("ledger：MonthView 热力格 commits>0 时右下角静态 StampMark", () => {
  const cellAt = LEDGER.indexOf("commits > 0 ? (");
  assert.ok(cellAt >= 0, "热力格应有 commits > 0 判断");
  const mark = /<StampMark\b[\s\S]*?\/>/.exec(LEDGER.slice(cellAt, cellAt + 800));
  assert.ok(mark, "commits > 0 的格子应渲染 StampMark");
  assert.match(mark[0], /kind="fang"/);
  assert.match(mark[0], /size=\{24\}/);
  assert.match(mark[0], /streak=\{streakUntil\(cell\.date\)\}/, "streak 取到那天为止的连续天数");
  assert.ok(/aria-hidden|seal-heatmap-seal/.test(LEDGER), "静态印痕不该新增交互");
});

// ---------- 纯逻辑：页内章当场盖过，今天不补盖、明天进回放 ----------

const NOW = "2026-10-04T09:00:00+08:00";
const NEXT_DAY = "2026-10-05T09:00:00+08:00";

const DAYS = [
  { date: "2026-09-30", commits: 4 },
  { date: "2026-10-01", commits: 2 },
  { date: "2026-10-02", commits: 0 },
  { date: "2026-10-03", commits: 3 },
  { date: "2026-10-04", commits: 2 },
];
const DAYS2 = [...DAYS, { date: "2026-10-05", commits: 1 }];

test("页内章已盖：今天打开出现在 events 里、不在 queue 里", () => {
  // 页内写操作成功后当场落库（recordInPageStamp 写 seen + stampLog）
  const before = {
    firstSeenDate: "2026-09-28",
    lastSealSeenAt: null,
    lastVisitAt: "2026-10-04T08:00:00+08:00",
    seen: [],
    stampLog: [],
  };
  const stamped = recordInPageStamp(
    before,
    { key: "read:abc", seal: "yuan", at: "2026-10-04T09:30:00+08:00" },
    "2026-10-04",
  );
  assert.ok(stamped.seen.includes("read:abc"));
  assert.deepEqual(stamped.stampLog.map((e) => e.key), ["read:abc"]);

  // 同一天再打开今天页：事件在纸面上（events），但已当场盖过，不进补盖队列
  const plan = planVisit({ store: stamped, days: DAYS, generatedAt: null, now: NOW, page: "today" });
  assert.ok(plan.events.some((e) => e.key === "read:abc"), "页内章应在今天的事件里");
  assert.ok(!plan.queue.some((e) => e.key === "read:abc"), "已当场盖过，不该再补盖");
  assert.ok(plan.stamped.includes("read:abc"), "应在 stamped 里");
  // git 方章没盖过，仍走队列
  assert.ok(plan.queue.some((e) => e.key === "git:2026-10-04"));

  // 第二天打开（昨天数据已到）：页内章进昨日回放，排在 git 方章前面
  const plan2 = planVisit({ store: plan.store, days: DAYS2, generatedAt: null, now: NEXT_DAY, page: "today" });
  assert.ok(plan2.replay, "第二天应演昨日回放");
  assert.equal(plan2.replay.date, "2026-10-04");
  const keys = plan2.replay.events.map((e) => e.key);
  assert.ok(keys.includes("read:abc"), "页内章应进昨日回放");
  assert.ok(keys.includes("git:2026-10-04"), "git 方章在回放里代表一整天");
  assert.ok(keys.indexOf("read:abc") < keys.indexOf("git:2026-10-04"), "页内章排在 git 方章前面");
  assert.ok(!plan2.queue.some((e) => e.key === "read:abc"), "回放的章不进补盖队列");
});
