#!/usr/bin/env node
/**
 * publish-review.mjs — 把本地文章目录推送到 Aries 并触发导入，随后等待线上页面。
 *
 * 用法：
 *   npm run publish-review -- <slug> [--host Aries] [--dry-run] [--no-wait]
 *
 * 环境变量覆盖：
 *   PUBLISH_REVIEW_HOST              ssh 主机别名（默认 Aries）
 *   PUBLISH_REVIEW_REMOTE_ARTICLES   远端文章根目录（默认 /home/ubuntu/dabaihua-data/articles）
 *   PUBLISH_REVIEW_BASE_URL          线上站点根地址（默认 https://superme.aigalaxy.top）
 *   ARTICLES_DIR                     本地文章根目录（默认 /workspace/projects/articles）
 *
 * 只使用 Node 内置模块。rsync 使用 `--filter 'P review-feedback-*'` 保护服务器上
 * 已存在的审稿反馈文件不被 `--delete` 删除；远端 meta.json 上的审稿状态会在本地
 * 缺少审稿历史时合并进上传副本（写入临时目录，绝不修改本地文件）。
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const LOCAL_ARTICLES_DIR = process.env.ARTICLES_DIR || "/workspace/projects/articles";
const DEFAULT_HOST = process.env.PUBLISH_REVIEW_HOST || "Aries";
const REMOTE_ARTICLES = (process.env.PUBLISH_REVIEW_REMOTE_ARTICLES || "/home/ubuntu/dabaihua-data/articles").replace(/\/+$/, "");
const BASE_URL = (process.env.PUBLISH_REVIEW_BASE_URL || "https://superme.aigalaxy.top").replace(/\/+$/, "");

const REMOTE_REPO = "/home/ubuntu/dabaihua-studio";
const REMOTE_FEEDBACK = "/home/ubuntu/dabaihua-data/feedback";
const REMOTE_D1_DIR = "/home/ubuntu/dabaihua-data/state/v3/d1/miniflare-D1DatabaseObject";

const REVIEW_STATUSES = new Set(["changes-requested", "approved", "commented"]);
const EXCLUDED_NAMES = new Set(["preview.png", "pi.log", "pi-prompt.txt"]);
const EXCLUDED_DIRS = new Set(["build", "sources"]);
const RSYNC_EXCLUDES = ["build/", "preview.png", "pi.log", "pi-prompt.txt", "sources/", "*.tmp", "review-feedback-*"];

const log = (message) => process.stdout.write(`${message}\n`);
const fail = (message) => {
  process.stderr.write(`publish-review 失败：${message}\n`);
  process.exitCode = 1;
};

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function formatCommand(command, args) {
  const safe = /^[A-Za-z0-9_./:@=*+-]+$/;
  const rendered = args.map((arg) => (safe.test(arg) ? arg : shellQuote(arg)));
  return [command, ...rendered].join(" ");
}

function parseArgs(argv) {
  const options = { slug: "", host: DEFAULT_HOST, dryRun: false, noWait: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-wait") options.noWait = true;
    else if (arg === "--host") {
      options.host = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--host=")) options.host = arg.slice("--host=".length);
    else if (arg.startsWith("--")) throw new Error(`未知参数：${arg}`);
    else positionals.push(arg);
  }
  if (positionals.length !== 1) {
    throw new Error("用法：npm run publish-review -- <slug> [--host Aries] [--dry-run] [--no-wait]");
  }
  if (!options.host) throw new Error("--host 不能为空");
  options.slug = positionals[0];
  return options;
}

function assertLocalArticle(slug) {
  if (!SLUG_RE.test(slug)) throw new Error(`slug 不合法：${slug}`);
  const dir = path.join(LOCAL_ARTICLES_DIR, slug);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`本地文章目录不存在：${dir}`);
  const markers = ["meta.json", "01-draft.md", "02-final.md", "article.html"];
  if (!markers.some((name) => existsSync(path.join(dir, name)))) {
    throw new Error(`本地目录缺少 meta.json / 01-draft.md / 02-final.md / article.html：${dir}`);
  }
  return dir;
}

function readJson(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function fetchRemoteMeta(host, slug) {
  const remoteMeta = `${REMOTE_ARTICLES}/${slug}/meta.json`;
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", host, `cat ${shellQuote(remoteMeta)}`], { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isExcluded(src, root) {
  const rel = path.relative(root, src);
  if (!rel || rel.startsWith("..")) return false;
  const base = path.basename(src);
  const segments = rel.split(path.sep);
  if (segments.some((segment) => EXCLUDED_DIRS.has(segment))) return true;
  if (EXCLUDED_NAMES.has(base)) return true;
  if (base.endsWith(".tmp")) return true;
  return base.startsWith("review-feedback-");
}

/** 把本地文章目录复制到临时目录，排除不需要上传的文件；绝不改动本地文件。 */
function stageArticle(localDir) {
  const stagingRoot = mkdtempSync(path.join(tmpdir(), "publish-review-"));
  const stagingArticle = path.join(stagingRoot, path.basename(localDir));
  cpSync(localDir, stagingArticle, {
    recursive: true,
    filter: (src) => !isExcluded(src, localDir),
  });
  return { stagingRoot, stagingArticle };
}

function hasReviewMeta(remoteMeta) {
  return (
    remoteMeta.review !== undefined ||
    remoteMeta.review_round !== undefined ||
    remoteMeta.review_history !== undefined ||
    REVIEW_STATUSES.has(remoteMeta.status)
  );
}

