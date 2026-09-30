/**
 * topic-materials.mjs — 解析 digest 产物为「选题素材」的纯函数。
 *
 * 只做文本/对象到素材条目的转换，不读文件、不发网络请求，便于单元测试。
 */

import { UNREADABLE_SUMMARY, FAILED_SUMMARY } from "./digest-summary.mjs";

const HEADING_RE = /^###\s+\d+[.、]\s*(.+?)\s*$/;
const REFERENCE_RE = /^\s*-\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/;
const ORIGINAL_RE = /^-\s*原文：\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/;
const ORIGIN_RE = /^-\s*来源：\s*(.+?)\s*·\s*(.+?)\s*$/;
const TAG_RE = /^-\s*标签：\s*(.+?)\s*$/;

function normalizeLines(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
}

function isPlaceholderSummary(text) {
  const value = String(text ?? "").trim();
  if (!value) return true;
  if (value === UNREADABLE_SUMMARY || value === FAILED_SUMMARY) return true;
  return value.includes("未能读取") || value.includes("摘要生成失败");
}

function sectionRange(lines, title) {
  const startPattern = new RegExp(`^##\\s*${title}\\s*$`);
  const start = lines.findIndex((line) => startPattern.test(line.trim()));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start: start + 1, end };
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function firstSentence(summary) {
  const text = String(summary ?? "").trim();
  if (!text) return "";
  const stop = text.indexOf("。");
  const sentence = stop >= 0 ? text.slice(0, stop + 1) : text;
  return sentence.slice(0, 60);
}

/** 解析「## 今日干货」小节，返回 { items, references }。 */
export function parseDigestMarkdown(text) {
  const lines = normalizeLines(text);
  const items = [];
  const references = [];
  const range = sectionRange(lines, "今日干货");

  if (range) {
    let index = range.start;
    let current = null;
    while (index < range.end) {
      const rawLine = lines[index];
      const line = rawLine.trim();
      const heading = line.match(HEADING_RE);
      if (heading) {
        if (current) items.push(current);
        current = { title: heading[1], url: "", origin: "", publishedAt: "", tag: "", summary: "" };
        index += 1;
        // 跳过标题与摘要之间的空行，再取第一段作为摘要。
        while (index < range.end && !lines[index].trim()) index += 1;
        const summaryLines = [];
        while (index < range.end) {
          const candidate = lines[index];
          const trimmed = candidate.trim();
          if (!trimmed || /^-\s+/.test(trimmed)) break;
          summaryLines.push(trimmed);
          index += 1;
        }
        const summary = summaryLines.join(" ").trim();
        if (!isPlaceholderSummary(summary)) current.summary = summary;
        continue;
      }
      if (current) {
        const original = line.match(ORIGINAL_RE);
        if (original && !current.url) {
          current.url = original[2];
          current.originalTitle = original[1];
          index += 1;
          continue;
        }
        const reference = line.match(REFERENCE_RE);
        if (reference && !current.url) {
          current.url = reference[2];
          current.originalTitle = reference[1];
          index += 1;
          continue;
        }
        const origin = line.match(ORIGIN_RE);
        if (origin) {
          current.origin = origin[1];
          current.publishedAt = origin[2];
          index += 1;
          continue;
        }
        const tag = line.match(TAG_RE);
        if (tag) {
          current.tag = tag[1];
          index += 1;
          continue;
        }
      }
      index += 1;
    }
    if (current) items.push(current);
  }

  const refRange = sectionRange(lines, "推荐选题");
  if (refRange) {
    for (let index = refRange.start; index < refRange.end; index += 1) {
      const reference = lines[index].match(REFERENCE_RE);
      if (reference) references.push({ title: reference[1], url: reference[2] });
    }
  }

  return { items, references };
}

/** 从 `<date>-topics.json` 收集带 url 的素材，沿用简报导入规则。 */
export function materialsFromTopicsJson(topicsJson) {
  const topics = Array.isArray(topicsJson?.topics) ? topicsJson.topics : [];
  const results = [];
  const seen = new Set();
  for (const topic of topics) {
    const materials = Array.isArray(topic?.materials) ? topic.materials : [];
    for (const material of materials) {
      const url = String(material?.url ?? "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const summary = String(material?.summary ?? "").trim();
      results.push({
        url,
        title: String(material?.title ?? "").trim() || firstSentence(summary),
        origin: domainOf(url),
        summary,
      });
    }
  }
  return results;
}

/** 剥掉 .cache/bodies 文件头两行（URL: / FETCHED:）与随后的空行。 */
export function stripBodyHeader(text) {
  const value = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = value.split("\n");
  if (!/^URL:/.test(lines[0] || "")) return value.trim();
  let index = 1;
  if (/^FETCHED:/.test(lines[index] || "")) index += 1;
  if (lines[index] === "") index += 1;
  return lines.slice(index).join("\n").trim();
}

/** 规范化 URL：去掉 hash 与尾部斜杠（与 digest-text.normalizeUrl 一致）。 */
export function normalizeMaterialUrl(raw) {
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
