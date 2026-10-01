/**
 * build-mirror.mjs — 把本机私密正本汇总成站点可读的 content/mirror/mirror.json。
 *
 * 输入（只读，仓库之外）：
 *   /workspace/handbook/entries.jsonl   正本（追加式，同一 id 多版本）
 *   /workspace/handbook/inbox.jsonl     收件箱（待确认）
 *
 * 输出：content/mirror/mirror.json —— 页面只读这个文件；它被 .gitignore 忽略，不进公开仓库。
 * 任一边缺失都不报错：没有正本就写出空 entries；坏行跳过并记进 warnings。
 *
 * 用法：
 *   npm run mirror:build
 *   node scripts/build-mirror.mjs [--out <path>] [--handbook-dir <dir>]
 *
 * 环境变量：HANDBOOK_DIR、MIRROR_OUT（命令行参数优先）。
 * 隐私：脚本只读、绝不写入 /workspace/handbook/。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const DEFAULT_HANDBOOK_DIR = process.env.HANDBOOK_DIR || "/workspace/handbook";
export const DEFAULT_OUT = process.env.MIRROR_OUT || path.join(REPO_ROOT, "content/mirror/mirror.json");

/** 逐行解析 JSONL，返回 {records, errors}。坏行不抛错，记下来。 */
export function parseJsonl(text) {
  const records = [];
  const errors = [];
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    try {
      records.push(JSON.parse(trimmed));
    } catch (error) {
      errors.push({ line: index + 1, message: String(error?.message || error) });
    }
  });
  return { records, errors };
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function versionOf(row) {
  const value = row?.version;
  return Number.isInteger(value) ? value : 0;
}

/** 按 id 归组，每组按 version 升序；同版本按出现顺序。 */
export function groupById(records) {
  const groups = new Map();
  records.forEach((row, index) => {
    if (!row || typeof row !== "object" || typeof row.id !== "string") return;
    if (!groups.has(row.id)) groups.set(row.id, []);
    groups.get(row.id).push({ index, row });
  });
  const result = new Map();
  for (const [id, rows] of groups) {
    rows.sort((a, b) => versionOf(a.row) - versionOf(b.row) || a.index - b.index);
    result.set(id, rows.map((item) => item.row));
  }
  return result;
}

function toHistoryItem(row) {
  return {
    version: versionOf(row),
    title: asString(row.title),
    body: asString(row.body),
    status: asString(row.status),
    reason: asString(row.reason),
    recordedAt: asString(row.recorded_at),
    supersededBy: asString(row.superseded_by),
  };
}

/** 把某个 id 的所有版本折成页面要的一条：最新版 + history。 */
export function toEntry(rows) {
  const latest = rows[rows.length - 1];
  return {
    id: asString(latest.id),
    category: asString(latest.category),
    title: asString(latest.title),
    body: asString(latest.body),
    scope: asArray(latest.scope).map(asString).filter(Boolean),
    sources: asArray(latest.sources)
      .filter((source) => source && typeof source === "object")
      .map((source) => ({
        agent: asString(source.agent),
        date: asString(source.date),
        ref: asString(source.ref),
      })),
    status: asString(latest.status),
    confirmedBy: asString(latest.confirmed_by),
    confirmedAt: asString(latest.confirmed_at),
    supersedes: asArray(latest.supersedes).map(asString).filter(Boolean),
    supersededBy: asString(latest.superseded_by),
    reviewAfter: asString(latest.review_after),
    reason: asString(latest.reason),
    addedBy: asString(latest.added_by),
    options: asArray(latest.options).map(asString).filter(Boolean),
    owner: asString(latest.owner),
    recordedAt: asString(latest.recorded_at),
    history: rows.map(toHistoryItem),
  };
}

function readJsonlFile(file) {
  if (!file || !existsSync(file)) return { records: [], errors: [] };
  return parseJsonl(readFileSync(file, "utf8"));
}

/** 汇总两个账本，返回页面需要的 {generatedAt, entries, inbox, warnings}。 */
export function buildMirrorData({ handbookDir = DEFAULT_HANDBOOK_DIR } = {}) {
  const generatedAt = new Date().toISOString();
  if (!handbookDir || !existsSync(handbookDir)) {
    return { generatedAt, entries: [], inbox: [], warnings: [] };
  }
  const entriesParse = readJsonlFile(path.join(handbookDir, "entries.jsonl"));
  const inboxParse = readJsonlFile(path.join(handbookDir, "inbox.jsonl"));

  const warnings = [
    ...entriesParse.errors.map((error) => ({ file: "entries.jsonl", ...error })),
    ...inboxParse.errors.map((error) => ({ file: "inbox.jsonl", ...error })),
  ];

  const entryGroups = groupById(entriesParse.records);
  const inboxGroups = groupById(inboxParse.records);
  const entryIds = new Set(entryGroups.keys());

  const entries = [...entryGroups.values()].map(toEntry);
  // 已确认进正本的收件箱 id 不再算待确认。
  const inbox = [...inboxGroups.entries()]
    .filter(([id]) => !entryIds.has(id))
    .map(([, rows]) => toEntry(rows))
    .filter((entry) => entry.status === "待确认");

  return { generatedAt, entries, inbox, warnings };
}

export function writeMirrorData(data, outFile = DEFAULT_OUT) {
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return outFile;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") options.out = argv[++index];
    else if (arg === "--handbook-dir") options.handbookDir = argv[++index];
  }
  return options;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const data = buildMirrorData({ handbookDir: options.handbookDir || DEFAULT_HANDBOOK_DIR });
  const out = writeMirrorData(data, options.out || DEFAULT_OUT);
  const stale = data.entries.filter((entry) => entry.status === "已推翻").length;
  console.log(
    `照照镜子已汇总：${data.entries.length} 条正本（其中 ${stale} 条已推翻）、${data.inbox.length} 条待确认 -> ${path.relative(REPO_ROOT, out) || out}`,
  );
}
