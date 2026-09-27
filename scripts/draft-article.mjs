/**
 * draft-article.mjs — 大白话讲AI 选题写稿流水线
 *
 * 从本地 D1 读取已 approved 的选题，抓取选题里的来源材料，用 pi CLI 依次执行
 * positioning / writer / wechat-draft-editor / qa 四个 Skill 阶段，写出终稿 markdown，
 * 并把正文回写 topics.draft_markdown。
 *
 * 用法：
 *   export PATH=/home/box/.local/bin:$PATH   # node 22 + pi
 *   export OPENCODE_API_KEY=...              # 来自你的密钥库，切勿提交
 *   npm run draft -- <topic-id> [--any-status] [--force] [--date YYYY-MM-DD]
 *
 * 环境变量：OPENCODE_API_KEY（必填，供 pi 使用）、DRAFT_MODEL、PI_BIN、
 *          DRAFT_OUT_DIR、DIGEST_D1_PATH、GITHUB_TOKEN（可选）。
 * 注意：本脚本不会打印任何密钥或完整环境变量。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "dabaihua-draft-article/1.0";
const FETCH_TIMEOUT_MS = 20_000;
const LLM_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
const SOURCE_TEXT_CAP = 8000;
const HN_COMMENT_LIMIT = 15;
const STAGE_NAMES = ["positioning", "writer", "wechat-draft-editor", "qa"];

// ---------- 基础工具 ----------

const log = (message) => process.stderr.write(`[draft] ${message}\n`);

function warn(message) {
  process.stderr.write(`[draft] WARN ${message}\n`);
}

function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
}

function decodeXml(input) {
  let text = String(input ?? "");
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    "#39": "'", "#8217": "’", "#8216": "‘", "#8220": "“", "#8221": "”", "#8230": "…",
  };
  return text.replace(/&(#?[a-zA-Z0-9]+);/g, (match, code) => {
    if (Object.prototype.hasOwnProperty.call(named, code)) return named[code];
    try {
      if (/^#x[0-9a-f]+$/i.test(code)) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (/^#[0-9]+$/.test(code)) return String.fromCodePoint(parseInt(code.slice(1), 10));
    } catch {
      return match;
    }
    return match;
  });
}

function stripHtml(input) {
  const withoutTags = String(input ?? "")
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeXml(withoutTags).replace(/\s+/g, " ").trim();
}

function truncate(text, max = SOURCE_TEXT_CAP) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function normalizeUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

async function fetchText(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, ...extraHeaders },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchJson(url, extraHeaders = {}) {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json", ...extraHeaders },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ---------- 本地 D1 ----------

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

function ensureTopicDraftColumns(db) {
  const columns = db.prepare("PRAGMA table_info(topics)").all();
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has("draft_markdown")) db.prepare("ALTER TABLE topics ADD COLUMN draft_markdown TEXT").run();
  if (!existing.has("draft_updated_at")) db.prepare("ALTER TABLE topics ADD COLUMN draft_updated_at TEXT").run();
}

function loadTopic(dbPath, id) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    ensureTopicDraftColumns(db);
    return db.prepare(`SELECT id, title, angle, reason, platform, status, notes,
        item_ids AS itemIds, draft_markdown, draft_updated_at AS draftUpdatedAt
      FROM topics WHERE id = ?`).get(id) || null;
  } finally {
    db.close();
  }
}

function saveDraft(dbPath, id, markdown) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    ensureTopicDraftColumns(db);
    const timestamp = new Date().toISOString();
    db.prepare("UPDATE topics SET draft_markdown = ?, draft_updated_at = ?, updated_at = ? WHERE id = ?")
      .run(markdown, timestamp, timestamp, id);
    return true;
  } finally {
    db.close();
  }
}

// ---------- 来源材料 ----------

function extractMarkdownLinks(text) {
  const links = [];
  const pattern = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  let match;
  while ((match = pattern.exec(String(text ?? "")))) {
    links.push({ title: match[1].trim(), url: match[2].trim() });
  }
  return links;
}

function collectSourceLinks(topic) {
  const collected = [];
  const seen = new Set();
  for (const link of [...extractMarkdownLinks(topic.notes), ...extractMarkdownLinks(topic.angle)]) {
    const normalized = normalizeUrl(link.url);
    if (!/^https?:\/\//.test(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    collected.push({ title: link.title, url: link.url, normalized });
  }
  return collected;
}

async function fetchHackerNews(storyId, link) {
  const data = await fetchJson(`https://hn.algolia.com/api/v1/items/${storyId}`);
  const parts = [];
  if (data.url) parts.push(`原文链接：${data.url}`);
  if (data.story_text) parts.push(stripHtml(data.story_text));
  const comments = (Array.isArray(data.children) ? data.children : [])
    .map((child) => stripHtml(child?.text))
    .filter(Boolean)
    .slice(0, HN_COMMENT_LIMIT);
  if (comments.length) {
    parts.push("高赞评论：");
    comments.forEach((text, index) => parts.push(`${index + 1}. ${text}`));
  }
  return {
    title: stripHtml(data.title) || link.title || link.normalized,
    url: link.url,
    text: truncate(parts.join("\n\n")),
  };
}

async function fetchGithub(owner, repo, link) {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const auth = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  let readme = "";
  let meta = {};
  try {
    readme = await fetchText(`${base}/readme`, { Accept: "application/vnd.github.raw", ...auth });
  } catch (error) {
    warn(`GitHub README 读取失败（${owner}/${repo}）：${error.message}`);
  }
  try {
    meta = await fetchJson(base, auth);
  } catch (error) {
    warn(`GitHub 仓库信息读取失败（${owner}/${repo}）：${error.message}`);
  }
  if (!readme && !meta.full_name) throw new Error("GitHub 仓库读取失败");
  const parts = [];
  if (meta.description) parts.push(`仓库简介：${meta.description}`);
  if (meta.stargazers_count != null) parts.push(`Star：${meta.stargazers_count}`);
  if (readme) parts.push(String(readme).trim());
  return {
    title: meta.full_name || `${owner}/${repo}`,
    url: link.url,
    text: truncate(parts.join("\n\n")),
  };
}

async function fetchGenericHtml(url, link) {
  const html = await fetchText(url, { Accept: "text/html,application/xhtml+xml" });
  return { title: link.title || url, url: link.url, text: truncate(stripHtml(html)) };
}

async function fetchSource(link) {
  try {
    const hn = link.normalized.match(/^https?:\/\/news\.ycombinator\.com\/item\?id=(\d+)/);
    if (hn) return await fetchHackerNews(hn[1], link);
    const github = link.normalized.match(/^https?:\/\/github\.com\/([^/]+)\/([^/?#]+)/);
    if (github) return await fetchGithub(github[1], github[2], link);
    return await fetchGenericHtml(link.normalized, link);
  } catch (error) {
    warn(`来源抓取失败（${link.normalized}）：${error.message}`);
    return null;
  }
}

async function collectSources(topic) {
  const links = collectSourceLinks(topic);
  log(`选题材料链接 ${links.length} 个`);
  const sources = [];
  for (const link of links) {
    const source = await fetchSource(link);
    if (source) sources.push(source);
  }
  sources.forEach((source, index) => { source.id = `S${index + 1}`; });
  return sources;
}

function writeWorkFiles(workDir, topic, sources) {
  mkdirSync(workDir, { recursive: true });
  const topicLines = [
    `# ${topic.title}`,
    "",
    `核心观点：${topic.angle || "（无）"}`,
  ];
  if (topic.reason) topicLines.push(`推荐理由：${topic.reason}`);
  topicLines.push("", "## 选题备注", "", topic.notes || "（无）", "");
  writeFileSync(path.join(workDir, "topic.md"), `${topicLines.join("\n")}\n`, "utf8");

  const sourceLines = ["# 来源材料", ""];
  for (const source of sources) {
    sourceLines.push(`## [${source.id}] ${source.title}`);
    sourceLines.push(`URL: ${source.url}`);
    sourceLines.push("");
    sourceLines.push(source.text || "（抓取失败或无正文）");
    sourceLines.push("");
  }
  writeFileSync(path.join(workDir, "sources.md"), `${sourceLines.join("\n")}\n`, "utf8");
}

// ---------- pi CLI（4 阶段流水线）----------

function runPi(prompt) {
  const piBin = process.env.PI_BIN || "pi";
  const model = process.env.DRAFT_MODEL || DEFAULT_MODEL;
  return new Promise((resolve, reject) => {
    const child = spawn(piBin, ["-p", "--no-session", "--model", model, prompt], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("pi 调用超过 15 分钟，已终止"));
    }, LLM_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`pi 退出码 ${code}: ${truncate(stderr, 400)}`));
    });
  });
}

function readOutput(file) {
  try {
    if (!existsSync(file)) return "";
    const content = readFileSync(file, "utf8");
    return content.trim() ? content : "";
  } catch {
    return "";
  }
}

async function runStage(name, prompt, outputFile, options = {}) {
  log(`阶段 ${name} 开始`);
  const startedAt = Date.now();
  for (const staleFile of [outputFile, ...(options.cleanupFiles || [])]) {
    rmSync(staleFile, { force: true });
  }
  const stdout = await runPi(prompt);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const content = readOutput(outputFile);
  if (content) {
    log(`阶段 ${name} 完成，用时 ${elapsed}s（${path.basename(outputFile)}）`);
    return content;
  }
  if (options.fallbackFile) {
    const fallback = readOutput(options.fallbackFile);
    if (fallback) {
      warn(`阶段 ${name} 未写出 ${path.basename(outputFile)}，回退到 ${path.basename(options.fallbackFile)}`);
      log(`阶段 ${name} 完成，用时 ${elapsed}s（回退稿）`);
      return fallback;
    }
  }
  const fallbackStdout = String(stdout ?? "").trim();
  if (fallbackStdout) {
    warn(`阶段 ${name} 未写出 ${path.basename(outputFile)}，使用 pi 标准输出`);
    log(`阶段 ${name} 完成，用时 ${elapsed}s（stdout 回退）`);
    return fallbackStdout;
  }
  throw new Error(`阶段 ${name} 未产生任何输出（${outputFile}）`);
}

const COMMON_RULES = [
  "通用规则：",
  "1. 这是非交互批处理，不能向用户提问；skill 里要求“向用户索取/确认”的地方，不要编造，按现有材料处理，并把缺口写进本阶段文件末尾的「待作者确认」小节（仅 positioning/qa 阶段；writer/editor 阶段不要把这类小节写进正文）。",
  "2. `topics strategy` CLI 在本机不可用，跳过；平台规格读 `content/_config/platform-specs.json`；作者声音读 `content/_config/author-voice.md` 和 `.agents/skills/writer/references/style_examples.md`。",
  "3. 事实、数据、案例、链接只能来自 work 目录的 topic.md 和 sources.md；不得编造作者经历、数据、引用或链接；正文里引用链接只能用 sources.md 中出现的 URL。",
  "4. 只写指定的输出文件，不修改仓库里任何其他文件。",
].join("\n");

const STYLE_CONTRACT = [
  "风格契约（必须逐条满足）：",
  "- 以 `# 标题` 开头，标题不超过 64 字。",
  "- 3-6 个问句式 H2 小标题，每个 `## ` 标题以？结尾。",
  "- 短段落，每段 1-3 句、不超过 120 字。",
  "- 每节至少一句 `**加粗的判断句**`；全文加粗 4-10 处，不要每段都加粗。",
  "- 一个案例（positioning 选定的）从开头贯穿到结尾。",
  "- 全文 1500-3000 字；开头 150 字内给出钩子和核心判断。",
  "- 禁用冒号「：」、破折号「——」和中文双引号，需要引号时用「」。",
  "- 文末附「参考资料」列表，只列 sources.md 中出现的 URL。",
  "- 结尾一句自然的关注或留言引导，不要写「希望有帮助」。",
].join("\n");

const skillPath = (rel) => path.join(REPO_ROOT, ".agents/skills", rel);
const contentPath = (rel) => path.join(REPO_ROOT, "content/_config", rel);
const workFile = (dir, name) => path.join(dir, name);

function positioningPrompt(workDir) {
  return [
    "你是「大白话讲AI」内容生产流水线的 positioning 阶段。",
    COMMON_RULES,
    "使用定位 skill 的「快版」，只走收益关 + 焦虑关。",
    `读取 ${skillPath("positioning/SKILL.md")}、${workFile(workDir, "topic.md")}、${workFile(workDir, "sources.md")}。`,
    `用 write 工具只写 ${workFile(workDir, "01-positioning.md")}。`,
    "文件内容包含：目标读者、可兑现收益、真实焦虑、JTBD、差异化、贯穿案例选择与理由、文章主线/提纲（3-6 个问句式 H2）。",
    "文件末尾加「待作者确认」小节，列出材料缺口。",
  ].join("\n");
}

function writerPrompt(workDir) {
  return [
    "你是「大白话讲AI」内容生产流水线的 writer 阶段。",
    COMMON_RULES,
    STYLE_CONTRACT,
    `读取 ${skillPath("writer/SKILL.md")}、${contentPath("author-voice.md")}、${skillPath("writer/references/style_examples.md")}、${contentPath("platform-specs.json")}、${workFile(workDir, "topic.md")}、${workFile(workDir, "sources.md")}、${workFile(workDir, "01-positioning.md")}。`,
    `用 write 工具只写 ${workFile(workDir, "02-draft.md")}，这是完整公众号主稿 markdown。`,
  ].join("\n");
}

function editorPrompt(workDir) {
  return [
    "你是「大白话讲AI」内容生产流水线的 wechat-draft-editor 阶段，使用修改模式。",
    COMMON_RULES,
    STYLE_CONTRACT,
    `读取 ${skillPath("wechat-draft-editor/SKILL.md")}、${contentPath("author-voice.md")}、${workFile(workDir, "02-draft.md")}，必要时读 ${workFile(workDir, "sources.md")} 以保持事实锚点与链接不变。`,
    `用 write 工具只写 ${workFile(workDir, "03-edited.md")}，输出完整修改稿正文（不含诊断），保持风格契约和所有事实锚点、链接不变。`,
  ].join("\n");
}

function qaPrompt(workDir) {
  return [
    "你是「大白话讲AI」内容生产流水线的 qa 阶段，做发布前质检与修复。",
    COMMON_RULES,
    STYLE_CONTRACT,
    `读取 ${skillPath("qa/SKILL.md")}、${contentPath("platform-specs.json")}、${contentPath("author-voice.md")}、${workFile(workDir, "sources.md")}、${workFile(workDir, "03-edited.md")}。`,
    `用 write 工具写两个文件：${workFile(workDir, "04-qa-report.md")}（规格检查 + L1-L5 结论、发现的问题、已修复项、待作者确认）和 ${workFile(workDir, "05-final.md")}（应用 QA 修复后的完整终稿）。`,
    "05-final.md 必须存在、非空，且仍满足上面的风格契约。",
  ].join("\n");
}

async function runPipeline(workDir) {
  await runStage(STAGE_NAMES[0], positioningPrompt(workDir), workFile(workDir, "01-positioning.md"));
  await runStage(STAGE_NAMES[1], writerPrompt(workDir), workFile(workDir, "02-draft.md"));
  await runStage(STAGE_NAMES[2], editorPrompt(workDir), workFile(workDir, "03-edited.md"));
  return runStage(STAGE_NAMES[3], qaPrompt(workDir), workFile(workDir, "05-final.md"), {
    fallbackFile: workFile(workDir, "03-edited.md"),
    cleanupFiles: [workFile(workDir, "04-qa-report.md")],
  });
}

// ---------- 后处理（确定性）----------

function validateLinks(markdown, allowedUrls) {
  const removed = [];
  let output = String(markdown ?? "").replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (full, text, url) => {
    if (allowedUrls.has(normalizeUrl(url))) return full;
    removed.push(url);
    return text;
  });
  output = output.replace(/https?:\/\/[^\s)\]}>"，。）]+/g, (url) => {
    if (allowedUrls.has(normalizeUrl(url))) return url;
    removed.push(url);
    return "";
  });
  return { markdown: output, removed: [...new Set(removed)] };
}

function styleReport(markdown) {
  const text = String(markdown ?? "");
  const lines = text.split(/\r?\n/);
  const h2 = lines.filter((line) => /^##\s+/.test(line));
  const h2Question = h2.filter((line) => /[？?]\s*$/.test(line));
  const bold = [...text.matchAll(/\*\*[^*\n]+\*\*/g)].length;
  const paragraphs = text.split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^[#>\-|`]/.test(paragraph));
  const longParagraphs = paragraphs.filter((paragraph) => paragraph.length > 150);
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const colon = (text.match(/：/g) || []).length;
  const dash = (text.match(/——/g) || []).length;
  const quote = (text.match(/[“”]/g) || []).length;
  return { h2: h2.length, h2Question: h2Question.length, bold, longParagraphs, chineseChars, colon, dash, quote };
}

