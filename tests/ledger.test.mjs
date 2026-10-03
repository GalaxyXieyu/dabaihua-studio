import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { GROWTH_NAMES, activeTabKey, sectionForPath, sectionTabs } from "../lib/site-nav.ts";
import { legacyRedirect } from "../lib/legacy-redirects.ts";
import {
  aggregateMonth,
  aggregateWeek,
  extractWeeklyTakeaway,
  heatmapLevel,
  isoWeekOf,
  monthHasContent,
  reviewAnchorDate,
  weekDates,
  weekHasContent,
} from "../lib/review.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** 递归收集 app/ 下的源码文件，用于「不许硬编码板块名」的检查。 */
function appSourceFiles() {
  const root = fileURLToPath(new URL("../app/", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else files.push(path);
    }
  };
  walk(root);
  return files;
}

/** 一小段日报 fixture：三个有记录的日子，跨 2026-W39 / 2026-W40 和 9 / 10 月。 */
function dailyDay(date, commits, tokensM, repos, repoStats) {
  return {
    date,
    weekday: "",
    summary: "",
    commits,
    tokensM,
    repos,
    repoStats,
    sections: { overview: null, what: [], blockers: null, results: null, leading: null, unfinished: null },
  };
}

const days = [
  dailyDay("2026-09-28", 10, 100.5, ["alpha"], [
    { repo: "alpha", commits: 8, additions: 100, deletions: 20 },
    { repo: "beta", commits: 2, additions: 10, deletions: 5 },
  ]),
  dailyDay("2026-09-30", 4, 15.2, ["beta"], [{ repo: "beta", commits: 4, additions: 40, deletions: 2 }]),
  dailyDay("2026-10-02", 6, null, ["gamma"], [{ repo: "gamma", commits: 6, additions: 60, deletions: 6 }]),
];

test("computes the ISO week and its Monday..Sunday dates from plain date strings", () => {
  assert.equal(isoWeekOf("2026-10-02"), "2026-W40");
  assert.equal(isoWeekOf("2026-09-27"), "2026-W39");
  assert.equal(isoWeekOf("2026-09-28"), "2026-W40");
  // 跨年：2027-01-01 仍属于 2026 年的第 53 周。
  assert.equal(isoWeekOf("2027-01-01"), "2026-W53");

  assert.deepEqual(weekDates("2026-W40"), [
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04",
  ]);
  assert.deepEqual(weekDates("2026-W39")[0], "2026-09-21");
  assert.deepEqual(weekDates("2026-W39")[6], "2026-09-27");
  assert.deepEqual(weekDates("bogus"), []);
});

test("aggregates a week / month into commits, tokens, distinct repos and line changes", () => {
  const week = aggregateWeek(days, "2026-W40");
  assert.equal(week.commits, 20);
  assert.ok(Math.abs(week.tokensM - 115.7) < 1e-9, `tokensM ${week.tokensM}`);
  assert.equal(week.repos, 3);
  assert.equal(week.additions, 210);
  assert.equal(week.deletions, 33);
  assert.equal(week.recordedDays, 3);
  assert.equal(week.hasData, true);

  const month = aggregateMonth(days, "2026-09");
  assert.equal(month.commits, 14);
  assert.ok(Math.abs(month.tokensM - 115.7) < 1e-9);
  assert.equal(month.repos, 2);
  assert.equal(month.additions, 150);
  assert.equal(month.deletions, 27);
  assert.equal(month.recordedDays, 2);
  assert.equal(month.hasData, true);

  // 上一期没有任何日报：标记为无数据，页面据此显示「上周 / 上月无记录」。
  const previous = aggregateWeek(days, "2026-W39");
  assert.equal(previous.hasData, false);
  assert.equal(previous.recordedDays, 0);
  assert.equal(previous.commits, 0);
  assert.equal(aggregateMonth(days, "2026-08").hasData, false);
});

