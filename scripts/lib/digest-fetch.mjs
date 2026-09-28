/**
 * digest-fetch.mjs — 正文抓取与可读文本抽取。
 *
 * 使用 @mozilla/readability + linkedom 抽取 readable text，抓取时限制并发、
 * 超时、体积与 content-type；GitHub 走 README 接口，Hacker News 附带讨论摘录。
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { collapseWhitespace, stripHtml, truncate } from "./digest-text.mjs";
import { extractHnId, isHnItemUrl, parseGithubRepoUrl } from "./digest-summary.mjs";

const API_UA = "dabaihua-daily-digest/1.0";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPTED_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown"];

export const FETCH_TIMEOUT_MS = 15_000;
export const BODY_MAX_BYTES = 2 * 1024 * 1024;
export const BODY_MAX_CHARS = 12_000;
export const FETCH_CONCURRENCY = 4;
export const SUMMARY_CONCURRENCY = 3;
export const HN_COMMENT_LIMIT = 5;
export const HN_CONTEXT_MAX_CHARS = 1_500;
export const GITHUB_README_NAMES = ["README.md", "readme.md", "README.MD", "README.rst", "README.txt", "README"];

export function sha1(text) {
  return createHash("sha1").update(String(text ?? ""), "utf8").digest("hex");
}

export async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function saveBodyAudit(bodiesDir, url, text) {
  mkdirSync(bodiesDir, { recursive: true });
  const file = path.join(bodiesDir, `${sha1(url)}.txt`);
  const content = `URL: ${url}\nFETCHED: ${new Date().toISOString()}\n\n${text}\n`;
  writeFileSync(file, content, "utf8");
  return file;
}

export async function readCapped(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("正文超过 2MB 上限");
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* 忽略取消失败 */ }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function stripHtmlFallback(html) {
  const source = String(html ?? "");
  for (const tag of ["article", "main", "body"]) {
    const match = source.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match && match[1].trim()) return stripHtml(match[1]);
  }
  return stripHtml(source);
}

/** Readability 抽取；失败时按 article/main/body 顺序退化到去标签文本。 */
export function extractReadable(html) {
  try {
    const { document } = parseHTML(String(html ?? ""));
    const article = new Readability(document).parse();
    if (article && article.textContent && article.textContent.trim()) return article.textContent;
  } catch {
    // 交给下面的兜底逻辑
  }
  return stripHtmlFallback(html);
}

/** 轻量去除 markdown 图片 / 徽章 / HTML 标签，保留正文文字。 */
export function stripMarkdownLite(markdown) {
  return String(markdown ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r\n?/g, "\n");
}

let activeFetches = 0;
const fetchQueue = [];

function acquireFetchSlot() {
  if (activeFetches < FETCH_CONCURRENCY) {
    activeFetches += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => fetchQueue.push(resolve));
}

function releaseFetchSlot() {
  const next = fetchQueue.shift();
  if (next) next();
  else activeFetches -= 1;
}

async function withFetchSlot(worker) {
  await acquireFetchSlot();
  try {
    return await worker();
  } finally {
    releaseFetchSlot();
  }
}

/** 抓取普通网页并抽取 readable text。 */
export async function fetchReadableText(url) {
  return withFetchSlot(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en,zh;q=0.9",
          Accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.1",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const baseType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (baseType && !ACCEPTED_TYPES.some((type) => baseType.includes(type))) {
        throw new Error(`不可读内容类型 ${baseType}`);
      }
      const raw = await readCapped(response, BODY_MAX_BYTES);
      if (baseType.includes("markdown") || baseType.includes("text/plain")) return raw;
      return extractReadable(raw);
    } finally {
      clearTimeout(timer);
    }
  });
}

async function fetchGithubReadmeViaApi(owner, repo) {
  const headers = { Accept: "application/vnd.github.raw", "User-Agent": API_UA };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return stripMarkdownLite(await response.text());
}

/** raw.githubusercontent.com 候选 URL（HEAD 分支，按 README 文件名依次尝试）。 */
export function githubReadmeRawUrls(owner, repo) {
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD`;
  return GITHUB_README_NAMES.map((name) => `${base}/${name}`);
}

async function fetchGithubReadmeViaRaw(owner, repo) {
  let lastError;
  for (const url of githubReadmeRawUrls(owner, repo)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": API_UA },
      });
      if (response.status !== 200) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      const text = await readCapped(response, BODY_MAX_BYTES);
      if (!text.trim()) {
        lastError = new Error("README 为空");
        continue;
      }
      return stripMarkdownLite(text);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("未找到 README");
}

/**
 * 先走 GitHub API（有 GITHUB_TOKEN 时带上），任何失败（403/404/429/网络）
 * 都回退到 raw.githubusercontent.com，避免无认证 API 限流导致 403。
 */
export async function fetchGithubReadme(owner, repo) {
  return withFetchSlot(async () => {
    try {
      return await fetchGithubReadmeViaApi(owner, repo);
    } catch {
      return await fetchGithubReadmeViaRaw(owner, repo);
    }
  });
}

/** 抓取 HN 线程：story 文本 + 至多 5 条顶层评论（合计 ≤1500 字）。 */
export async function fetchHnThread(id) {
  return withFetchSlot(async () => {
    const response = await fetch(`https://hn.algolia.com/api/v1/items/${id}`, {
      headers: { "User-Agent": API_UA, Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const storyText = stripHtml(data.text || data.story_text || "");
    const parts = [];
    let total = 0;
    for (const child of (data.children || []).slice(0, HN_COMMENT_LIMIT)) {
      const text = stripHtml(child.text || "");
      if (!text) continue;
      const line = truncate(text, 400);
      if (total + line.length > HN_CONTEXT_MAX_CHARS) break;
      parts.push(`- ${line}`);
      total += line.length;
    }
    const discussionText = parts.length ? `HN 讨论摘录：\n${parts.join("\n")}` : "";
    return { storyText, discussionText };
  });
}

function finalizeBody(text) {
  return collapseWhitespace(text).slice(0, BODY_MAX_CHARS);
}

/**
 * 根据 material 抓取正文文本（已折叠空白、截断到 12000 字）。
 * 抓取失败会抛错，调用方按 unreadable 处理。
 */
export async function fetchMaterialBody(material) {
  const repo = parseGithubRepoUrl(material.url);
  if (repo) {
    return finalizeBody(await fetchGithubReadme(repo.owner, repo.repo));
  }

  const hnId = material.source === "Hacker News"
    ? extractHnId(material.summary) || extractHnId(material.url)
    : null;

  if (hnId) {
    const thread = await fetchHnThread(hnId);
    const askLike = isHnItemUrl(material.url) || !/^https?:/i.test(String(material.url || ""));
    let main = "";
    if (!askLike) {
      try {
        main = await fetchReadableText(material.url);
      } catch {
        main = "";
      }
    }
    if (!main) main = thread.storyText;
    const parts = [main, thread.discussionText].filter(Boolean);
    return finalizeBody(parts.join("\n\n"));
  }

  return finalizeBody(await fetchReadableText(material.url));
}
