#!/usr/bin/env node
/**
 * article-draft.mjs — 把已排好版的公众号文章目录保存进「草稿箱」。
 *
 * 用法：
 *   npm run article:draft -- <slug> [--upload] [--local] [--title T] [--digest D]
 *       [--author A] [--comment 0|1] [--crop-235 x1_y1_x2_y2] [--crop-1x1 x1_y1_x2_y2]
 *       [--allow-long-title] [--out DIR] [--force]
 *
 * 安全边界（硬性）：
 *   默认是 DRY RUN：会上传图片素材并让远端渲染预览，但 dryRun=true，绝不创建/群发。
 *   只有显式加 --upload 才会真正保存到公众号草稿箱。工具白名单只有
 *   gzh_html_draft_add，并额外用禁止名单正则拦截群发/发布类工具名。
 *   若远端工具 inputSchema 缺少 dryRun（或未声明任何属性），非 --upload 运行会直接
 *   拒绝调用 tools/call，绝不冒默认实发请求的风险。
 *   --local 为完全离线干跑，不发任何网络请求。
 *
 * 只使用 Node 内置模块。
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const ARTICLES_DIR = process.env.ARTICLES_DIR || "/workspace/projects/articles";
const DEFAULT_MCP_URL = "https://llm.aigalaxy.top/wenyan-mcp/mcp";
const DEFAULT_OUT_ROOT = "/workspace/screens/wenyan";
const MCP_TIMEOUT_MS = 180_000;
const MAX_IMAGE_BYTES = 1024 * 1024;
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg"]);

const ALLOWLIST = ["gzh_html_draft_add"];
const DENYLIST = /(mass|send_?all|sendall|freepublish|free_publish|submit|broadcast|群发)/i;

const USAGE = "用法：node scripts/article-draft.mjs <slug> [--upload] [--local] [--title T] [--digest D] [--author A] [--comment 0|1] [--crop-235 x1_y1_x2_y2] [--crop-1x1 x1_y1_x2_y2] [--allow-long-title] [--out DIR] [--force]";

const log = (message) => process.stdout.write(`${message}\n`);
const warn = (message) => process.stderr.write(`[article-draft] WARN ${message}\n`);
const fail = (message) => process.stderr.write(`[article-draft] ${message}\n`);

// ---------- 基础工具 ----------

/** 任何错误信息都可能来自远端响应，先做一次密钥脱敏，绝不打印 DABAIHUA_WENYAN_API_KEY。 */
export function redact(text) {
  const key = process.env.DABAIHUA_WENYAN_API_KEY || "";
  let out = String(text ?? "");
  if (key) out = out.split(key).join("***");
  return out;
}

function truncate(text, max = 400) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function charCount(text) {
  return [...String(text ?? "")].length;
}

/** 读取 KEY=VALUE 环境文件；不覆盖 process.env 中已存在的变量。 */
export function loadEnvFile(file) {
  if (!file || !existsSync(file)) return;
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

function mcpUrl() {
  return process.env.DABAIHUA_WENYAN_MCP_URL || DEFAULT_MCP_URL;
}

function uploadUrl() {
  return mcpUrl().replace(/\/mcp\/?$/, "/upload");
}

function readJson(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ---------- PNG / JPEG 尺寸 ----------

/** 读取 PNG 的 IHDR，或基线 JPEG 的 SOF0/SOF2，返回 {width,height,type}。 */
export function imageSize(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf ?? []);
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), type: "png" };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        offset += 2;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      if (offset + 4 > bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof && offset + 9 <= bytes.length) {
        return {
          width: bytes.readUInt16BE(offset + 7),
          height: bytes.readUInt16BE(offset + 5),
          type: "jpeg",
        };
      }
      offset += 2 + segmentLength;
    }
  }
  return null;
}

const fraction = (value) => String(Math.round(value * 1e6) / 1e6);
const joinFractions = ([x1, y1, x2, y2]) => [x1, y1, x2, y2].map(fraction).join("_");