function appendStyleReport(reportFile, report) {
  mkdirSync(path.dirname(reportFile), { recursive: true });
  const section = [
    "",
    "## 脚本自动检查",
    "",
    `- H2 数量：${report.h2}（问句式 ${report.h2Question}）`,
    `- 加粗数量：${report.bold}`,
    `- 超过 150 字的段落：${report.longParagraphs.length}`,
    `- 中文字符数：${report.chineseChars}`,
    `- 冒号「：」出现：${report.colon}`,
    `- 破折号「——」出现：${report.dash}`,
    `- 中文双引号出现：${report.quote}`,
    "",
  ].join("\n");
  const existing = readOutput(reportFile);
  const base = existing ? existing.replace(/\s*$/, "") : "# QA 报告";
  writeFileSync(reportFile, `${base}\n${section}`, "utf8");
}

function warnStyle(report) {
  if (report.h2 < 3 || report.h2 > 6) warn(`H2 数量为 ${report.h2}，期望 3-6 个`);
  if (report.h2Question !== report.h2) warn(`问句式 H2 为 ${report.h2Question}/${report.h2}`);
  if (report.bold < 4 || report.bold > 10) warn(`加粗数量为 ${report.bold}，期望 4-10 处`);
  if (report.longParagraphs.length) warn(`有 ${report.longParagraphs.length} 个段落超过 150 字`);
  if (report.colon) warn(`正文出现冒号「：」${report.colon} 次`);
  if (report.dash) warn(`正文出现破折号「——」${report.dash} 次`);
  if (report.quote) warn(`正文出现中文双引号${report.quote} 次`);
}

