#!/usr/bin/env node
/**
 * brief.mjs — 每日选题简报命令行。
 *
 *   node scripts/brief.mjs push <file.json> [--base URL]
 *   node scripts/brief.mjs responses [--date D | --since ISO | --latest] [--json] [--base URL]
 *   node scripts/brief.mjs list
 *
 * 认证：DABAIHUA_API_KEY 优先；否则读 ~/.config/topics-cli/config.json 的 token。
 * base：--base > DABAIHUA_BASE_URL > config.endpoint > https://topic.aigalaxy.top。
 * 本脚本绝不打印 key。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_BASE = "https://topic.aigalaxy.top";
const CONFIG_DIR = process.env.TOPICS_CONFIG_DIR || path.join(homedir(), ".config", "topics-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    /* 配置损坏时按未登录处理 */
  }
  return {};
}

function resolveBase(flagBase) {
  const configured = flagBase || process.env.DABAIHUA_BASE_URL || loadConfig().endpoint || DEFAULT_BASE;
  return String(configured).trim().replace(/\/+$/, "");
}

function resolveKey() {
  const envKey = String(process.env.DABAIHUA_API_KEY || "").trim();
  if (envKey) return envKey;
  return String(loadConfig().token || "").trim();
}

function usage() {
  process.stdout.write(
    [
      "用法：",
      "  node scripts/brief.mjs push <file.json> [--base URL]",
      "  node scripts/brief.mjs responses [--date D | --since ISO | --latest] [--json] [--base URL]",
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
    if (arg === "--json" || arg === "--latest") flags[arg.slice(2)] = true;
    else if (arg === "--base" || arg === "--date" || arg === "--since") flags[arg.slice(2)] = argv[(index += 1)];
    else positional.push(arg);
  }
  return { positional, flags };
}

async function request(base, token, pathname, options = {}) {
  const response = await fetch(base + pathname, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const detail = Array.isArray(data.errors) ? data.errors.join("；") : data.error || `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data;
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
  const base = resolveBase(flags.base);
  const token = resolveKey();
  if (!token) throw new Error("请设置 DABAIHUA_API_KEY 或先运行 topics login");

  if (command === "push") await cmdPush(positional, flags, base, token);
  else if (command === "responses") await cmdResponses(flags, base, token);
  else if (command === "list") await cmdList(base, token);
  else throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  process.stderr.write(`失败：${error.message}\n`);
  process.exitCode = 1;
});