/** 计算 2.35:1 与 1:1 的最大居中裁剪，返回 x1_y1_x2_y2 分数串。 */
export function computeCrops(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) throw new Error(`图片尺寸不合法：${width}x${height}`);
  const ratio = w / h;
  const target = 2.35;

  let crop235;
  if (Math.abs(ratio - target) <= target * 0.02) {
    crop235 = "0_0_1_1";
  } else {
    let x1 = 0;
    let y1 = 0;
    let x2 = 1;
    let y2 = 1;
    if (ratio > target) {
      const cropWidth = target * h;
      const x = (w - cropWidth) / 2;
      x1 = x / w;
      x2 = (x + cropWidth) / w;
    } else {
      const cropHeight = w / target;
      const y = (h - cropHeight) / 2;
      y1 = y / h;
      y2 = (y + cropHeight) / h;
    }
    crop235 = joinFractions([x1, y1, x2, y2]);
  }

  let s1 = 0;
  let s2 = 0;
  let s3 = 1;
  let s4 = 1;
  if (w > h) {
    const side = h;
    const x = (w - side) / 2;
    s1 = x / w;
    s3 = (x + side) / w;
  } else if (h > w) {
    const side = w;
    const y = (h - side) / 2;
    s2 = y / h;
    s4 = (y + side) / h;
  }
  return { crop235, crop1x1: joinFractions([s1, s2, s3, s4]) };
}

// ---------- 字段与图片校验 ----------

/** 公众号标题/作者/摘要长度校验。 */
export function validateFields({ title, author, digest, allowLongTitle } = {}) {
  const errors = [];
  const warnings = [];
  const titleLength = charCount(title);
  if (titleLength > 64) {
    errors.push(`标题 ${titleLength} 字，超过公众号 64 字绝对上限`);
  } else if (titleLength > 32) {
    if (allowLongTitle) warnings.push(`标题 ${titleLength} 字，超过公众号 32 字上限（已用 --allow-long-title 放行）`);
    else errors.push(`标题 ${titleLength} 字，超过公众号 32 字上限`);
  }
  const authorLength = charCount(author);
  if (authorLength > 16) errors.push(`作者 ${authorLength} 字，超过 16 字上限`);
  const digestLength = charCount(digest);
  if (digestLength > 120) errors.push(`摘要 ${digestLength} 字，超过 120 字上限`);
  return { errors, warnings };
}

/** 提取 HTML 中每个 <img> 的 src 值（支持双引号、单引号、无引号）。 */
export function extractImgSrcs(html) {
  const srcs = [];
  const tagRe = /<img\b[^>]*>/gi;
  let tag;
  while ((tag = tagRe.exec(String(html ?? "")))) {
    const match = tag[0].match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (match) srcs.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return srcs;
}

const IMG_SRC_PLACEHOLDER = "__IMG_SRC__";

function normalizeImgSrcs(html) {
  return String(html ?? "").replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    (_full, prefix) => `${prefix}${IMG_SRC_PLACEHOLDER}`,
  );
}

/** 两个 HTML 是否除 img src 值外完全一致。 */
export function sameExceptImgSrc(a, b) {
  return normalizeImgSrcs(a) === normalizeImgSrcs(b);
}

function isLocalSrc(src) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(src);
}

function isMmbiz(src) {
  return /mmbiz/i.test(src);
}