function extractTitle(markdown, fallback) {
  const match = String(markdown ?? "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

// ---------- CLI ----------

const USAGE = "用法：node scripts/draft-article.mjs <topic-id> [--any-status] [--force] [--date YYYY-MM-DD]";

function parseArgs(argv) {
  const options = { topicId: 0, anyStatus: false, force: false, date: "" };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--any-status") options.anyStatus = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--date") {
      options.date = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--")) warn(`忽略未知参数：${arg}`);
    else if (arg !== "") positional.push(arg);
  }
  const id = Number(positional[0]);
  if (!Number.isInteger(id) || id <= 0) throw new Error(USAGE);
  options.topicId = id;
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date 格式应为 YYYY-MM-DD，收到：${options.date}`);
  }
  return options;
}

// ---------- 主流程 ----------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const date = options.date || shanghaiDate();
  const outDir = process.env.DRAFT_OUT_DIR || "/workspace/projects/drafts";
  const dbPath = resolveD1Path();
  if (!dbPath) {
    log("错误：未找到本地 D1 sqlite，请设置 DIGEST_D1_PATH 或先启动一次开发服务器。");
    process.exitCode = 1;
    return;
  }
  const topic = loadTopic(dbPath, options.topicId);
  if (!topic) {
    log(`错误：未找到选题 ${options.topicId}。`);
    process.exitCode = 1;
    return;
  }
  log(`选题 ${topic.id}：${topic.title}`);
  if (topic.status !== "approved" && !options.anyStatus) {
    log("选题尚未 approved，请先在看板通过，或加 --any-status。");
    process.exitCode = 1;
    return;
  }
  if (topic.draft_markdown && !options.force) {
    log(`选题 ${topic.id} 已有草稿（${topic.draftUpdatedAt || "未知时间"}），未加 --force，跳过。`);
    return;
  }
  if (!process.env.OPENCODE_API_KEY) {
    log("错误：未设置 OPENCODE_API_KEY。请先 export OPENCODE_API_KEY=<你的密钥> 再运行（密钥不要提交）。");
    process.exitCode = 1;
    return;
  }

  const workDir = path.join(outDir, ".work", `${date}-${topic.id}`);
  const sources = await collectSources(topic);
  writeWorkFiles(workDir, topic, sources);
  log(`work 目录：${workDir}（来源 ${sources.length} 个）`);

  const finalRaw = await runPipeline(workDir);
  const { markdown: cleaned, removed } = validateLinks(finalRaw, new Set(collectSourceLinks(topic).map((link) => link.normalized)));
  if (removed.length) warn(`移除未授权链接 ${removed.length} 个：${removed.join("、")}`);

  const title = extractTitle(cleaned, topic.title);
  const report = styleReport(cleaned);
  appendStyleReport(workFile(workDir, "04-qa-report.md"), report);
  warnStyle(report);

  mkdirSync(outDir, { recursive: true });
  const draftFile = path.join(outDir, `${date}-${topic.id}.md`);
  writeFileSync(draftFile, cleaned, "utf8");
  log(`已写出 ${draftFile}`);

  let dbUpdated = false;
  try {
    saveDraft(dbPath, topic.id, cleaned);
    dbUpdated = true;
  } catch (error) {
    warn(`草稿入库失败（文件已保留）：${error.message}`);
  }

  const questionRatio = report.h2 ? `${report.h2Question}/${report.h2}` : "0/0";
  process.stdout.write(`选题：${topic.id} ${title}\n`);
  process.stdout.write(`草稿：${draftFile}\n`);
  process.stdout.write(`work：${workDir}\n`);
  process.stdout.write(`字数：${report.chineseChars} 字\n`);
  process.stdout.write(`H2 问句比：${questionRatio}\n`);
  process.stdout.write(`加粗：${report.bold} 处\n`);
  process.stdout.write(`移除链接：${removed.length} 个\n`);
  process.stdout.write(`DB 更新：${dbUpdated ? "是" : "否"}\n`);
}

main().catch((error) => {
  log(`运行失败：${error.stack || error.message}`);
  process.exitCode = 1;
});