function shouldMergeMeta(localMeta, remoteMeta) {
  if (!hasReviewMeta(remoteMeta)) return false;
  const localHistory = Array.isArray(localMeta.review_history) ? localMeta.review_history : [];
  if (localHistory.length === 0) return true;
  return Number(localMeta.review_round ?? 0) < Number(remoteMeta.review_round ?? 0);
}

function mergedMeta(localMeta, remoteMeta) {
  const merged = { ...localMeta };
  for (const key of ["review", "review_round", "review_history"]) {
    if (remoteMeta[key] !== undefined) merged[key] = remoteMeta[key];
  }
  if (REVIEW_STATUSES.has(remoteMeta.status)) merged.status = remoteMeta.status;
  return merged;
}

function writeMergedMeta(stagingArticle, meta) {
  writeFileSync(path.join(stagingArticle, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

function rsyncArgs(stagingArticle, host, slug, dryRun) {
  const args = ["-az", "--delete"];
  if (dryRun) args.push("--dry-run");
  for (const pattern of RSYNC_EXCLUDES) args.push("--exclude", pattern);
  // 显式保护服务器端审稿反馈，--delete 不会移除它们。
  args.push("--filter", "P review-feedback-*");
  args.push(`${stagingArticle}/`);
  args.push(`${host}:${REMOTE_ARTICLES}/${slug}/`);
  return args;
}

function remoteMkdirCommand() {
  return `mkdir -p ${shellQuote(REMOTE_ARTICLES)}`;
}

function remoteImportCommand(slug) {
  const d1Lookup = `$(ls ${shellQuote(REMOTE_D1_DIR)}/*.sqlite 2>/dev/null | grep -v metadata.sqlite | sort | head -n 1)`;
  const envPrefix = [
    `ARTICLES_DIR=${shellQuote(REMOTE_ARTICLES)}`,
    `FEEDBACK_DIR=${shellQuote(REMOTE_FEEDBACK)}`,
    `DIGEST_D1_PATH=${d1Lookup}`,
  ].join(" ");
  return `cd ${shellQuote(REMOTE_REPO)} && ${envPrefix} node scripts/sync-articles.mjs --once --slug ${shellQuote(slug)}`;
}

function ssh(host, remoteCommand, { allowFailure = false, stdio = "pipe" } = {}) {
  const result = spawnSync("ssh", ["-o", "BatchMode=yes", host, remoteCommand], { stdio, encoding: "utf8" });
  if (result.error) throw new Error(`执行 ssh 失败：${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || "").trim();
    throw new Error(`ssh 命令失败（退出码 ${result.status}）${detail ? `：${detail}` : ""}`);
  }
  return result;
}

function pageUrl(slug) {
  return `${BASE_URL}/articles/${slug}`;
}

async function waitForPage(slug, timeoutMs = 20000) {
  const url = pageUrl(slug);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      // 200 = 页面存在；302/307 = 未登录重定向到 /login，也算页面存在。
      if ([200, 301, 302, 303, 307, 308].includes(response.status)) return { ok: true, status: response.status };
    } catch {
      // 继续重试
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ok: false, status: 0 };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const localDir = assertLocalArticle(options.slug);
  log(`本地文章目录：${localDir}`);
  log(`目标主机：${options.host}`);

  const mkdirCommand = remoteMkdirCommand();
  const importCommand = remoteImportCommand(options.slug);

  let remoteMeta = null;
  if (!options.dryRun) {
    remoteMeta = fetchRemoteMeta(options.host, options.slug);
    if (remoteMeta) log("已读取服务器 meta.json（用于合并审稿状态）");
  }

  const { stagingRoot, stagingArticle } = stageArticle(localDir);
  try {
    const localMeta = readJson(path.join(stagingArticle, "meta.json")) || {};
    if (remoteMeta && shouldMergeMeta(localMeta, remoteMeta)) {
      writeMergedMeta(stagingArticle, mergedMeta(localMeta, remoteMeta));
      log(`已合并服务器审稿状态（review_round=${remoteMeta.review_round ?? "?"}）`);
    }

    const rsync = rsyncArgs(stagingArticle, options.host, options.slug, options.dryRun);

    if (options.dryRun) {
      log(`dry-run，将执行：`);
      log(`  ${formatCommand("rsync", rsync)}`);
      log(`  ${formatCommand("ssh", [options.host, mkdirCommand])}`);
      log(`  ${formatCommand("ssh", [options.host, importCommand])}`);
      log(pageUrl(options.slug));
      return;
    }

    ssh(options.host, mkdirCommand);

    const rsyncResult = spawnSync("rsync", rsync, { stdio: "inherit" });
    if (rsyncResult.error) throw new Error(`执行 rsync 失败：${rsyncResult.error.message}`);
    if (rsyncResult.status !== 0) throw new Error(`rsync 失败（退出码 ${rsyncResult.status}）`);

    const importResult = ssh(options.host, importCommand, { allowFailure: true, stdio: "inherit" });
    if (importResult.status !== 0) throw new Error(`服务器导入失败（退出码 ${importResult.status}）`);

    if (options.noWait) {
      log("已触发导入（--no-wait，不等待页面）");
    } else {
      const result = await waitForPage(options.slug);
      if (!result.ok) throw new Error(`等待 ${pageUrl(options.slug)} 超过 20s 仍不可访问`);
      log(`线上页面可访问（HTTP ${result.status}）`);
    }

    log(pageUrl(options.slug));
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error));
});