function resolveLocalSrc(articleDir, src) {
  const resolved = path.resolve(articleDir, src);
  const relative = path.relative(articleDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return { resolved, outside: true };
  return { resolved, outside: false };
}

/** 扫描正文图片：收集本地文件信息与所有错误。 */
function scanImages(articleDir, html) {
  const srcs = extractImgSrcs(html);
  const errors = [];
  const localFiles = new Map();
  const entries = [];
  for (const src of srcs) {
    if (!src) {
      errors.push("发现空的 img src");
      continue;
    }
    if (/^data:/i.test(src)) {
      errors.push(`data: URI 图片不被公众号接受：${truncate(src, 60)}`);
      continue;
    }
    if (/^https?:\/\//i.test(src)) {
      if (!isMmbiz(src)) errors.push(`外链图片（非 mmbiz）不被接受：${truncate(src, 120)}`);
      entries.push({ src, kind: "external", bytes: 0 });
      continue;
    }
    if (!isLocalSrc(src)) {
      errors.push(`不支持的图片地址：${truncate(src, 120)}`);
      continue;
    }
    const { resolved, outside } = resolveLocalSrc(articleDir, src);
    if (outside) {
      errors.push(`本地图片越出文章目录：${src}`);
      continue;
    }
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      errors.push(`本地图片不存在：${src}`);
      continue;
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      errors.push(`本地图片格式必须是 .png/.jpg/.jpeg：${src}`);
      continue;
    }
    const bytes = statSync(resolved).size;
    if (bytes > MAX_IMAGE_BYTES) {
      errors.push(`本地图片超过 1 MB（${bytes} 字节）：${src}`);
      continue;
    }
    localFiles.set(resolved, { src, resolved, bytes });
    entries.push({ src, kind: "local", resolved, bytes });
  }
  return { errors, entries, localFiles };
}

// ---------- 最小 MCP Streamable HTTP 客户端 ----------

