#!/usr/bin/env node
// scripts/seal-mock-daily.mjs — 生成本地预览"今天"页印章动效用的假日报数据。
//
// 纯 node 脚本：不联网、不读任何私密文件，只在 stdout 输出一份能通过
// lib/private-data.ts 里 validateDailyData 的 DailyData JSON。
// 全部字段都是虚构的（summary 写"示例数据"、repo 一律 example-repo），
// 仓库是公开的，不要在这里放任何真实数据。
//
// 用法：
//   node scripts/seal-mock-daily.mjs [--today YYYY-MM-DD] [--scenario <name>] > /tmp/seal-mock.json
// scenario：
//   streak     默认。今天之前连续 9 天每天都有提交（昨天也有），今天没有记录
//              （模拟早上打开，当天 23:15 之前还没上传）。
//   catchup    同 streak，但昨天和今天都有记录（模拟当晚已上传）。
//   blank      最新一天（昨天）commits 为 0，前面几天有提交（空白日，不催）。
//   noyesterday 数据只到前天（模拟昨天的上传失败）。
//   gap        中间断一天 commits 为 0，测试连续天数从断点后重算。

const WEEKDAYS = "日一二三四五六";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCENARIOS = ["streak", "catchup", "blank", "noyesterday", "gap"];

/** Asia/Shanghai 的今天（YYYY-MM-DD），不依赖任何环境变量。 */
function shanghaiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const pad = (n) => String(n).padStart(2, "0");

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400e3);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

function weekdayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return "星期" + WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 确定性的虚构提交数：1–5 次，跟日期走，同一日期总是同一个数。 */
function fakeCommits(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86400e3);
  return 1 + ((dayNumber * 7 + 3) % 5);
}

/** 每个 scenario 产出 [{ date, commits }]（commits 为 0 或缺记录都表示那天没提交）。 */
function scenarioDays(today, scenario) {
  const NINE = Array.from({ length: 9 }, (_, i) => addDays(today, i - 9)); // today-9 .. today-1
  switch (scenario) {
    case "streak":
      // 今天没有记录：早上打开页面时当天数据还没传
      return NINE.map((date) => ({ date, commits: fakeCommits(date) }));
    case "catchup":
      // 昨天和今天都有记录：当晚已经上传
      return [...NINE, today].map((date) => ({ date, commits: fakeCommits(date) }));
    case "blank":
      // 昨天在数据集里但 commits 为 0（空白日）
      return NINE.map((date) => ({
        date,
        commits: date === addDays(today, -1) ? 0 : fakeCommits(date),
      }));
    case "noyesterday":
      // 数据只到前天：昨天的上传失败
      return NINE.slice(0, 8).map((date) => ({ date, commits: fakeCommits(date) }));
    case "gap":
      // 中间断一天（today-5 没提交），连续天数从断点后重算
      return NINE.map((date) => ({
        date,
        commits: date === addDays(today, -5) ? 0 : fakeCommits(date),
      }));
    default:
      throw new Error("unknown scenario: " + scenario);
  }
}

/** generatedAt：跟 scenario 对应的"最后一次上传"时间（虚构）。 */
function generatedAt(today, scenario) {
  switch (scenario) {
    case "catchup":
      return `${today}T23:20:00+08:00`;
    case "noyesterday":
      return `${addDays(today, -2)}T23:15:00+08:00`;
    default:
      return `${today}T07:30:00+08:00`;
  }
}

function buildDailyData(today, scenario) {
  const days = scenarioDays(today, scenario).map(({ date, commits }) => ({
    date,
    weekday: weekdayOf(date),
    summary: "示例数据",
    commits,
    repos: commits > 0 ? ["example-repo"] : [],
    tokensM: commits > 0 ? Number((commits * 1.4 + 0.7).toFixed(1)) : null,
    // sections 的字段全空：印章动效只读 date/commits，正文不进预览
    sections: {
      overview: null,
      what: [],
      blockers: null,
      results: null,
      leading: null,
      unfinished: null,
    },
    repoStats: [
      { repo: "example-repo", commits, additions: commits * 41, deletions: commits * 13 },
    ],
  }));
  return { generatedAt: generatedAt(today, scenario), days };
}

// ---------- 参数 ----------

const args = process.argv.slice(2);
let today = shanghaiToday();
let scenario = "streak";
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--today") {
    today = args[i + 1];
    i += 1;
    if (!DATE_RE.test(today ?? "")) {
      console.error("--today 需要 YYYY-MM-DD，收到：" + String(today));
      process.exit(1);
    }
  } else if (arg === "--scenario") {
    scenario = args[i + 1];
    i += 1;
    if (!SCENARIOS.includes(scenario ?? "")) {
      console.error(`--scenario 只能是 ${SCENARIOS.join(" / ")}，收到：` + String(scenario));
      process.exit(1);
    }
  } else if (arg === "--help" || arg === "-h") {
    console.log(
      "用法：node scripts/seal-mock-daily.mjs [--today YYYY-MM-DD] [--scenario " +
        SCENARIOS.join("|") +
        "] > out.json",
    );
    process.exit(0);
  } else {
    console.error("未知参数：" + arg);
    console.error("用法：node scripts/seal-mock-daily.mjs [--today YYYY-MM-DD] [--scenario " + SCENARIOS.join("|") + "]");
    process.exit(1);
  }
}

process.stdout.write(JSON.stringify(buildDailyData(today, scenario), null, 2) + "\n");