test("keeps a week / month view on the requested date even when that day has no record", () => {
  // 2026-09-24 是 W39 的周四，fixture 里没有这天的日报，周 / 月视图仍要停在这一周 / 这一月。
  assert.equal(reviewAnchorDate(days, "2026-09-24"), "2026-09-24");
  assert.equal(isoWeekOf(reviewAnchorDate(days, "2026-09-24")), "2026-W39");
  assert.equal(reviewAnchorDate(days, "2026-08-15"), "2026-08-15");
  // 非法 / 缺省日期回落到最新一天，行为不变。
  assert.equal(reviewAnchorDate(days, "2026-9-31"), "2026-10-02");
  assert.equal(reviewAnchorDate(days, "not-a-date"), "2026-10-02");
  assert.equal(reviewAnchorDate(days, undefined), "2026-10-02");
  assert.equal(reviewAnchorDate([], "2026-09-24"), null);
});

test("flags a target week / month as reachable when only a weekly report exists", () => {
  // W39 只有周记、没有日报；W40 有日报。
  assert.equal(weekHasContent("2026-W39", [], ["2026-W39"]), true);
  assert.equal(weekHasContent("2026-W39", days, []), false);
  assert.equal(weekHasContent("2026-W40", days, []), true);

  // W39 的周一在 9 月；W40 的周一（9 月 28 日）也在 9 月，所以 9 月可以靠周记点开。
  assert.equal(monthHasContent("2026-09", [], ["2026-W39"]), true);
  assert.equal(monthHasContent("2026-09", [], ["2026-W40"]), true);
  assert.equal(monthHasContent("2026-08", days, []), false);
});

test("counts month changed lines as additions plus deletions", () => {
  const month = aggregateMonth(days, "2026-09");
  assert.equal(month.additions + month.deletions, 177);
  assert.equal(month.additions, 150);
  assert.equal(month.deletions, 27);
});

test("maps commits onto five discrete heatmap levels", () => {
  assert.equal(heatmapLevel(null, 20), 0);
  assert.equal(heatmapLevel(0, 20), 0);
  assert.equal(heatmapLevel(20, 20), 4);
  assert.equal(heatmapLevel(10, 20), 2);
  assert.equal(heatmapLevel(5, 20), 1);
  // 相对当月峰值：很小的值也至少是 1，保证「有 / 无」可分。
  assert.equal(heatmapLevel(1, 100), 1);
  // 峰值缺省时用当天值兜底，不会算出 NaN。
  assert.equal(heatmapLevel(3, 0), 4);
});

test("extracts the weekly takeaway h1 and meta description without a DOM", () => {
  const html = [
    "<!doctype html><html><head>",
    "<title>备用标题</title>",
    '<meta name="description" content="第一句。第二句含 &amp; 符号。第三句。第四句。第五句不该出现。">',
    "</head><body><h1>本周标题</h1></body></html>",
  ].join("");
  const takeaway = extractWeeklyTakeaway(html);
  assert.ok(takeaway);
  assert.equal(takeaway.title, "本周标题");
  assert.equal(takeaway.description, "第一句。第二句含 & 符号。第三句。第四句。");
  assert.doesNotMatch(takeaway.description, /第五句/);

  // h1 缺失时退回 <title>；属性顺序颠倒也要认。
  const fallback = extractWeeklyTakeaway(
    '<html><head><meta content="只有一句。" name="description"><title>备用标题</title></head></html>',
  );
  assert.ok(fallback);
  assert.equal(fallback.title, "备用标题");
  assert.equal(fallback.description, "只有一句。");

  // 没有 description 就没有要点，页面不写任何占位话术。
  assert.equal(extractWeeklyTakeaway('<html><body><h1>没有摘要</h1></body></html>'), null);
  assert.equal(extractWeeklyTakeaway('<html><head><meta name="description" content="  "></head></html>'), null);
});