export function parseMcpPayload(text, contentType, id) {
  const body = String(text ?? "");
  if (String(contentType ?? "").includes("text/event-stream") || /^\s*(event|data):/m.test(body)) {
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

export function createMcpClient(url, apiKey) {
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

export async function openMcpSession(client) {
  await client.call(
    "initialize",
    { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "dabaihua-article-draft", version: "1.0" } },
    { id: 1 },
  );
  await client.call("notifications/initialized", undefined, { notification: true });
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
  if (result?.structuredContent && typeof result.structuredContent.media_id === "string") {
    return result.structuredContent.media_id;
  }
  const text = resultText(result);
  const jsonField = text.match(/"media_id"\s*:\s*"([A-Za-z0-9_-]{6,})"/i);
  if (jsonField) return jsonField[1];
  const match = text.match(/media[_ ]?id[^A-Za-z0-9_-]*([A-Za-z0-9_-]{6,})/i);
  return match ? match[1] : "";
}

// ---------- 参数解析 ----------

function parseArgs(argv) {
  const options = {
    slug: "",
    upload: false,
    local: false,
    title: "",
    digest: "",
    author: "",
    comment: 0,
    crop235: "",
    crop1x1: "",
    allowLongTitle: false,
    out: "",
    force: false,
  };
  const positionals = [];
  const take = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${name} 需要一个值`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--upload") options.upload = true;
    else if (arg === "--local") options.local = true;
    else if (arg === "--allow-long-title") options.allowLongTitle = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--title") { options.title = take(index, "--title"); index += 1; }
    else if (arg === "--digest") { options.digest = take(index, "--digest"); index += 1; }
    else if (arg === "--author") { options.author = take(index, "--author"); index += 1; }
    else if (arg === "--comment") { options.comment = Number(take(index, "--comment")); index += 1; }
    else if (arg === "--crop-235") { options.crop235 = take(index, "--crop-235"); index += 1; }
    else if (arg === "--crop-1x1") { options.crop1x1 = take(index, "--crop-1x1"); index += 1; }
    else if (arg === "--out") { options.out = take(index, "--out"); index += 1; }
    else if (arg.startsWith("--")) throw new Error(`未知参数：${arg}`);
    else if (arg !== "") positionals.push(arg);
  }
  if (positionals.length !== 1) throw new Error(USAGE);
  options.slug = positionals[0];
  if (![0, 1].includes(options.comment)) throw new Error("--comment 只能是 0 或 1");
  if (options.upload && options.local) throw new Error("--upload 与 --local 不能同时使用");
  return options;
}

const CROP_RE = /^\d*\.?\d+_\d*\.?\d+_\d*\.?\d+_\d*\.?\d+$/;
function validateCrop(value, name) {
  if (!value) return "";
  if (!CROP_RE.test(value)) throw new Error(`${name} 格式应为 x1_y1_x2_y2：${value}`);
  const parts = value.split("_").map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0 || part > 1)) {
    throw new Error(`${name} 数值必须在 0..1 之间：${value}`);
  }
  if (!(parts[2] > parts[0]) || !(parts[3] > parts[1])) throw new Error(`${name} 裁剪区域不合法：${value}`);
  return value;
}

// ---------- 图片上传 ----------

async function uploadImage(url, apiKey, dir, filePath) {
  const bytes = readFileSync(filePath);
  const name = path.basename(filePath);
  const target = `${url}?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`;
  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "X-API-Key": apiKey },
    body: bytes,
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`上传 ${name} 失败：HTTP ${response.status}${text ? `（${truncate(redact(text), 200)}）` : ""}`);
  }
  return { name, bytes: bytes.length, status: response.status };
}

// ---------- 裁剪预览（可选，依赖 python3 + Pillow）----------

function hasPillow() {
  const result = spawnSync("python3", ["-c", "import PIL"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

const CROP_PY = [
  "import sys",
  "from PIL import Image",
  "src, out235, out1x1, c235, c1x1 = sys.argv[1:6]",
  "im = Image.open(src)",
  "w, h = im.size",
  "for spec, out in ((c235, out235), (c1x1, out1x1)):",
  "    x1, y1, x2, y2 = (float(v) for v in spec.split('_'))",
  "    box = (round(x1 * w), round(y1 * h), round(x2 * w), round(y2 * h))",
  "    im.crop(box).save(out)",
].join("\n");

function writeCropPreviews(coverPath, outDir, crop235, crop1x1) {
  if (!hasPillow()) {
    warn("未检测到 python3 + Pillow，跳过裁剪预览图");
    return;
  }
  const out235 = path.join(outDir, "cover-crop-2.35x1.png");
  const out1x1 = path.join(outDir, "cover-crop-1x1.png");
  const result = spawnSync("python3", ["-c", CROP_PY, coverPath, out235, out1x1, crop235, crop1x1], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    warn(`裁剪预览生成失败：${result.error ? result.error.message : truncate(result.stderr, 300)}`);
    return;
  }
  log(`裁剪预览：${out235}`);
  log(`裁剪预览：${out1x1}`);
}

// ---------- 摘要打印 ----------

function formatBytes(bytes) {
  return `${bytes} 字节`;
}

function printSummary({ title, digest, author, needOpenComment, coverSrc, coverSize, crops, imageEntries, uploadFiles, htmlLength }) {
  const titleLength = charCount(title);
  log("—— 文章草稿计划 ——");
  log(`标题：${title}（${titleLength} 字）`);
  log(`摘要：${digest ? `${digest}（${charCount(digest)} 字）` : "（未提供，微信会取前 54 字）"}`);
  log(`作者：${author || "（未提供）"}`);
  log(`留言开关 needOpenComment：${needOpenComment}`);
  log(`封面：${coverSrc}　${coverSize.width}x${coverSize.height}（${coverSize.type}）　${formatBytes(coverSize.bytes)}`);
  log(`2.35:1 裁剪：${crops.crop235}`);
  log(`1:1 裁剪：${crops.crop1x1}`);
  if (imageEntries.length === 0) {
    log("正文图片：无");
  } else {
    log(`正文图片：${imageEntries.length} 处引用`);
    for (const entry of imageEntries) {
      log(`  - ${entry.src}　${entry.kind === "local" ? formatBytes(entry.bytes) : "外链 mmbiz"}`);
    }
  }
  log(`待上传文件（唯一本地文件）：${uploadFiles.length} 个`);
  log(`HTML 长度：${htmlLength} 字`);
}

// ---------- 工具参数构建 ----------

/**
 * 按 schemaProperties 过滤 desired 得到 tools/call 的 arguments。
 * 纯函数：不做任何 I/O。规则：
 *   - schema 未声明任何属性时放行全部键（兼容无 schema 的旧工具）；
 *   - schema 声明了属性但不含 dryRun，且本次不是 --upload：返回 error，拒绝调用；
 *   - dryRun 永不被过滤，args.dryRun 始终为 !upload（以 options 为准，忽略 desired 里的值）。
 * 返回 { args, dropped, error }，error 为字符串或 null。
 */
export function buildToolArgs(desired, schemaProperties, { upload } = {}) {
  const allowedKeys = new Set(Object.keys(schemaProperties || {}));
  if (!upload && (allowedKeys.size === 0 || !allowedKeys.has("dryRun"))) {
    return { args: {}, dropped: [], error: "工具 inputSchema 不含 dryRun，拒绝调用（避免误建草稿）" };
  }
  const args = {};
  const dropped = [];
  for (const [key, value] of Object.entries(desired || {})) {
    if (key === "dryRun") continue; // 永不丢弃，统一在下方按 !upload 写入
    if (allowedKeys.size === 0 || allowedKeys.has(key)) args[key] = value;
    else dropped.push(key);
  }
  args.dryRun = !upload;
  return { args, dropped, error: null };
}

// ---------- 主流程 ----------

export async function main(argv = process.argv.slice(2)) {
  loadEnvFile(process.env.WENYAN_ENV_FILE || path.join(homedir(), ".config/wenyan/env"));
  const options = parseArgs(argv);
  const { slug } = options;
  if (!SLUG_RE.test(slug)) throw new Error(`slug 不合法：${slug}`);

  const articleDir = path.join(ARTICLES_DIR, slug);
  if (!existsSync(articleDir) || !statSync(articleDir).isDirectory()) {
    throw new Error(`文章目录不存在：${articleDir}`);
  }
  const metaPath = path.join(articleDir, "meta.json");
  const meta = readJson(metaPath);
  if (!meta) throw new Error(`无法读取 meta.json：${metaPath}`);

  const htmlRel = (meta.layout && meta.layout.html) || "article.html";
  const htmlPath = path.join(articleDir, htmlRel);
  if (!existsSync(htmlPath)) throw new Error(`HTML 文件不存在：${htmlPath}`);
  const html = readFileSync(htmlPath, "utf8");

  const title = options.title || (meta.wechat && meta.wechat.title) || meta.title || "";
  const digest = options.digest || (meta.wechat && meta.wechat.digest) || meta.digest || "";
  const author = options.author || (meta.wechat && meta.wechat.author) || process.env.WENYAN_AUTHOR || "";
  const needOpenComment = options.comment;

  if (options.upload && meta.wechat_draft && meta.wechat_draft.media_id && !options.force) {
    fail(`已存在公众号草稿（media_id=${meta.wechat_draft.media_id}），如需重新保存请加 --force`);
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(options.out || path.join(DEFAULT_OUT_ROOT, slug));

  // 封面
  const coverList = Array.isArray(meta.images && meta.images.cover) ? meta.images.cover : [];
  const coverRel = coverList.find((item) => typeof item === "string" && item.includes("21x9")) || "images/cover-21x9.png";
  const coverPath = resolveLocalSrc(articleDir, coverRel).resolved;
  if (!existsSync(coverPath)) throw new Error(`封面不存在：${coverPath}`);
  const coverBuf = readFileSync(coverPath);
  const coverSize = imageSize(coverBuf);
  if (!coverSize) throw new Error(`无法识别封面尺寸：${coverPath}`);

  // 裁剪
  const computed = computeCrops(coverSize.width, coverSize.height);
  const crop235 = validateCrop(options.crop235, "--crop-235") || computed.crop235;
  const crop1x1 = validateCrop(options.crop1x1, "--crop-1x1") || computed.crop1x1;
  warn("1:1 crop is taken from the same 21:9 cover (WeChat cannot use a separate square image); check the preview");

  // 字段与图片校验
  const fieldValidation = validateFields({ title, author, digest, allowLongTitle: options.allowLongTitle });
  if (!digest) warn("no digest: WeChat will take the first 54 chars");
  const imageScan = scanImages(articleDir, html);
  const errors = [...fieldValidation.errors, ...imageScan.errors];
  const warnings = [...fieldValidation.warnings];

  // 待上传文件 = 正文本地图片 + 封面（按绝对路径去重）
  const uploadMap = new Map(imageScan.localFiles);
  uploadMap.set(coverPath, { src: coverRel, resolved: coverPath, bytes: coverBuf.length });
  const uploadFiles = [...uploadMap.values()];
  const basenameSeen = new Map();
  for (const file of uploadFiles) {
    const name = path.basename(file.resolved);
    if (basenameSeen.has(name) && basenameSeen.get(name) !== file.resolved) {
      errors.push(`有不同文件使用了同名 basename，无法按名解析：${name}`);
    }
    basenameSeen.set(name, file.resolved);
  }

  printSummary({
    title,
    digest,
    author,
    needOpenComment,
    coverSrc: coverRel,
    coverSize: { ...coverSize, bytes: coverBuf.length },
    crops: { crop235, crop1x1 },
    imageEntries: imageScan.entries,
    uploadFiles,
    htmlLength: html.length,
  });
  for (const warning of warnings) warn(warning);

  const hasErrors = errors.length > 0;
  if (hasErrors) {
    log("校验失败：");
    for (const error of errors) log(`  ✗ ${error}`);
  }

  mkdirSync(outDir, { recursive: true });

  if (options.local) {
    writePlanJson(outDir, {
      slug,
      articleDir,
      html: htmlRel,
      title,
      digest,
      author,
      needOpenComment,
      cover: { src: coverRel, width: coverSize.width, height: coverSize.height, type: coverSize.type, bytes: coverBuf.length },
      crops: { crop235, crop1x1 },
      images: imageScan.entries,
      uploadFiles: uploadFiles.map((file) => ({ name: path.basename(file.resolved), bytes: file.bytes })),
      htmlLength: html.length,
      validation: { errors, warnings },
    });
    log(`已写出 ${path.join(outDir, "plan.json")}`);
    writeCropPreviews(coverPath, outDir, crop235, crop1x1);
    process.exitCode = hasErrors ? 1 : 0;
    return;
  }

  // 任何网络步骤之前先处理校验错误
  if (hasErrors) {
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.DABAIHUA_WENYAN_API_KEY;
  if (!apiKey) {
    fail("未设置 DABAIHUA_WENYAN_API_KEY（可放在 ~/.config/wenyan/env），无法执行上传。加 --local 可完全离线干跑。");
    process.exitCode = 1;
    return;
  }

  writeCropPreviews(coverPath, outDir, crop235, crop1x1);

  // 上传图片素材
  const uUrl = uploadUrl();
  log(`上传图片到 ${uUrl}`);
  for (const file of uploadFiles) {
    const uploaded = await uploadImage(uUrl, apiKey, slug, file.resolved);
    log(`  已上传 ${uploaded.name}（${uploaded.bytes} 字节）`);
  }

  // MCP 会话
  const client = createMcpClient(mcpUrl(), apiKey);
  log(`连接 wenyan-mcp：${mcpUrl()}`);
  await openMcpSession(client);
  const list = await client.call("tools/list", {}, { id: 2 });
  const tools = Array.isArray(list?.tools) ? list.tools : [];
  const names = tools.map((tool) => tool.name);
  const chosenName = ALLOWLIST.find((name) => names.includes(name));
  if (!chosenName) {
    fail(`未找到允许的草稿工具 ${ALLOWLIST.join("、")}。可用工具：${names.join("、") || "（无）"}`);
    process.exitCode = 1;
    return;
  }
  if (DENYLIST.test(chosenName)) {
    fail(`工具名 ${chosenName} 命中禁止名单，已中止（绝不群发）`);
    process.exitCode = 1;
    return;
  }
  const tool = tools.find((item) => item.name === chosenName);
  const schema = tool?.inputSchema || tool?.input_schema || {};

  const desired = {
    html,
    imageDir: slug,
    resolveByBasename: true,
    title,
    needOpenComment,
    coverFile: path.basename(coverPath),
    picCrop235_1: crop235,
    picCrop1_1: crop1x1,
  };
  if (author) desired.author = author;
  if (digest) desired.digest = digest;
  if (options.allowLongTitle) desired.allowLongTitle = true;

  // 非上传运行若 schema 缺 dryRun（或无属性声明），在此处直接拒绝，绝不发起实发请求
  const { args, dropped, error: argsError } = buildToolArgs(desired, schema.properties, { upload: options.upload });
  if (argsError) {
    fail(argsError);
    process.exitCode = 1;
    return;
  }
  if (dropped.length) warn(`工具 inputSchema 不含以下参数，已丢弃：${dropped.join("、")}`);

  // 硬性保险：dryRun 必须在场且与 !options.upload 一致，否则拒绝调用
  if (args.dryRun !== !options.upload) {
    fail(`dryRun 参数缺失或不一致（期望 ${!options.upload}），拒绝调用（避免误建草稿）`);
    process.exitCode = 1;
    return;
  }

  log(`调用工具：${chosenName}（dryRun=${args.dryRun}）`);
  let result;
  try {
    result = await client.call("tools/call", { name: chosenName, arguments: args }, { id: 3 });
  } catch (error) {
    fail(`调用失败：${truncate(redact(error.message), 400)}`);
    process.exitCode = 2;
    return;
  }
  if (result?.isError) {
    fail(`工具返回错误：${truncate(redact(resultText(result)), 400)}`);
    process.exitCode = 2;
    return;
  }

  const rawText = result?.content?.[0]?.text ?? "";
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = null;
  }

  if (!options.upload) {
    writeFileSync(path.join(outDir, "dry-run-result.json"), `${JSON.stringify(parsed ?? { raw: rawText }, null, 2)}\n`, "utf8");
    const serverContent = parsed && typeof parsed.content === "string" ? parsed.content : "";
    writeFileSync(path.join(outDir, "dry-run-content.html"), serverContent, "utf8");
    const identical = parsed ? sameExceptImgSrc(serverContent, html) : false;
    log(`HTML 与 article.html 除 img src 外完全一致：${identical ? "是" : "否"}`);
    if (parsed) {
      log(`服务端 uploadCount：${parsed.uploadCount ?? "（无）"}`);
      const serverWarnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
      for (const warning of serverWarnings) log(`服务端提醒：${warning}`);
    } else {
      log("服务端结果不是 JSON，已原样写入 dry-run-result.json");
    }
    process.exitCode = identical ? 0 : 1;
    return;
  }

  // --upload：真正保存到草稿箱
  const mediaId = parsed ? extractMediaId(parsed) || parsed.media_id || "" : extractMediaId(result);
  if (!mediaId) {
    fail(`工具未返回 media_id，无法确认草稿已创建：${truncate(redact(rawText), 300)}`);
    process.exitCode = 2;
    return;
  }
  log(`已保存到公众号草稿箱（未群发）media_id=${mediaId}`);
  meta.wechat_draft = { media_id: mediaId, saved_at: new Date().toISOString(), title };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  log(`已更新 ${metaPath}`);
}

function writePlanJson(outDir, plan) {
  const payload = { generated_at: new Date().toISOString(), ...plan };
  writeFileSync(path.join(outDir, "plan.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    fail(error.message);
    process.exitCode = 1;
  });
}
