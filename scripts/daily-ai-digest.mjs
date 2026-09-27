/**
 * daily-ai-digest.mjs — 大白话讲AI 每日 AI 素材采集器
 *
 * 采集 GitHub / Hacker News / 厂商博客 RSS / 本地 D1 文章，用 pi CLI 过滤并生成
 * 6-10 条中文干货 + 3-5 个公众号选题，写出 markdown，并把选题写入本地 topics 板。
 *
 * 用法：
 *   export PATH=/home/box/.local/bin:$PATH   # node 22 + pi
 *   export OPENCODE_API_KEY=...              # 来自你的密钥库，切勿提交
 *   npm run digest            # 或: node scripts/daily-ai-digest.mjs [--refresh] [--force] [--dry-run] [--no-board] [--date YYYY-MM-DD]
 *
 * 环境变量：OPENCODE_API_KEY（必填，供 pi 使用）、DIGEST_MODEL、PI_BIN、
 *          DIGEST_OUT_DIR、DIGEST_D1_PATH、GITHUB_TOKEN（可选）。
 * 注意：本脚本不会打印任何密钥或完整环境变量。
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "dabaihua-daily-digest/1.0";
const FETCH_TIMEOUT_MS = 20_000;
const LLM_TIMEOUT_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MODEL = "opencode-go/deepseek-v4.1-flash";
const MATERIAL_CAP = 90;

const AI_KEYWORDS = [
  "agent", "llm", "rag", "ai", "gpt", "claude", "gemini", "model", "mcp",
  "enterprise", "copilot", "inference", "embedding", "智能体", "大模型",
  "人工智能", "生成式", "机器学习",
];

const RSS_FEEDS = [
  { source: "OpenAI", url: "https://openai.com/news/rss.xml" },
  { source: "Anthropic", url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml" },
  { source: "Google AI", url: "https://blog.google/technology/ai/rss/" },
  { source: "DeepMind", url: "https://deepmind.google/blog/rss.xml" },
  { source: "Microsoft AI", url: "https://news.microsoft.com/source/topics/ai/feed/" },
  { source: "Microsoft Research", url: "https://www.microsoft.com/en-us/research/feed/" },
  { source: "AWS ML", url: "https://aws.amazon.com/blogs/machine-learning/feed/" },
  { source: "Hugging Face", url: "https://huggingface.co/blog/feed.xml" },
  { source: "GitHub Blog", url: "https://github.blog/ai-and-ml/feed/" },
  { source: "Cloudflare AI", url: "https://blog.cloudflare.com/tag/ai/rss/" },
  { source: "Databricks", url: "https://www.databricks.com/feed" },
  { source: "Simon Willison", url: "https://simonwillison.net/atom/everything/" },
];

// ---------- 基础工具 ----------

const log = (message) => process.stderr.write(`[digest] ${message}\n`);

function warn(message) {
  process.stderr.write(`[digest] WARN ${message}\n`);
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function ymdDaysAgo(days) {
  return isoDaysAgo(days).slice(0, 10);
}

function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
}

function shanghaiTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const got = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${got.year}-${got.month}-${got.day} ${got.hour}:${got.minute}:${got.second}`;
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
  const withoutTags = String(input ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
  return decodeXml(withoutTags).replace(/\s+/g, " ").trim();
}

function truncate(text, max = 300) {
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

function validDate(value) {
  const time = Date.parse(String(value ?? ""));
  return Number.isNaN(time) ? 0 : time;
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

// ---------- 来源 1：GitHub ----------

async function collectGithub() {
  const queries = [
    `topic:ai-agents pushed:>=${ymdDaysAgo(7)}`,
    `topic:rag created:>=${ymdDaysAgo(30)}`,
    `"enterprise ai" created:>=${ymdDaysAgo(30)}`,
    `"ai native" created:>=${ymdDaysAgo(30)}`,
    `mcp agent created:>=${ymdDaysAgo(14)}`,
  ];
  const headers = process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};
  const materials = [];
  const seen = new Set();
  let failures = 0;
  for (const query of queries) {
    try {
      const params = new URLSearchParams({ q: query, sort: "stars", order: "desc", per_page: "10" });
      const data = await fetchJson(`https://api.github.com/search/repositories?${params}`, headers);
      for (const repo of data.items || []) {
        const url = normalizeUrl(repo.html_url);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const created = String(repo.created_at || "").slice(0, 10);
        const pushed = String(repo.pushed_at || "").slice(0, 10);
        materials.push({
          source: "GitHub",
          title: repo.full_name || repo.name || url,
          url,
          summary: `${repo.description || "无描述"}｜★${repo.stargazers_count ?? 0}｜${repo.language || "未知语言"}｜created ${created} / pushed ${pushed}`,
          date: repo.pushed_at || repo.created_at || "",
          score: Number(repo.stargazers_count) || 0,
        });
      }
    } catch (error) {
      failures += 1;
      warn(`GitHub 查询失败（${query}）：${error.message}`);
    }
  }
  if (failures === queries.length) throw new Error(`GitHub 全部 ${queries.length} 个查询失败`);
  return materials;
}

// ---------- 来源 2：Hacker News (Algolia) ----------

async function collectHackerNews() {
  const queries = ["AI agent", "LLM", "RAG", "enterprise AI", "Claude", "OpenAI"];
  const materials = [];
  let failures = 0;
  for (const query of queries) {
    try {
      const params = new URLSearchParams({
        query,
        tags: "story",
        numericFilters: `created_at_i>${Math.floor((Date.now() - 3 * DAY_MS) / 1000)},points>30`,
        hitsPerPage: "15",
      });
      const data = await fetchJson(`https://hn.algolia.com/api/v1/search?${params}`);
      for (const hit of data.hits || []) {
        const discussion = `https://news.ycombinator.com/item?id=${hit.objectID}`;
        const url = normalizeUrl(hit.url || discussion);
        if (!url) continue;
        materials.push({
          source: "Hacker News",
          title: stripHtml(hit.title) || discussion,
          url,
          summary: `${stripHtml(hit.story_text || hit.title)}｜${hit.points ?? 0} points · ${hit.num_comments ?? 0} comments｜讨论 ${discussion}`,
          date: hit.created_at || "",
          score: Number(hit.points) || 0,
        });
      }
    } catch (error) {
      failures += 1;
      warn(`Hacker News 查询失败（${query}）：${error.message}`);
    }
  }
  if (failures === queries.length) throw new Error(`Hacker News 全部 ${queries.length} 个查询失败`);
  return materials;
}

// ---------- 来源 3：厂商博客 RSS/Atom ----------

function extractFirst(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1] : "";
}

function extractLink(block) {
  let alternate = "";
  let fallback = "";
  const linkTags = block.matchAll(/<link\b([^>]*?)(?:\/>|>([\s\S]*?)<\/link>)/gi);
  for (const match of linkTags) {
    const attrs = match[1] || "";
    const href = attrs.match(/href=["']([^"']+)["']/i);
    const rel = attrs.match(/rel=["']([^"']+)["']/i);
    if (href) {
      const value = decodeXml(href[1].trim());
      if (!rel || rel[1].toLowerCase() === "alternate") {
        if (!alternate) alternate = value;
      } else if (!fallback) {
        fallback = value;
      }
    } else if (match[2]) {
      const value = decodeXml(match[2].trim());
      if (value && !fallback) fallback = value;
    }
  }
  return normalizeUrl(alternate || fallback);
}

function parseFeed(xml, source) {
  const blocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((match) => match[0]);
  const materials = [];
  for (const block of blocks) {
    const title = stripHtml(extractFirst(block, "title"));
    const url = extractLink(block);
    const description = extractFirst(block, "description") || extractFirst(block, "summary") || extractFirst(block, "content");
    const dateRaw = extractFirst(block, "pubDate") || extractFirst(block, "published") || extractFirst(block, "updated") || extractFirst(block, "dc:date");
    if (!title || !url) continue;
    const time = validDate(dateRaw);
    if (time && Date.now() - time > 7 * DAY_MS) continue;
    materials.push({
      source,
      title,
      url,
      summary: truncate(stripHtml(description)),
      date: time ? new Date(time).toISOString() : "",
      score: 0,
    });
    if (materials.length >= 8) break;
  }
  return materials;
}

async function collectFeeds() {
  const materials = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await fetchText(feed.url, { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
      materials.push(...parseFeed(xml, feed.source));
    } catch (error) {
      warn(`RSS ${feed.source} 抓取失败：${error.message}`);
    }
  }
  return materials;
}

// ---------- 来源 4：本地 D1 已有文章 ----------

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

function collectLocalItems(dbPath) {
  if (!dbPath || !existsSync(dbPath)) {
    warn(`未找到本地 D1 sqlite（${dbPath || "自动发现失败"}），跳过本地文章`);
    return [];
  }
  let db;
  try {
    db = new DatabaseSync(dbPath);
    const rows = db.prepare(
      `SELECT i.title, i.url, i.original_excerpt, i.published_at, i.created_at,
              s.name AS source_name, s.kind
       FROM items i LEFT JOIN sources s ON s.id = i.source_id
       WHERE i.url LIKE 'http%' AND COALESCE(i.published_at, i.created_at) >= ?
       ORDER BY i.id DESC LIMIT 60`,
    ).all(isoDaysAgo(3));
    return rows.map((row) => ({
      source: row.source_name || "本地库",
      title: String(row.title || "").trim(),
      url: normalizeUrl(row.url),
      summary: truncate(stripHtml(row.original_excerpt), 240),
      date: row.published_at || row.created_at || "",
      score: 0,
    })).filter((material) => material.title && material.url);
  } catch (error) {
    warn(`本地 D1 读取失败：${error.message}`);
    return [];
  } finally {
    if (db) db.close();
  }
}

// ---------- 归一化 / 去重 / 筛选 ----------

function hasAiKeyword(text) {
  const haystack = String(text ?? "").toLowerCase();
  return AI_KEYWORDS.some((keyword) => {
    if (keyword.length <= 3 && /^[a-z0-9]+$/.test(keyword)) {
      return new RegExp(`\\b${keyword}\\b`, "i").test(haystack);
    }
    return haystack.includes(keyword);
  });
}

function selectBalanced(materials, cap) {
  const groups = new Map();
  for (const material of materials) {
    const list = groups.get(material.source) || [];
    list.push(material);
    groups.set(material.source, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (b.score - a.score) || (validDate(b.date) - validDate(a.date)));
  }
  const selected = [];
  let progressed = true;
  while (selected.length < cap && progressed) {
    progressed = false;
    for (const list of groups.values()) {
      if (!list.length) continue;
      selected.push(list.shift());
      progressed = true;
      if (selected.length >= cap) break;
    }
  }
  return selected;
}

function buildMaterials(rawMaterials) {
  const byUrl = new Map();
  for (const material of rawMaterials) {
    const url = normalizeUrl(material.url);
    if (!url || !material.title) continue;
    if (!hasAiKeyword(`${material.title} ${material.summary}`)) continue;
    if (!byUrl.has(url)) byUrl.set(url, { ...material, url });
  }
  const selected = selectBalanced([...byUrl.values()], MATERIAL_CAP);
  return selected.map((material, index) => ({
    id: `M${index + 1}`,
    source: material.source,
    title: material.title,
    url: material.url,
    summary: truncate(material.summary, 300),
    date: material.date ? String(material.date).slice(0, 10) : "",
  }));
}

async function gatherMaterials(stats) {
  const collectors = [
    ["GitHub", collectGithub],
    ["Hacker News", collectHackerNews],
    ["RSS", collectFeeds],
    ["本地库", () => collectLocalItems(resolveD1Path())],
  ];
  const raw = [];
  for (const [name, collector] of collectors) {
    try {
      const materials = await collector();
      raw.push(...materials);
      stats.counts[name] = materials.length;
    } catch (error) {
      stats.failed.push(name);
      stats.counts[name] = 0;
      warn(`来源 ${name} 抓取失败：${error.message}`);
    }
  }
  return buildMaterials(raw);
}

// ---------- LLM（pi CLI）----------

function buildPrompt(materials) {
  const lines = materials.map((m) => `[${m.id}] (${m.source}) ${m.title} — ${m.summary} (${m.date || "无日期"})`);
  return [
    "你是「大白话讲AI」的内容策划。以下是今天抓取到的 AI 素材列表，每行格式为 [编号] (来源) 标题 — 摘要 (日期)。",
    "受众：想在企业里落地 AI 的管理者、产品经理和工程师。",
    "重点关注：企业 AI 应用、AI Native 实践、Agent/RAG 工程落地、真实案例。",
    "排除：纯融资八卦、纯学术且无落地价值的内容。",
    "请只输出严格 JSON（不要 markdown 代码块、不要解释文字），结构如下：",
    '{"items":[{"id":"M12","title":"中文标题","summary":"2-3句中文干货摘要，说清楚是什么、为什么对企业重要","tag":"Agent|RAG|企业落地|AI Native|工具|模型"}],',
    ' "topics":[{"title":"公众号选题标题（大白话、有钩子）","core":"核心观点（一两句判断）","case":"贯穿全文的一个案例","benefit":"读者收益","refs":["M12","M3"]}]}',
    "要求：items 6-10 条，topics 3-5 个；refs 只能使用上面列表里出现过的编号；不要编造任何编号或链接。",
    "",
    "素材列表：",
    ...lines,
  ].join("\n");
}

function runPi(prompt) {
  const piBin = process.env.PI_BIN || "pi";
  const model = process.env.DIGEST_MODEL || DEFAULT_MODEL;
  return new Promise((resolve, reject) => {
    const child = spawn(piBin, ["-p", "--no-session", "--model", model, prompt], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("pi 调用超过 10 分钟，已终止"));
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

function parseLlmJson(text) {
  const stripped = String(text ?? "").replace(/```json/gi, "").replace(/```/g, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("响应中未找到 JSON");
  return JSON.parse(stripped.slice(start, end + 1));
}

async function runLlm(materials) {
  const prompt = buildPrompt(materials);
  const first = await runPi(prompt);
  try {
    return parseLlmJson(first);
  } catch (error) {
    warn(`JSON 解析失败，重试一次：${error.message}`);
    const reminder = `${prompt}\n\n重要：你上一次没有输出合法 JSON。请只输出 JSON，不要任何其他文字或代码块标记。`;
    const second = await runPi(reminder);
    return parseLlmJson(second);
  }
}

// ---------- 反编造校验 ----------

const URL_PATTERN = /https?:\/\/[^\s)\]}>"，。]+/g;

function sanitizeText(value, allowedUrls) {
  return String(value ?? "").replace(URL_PATTERN, (matched) => (
    allowedUrls.has(normalizeUrl(matched)) ? matched : ""
  )).replace(/\s{2,}/g, " ").trim();
}

function validateResult(result, materials) {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const allowedUrls = new Set(materials.map((m) => normalizeUrl(m.url)));
  const items = [];
  for (const item of Array.isArray(result.items) ? result.items : []) {
    const material = byId.get(String(item?.id || ""));
    if (!material) continue;
    items.push({
      id: material.id,
      title: sanitizeText(item.title, allowedUrls) || material.title,
      summary: sanitizeText(item.summary, allowedUrls),
      tag: sanitizeText(item.tag, allowedUrls),
    });
    if (items.length >= 10) break;
  }
  const topics = [];
  for (const topic of Array.isArray(result.topics) ? result.topics : []) {
    const refs = (Array.isArray(topic?.refs) ? topic.refs : [])
      .map((ref) => String(ref || ""))
      .filter((ref) => byId.has(ref));
    if (!refs.length) continue;
    topics.push({
      title: sanitizeText(topic.title, allowedUrls),
      core: sanitizeText(topic.core, allowedUrls),
      case: sanitizeText(topic.case, allowedUrls),
      benefit: sanitizeText(topic.benefit, allowedUrls),
      refs,
    });
    if (topics.length >= 5) break;
  }
  items.sort((a, b) => materials.findIndex((m) => m.id === a.id) - materials.findIndex((m) => m.id === b.id));
  return { items, topics };
}

// ---------- markdown 生成 ----------

function buildMarkdown(date, materials, result, stats, generatedAt) {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const counts = Object.entries(stats.counts).map(([name, count]) => `${name} ${count}`).join(" · ") || "无";
  const failed = stats.failed.length ? stats.failed.join("、") : "无";
  const lines = [
    `# 大白话讲AI · 每日素材 ${date}`,
    "",
    `生成时间：${generatedAt}（Asia/Shanghai）｜来源统计：${counts}｜失败来源：${failed}`,
    "",
    "## 今日干货",
    "",
  ];
  result.items.forEach((item, index) => {
    const material = byId.get(item.id);
    if (!material) return;
    lines.push(`### ${index + 1}. ${item.title}`);
    lines.push(`- 原文：[${material.title}](${material.url})`);
    if (material.source === "Hacker News") {
      const hnMatch = String(material.summary || "").match(/https:\/\/news\.ycombinator\.com\/item\?id=\d+/);
      if (hnMatch) lines.push(`- HN 讨论：${hnMatch[0]}`);
    }
    lines.push(`- 来源：${material.source} · ${material.date || "无日期"}`);
    lines.push(`- 标签：${item.tag || "未分类"}`);
    lines.push("");
    lines.push(item.summary || material.summary);
    lines.push("");
  });
  lines.push("## 推荐选题", "");
  result.topics.forEach((topic, index) => {
    lines.push(`### 选题${index + 1}：${topic.title}`);
    lines.push(`- **核心观点**：${topic.core}`);
    lines.push(`- **贯穿案例**：${topic.case}`);
    lines.push(`- **读者收益**：${topic.benefit}`);
    lines.push("- **依据素材**：");
    for (const ref of topic.refs) {
      const material = byId.get(ref);
      if (!material) continue;
      lines.push(`  - [${material.title}](${material.url})`);
    }
    lines.push("");
  });
  lines.push("---");
  lines.push("> 以上链接均已对照当日实际抓取来源校验；标题与链接来自原始材料，未经模型改动。");
  lines.push("");
  return lines.join("\n");
}

function buildTopicNotes(topic, byId) {
  const refs = topic.refs.map((ref) => byId.get(ref)).filter(Boolean);
  const lines = [
    `贯穿案例：${topic.case}`,
    `读者收益：${topic.benefit}`,
    "依据素材：",
    ...refs.map((material) => `- [${material.title}](${material.url})`),
  ];
  return lines.join("\n");
}

// ---------- 选题板写入 ----------

function insertTopics(dbPath, validatedTopics, date, force) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const marker = db.prepare("SELECT COUNT(*) AS c FROM topics WHERE reason = ?").get(`daily-ai-digest:${date}`);
    if (marker.c > 0 && !force) {
      return { skipped: true, inserted: [] };
    }
    const exists = db.prepare("SELECT COUNT(*) AS c FROM topics WHERE title = ?");
    const insert = db.prepare(
      `INSERT INTO topics
       (title, angle, reason, platform, content_type, heat, match_score, feasibility, total,
        hkr, status, item_ids, notes, created_at, updated_at)
       VALUES (?, ?, ?, 'gzh', 'article', 0, 0, 0, 0, '', 'candidate', '[]', ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    const inserted = [];
    let inTransaction = false;
    try {
      db.exec("BEGIN");
      inTransaction = true;
      for (const topic of validatedTopics) {
        const title = String(topic.title || "").slice(0, 120);
        if (!title) continue;
        if (exists.get(title).c > 0) continue;
        const info = insert.run(
          title,
          String(topic.core || "").slice(0, 500),
          `daily-ai-digest:${date}`,
          topic.notes,
          now,
          now,
        );
        inserted.push(Number(info.lastInsertRowid));
      }
      db.exec("COMMIT");
      inTransaction = false;
    } catch (error) {
      if (inTransaction) {
        try { db.exec("ROLLBACK"); } catch { /* 忽略回滚失败 */ }
      }
      throw error;
    }
    return { skipped: false, inserted };
  } finally {
    db.close();
  }
}