test("names the growth tabs from GROWTH_NAMES and routes old views to ledger", () => {
  const tabs = sectionTabs("growth", "admin");
  assert.deepEqual(
    tabs.map((item) => item.label),
    [GROWTH_NAMES.ledger.label, GROWTH_NAMES.career.label, GROWTH_NAMES.mirror.label],
  );
  assert.deepEqual(
    tabs.map((item) => item.key),
    ["ledger", "career", "mirror"],
  );
  assert.deepEqual(
    tabs.map((item) => item.href),
    ["/ledger", "/career", "/mirror"],
  );

  // 旧的日 / 周链接都落到同一个「翻翻旧账」tab。
  assert.equal(activeTabKey("/ledger"), "ledger");
  assert.equal(activeTabKey("/daily"), "ledger");
  assert.equal(activeTabKey("/daily/2026-10-02"), "ledger");
  assert.equal(activeTabKey("/weekly"), "ledger");
  assert.equal(activeTabKey("/weekly/2026-W39/"), "ledger");

  // 内容板块的审稿页 /review/[id] 仍是「文章」tab。
  assert.equal(sectionForPath("/review/123"), "content");
  assert.equal(activeTabKey("/review/123"), "articles");
});

test("redirects legacy /daily and /weekly URLs in the worker with the date intact", async () => {
  const at = (value) => new URL(value, "https://studio.example");
  assert.equal(legacyRedirect(at("/daily?date=2026-09-30")), "/ledger?view=day&date=2026-09-30");
  assert.equal(legacyRedirect(at("/daily?date=bad")), "/ledger?view=day");
  assert.equal(legacyRedirect(at("/daily")), "/ledger?view=day");
  assert.equal(legacyRedirect(at("/weekly")), "/ledger?view=week");
  assert.equal(legacyRedirect(at("/weekly/?date=2026-09-30")), "/ledger?view=week&date=2026-09-30");
  // /weekly/<week>/ 仍是 worker 的原始 HTML 路由，不能被列表重定向吃掉。
  assert.equal(legacyRedirect(at("/weekly/2026-W39/")), null);
  assert.equal(legacyRedirect(at("/topics/daily")), null);

  // worker 必须真正调用这个纯函数，并且插在登录门之后、周报 HTML 处理之前。
  const worker = read("../worker/index.ts");
  assert.match(worker, /legacyRedirect\(url\)/);
  const gate = worker.indexOf("isPublicPath(url.pathname)");
  const legacy = worker.indexOf("legacyRedirect(url)");
  const weekly = worker.indexOf("handleWeeklyRequest(request");
  assert.ok(gate >= 0 && legacy > gate && weekly > legacy, "legacyRedirect 应在登录门之后、周报处理之前");
});

test("keeps the old routes as redirects and the ledger page admin-only", () => {
  const daily = read("../app/daily/page.tsx");
  const weekly = read("../app/weekly/page.tsx");
  const ledger = read("../app/ledger/page.tsx");

  assert.match(daily, /redirect\(/);
  assert.match(daily, /\/ledger\?view=day/);
  assert.match(daily, /dateParts\(date\)/);
  // ?date= 必须 await 后读出并原样带到 /ledger，不能只重定向到 view=day。
  assert.match(daily, /await searchParams/);
  assert.match(daily, /\/ledger\?view=day&date=\$\{date\}/);
  assert.match(weekly, /redirect\("\/ledger\?view=week"\)/);

  // /ledger 和原 /daily 一样：未登录跳登录页，非管理员 404。
  assert.match(ledger, /redirect\("\/login\?next=\/ledger"\)/);
  assert.match(ledger, /if \(user\.role !== "admin"\) notFound\(\)/);
  assert.match(ledger, /loadDailyData\(env\.DB\)/);
  assert.match(ledger, /listWeeklyReports\(env\)/);
  assert.match(ledger, /getWeeklyReportHtml\(env, week\)/);
  assert.match(ledger, /<SiteAppBar user=\{user\} pathname="\/ledger" \/>/);

  // 内容板块的 /review/[id] 审稿路由必须原样保留。
  assert.equal(existsSync(fileURLToPath(new URL("../app/review/[id]/page.tsx", import.meta.url))), true);
});

test("keeps the growth page names in lib/site-nav.ts only", () => {
  const forbidden = [/翻翻旧账/, /攒点筹码/, /照照镜子/];
  for (const file of appSourceFiles()) {
    if (!/\.(tsx?|css|json)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} 不应硬编码板块名（改 lib/site-nav.ts 的 GROWTH_NAMES）`);
    }
  }
});
