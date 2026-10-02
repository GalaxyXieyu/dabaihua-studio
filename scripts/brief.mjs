#!/usr/bin/env node
/**
 * brief.mjs — 每日选题简报命令行。
 *
 *   node scripts/brief.mjs validate <file.json>
 *   node scripts/brief.mjs push <file.json> [--dry-run] [--base URL]
 *   node scripts/brief.mjs responses [--date D | --since ISO | --latest] [--json] [--base URL]
 *   node scripts/brief.mjs fetch-materials (--date D | --all) [--force] [--base URL]
 *   node scripts/brief.mjs list
 *
 * validate 与 push --dry-run 在本地校验，不联网、不需要 token。
 * 认证：DABAIHUA_API_KEY 优先；否则读 ~/.config/topics-cli/config.json 的 token。
 * base：--base > DABAIHUA_BASE_URL > config.endpoint > https://superme.aigalaxy.top。
 * 本脚本绝不打印 key。
 */

import { readFileSync } from "node:fs";
import { apiRequest as request, resolveBase, resolveKey } from "./lib/dabaihua-api.mjs";

function usage() {
  process.stdout.write(
    [
      "用法：",
      "  node scripts/brief.mjs validate <file.json>",
      "  node scripts/brief.mjs push <file.json> [--dry-run] [--base URL]",
      "  node scripts/brief.mjs responses [--date D | --since ISO | --latest] [--json] [--base URL]",
      "  node scripts/brief.mjs fetch-materials (--date D | --all) [--force] [--base URL]",
      "  node scripts/brief.mjs list",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json" || arg === "--latest" || arg === "--dry-run" || arg === "--all" || arg === "--force") flags[arg.slice(2)] = true;
    else if (arg === "--base" || arg === "--date" || arg === "--since") flags[arg.slice(2)] = argv[(index += 1)];
    else positional.push(arg);
  }
  return { positional, flags };
}

async function cmdValidate(positional) {
  const file = positional[0];
  if (!file) throw new Error("用法：node scripts/brief.mjs validate <file.json>");
  let buf;
  try {
    buf = readFileSync(file);
  } catch (error) {
    throw new Error(`读不了这个文件：${error.message}`);
  }
  const core = await import("../lib/daily-brief-core.ts");
  if (buf.length > core.BRIEF_MAX_BYTES) {
    process.stderr.write(`简报超过 ${core.BRIEF_MAX_BYTES} 字节上限（当前 ${buf.length}）\n`);
    process.exitCode = 1;
    return false;
  }
  let raw;
  try {
    raw = JSON.parse(buf.toString("utf8"));
  } catch (error) {
    throw new Error(`不是合法 JSON：${error.message}`);
  }
  const result = core.validateBrief(raw);
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
    return false;
  }
  const ids = result.brief.topics.map((topic) => topic.id).join(", ");
  process.stdout.write(`格式正确：${result.brief.date}，${result.brief.topics.length} 个选题（${ids}）\n`);
  return true;
}

async function cmdPush(positional, flags, base, token) {
  const file = positional[0];
  if (!file) throw new Error("用法：node scripts/brief.mjs push <file.json> [--base URL]");
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`读不了这个文件或不是合法 JSON：${error.message}`);
  }
  if (!raw || typeof raw !== "object" || !raw.date || !Array.isArray(raw.topics)) {
    throw new Error("简报缺少 date 或 topics");
  }
  const result = await request(base, token, `/api/briefs/${raw.date}`, { method: "PUT", body: raw });
  const action = result.created ? "已导入" : "已更新";
  process.stdout.write(`${action} ${result.date}：${result.topicCount} 个选题，保留了 ${result.responsesKept} 条回复\n`);
  if (result.materials) {
    process.stdout.write(`素材：新增 ${result.materials.added}，更新 ${result.materials.updated}，已在阅读 ${result.materials.linked}\n`);
  }
  process.stdout.write(`页面地址：${result.url}\n`);
}

