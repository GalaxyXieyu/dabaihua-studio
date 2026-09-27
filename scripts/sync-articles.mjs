/**
 * sync-articles.mjs — 本地文章目录 ↔ D1 同步 + 审稿反馈导出
 *
 * 用法：
 *   node scripts/sync-articles.mjs [--once] [--watch] [--interval 10] [--slug <slug>]
 *                                  [--export-only] [--import-only]
 *
 * 环境变量：
 *   ARTICLES_DIR     文章根目录（默认 /workspace/projects/articles）
 *   FEEDBACK_DIR     选题审稿反馈导出目录（默认 /workspace/projects/drafts/.feedback）
 *   DIGEST_D1_PATH   直接指定本地 D1 sqlite 文件；缺省时自动探测 wrangler 本地状态目录
 *
 * IMPORT：把每个 <slug>/ 目录的 meta.json、01-draft.md、02-final.md、qa-report.md、
 *         article.html、images/* 导入 D1；绝不删除用户审稿数据。
 * EXPORT：把 exported_at IS NULL 的 review_rounds 写成 review-feedback-<round>.json/.md，
 *         并把状态字段合并回文章 meta.json。
 */

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTICLES_DIR = process.env.ARTICLES_DIR || "/workspace/projects/articles";
const FEEDBACK_DIR = process.env.FEEDBACK_DIR || "/workspace/projects/drafts/.feedback";

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const IMAGE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const EXT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
const VERDICT_LABELS = { approved: "通过", changes_requested: "要求修改", comments: "仅批注" };

const log = (message) => process.stderr.write(`[articles] ${message}\n`);

function warn(message) {
  process.stderr.write(`[articles] WARN ${message}\n`);
}

