import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeSitesBrowser, sitesBrowserFetch } from "./sites-browser-fetch.mjs";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers = [], ...records] = rows;
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

export function readMarkdownDocument(markdown) {
  const frontmatter = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const metadata = {};
  if (frontmatter) {
    for (const line of frontmatter[1].split("\n")) {
      const match = line.match(/^([a-z_]+):\s*["']?([\s\S]*?)["']?\s*$/i);
      if (match) metadata[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  const contentMarkdown = markdown
    .slice(frontmatter?.[0].length || 0)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { metadata, contentMarkdown };
}

// 把微信发布时间归一化为 ISO 字符串。
// 优先用 markdown frontmatter 的 publish_time（来自文章页 HTML，真实发布时间），
// 缺失时回退到 index.csv 的 record.publish_time（来自列表 API update_time，可靠）。
// 输入形如 "2026-07-21 15:55:18"（上海时间）或 ISO，解析失败返回 undefined。
export function normalizePublishTime(value) {
  const clean = String(value || "").trim();
  if (!clean) return undefined;
  const shanghai = clean.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  const date = new Date(shanghai ? `${shanghai[1]}T${shanghai[2]}+08:00` : clean);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function localImageReferences(markdown) {
  return [...markdown.matchAll(/!\[([^\]]*)\]\(\.\.\/images\/([^)]+)\)/g)].map((match) => ({ full: match[0], alt: match[1], relativePath: match[2] }));
}

function keychain(service) {
  return execFileSync("security", ["find-generic-password", "-a", "rss-ai-sync", "-s", service, "-w"], { encoding: "utf8" }).trim();
}

function contentType(file, bytes) {
  // 微信 CDN 落盘的文件扩展名经常不可信，优先看魔数。
  if (bytes && bytes.length >= 12) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "image/avif";
  }
  const extension = path.extname(file).toLowerCase();
  return ({ ".avif": "image/avif", ".gif": "image/gif", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" })[extension] || "application/octet-stream";
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(values[index], index);
    }
  }));
  return results;
}

async function run() {
  const inputFlag = process.argv.indexOf("--input");
  const endpointFlag = process.argv.indexOf("--endpoint");
  const accountKeyFlag = process.argv.indexOf("--account-key");
  const accountNameFlag = process.argv.indexOf("--account-name");
  const requestIdFlag = process.argv.indexOf("--request-id");
  const input = inputFlag >= 0 ? process.argv[inputFlag + 1] : "";
  const endpoint = endpointFlag >= 0 ? process.argv[endpointFlag + 1] : "http://localhost:3001";
  let accountKey = accountKeyFlag >= 0 ? process.argv[accountKeyFlag + 1] : "";
  const requestId = requestIdFlag >= 0 ? Number(process.argv[requestIdFlag + 1]) || undefined : undefined;
  if (!input) throw new Error("用法：node scripts/backfill-wechat-markdown.mjs --input <公众号下载目录> [--endpoint http://localhost:3001]");

  const accountName = (accountNameFlag >= 0 ? process.argv[accountNameFlag + 1] : "")?.trim() || path.basename(path.resolve(input));
  const remote = !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/i.test(endpoint);
  const authHeaders = remote ? {
    "OAI-Sites-Authorization": `Bearer ${keychain("rss-ai-sites-bypass")}`,
    "x-import-token": keychain("rss-ai-import-token"),
  } : {};
  const request = async (url, options = {}) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return remote ? await sitesBrowserFetch(url, options) : await fetch(url, options);
      } catch (error) {
        // keep-alive 连接可能已被对端闲置断开，换新连接重试一次（上传均为幂等）
        if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 400)); continue; }
        const cause = error instanceof Error ? error.cause : undefined;
        const detail = cause ? String(cause.code || cause.name || cause.message || cause).trim() : "";
        throw new Error(`${error instanceof Error ? error.message : "网络请求失败"}${detail ? `（${detail}）` : ""} @ ${new URL(url).pathname}`);
      }
    }
  };
  if (!accountKey) {
    const dashboardResponse = await request(`${endpoint}/api/dashboard`, { headers: authHeaders });
    if (!dashboardResponse.ok) throw new Error(`读取情报台失败：${dashboardResponse.status}`);
    const dashboard = await dashboardResponse.json();
    const source = dashboard.sources.find((candidate) => candidate.kind === "wechat" && candidate.name === accountName);
    if (!source?.url?.startsWith("wechat://")) throw new Error(`情报台里找不到公众号“${accountName}”`);
    accountKey = source.url.slice("wechat://".length);
  }
  const accountHash = createHash("sha256").update(accountKey).digest("hex").slice(0, 16);

  const records = parseCsv(await readFile(path.join(input, "index.csv"), "utf8")).filter((record) => record.status === "success" && record.markdown_path);
  const articles = [];
  let uploaded = 0;
  const imageWarnings = [];
  for (const record of records) {
    const markdown = await readFile(path.join(input, record.markdown_path), "utf8");
    const parsed = readMarkdownDocument(markdown);
    const references = localImageReferences(parsed.contentMarkdown);
    const articleHash = createHash("sha256").update(record.source_url).digest("hex").slice(0, 16);
    // 单张图片失败只丢那张图，不拖垮整篇文章、更不拖垮整个账号；
    // wrangler 本地 R2 在并发写入时偶发 503，重试两次基本都能过。
    const replacements = await mapLimit(references, 3, async (reference) => {
      const file = path.join(input, "images", reference.relativePath);
      const key = `wechat/${accountHash}/${articleHash}/${path.basename(reference.relativePath)}`;
      const body = await readFile(file).catch(() => null);
      if (!body) return { ...reference, web: "" };
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await request(`${endpoint}/api/media?key=${encodeURIComponent(key)}`, {
            method: "POST",
            headers: { ...authHeaders, "content-type": contentType(file, body) },
            body,
          });
          if (response.ok) {
            const result = await response.json();
            if (result.stored) uploaded += 1;
            return { ...reference, web: `![${reference.alt}](/api/media?key=${encodeURIComponent(key)})` };
          }
          if (response.status < 500) {
            const result = await response.json().catch(() => ({}));
            imageWarnings.push(`${path.basename(file)}: ${result.error || response.status}`);
            return { ...reference, web: "" };
          }
        } catch {
          // 网络抖动走下面的退避重试
        }
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      }
      imageWarnings.push(`${path.basename(file)}: 重试后仍上传失败`);
      return { ...reference, web: "" };
    });
    let contentMarkdown = parsed.contentMarkdown;
    for (const replacement of replacements) contentMarkdown = contentMarkdown.replaceAll(replacement.full, replacement.web);
    if (contentMarkdown.length < 160) continue;
    articles.push({
      title: record.title,
      url: record.source_url,
      contentMarkdown,
      author: parsed.metadata.author || parsed.metadata.account || accountName,
      publishedAt: normalizePublishTime(parsed.metadata.publish_time || record.publish_time),
    });
  }

  let changed = 0;
  for (let index = 0; index < articles.length; index += 10) {
    const response = await request(`${endpoint}/api/items`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({ action: "import-wechat", accountKey, accountName, requestId, articles: articles.slice(index, index + 10) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `回填失败：${response.status}`);
    changed += Number(result.added || 0);
  }
  if (imageWarnings.length) console.error(`部分图片被跳过（${imageWarnings.length} 张）: ${imageWarnings.slice(0, 5).join("; ")}`);
  console.log(JSON.stringify({ account: accountName, articles: articles.length, images: uploaded, imageSkipped: imageWarnings.length, changed }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run()
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(closeSitesBrowser);
}
