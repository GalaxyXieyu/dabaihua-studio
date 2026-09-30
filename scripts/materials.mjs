#!/usr/bin/env node
/**
 * materials.mjs — 把晴儿的每日素材推送到「阅读」的「选题素材」来源。
 *
 *   node scripts/materials.mjs push <YYYY-MM-DD> [--dir DIR] [--base URL] [--dry-run]
 *   node scripts/materials.mjs push-all [--dir DIR] [--base URL] [--dry-run]
 *
 * 素材来自 <dir>/<date>.md 的「今日干货」+「推荐选题」依据素材，以及
 * <dir>/<date>-topics.json 的 topics[].materials；正文取自
 * <dir>/.cache/bodies/<sha1(url)>.txt（自动剥离文件头）。
 *
 * 认证与 base 解析和 brief.mjs 一致（DABAIHUA_API_KEY > config.token；
 * --base > DABAIHUA_BASE_URL > config.endpoint > https://topic.aigalaxy.top）。
 * 本脚本绝不打印 key。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { apiRequest, resolveBase, resolveKey } from "./lib/dabaihua-api.mjs";
import { sha1 } from "./lib/digest-fetch.mjs";
import {
  materialsFromTopicsJson,
  normalizeMaterialUrl,
  parseDigestMarkdown,
  stripBodyHeader,
} from "./lib/topic-materials.mjs";

const DEFAULT_DIR = "/workspace/projects/daily-topics";
const BATCH_SIZE = 50;
const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

function usage() {
  process.stdout.write(
    [
      "用法：",
      "  node scripts/materials.mjs push <YYYY-MM-DD> [--dir DIR] [--base URL] [--dry-run]",
      "  node scripts/materials.mjs push-all [--dir DIR] [--base URL] [--dry-run]",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--dir" || arg === "--base") flags[arg.slice(2)] = argv[(index += 1)];
    else positional.push(arg);
  }
  return { positional, flags };
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 读取正文缓存：先按原始 url，再按规范化 url 找。 */
function readBody(dir, url) {
  for (const candidate of [url, normalizeMaterialUrl(url)]) {
    const file = path.join(dir, ".cache", "bodies", `${sha1(candidate)}.txt`);
    if (existsSync(file)) return stripBodyHeader(readFileSync(file, "utf8"));
  }
  return "";
}

/** 收集某天所有可导入素材。干货优先，其次依据素材，最后 topics.json。 */
export function collectMaterials(dir, date) {
  const collected = [];
  const seen = new Set();
  const add = (entry) => {
    const url = String(entry.url ?? "").trim();
    const originalTitle = String(entry.originalTitle ?? "").trim();
    const zhTitle = String(entry.title ?? "").trim();
    const title = originalTitle || zhTitle;
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    const material = {
      url,
      title: title.slice(0, 300),
      origin: String(entry.origin ?? "").trim(),
      publishedAt: String(entry.publishedAt ?? "").trim(),
      summary: String(entry.summary ?? "").trim().slice(0, 1200),
      tag: String(entry.tag ?? "").trim(),
    };
    // 弱素材：来自推荐选题依据素材与 topics.json，更新时只填空、不覆盖正文。
    if (entry.weak) material.weak = true;
    if (originalTitle && zhTitle) material.titleZh = zhTitle.slice(0, 300);
    collected.push(material);
  };

  const markdownPath = path.join(dir, `${date}.md`);
  if (existsSync(markdownPath)) {
    const { items, references } = parseDigestMarkdown(readFileSync(markdownPath, "utf8"));
    for (const item of items) add(item);
    for (const reference of references) add({ url: reference.url, title: reference.title, origin: domainOf(reference.url), weak: true });
  } else {
    process.stderr.write(`[materials] 找不到 ${markdownPath}\n`);
  }

  const topicsPath = path.join(dir, `${date}-topics.json`);
  if (existsSync(topicsPath)) {
    let json = null;
    try {
      json = JSON.parse(readFileSync(topicsPath, "utf8"));
    } catch (error) {
      process.stderr.write(`[materials] ${topicsPath} 解析失败：${error.message}\n`);
    }
    for (const material of materialsFromTopicsJson(json)) add({ ...material, weak: true });
  }

  for (const entry of collected) {
    const body = readBody(dir, entry.url);
    if (body) entry.contentMarkdown = body.slice(0, 120_000);
  }
  return collected;
}