function resolveD1Path() {
  if (process.env.DIGEST_D1_PATH) return process.env.DIGEST_D1_PATH;
  const dir = path.join(REPO_ROOT, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  try {
    const candidate = readdirSync(dir)
      .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
      .sort()[0];
    return candidate ? path.join(dir, candidate) : "";
  } catch {
    return "";
  }
}

function sha256Text(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readTextOrNull(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function extractTitle(markdown) {
  const match = String(markdown ?? "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function isSymlink(filePath) {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}

function writeTextAtomic(file, contents) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, file);
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

// ---------- 建表（与 lib/store.ts 运行时 schema 保持一致）----------

function ensureReviewTables(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS articles (slug TEXT PRIMARY KEY, date TEXT, title TEXT, topic TEXT, status TEXT, meta_json TEXT NOT NULL DEFAULT '{}', draft_md TEXT, final_md TEXT, qa_report TEXT, article_html TEXT, content_hash TEXT, review_round INTEGER NOT NULL DEFAULT 1, is_public INTEGER NOT NULL DEFAULT 0, topic_id INTEGER, synced_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS articles_date_idx ON articles(date DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS articles_public_idx ON articles(is_public, updated_at DESC);
CREATE TABLE IF NOT EXISTS article_assets (slug TEXT NOT NULL, path TEXT NOT NULL, content_type TEXT NOT NULL, bytes BLOB NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(slug, path));
CREATE TABLE IF NOT EXISTS article_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, round INTEGER NOT NULL, html TEXT, markdown TEXT, content_hash TEXT, created_at TEXT NOT NULL, UNIQUE(target_type, target_id, round));
CREATE TABLE IF NOT EXISTS review_marks (id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, round INTEGER NOT NULL, user_id INTEGER NOT NULL, kind TEXT NOT NULL, exact TEXT NOT NULL, prefix TEXT NOT NULL DEFAULT '', suffix TEXT NOT NULL DEFAULT '', start_offset INTEGER, end_offset INTEGER, block_index INTEGER, comment TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS review_marks_target_idx ON review_marks(target_type, target_id, round, start_offset);
CREATE TABLE IF NOT EXISTS review_rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id TEXT NOT NULL, round INTEGER NOT NULL, user_id INTEGER NOT NULL, verdict TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', mark_count INTEGER NOT NULL DEFAULT 0, feedback_json TEXT NOT NULL, exported_at TEXT, export_path TEXT, created_at TEXT NOT NULL, UNIQUE(target_type, target_id, round));
CREATE INDEX IF NOT EXISTS review_rounds_target_idx ON review_rounds(target_type, target_id, round DESC);
CREATE INDEX IF NOT EXISTS review_rounds_export_idx ON review_rounds(exported_at, id);
`);
}

function openDb() {
  const dbPath = resolveD1Path();
  if (!dbPath) throw new Error("未找到本地 D1 sqlite，请设置 DIGEST_D1_PATH 或先启动一次开发服务器");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  ensureReviewTables(db);
  return db;
}

// ---------- IMPORT ----------

function importImages(db, slug, dir, timestamp) {
  const imagesDir = path.join(dir, "images");
  let entries = [];
  try {
    entries = readdirSync(imagesDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const present = [];
  for (const entry of entries) {
    const filePath = path.join(imagesDir, entry.name);
    if (isSymlink(filePath)) {
      warn(`跳过符号链接图片：${slug}/images/${entry.name}`);
      continue;
    }
    let stats;
    try {
      stats = lstatSync(filePath);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;
    if (!IMAGE_NAME_RE.test(entry.name)) {
      warn(`跳过图片（文件名不合法）：${slug}/images/${entry.name}`);
      continue;
    }
    const contentType = EXT_TYPES[path.extname(entry.name).toLowerCase()];
    if (!contentType) {
      warn(`跳过图片（扩展名不支持）：${slug}/images/${entry.name}`);
      continue;
    }
    if (stats.size > MAX_ASSET_BYTES) {
      warn(`跳过图片（超过 2MB）：${slug}/images/${entry.name}`);
      continue;
    }
    const relPath = `images/${entry.name}`;
    const bytes = readFileSync(filePath);
    const digest = sha256Bytes(bytes);
    present.push(relPath);
    const existing = db.prepare("SELECT sha256 FROM article_assets WHERE slug = ? AND path = ?").get(slug, relPath);
    if (existing && existing.sha256 === digest) continue;
    db.prepare(
      `INSERT INTO article_assets (slug, path, content_type, bytes, size, sha256, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug, path) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes,
         size = excluded.size, sha256 = excluded.sha256, updated_at = excluded.updated_at`,
    ).run(slug, relPath, contentType, bytes, bytes.length, digest, timestamp);
  }
  if (present.length) {
    const placeholders = present.map(() => "?").join(", ");
    db.prepare(`DELETE FROM article_assets WHERE slug = ? AND path NOT IN (${placeholders})`).run(slug, ...present);
  } else {
    db.prepare("DELETE FROM article_assets WHERE slug = ?").run(slug);
  }
  return present.length;
}

function importArticles(db, options) {
  let entries;
  try {
    entries = readdirSync(ARTICLES_DIR, { withFileTypes: true });
  } catch (error) {
    warn(`无法读取文章目录 ${ARTICLES_DIR}：${error.message}`);
    return;
  }
  const seen = new Set();
  const timestamp = new Date().toISOString();
  let imported = 0;

  for (const entry of entries) {
    if (entry.isSymbolicLink() || isSymlink(path.join(ARTICLES_DIR, entry.name))) {
      warn(`跳过符号链接条目：${entry.name}`);
      continue;
    }
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (!SLUG_RE.test(slug)) continue;
    if (options.slug && slug !== options.slug) continue;
    const dir = path.join(ARTICLES_DIR, slug);

    const metaRaw = readTextOrNull(path.join(dir, "meta.json"));
    if (metaRaw === null) {
      warn(`跳过 ${slug}：缺少 meta.json`);
      continue;
    }
    let meta;
    try {
      meta = JSON.parse(metaRaw);
    } catch (error) {
      warn(`跳过 ${slug}：meta.json 不是合法 JSON（${error.message}）`);
      continue;
    }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      warn(`跳过 ${slug}：meta.json 结构不合法`);
      continue;
    }
    seen.add(slug);

    const draftMd = readTextOrNull(path.join(dir, "01-draft.md"));
    const finalMd = readTextOrNull(path.join(dir, "02-final.md"));
    const qaReport = readTextOrNull(path.join(dir, "qa-report.md"));
    const articleHtml = readTextOrNull(path.join(dir, "article.html"));
    const metaTitle = typeof meta.title === "string" ? meta.title.trim() : "";
    const title = metaTitle || extractTitle(finalMd) || extractTitle(draftMd) || String(meta.topic || "").trim() || slug;
    const topic = typeof meta.topic === "string" ? meta.topic : null;
    const status = typeof meta.status === "string" ? meta.status : null;
    const date = typeof meta.date === "string" ? meta.date : null;
    const topicId = Number.isInteger(meta.topic_id) && meta.topic_id > 0 ? meta.topic_id : null;
    const contentHash = sha256Text(articleHtml || finalMd || draftMd || "");

    db.prepare(
      `INSERT INTO articles (slug, date, title, topic, status, meta_json, draft_md, final_md, qa_report, article_html, content_hash, review_round, is_public, topic_id, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET date = excluded.date, title = excluded.title, topic = excluded.topic,
         status = excluded.status, meta_json = excluded.meta_json, draft_md = excluded.draft_md,
         final_md = excluded.final_md, qa_report = excluded.qa_report, article_html = excluded.article_html,
         content_hash = excluded.content_hash, topic_id = excluded.topic_id, synced_at = excluded.synced_at,
         updated_at = excluded.updated_at`,
    ).run(slug, date, title, topic, status, JSON.stringify(meta), draftMd, finalMd, qaReport, articleHtml, contentHash, topicId, timestamp, timestamp, timestamp);

    const assetCount = importImages(db, slug, dir, timestamp);
    imported += 1;
    log(`导入 ${slug}：title=${title}，图片 ${assetCount} 张`);
  }

  if (!options.slug) {
    const dbSlugs = db.prepare("SELECT slug FROM articles").all();
    for (const row of dbSlugs) {
      if (!seen.has(row.slug)) warn(`文章目录已消失，保留数据库中的审稿数据：${row.slug}`);
    }
  }
  log(`导入完成：${imported} 篇`);
}

// ---------- EXPORT ----------

function contextLabel(mark) {
  const prefix = mark.prefix ? `…${mark.prefix}` : "";
  const suffix = mark.suffix ? `${mark.suffix}…` : "";
  return `${prefix}【${mark.quote}】${suffix}`;
}

function renderFeedbackMarkdown(feedback) {
  const verdict = feedback.verdict || "comments";
  const label = VERDICT_LABELS[verdict] || verdict;
  const marks = Array.isArray(feedback.marks) ? feedback.marks : [];
  const changes = marks.filter((mark) => mark.type === "change");
  const goods = marks.filter((mark) => mark.type === "good");
  const lines = [
    `# 审稿反馈 · 第 ${feedback.round} 轮 · ${feedback.target?.title || feedback.target?.id || ""}`,
    "",
    `- 结论：${label}`,
    `- 审稿人：${feedback.reviewer?.nickname || "（未知）"}`,
    `- 提交时间：${feedback.submittedAt || ""}`,
    `- 内容指纹：${feedback.contentHash || ""}`,
    "",
    "## 总体意见",
    "",
    feedback.overallComment ? String(feedback.overallComment).trim() : "（无）",
    "",
    `## 要改（${changes.length}）`,
    "",
  ];
  if (changes.length) {
    for (const mark of changes) {
      lines.push(`- 「${mark.quote}」（上下文：${contextLabel(mark)}）→ ${mark.comment || "（无补充说明）"}`);
    }
  } else {
    lines.push("（无）");
  }
  lines.push("", `## 写得好（${goods.length}）`, "");
  if (goods.length) {
    for (const mark of goods) {
      lines.push(`- 「${mark.quote}」（上下文：${contextLabel(mark)}）→ ${mark.comment || "（无补充说明）"}`);
    }
  } else {
    lines.push("（无）");
  }
  lines.push(
    "",
    "---",
    "",
    `本文件是 review-feedback-${feedback.round}.json 的可读版本，机器可读的完整反馈请以同名 JSON 为准。`,
    "",
  );
  return `${lines.join("\n")}`;
}

function mergeArticleMeta(metaPath, feedback, files) {
  let meta = {};
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed;
    else throw new Error("meta.json 不是对象");
  } catch (error) {
    warn(`meta.json 读取/解析失败（${metaPath}）：${error.message}，将写入新对象`);
    meta = {};
  }
  if (feedback.verdict === "approved") meta.status = "approved";
  else if (feedback.verdict === "changes_requested") meta.status = "changes-requested";
  meta.review_round = feedback.round;
  meta.review = {
    round: feedback.round,
    verdict: feedback.verdict,
    feedback_json: files.jsonName,
    feedback_md: files.mdName,
    submitted_at: feedback.submittedAt,
  };
  const history = (Array.isArray(meta.review_history) ? meta.review_history : [])
    .filter((item) => item && Number(item.round) !== Number(feedback.round));
  history.push({
    round: feedback.round,
    verdict: feedback.verdict,
    submitted_at: feedback.submittedAt,
    feedback_json: files.jsonName,
    feedback_md: files.mdName,
  });
  history.sort((left, right) => Number(left.round) - Number(right.round));
  meta.review_history = history;
  writeJsonAtomic(metaPath, meta);
}

function exportRounds(db, options) {
  const rows = db.prepare(
    `SELECT id, target_type AS targetType, target_id AS targetId, round, verdict, feedback_json AS feedbackJson
     FROM review_rounds WHERE exported_at IS NULL ORDER BY id ASC`,
  ).all();
  let exported = 0;
  for (const row of rows) {
    if (options.slug) {
      if (row.targetType !== "article" || row.targetId !== options.slug) continue;
    }
    let feedback;
    try {
      feedback = JSON.parse(row.feedbackJson);
    } catch (error) {
      warn(`跳过第 ${row.round} 轮反馈（${row.targetType} ${row.targetId}）：feedback_json 解析失败（${error.message}）`);
      continue;
    }
    const dir = row.targetType === "article"
      ? path.join(ARTICLES_DIR, row.targetId)
      : path.join(FEEDBACK_DIR, `topic-${row.targetId}`);
    mkdirSync(dir, { recursive: true });
    const jsonName = `review-feedback-${row.round}.json`;
    const mdName = `review-feedback-${row.round}.md`;
    writeJsonAtomic(path.join(dir, jsonName), feedback);
    writeTextAtomic(path.join(dir, mdName), renderFeedbackMarkdown(feedback));
    if (row.targetType === "article") {
      mergeArticleMeta(path.join(dir, "meta.json"), feedback, { jsonName, mdName });
    }
    db.prepare("UPDATE review_rounds SET exported_at = ?, export_path = ? WHERE id = ?")
      .run(new Date().toISOString(), dir, row.id);
    exported += 1;
    log(`导出审稿反馈：${row.targetType} ${row.targetId} 第 ${row.round} 轮 → ${dir}`);
  }
  log(`导出完成：${exported} 轮`);
}

// ---------- CLI ----------

function runOnce(options) {
  const db = openDb();
  try {
    if (!options.exportOnly) importArticles(db, options);
    if (!options.importOnly) exportRounds(db, options);
  } finally {
    db.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sleepWhile(ms, isRunning) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isRunning()) return;
    await sleep(Math.min(200, deadline - Date.now()));
  }
}

async function watch(options) {
  let running = true;
  const stop = (signal) => {
    log(`收到 ${signal}，停止 watcher`);
    running = false;
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  while (running) {
    try {
      runOnce(options);
    } catch (error) {
      warn(`本轮同步失败：${error.message}`);
    }
    if (!running) break;
    await sleepWhile(Math.max(1, options.interval) * 1000, () => running);
  }
}

function parseArgs(argv) {
  const options = { watch: false, interval: 10, slug: "", exportOnly: false, importOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") options.watch = true;
    else if (arg === "--once") options.watch = false;
    else if (arg === "--interval") {
      options.interval = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--slug") {
      options.slug = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--export-only") options.exportOnly = true;
    else if (arg === "--import-only") options.importOnly = true;
    else warn(`忽略未知参数：${arg}`);
  }
  if (!Number.isFinite(options.interval) || options.interval < 1) options.interval = 10;
  if (options.slug && !SLUG_RE.test(options.slug)) throw new Error(`--slug 不合法：${options.slug}`);
  if (options.exportOnly && options.importOnly) throw new Error("--export-only 与 --import-only 不能同时使用");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  log(`文章目录：${ARTICLES_DIR}${options.slug ? `（仅 ${options.slug}）` : ""}`);
  if (options.watch) {
    log(`watch 模式启动，每 ${options.interval}s 同步一次（Ctrl+C 退出）`);
    await watch(options);
    return;
  }
  runOnce(options);
}

main().catch((error) => {
  warn(`运行失败：${error.stack || error.message}`);
  process.exitCode = 1;
});
