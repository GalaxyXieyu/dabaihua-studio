/**
 * publish-draft.mjs — 大白话讲AI 公众号 HTML 排版与草稿箱流水线
 *
 * 从本地 D1 读取已审稿通过的选题终稿，用 pi CLI 依次执行 wechat-article-publisher
 * Skill 的 mobile-layout（手机端语意分行）和 render（主题渲染）两个阶段，产出
 * 公众号正文 HTML 片段与预览页，并把状态回写 topics.publish_*；在作者显式加
 * --upload 且存在 DABAIHUA_WENYAN_API_KEY 时，把文章保存到微信公众号「草稿箱」。
 *
 * 安全边界（硬性，不可绕过）：
 *   本流水线最多只能把文章保存进微信公众号「草稿箱」。脚本不包含、也不会实现
 *   任何群发 / freepublish / 提交发布 / 广播类路径。发布工具名有固定白名单
 *   ['gzh_article_publish', 'publish_article']，并在调用前叠加禁止名单正则
 *   /(mass|send_?all|sendall|freepublish|free_publish|submit|broadcast|群发)/i
 *   再拦截一次；命中即中止。上传必须由作者显式加 --upload 才会触发。
 *
 * 用法：
 *   export PATH=/home/box/.local/bin:$PATH   # node 22 + pi
 *   export OPENCODE_API_KEY=...              # 来自你的密钥库，切勿提交
 *   npm run publish:draft -- <topic-id> [--any-review] [--theme <id>] [--upload]
 *       [--cover <url>] [--author <name>] [--list-tools] [--force] [--date YYYY-MM-DD]
 *
 * 环境变量：OPENCODE_API_KEY（pi 阶段必需，仅做存在性检查）、PUBLISH_MODEL、
 *          PI_BIN、DRAFT_OUT_DIR、DIGEST_D1_PATH、
 *          DABAIHUA_WENYAN_API_KEY（可选，只从环境读取，绝不打印）、
 *          DABAIHUA_WENYAN_MCP_URL、WENYAN_THEME（默认 default）、WENYAN_AUTHOR。
 * 注意：本脚本不会打印任何密钥或完整环境变量。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LLM_TIMEOUT_MS = 15 * 60 * 1000;
const MCP_TIMEOUT_MS = 180_000;
const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
const DEFAULT_THEME = "red-white";
const DEFAULT_WENYAN_THEME = "default";
const DEFAULT_MCP_URL = "http://120.76.159.103:39000/mcp";
const SKILL_DIR = path.join(REPO_ROOT, ".agents/skills/wechat-article-publisher");

// 只允许保存到草稿箱的工具；顺序即优先级。
const PUBLISH_ALLOWLIST = ["gzh_article_publish", "publish_article"];
// 永不调用的群发/发布类工具名特征。
const PUBLISH_DENYLIST = /(mass|send_?all|sendall|freepublish|free_publish|submit|broadcast|群发)/i;

const PUBLISH_COLUMNS = [
  ["publish_status", "TEXT"],
  ["publish_html", "TEXT"],
  ["publish_html_at", "TEXT"],
  ["wechat_draft_media_id", "TEXT"],
  ["wechat_draft_saved_at", "TEXT"],
  ["publish_error", "TEXT"],
];

const USAGE = "用法：node scripts/publish-draft.mjs <topic-id> [--any-review] [--theme <id>] [--upload] [--cover <url>] [--author <name>] [--list-tools] [--force] [--date YYYY-MM-DD]";

// ---------- 基础工具 ----------

const log = (message) => process.stderr.write(`[publish] ${message}\n`);

function warn(message) {
  process.stderr.write(`[publish] WARN ${message}\n`);
}

function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
}

function truncate(text, max = 400) {
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 任何错误信息都可能来自远端响应，先做一次密钥脱敏，绝不打印 DABAIHUA_WENYAN_API_KEY。
function redact(text) {
  const key = process.env.DABAIHUA_WENYAN_API_KEY || "";
  let out = String(text ?? "");
  if (key) out = out.split(key).join("***");
  return out;
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

function ensurePublishColumns(db) {
  const columns = db.prepare("PRAGMA table_info(topics)").all();
  const existing = new Set(columns.map((column) => column.name));
  for (const [name, type] of PUBLISH_COLUMNS) {
    if (!existing.has(name)) db.prepare(`ALTER TABLE topics ADD COLUMN ${name} ${type}`).run();
  }
}

function loadTopic(dbPath, id) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    ensurePublishColumns(db);
    return db.prepare(`SELECT id, title, status, draft_markdown AS draftMarkdown,
        review_status AS reviewStatus, publish_status AS publishStatus,
        publish_html AS publishHtml, publish_html_at AS publishHtmlAt,
        wechat_draft_media_id AS wechatDraftMediaId, wechat_draft_saved_at AS wechatDraftSavedAt,
        publish_error AS publishError
      FROM topics WHERE id = ?`).get(id) || null;
  } finally {
    db.close();
  }
}

function savePublishFields(dbPath, id, fields) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    ensurePublishColumns(db);
    const sets = [];
    const binds = [];
    for (const [column, value] of Object.entries(fields)) {
      sets.push(`${column} = ?`);
      binds.push(value);
    }
    sets.push("updated_at = ?");
    binds.push(new Date().toISOString());
    binds.push(id);
    db.prepare(`UPDATE topics SET ${sets.join(", ")} WHERE id = ?`).run(...binds);
    return true;
  } finally {
    db.close();
  }
}

// ---------- wechat-article-publisher Skill 路径 ----------

const skillPath = (rel) => path.join(SKILL_DIR, rel);
const workFile = (dir, name) => path.join(dir, name);

function themeFilePath(theme) {
  return skillPath(`references/theme-${theme}.md`);
}

function availableThemes() {
  try {
    return readdirSync(skillPath("references"))
      .filter((name) => /^theme-.+\.md$/.test(name) && !["theme-index.md", "theme-generator.md"].includes(name))
      .map((name) => name.replace(/^theme-/, "").replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

// ---------- pi CLI ----------

function runPi(prompt) {
  const piBin = process.env.PI_BIN || "pi";
  const model = process.env.PUBLISH_MODEL || DEFAULT_MODEL;
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

async function runStage(name, prompt, outputFile) {
  log(`阶段 ${name} 开始`);
  const startedAt = Date.now();
  rmSync(outputFile, { force: true });
  const stdout = await runPi(prompt);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const content = readOutput(outputFile);
  if (content) {
    log(`阶段 ${name} 完成，用时 ${elapsed}s（${path.basename(outputFile)}）`);
    return content;
  }
  const fallbackStdout = String(stdout ?? "").trim();
  if (fallbackStdout) {
    warn(`阶段 ${name} 未写出 ${path.basename(outputFile)}，使用 pi 标准输出`);
    writeFileSync(outputFile, fallbackStdout, "utf8");
    return fallbackStdout;
  }
  throw new Error(`阶段 ${name} 未产生任何输出（${outputFile}）`);
}

function runValidator(scriptName, args) {
  const script = skillPath(`scripts/${scriptName}`);
  return new Promise((resolve) => {
    const child = spawn("python3", [script, ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ ok: false, code: -1, output: `运行失败：${error.message}` }));
    child.on("close", (code) => resolve({ ok: code === 0, code, output: `${stdout}${stderr}`.trim() }));
  });
}

// ---------- pi 阶段提示词 ----------

const COMMON_RULES = [
  "通用规则：",
  "1. 这是非交互批处理，不能向用户提问；不要编造或索要任何信息。",
  "2. 只写指定的输出文件，不改动仓库里的任何其他文件。",
  "3. 不得增删改正文文字、标点或链接；只允许按 skill 约定调整空白、段落边界、软换行与表现层结构。",
  "4. 增强项 infer_headings、english_labels、signature、cta 全部关闭（未获授权），不得生成或补写标题、英文标签、签名、CTA。",
  "5. 技术/观点文章不做爱格标点校订（不执行 punctuation 阶段）。",
].join("\n");

function layoutPrompt(workDir, extra = "") {
  return [
    "你是「大白话讲AI」发布流水线的 mobile-layout 阶段。",
    COMMON_RULES,
    `读取 ${skillPath("SKILL.md")}、${skillPath("references/mobile-layout.md")}、${workFile(workDir, "01-source.md")}。`,
    `用 write 工具只写 ${workFile(workDir, "03-layout.md")}：这是 01-source.md 的手机端语意分行稿，通过验证后即为唯一冻结正文。`,
    "先合并/拆分完整语意组、再决定 <br> 与 <!-- wechat:blank -->，不得把每个物理段落直接当成硬段落。",
    extra,
  ].filter(Boolean).join("\n");
}

function renderPrompt(workDir, frozenFile, theme, extra = "") {
  return [
    "你是「大白话讲AI」发布流水线的 render 阶段。",
    COMMON_RULES,
    `读取 ${skillPath("SKILL.md")}、${skillPath("references/rendering.md")}、${skillPath("references/theme-index.md")}、${themeFilePath(theme)}、${skillPath("references/common-components.md")}、${frozenFile}。`,
    `使用主题 ${theme}，用 write 工具只写 ${workFile(workDir, "output.html")}。`,
    "输出必须是纯 <section>…</section> 正文片段：只用内联 style，所有正文文字节点用 <span leaf=\"\"> 包裹；禁止 <style>、<script>、<div>、class、id、position、float、@media、grid。",
    "冻结正文的段落、<br> 和留白标记必须一一对应，不得重新判断分行。",
    extra,
  ].filter(Boolean).join("\n");
}

// ---------- 阶段编排（含校验与一次重跑）----------

async function produceLayout(workDir, sourceFile, layoutFile) {
  try {
    await runStage("mobile-layout", layoutPrompt(workDir), layoutFile);
  } catch (error) {
    warn(`mobile-layout 阶段失败：${error.message}，回退到 01-source.md`);
    return { frozenFile: sourceFile, layoutValidation: { ok: false, output: `阶段失败：${error.message}` } };
  }
  let result = await runValidator("validate_content.py", ["--mode", "layout", sourceFile, layoutFile]);
  if (!result.ok) {
    warn("layout 内容合同未通过，带校验输出重跑一次");
    try {
      await runStage("mobile-layout", layoutPrompt(workDir, `上一次校验输出：\n${result.output}`), layoutFile);
    } catch (error) {
      warn(`mobile-layout 重跑失败：${error.message}`);
    }
    result = await runValidator("validate_content.py", ["--mode", "layout", sourceFile, layoutFile]);
  }
  if (result.ok) return { frozenFile: layoutFile, layoutValidation: result };
  warn("mobile-layout 内容合同仍不通过，冻结 01-source.md（render-only 模式）");
  return { frozenFile: sourceFile, layoutValidation: result };
}

async function produceHtml(workDir, frozenFile, outputFile, theme) {
  let validations = { content: null, gzh: null };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const extra = attempt === 0
      ? ""
      : `上一次校验输出：\n${[validations.content?.output, validations.gzh?.output].filter(Boolean).join("\n")}`;
    await runStage("render", renderPrompt(workDir, frozenFile, theme, extra), outputFile);
    validations = {
      content: await runValidator("validate_content.py", ["--mode", "render", frozenFile, outputFile]),
      gzh: await runValidator("validate_gzh_html.py", ["--allow-source-punctuation", outputFile]),
    };
    if (validations.content.ok && validations.gzh.ok) return validations;
    if (attempt === 0) warn("render 校验未通过，带校验输出重跑一次");
  }
  warn("render 校验仍不通过：保留 HTML，但已在报告中记录失败（不退出非零）");
  return validations;
}

// ---------- 链接与预览（确定性后处理）----------

function collectDraftUrls(markdown) {
  const urls = new Set();
  const text = String(markdown ?? "");
  const mdPattern = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  const barePattern = /https?:\/\/[^\s)\]}>"，。]+/g;
  let match;
  while ((match = mdPattern.exec(text))) urls.add(normalizeUrl(match[1]));
  while ((match = barePattern.exec(text))) urls.add(normalizeUrl(match[0]));
  return urls;
}

function stripUnapprovedLinks(html, allowedUrls) {
  const removed = [];
  const output = String(html ?? "").replace(
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
    (full, doubleUrl, singleUrl, inner) => {
      const href = doubleUrl ?? singleUrl ?? "";
      if (allowedUrls.has(normalizeUrl(href))) return full;
      removed.push(href);
      return inner;
    },
  );
  return { html: output, removed: [...new Set(removed)] };
}

function buildPreview(fragment, title) {
  const template = readFileSync(skillPath("assets/preview-template.html"), "utf8");
  return template
    .replace("{{TITLE}}", escapeHtml(title))
    .replace("<!--GZH_CONTENT-->", fragment);
}

function extractTitle(markdown, fallback) {
  const match = String(markdown ?? "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

// ---------- 最小 MCP Streamable HTTP 客户端 ----------

function parseMcpPayload(text, contentType, id) {
  const body = String(text ?? "");
  if (contentType.includes("text/event-stream") || /^\s*(event|data):/m.test(body)) {
    const messages = [];
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        messages.push(JSON.parse(data));
      } catch {
        // 忽略无法解析的心跳/空行
      }
    }
    return messages.find((message) => message && message.id === id) || messages.at(-1) || null;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function createMcpClient(url, apiKey) {
  let sessionId = "";
  async function call(method, params, { id = null, notification = false } = {}) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "X-API-Key": apiKey,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const payload = { jsonrpc: "2.0", method };
    if (params !== undefined) payload.params = params;
    if (!notification) payload.id = id;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
    });
    const nextSessionId = response.headers.get("mcp-session-id");
    if (nextSessionId) sessionId = nextSessionId;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MCP ${method} 失败：HTTP ${response.status}${text ? `（${truncate(redact(text), 200)}）` : ""}`);
    }
    if (notification) return null;
    const message = parseMcpPayload(await response.text(), response.headers.get("content-type") || "", id);
    if (message?.error) throw new Error(`MCP ${method} 返回错误：${truncate(redact(JSON.stringify(message.error)), 300)}`);
    return message?.result ?? null;
  }
  return { call };
}

async function openMcpSession(client) {
  await client.call("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "dabaihua-publish", version: "1.0" },
  }, { id: 1 });
  await client.call("notifications/initialized", undefined, { notification: true });
}

async function listWenyanTools(client) {
  const list = await client.call("tools/list", {}, { id: 2 });
  return Array.isArray(list?.tools) ? list.tools : [];
}

async function listTools() {
  const apiKey = process.env.DABAIHUA_WENYAN_API_KEY;
  if (!apiKey) {
    log("错误：--list-tools 需要 DABAIHUA_WENYAN_API_KEY。");
    process.exitCode = 1;
    return;
  }
  const url = process.env.DABAIHUA_WENYAN_MCP_URL || DEFAULT_MCP_URL;
  const client = createMcpClient(url, apiKey);
  await openMcpSession(client);
  const tools = await listWenyanTools(client);
  process.stdout.write(`wenyan-mcp 工具（${url}）：\n`);
  for (const tool of tools) {
    process.stdout.write(`- ${tool.name}\n`);
    if (tool.description) process.stdout.write(`  ${truncate(String(tool.description).split("\n")[0], 200)}\n`);
    process.stdout.write(`  inputSchema: ${JSON.stringify(tool.inputSchema || tool.input_schema || {})}\n`);
  }
}

// ---------- 上传参数组装 ----------

function splitDraft(draft, fallbackTitle) {
  const text = String(draft ?? "");
  const match = text.match(/^#\s+(.+)$/m);
  const title = match ? match[1].trim() : fallbackTitle;
  const body = match ? text.replace(/^#\s+.+\r?\n?/m, "") : text;
  return { title, body: body.replace(/^\s*\n+/, "") };
}

function buildPayload(draft, fallbackTitle, { cover, author }) {
  const { title, body } = splitDraft(draft, fallbackTitle);
  const frontmatter = ["---", `title: ${title}`];
  if (cover) frontmatter.push(`cover: ${cover}`);
  if (author) frontmatter.push(`author: ${author}`);
  frontmatter.push("---");
  return { title, body, markdown: `${frontmatter.join("\n")}\n\n${body}` };
}

function buildToolArguments(tool, payload, { cover, author, theme, html }) {
  const schema = tool?.inputSchema || tool?.input_schema || {};
  const keys = Object.keys(schema.properties || {});
  const has = (name) => keys.includes(name);
  const args = {};
  const contentKey = ["content", "markdown", "md", "content_markdown"].find(has);
  const htmlKey = ["html", "content_html"].find(has);
  if (contentKey) {
    args[contentKey] = payload.markdown;
  } else if (htmlKey) {
    args[htmlKey] = html;
    if (has("title")) args.title = payload.title;
  }
  if (has("title") && args.title === undefined) args.title = payload.title;
  if (has("author") && author) args.author = author;
  if (has("cover") && cover) args.cover = cover;
  if (has("thumb_url") && cover) args.thumb_url = cover;
  if (has("theme_id")) args.theme_id = theme;
  else if (has("theme")) args.theme = theme;
  return args;
}

function resultText(result) {
  const parts = [];
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item && typeof item.text === "string") parts.push(item.text);
  }
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    parts.push(JSON.stringify(result.structuredContent));
  }
  return parts.join("\n");
}

function extractMediaId(result) {
  if (result && typeof result.media_id === "string" && result.media_id) return result.media_id;
  if (result?.structuredContent && typeof result.structuredContent.media_id === "string") return result.structuredContent.media_id;
  const text = resultText(result);
  const jsonField = text.match(/"media_id"\s*:\s*"([A-Za-z0-9_-]{10,})"/i);
  if (jsonField) return jsonField[1];
  const match = text.match(/media[_ ]?id[^A-Za-z0-9_-]*([A-Za-z0-9_-]{10,})/i);
  return match ? match[1] : "";
}

// ---------- 上传到草稿箱（唯一写路径）----------

async function uploadToDraftBox({ dbPath, topic, fragment, draft, options }) {
  const apiKey = process.env.DABAIHUA_WENYAN_API_KEY;
  const url = process.env.DABAIHUA_WENYAN_MCP_URL || DEFAULT_MCP_URL;
  const theme = process.env.WENYAN_THEME || DEFAULT_WENYAN_THEME;
  const author = options.author || process.env.WENYAN_AUTHOR || "";
  const cover = options.cover || "";
  const client = createMcpClient(url, apiKey);
  log(`连接 wenyan-mcp：${url}`);
  await openMcpSession(client);
  const tools = await listWenyanTools(client);
  const names = tools.map((tool) => tool.name);
  const chosenName = PUBLISH_ALLOWLIST.find((name) => names.includes(name));
  if (!chosenName) {
    warn(`未找到允许的发布工具。可用工具：${names.join("、") || "（无）"}`);
    process.exitCode = 1;
    return { status: null, message: "失败（无允许的发布工具）" };
  }
  if (PUBLISH_DENYLIST.test(chosenName)) {
    warn(`工具名 ${chosenName} 命中禁止名单，已中止（绝不群发）`);
    process.exitCode = 1;
    return { status: null, message: "中止（命中禁止名单）" };
  }
  const tool = tools.find((item) => item.name === chosenName);
  const payload = buildPayload(draft, topic.title, { cover, author });
  const args = buildToolArguments(tool, payload, { cover, author, theme, html: fragment });
  log(`调用工具：${chosenName}`);
  log(`上传参数键：${Object.keys(args).join("、") || "（无）"}`);

  let result;
  try {
    result = await client.call("tools/call", { name: chosenName, arguments: args }, { id: 3 });
  } catch (error) {
    const message = truncate(redact(error.message), 400);
    savePublishFields(dbPath, topic.id, { publish_status: "upload_failed", publish_error: message });
    warn(`上传失败：${message}`);
    process.exitCode = 2;
    return { status: "upload_failed", message: "失败（已记录 publish_error）" };
  }
  if (result?.isError) {
    const message = truncate(redact(resultText(result)) || "工具返回 isError", 400);
    savePublishFields(dbPath, topic.id, { publish_status: "upload_failed", publish_error: message });
    warn(`上传失败：${message}`);
    process.exitCode = 2;
    return { status: "upload_failed", message: "失败（已记录 publish_error）" };
  }
  const mediaId = extractMediaId(result);
  savePublishFields(dbPath, topic.id, {
    publish_status: "draft_saved",
    wechat_draft_media_id: mediaId || null,
    wechat_draft_saved_at: new Date().toISOString(),
    publish_error: null,
  });
  if (mediaId) log(`media_id：${mediaId}`);
  else warn("未能从返回中解析 media_id，但工具未报错");
  process.stdout.write("已保存到公众号草稿箱（未群发），请在公众号后台草稿箱检查后手动发布\n");
  return { status: "draft_saved", message: `成功（media_id: ${mediaId || "未知"}）` };
}

// ---------- 校验报告 ----------

function validationLabel(result) {
  if (!result) return "未执行";
  return result.ok ? "通过" : "失败";
}

function buildValidationReport({ title, theme, reuse, layoutValidation, validations, removedLinks }) {
  const lines = [
    `# 发布前校验：${title}`,
    "",
    `- 主题：${theme}`,
    `- HTML 来源：${reuse ? "复用已有文件" : "pi 流程生成"}`,
    `- layout 内容合同：${validationLabel(layoutValidation)}`,
    `- render 内容合同：${validationLabel(validations.content)}`,
    `- gzh HTML 合规：${validationLabel(validations.gzh)}`,
    `- 已移除未授权链接：${removedLinks.length} 个`,
  ];
  for (const [label, result] of [["layout", layoutValidation], ["render-content", validations.content], ["gzh-html", validations.gzh]]) {
    if (!result) continue;
    lines.push("", `## ${label}`, "", "```", result.output || "（无输出）", "```");
  }
  return `${lines.join("\n")}\n`;
}

// ---------- CLI ----------

function parseArgs(argv) {
  const options = {
    topicId: 0, anyReview: false, theme: "", upload: false, cover: "",
    author: "", listTools: false, force: false, date: "",
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--any-review") options.anyReview = true;
    else if (arg === "--upload") options.upload = true;
    else if (arg === "--list-tools") options.listTools = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--theme") { options.theme = argv[index + 1] || ""; index += 1; }
    else if (arg === "--cover") { options.cover = argv[index + 1] || ""; index += 1; }
    else if (arg === "--author") { options.author = argv[index + 1] || ""; index += 1; }
    else if (arg === "--date") { options.date = argv[index + 1] || ""; index += 1; }
    else if (arg.startsWith("--")) warn(`忽略未知参数：${arg}`);
    else if (arg !== "") positional.push(arg);
  }
  const id = Number(positional[0]);
  if (Number.isInteger(id) && id > 0) options.topicId = id;
  else if (!options.listTools) throw new Error(USAGE);
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date 格式应为 YYYY-MM-DD，收到：${options.date}`);
  }
  return options;
}

// ---------- 主流程 ----------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const date = options.date || shanghaiDate();
  const outDir = path.resolve(process.env.DRAFT_OUT_DIR || "/workspace/projects/drafts");

  if (options.listTools) {
    await listTools();
    return;
  }

  const theme = options.theme || DEFAULT_THEME;
  if (!existsSync(themeFilePath(theme))) {
    log(`错误：主题 ${theme} 不存在。可用主题：${availableThemes().join("、") || "（无）"}`);
    process.exitCode = 1;
    return;
  }

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
  const draft = String(topic.draftMarkdown || "");
  if (!draft.trim()) {
    log(`错误：选题 ${topic.id} 还没有草稿，请先 npm run draft -- ${topic.id}。`);
    process.exitCode = 1;
    return;
  }
  log(`选题 ${topic.id}：${topic.title}`);
  if (topic.reviewStatus !== "approved" && !options.anyReview) {
    log(`审稿未通过，请先在 /review/${topic.id} 通过，或加 --any-review。`);
    process.exitCode = 1;
    return;
  }

  const workDir = path.join(outDir, ".work", `${date}-${topic.id}-publish`);
  mkdirSync(workDir, { recursive: true });
  const sourceFile = path.join(workDir, "01-source.md");
  writeFileSync(sourceFile, draft, "utf8");
  log(`work 目录：${workDir}`);

  const htmlFile = path.join(outDir, `${date}-${topic.id}.html`);
  const previewFile = path.join(outDir, `${date}-${topic.id}_预览.html`);
  const workHtmlFile = path.join(workDir, "output.html");
  const workPreviewFile = path.join(workDir, "output_预览.html");

  const reuse = !options.force && existsSync(htmlFile) && Boolean(topic.publishStatus);
  let fragment = "";
  let removedLinks = [];
  let layoutValidation = null;
  let validations = { content: null, gzh: null };

  if (reuse) {
    log(`复用已有 HTML（publish_status=${topic.publishStatus}），跳过 pi 阶段`);
    fragment = readFileSync(htmlFile, "utf8");
    removedLinks = [];
  } else {
    if (!process.env.OPENCODE_API_KEY) {
      log("错误：未设置 OPENCODE_API_KEY。请先 export OPENCODE_API_KEY=<你的密钥> 再运行（密钥不要提交）。");
      process.exitCode = 1;
      return;
    }
    const layoutOutcome = await produceLayout(workDir, sourceFile, path.join(workDir, "03-layout.md"));
    layoutValidation = layoutOutcome.layoutValidation;
    log(`冻结正文：${path.basename(layoutOutcome.frozenFile)}`);
    validations = await produceHtml(workDir, layoutOutcome.frozenFile, workHtmlFile, theme);
    fragment = readFileSync(workHtmlFile, "utf8");
    const cleaned = stripUnapprovedLinks(fragment, collectDraftUrls(draft));
    fragment = cleaned.html;
    removedLinks = cleaned.removed;
    if (removedLinks.length) {
      log(`移除未授权链接 ${removedLinks.length} 个：${removedLinks.join("、")}`);
      writeFileSync(workHtmlFile, fragment, "utf8");
    }
  }

  mkdirSync(outDir, { recursive: true });
  const title = extractTitle(draft, topic.title);
  const preview = buildPreview(fragment, title);
  writeFileSync(htmlFile, fragment, "utf8");
  writeFileSync(previewFile, preview, "utf8");
  writeFileSync(workHtmlFile, fragment, "utf8");
  writeFileSync(workPreviewFile, preview, "utf8");
  log(`已写出 ${htmlFile}`);
  log(`已写出 ${previewFile}`);

  writeFileSync(
    path.join(workDir, "05-validation.md"),
    buildValidationReport({ title, theme, reuse, layoutValidation, validations, removedLinks }),
    "utf8",
  );

  let publishStatus = reuse ? (topic.publishStatus || "html_ready") : "html_ready";
  if (!reuse || topic.publishStatus !== "draft_saved") {
    try {
      savePublishFields(dbPath, topic.id, {
        publish_status: "html_ready",
        publish_html: fragment,
        publish_html_at: new Date().toISOString(),
        publish_error: null,
      });
    } catch (error) {
      warn(`HTML 状态入库失败（文件已保留）：${error.message}`);
    }
  }

  let uploadLabel = "未上传";
  const apiKey = process.env.DABAIHUA_WENYAN_API_KEY;
  if (!apiKey) {
    log("未设置 DABAIHUA_WENYAN_API_KEY，已生成 HTML，跳过草稿箱上传；设置后加 --upload 重跑即可");
    uploadLabel = "跳过（未设置 DABAIHUA_WENYAN_API_KEY）";
  } else if (!options.upload) {
    log("上传到公众号草稿箱是外部写操作，需要作者确认；如需上传请显式加 --upload");
    uploadLabel = "跳过（未加 --upload）";
  } else {
    if (topic.publishStatus === "draft_saved" && !options.force) {
      log(`该选题已保存过草稿箱（wechat_draft_saved_at=${topic.wechatDraftSavedAt || "未知"}），如需重新上传请加 --force`);
      uploadLabel = "跳过（已保存过草稿箱，加 --force 可重新上传）";
    } else {
      if (!options.cover) {
        warn("未提供封面：微信草稿必须有封面，wenyan 会退回用正文第一张图，而本稿没有图片，因此上传可能失败；建议加 --cover <https URL>");
      }
      const outcome = await uploadToDraftBox({ dbPath, topic, fragment, draft, options });
      uploadLabel = outcome.message;
      if (outcome.status) publishStatus = outcome.status;
    }
  }

  process.stdout.write(`选题：${topic.id} ${title}\n`);
  process.stdout.write(`主题：${theme}\n`);
  process.stdout.write(`HTML：${htmlFile}\n`);
  process.stdout.write(`预览：${previewFile}\n`);
  process.stdout.write(`layout 校验：${validationLabel(layoutValidation)}\n`);
  process.stdout.write(`render 内容合同：${validationLabel(validations.content)}\n`);
  process.stdout.write(`HTML 合规：${validationLabel(validations.gzh)}\n`);
  process.stdout.write(`移除链接：${removedLinks.length} 个\n`);
  process.stdout.write(`publish_status：${publishStatus}\n`);
  process.stdout.write(`草稿箱：${uploadLabel}\n`);
}

main().catch((error) => {
  log(`运行失败：${error.stack || error.message}`);
  process.exitCode = 1;
});