async function cmdResponses(flags, base, token) {
  const params = new URLSearchParams();
  if (flags.date) params.set("date", flags.date);
  else if (flags.since) params.set("since", flags.since);
  else params.set("latest", "1");
  const data = await request(base, token, `/api/briefs/responses?${params.toString()}`);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  if (!data.responses || data.responses.length === 0) {
    process.stdout.write("还没有回复\n");
    return;
  }
  for (const row of data.responses) {
    const verdict = row.decision === "pick" ? "就写这个" : row.decision === "reject" ? "不要" : "只打分";
    const line = [`${row.date}`, row.topicTitle || row.topicId, `→ ${verdict}`];
    if (row.rating) line.push(`★${row.rating}`);
    if (row.topicMissing) line.push("（简报里已没有这个选题）");
    process.stdout.write(`${line.join(" · ")}\n`);
    if (row.scenario) process.stdout.write(`  场景：${row.scenario.text}\n`);
    for (const answer of row.answers || []) {
      process.stdout.write(`  问：${answer.question}\n`);
      process.stdout.write(`  答：${answer.answer || "（未填）"}\n`);
    }
    if (row.ratingComment) process.stdout.write(`  评语：${row.ratingComment}\n`);
    if (row.rejectReason) process.stdout.write(`  理由：${row.rejectReason}\n`);
  }
}

const FETCH_REASON_LABELS = { login: "需要登录或付费", unreachable: "网页打不开", extract: "正文提取失败" };

function failedSummary(failed) {
  if (!failed.length) return "";
  const counts = new Map();
  for (const item of failed) {
    const reason = item && item.reason ? item.reason : "unreachable";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  const parts = [];
  for (const [reason, count] of counts) parts.push(`${FETCH_REASON_LABELS[reason] || reason} ${count}`);
  return `（${parts.join("、")}）`;
}

async function cmdFetchMaterials(flags, base, token) {
  let dates;
  if (flags.all) {
    const data = await request(base, token, "/api/briefs");
    dates = (data.briefs || []).map((brief) => brief.date).filter(Boolean);
    if (!dates.length) {
      process.stdout.write("还没有选题简报\n");
      return;
    }
  } else if (flags.date) {
    dates = [flags.date];
  } else {
    throw new Error("用法：node scripts/brief.mjs fetch-materials (--date D | --all) [--force]");
  }

  let totalChecked = 0;
  let totalFetched = 0;
  const allFailed = [];
  for (const date of dates) {
    const data = await request(base, token, `/api/briefs/${date}/materials`, {
      method: "POST",
      body: flags.force ? { force: true } : undefined,
    });
    const failed = Array.isArray(data.failed) ? data.failed : [];
    const checked = Number(data.checked || 0);
    const fetched = Number(data.fetched || 0);
    totalChecked += checked;
    totalFetched += fetched;
    allFailed.push(...failed);
    process.stdout.write(`${date}  检查 ${checked}  抓到 ${fetched}  没抓到 ${failed.length}${failedSummary(failed)}\n`);
  }
  if (dates.length > 1) {
    process.stdout.write(`合计  检查 ${totalChecked}  抓到 ${totalFetched}  没抓到 ${allFailed.length}${failedSummary(allFailed)}\n`);
  }
}

async function cmdList(base, token) {
  const data = await request(base, token, "/api/briefs");
  if (!data.briefs || data.briefs.length === 0) {
    process.stdout.write("还没有选题简报\n");
    return;
  }
  for (const brief of data.briefs) {
    process.stdout.write(`${brief.date} · ${brief.title || "（无标题）"} · ${brief.topicCount} 个选题 · 已回复 ${brief.responseCount}\n`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  const { positional, flags } = parseArgs(argv);

  // validate 与 push --dry-run 只做本地校验，不读 token、不联网。
  if (command === "validate") {
    await cmdValidate(positional);
    return;
  }

  const base = resolveBase(flags.base);

  if (command === "push") {
    if (flags["dry-run"]) {
      await cmdValidate(positional);
      process.stdout.write("dry-run：没有发送\n");
      return;
    }
    const token = resolveKey();
    if (!token) throw new Error("请设置 DABAIHUA_API_KEY 或先运行 topics login");
    await cmdPush(positional, flags, base, token);
    return;
  }

  const token = resolveKey();
  if (!token) throw new Error("请设置 DABAIHUA_API_KEY 或先运行 topics login");

  if (command === "responses") await cmdResponses(flags, base, token);
  else if (command === "fetch-materials") await cmdFetchMaterials(flags, base, token);
  else if (command === "list") await cmdList(base, token);
  else throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  process.stderr.write(`失败：${error.message}\n`);
  process.exitCode = 1;
});