// ---------- 缓存 ----------

function cachePath(outDir, date) {
  return path.join(outDir, ".cache", `${date}.json`);
}

function readCache(outDir, date) {
  const file = cachePath(outDir, date);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    warn(`缓存读取失败，将重新抓取：${error.message}`);
    return null;
  }
}

function writeCache(outDir, date, payload) {
  const file = cachePath(outDir, date);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

// ---------- CLI ----------

function parseArgs(argv) {
  const options = { date: "", refresh: false, force: false, dryRun: false, noBoard: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") {
      options.date = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--refresh") options.refresh = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-board") options.noBoard = true;
    else if (arg !== "") warn(`忽略未知参数：${arg}`);
  }
  if (options.date && !/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`--date 格式应为 YYYY-MM-DD，收到：${options.date}`);
  }
  return options;
}

// ---------- 主流程 ----------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const date = options.date || shanghaiDate();
  const outDir = process.env.DIGEST_OUT_DIR || "/workspace/projects/daily-topics";
  const generatedAt = shanghaiTimestamp();
  log(`日期 ${date}，输出目录 ${outDir}`);

  let materials;
  let result;
  let stats;

  const cached = options.refresh ? null : readCache(outDir, date);
  if (cached && Array.isArray(cached.materials) && cached.llmResult) {
    materials = cached.materials;
    result = cached.llmResult;
    stats = cached.stats || { counts: {}, failed: [] };
    log("命中当日缓存，跳过抓取与 LLM");
  } else {
    if (!process.env.OPENCODE_API_KEY) {
      log("错误：未设置 OPENCODE_API_KEY。请先 export OPENCODE_API_KEY=<你的密钥> 再运行（密钥不要提交）。");
      process.exitCode = 1;
      return;
    }
    stats = { counts: {}, failed: [] };
    log("开始抓取素材……");
    materials = await gatherMaterials(stats);
    log(`归一化后候选素材 ${materials.length} 条`);
    if (!materials.length) {
      warn("没有抓取到任何素材，仍会写出空结果");
    }
    log("调用 pi 进行筛选与摘要……");
    const rawResult = await runLlm(materials);
    result = validateResult(rawResult, materials);
    if (result.items.length < 6) warn(`有效干货仅 ${result.items.length} 条（少于 6）`);
    if (result.topics.length < 3) warn(`有效选题仅 ${result.topics.length} 个（少于 3）`);
    log(`校验后：干货 ${result.items.length} 条，选题 ${result.topics.length} 个`);
    if (!options.dryRun) writeCache(outDir, date, { materials, llmResult: result, stats, generatedAt });
  }

  const markdown = buildMarkdown(date, materials, result, stats, generatedAt);
  if (options.dryRun) {
    process.stdout.write(markdown);
    process.stdout.write(`\n[dry-run] 干货 ${result.items.length} 条，选题 ${result.topics.length} 个（未写文件、未写库）\n`);
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const markdownFile = path.join(outDir, `${date}.md`);
  writeFileSync(markdownFile, markdown, "utf8");
  log(`已写出 ${markdownFile}`);

  let insertedIds = [];
  let boardFailed = false;
  if (!options.noBoard) {
    const dbPath = resolveD1Path();
    if (!dbPath) {
      warn("未找到本地 D1，跳过选题板写入");
      boardFailed = true;
    } else {
      try {
        const byId = new Map(materials.map((m) => [m.id, m]));
        const boardTopics = result.topics
          .map((topic) => ({ ...topic, notes: buildTopicNotes(topic, byId) }))
          .filter((topic) => topic.title);
        const outcome = insertTopics(dbPath, boardTopics, date, options.force);
        if (outcome.skipped) log(`选题板已存在 daily-ai-digest:${date} 的写入，使用 --force 可强制写入`);
        else insertedIds = outcome.inserted;
        log(`选题板写入完成，新增 ${insertedIds.length} 条`);
      } catch (error) {
        boardFailed = true;
        warn(`选题板写入失败（markdown 已保留）：${error.message}`);
      }
    }
  }

  process.stdout.write(`文件：${markdownFile}\n`);
  process.stdout.write(`干货：${result.items.length} 条｜选题：${result.topics.length} 个\n`);
  process.stdout.write(`选题板新增：${insertedIds.length ? insertedIds.join(", ") : "无"}\n`);
  if (boardFailed) process.exitCode = 2;
}

main().catch((error) => {
  log(`运行失败：${error.stack || error.message}`);
  process.exitCode = 1;
});