export async function pushDate(date, dir, base, token, dryRun) {
  const items = collectMaterials(dir, date);
  if (dryRun) {
    process.stdout.write(`[dry-run] ${date}：将导入 ${items.length} 条素材\n`);
    for (const item of items.slice(0, 5)) process.stdout.write(`  - ${item.title}\n`);
    if (items.length > 5) process.stdout.write(`  … 其余 ${items.length - 5} 条\n`);
    return { added: 0, updated: 0, linked: 0, skipped: 0, skippedReasons: [] };
  }

  const totals = { added: 0, updated: 0, linked: 0, skipped: 0 };
  const skippedReasons = new Map();
  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const batch = items.slice(index, index + BATCH_SIZE);
    const result = await apiRequest(base, token, "/api/materials", { method: "POST", body: { date, items: batch } });
    totals.added += Number(result.added || 0);
    totals.updated += Number(result.updated || 0);
    totals.linked += Number(result.linked || 0);
    totals.skipped += Number(result.skipped || 0);
    for (const entry of result.items || []) {
      if (entry.status === "skipped") {
        const reason = entry.reason || "未知";
        skippedReasons.set(reason, (skippedReasons.get(reason) || 0) + 1);
      }
    }
  }
  return { ...totals, skippedReasons: [...skippedReasons.entries()] };
}

function printSummary(date, totals) {
  process.stdout.write(
    `${date}：新增 ${totals.added}、更新 ${totals.updated}、已在阅读里 ${totals.linked}、跳过 ${totals.skipped}\n`,
  );
  if (totals.skippedReasons?.length) {
    const detail = totals.skippedReasons.map(([reason, count]) => `${reason} ${count}`).join("；");
    process.stdout.write(`  跳过原因：${detail}\n`);
  }
}

function listDates(dir) {
  const dates = [];
  for (const file of readdirSync(dir)) {
    const matched = DATE_FILE_RE.exec(file);
    if (matched) dates.push(matched[1]);
  }
  return dates.sort();
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv.shift();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return;
  }
  const { positional, flags } = parseArgs(argv);
  const dir = flags.dir || process.env.DIGEST_OUT_DIR || DEFAULT_DIR;
  const base = resolveBase(flags.base);
  const token = resolveKey();
  const dryRun = Boolean(flags.dryRun);

  if (command === "push") {
    const date = positional[0];
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("用法：node scripts/materials.mjs push <YYYY-MM-DD>");
    if (!dryRun && !token) throw new Error("请设置 DABAIHUA_API_KEY 或先运行 topics login");
    if (!existsSync(dir)) throw new Error(`素材目录不存在：${dir}`);
    const totals = await pushDate(date, dir, base, token || "", dryRun);
    if (!dryRun) printSummary(date, totals);
    return;
  }

  if (command === "push-all") {
    if (!dryRun && !token) throw new Error("请设置 DABAIHUA_API_KEY 或先运行 topics login");
    if (!existsSync(dir)) throw new Error(`素材目录不存在：${dir}`);
    const dates = listDates(dir);
    if (!dates.length) {
      process.stdout.write(`没有找到 ${dir} 下的 YYYY-MM-DD.md\n`);
      return;
    }
    for (const date of dates) {
      const totals = await pushDate(date, dir, base, token || "", dryRun);
      if (!dryRun) printSummary(date, totals);
    }
    return;
  }

  throw new Error(`未知命令：${command}`);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`失败：${error.message}\n`);
    process.exitCode = 1;
  });
}