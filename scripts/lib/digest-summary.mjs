/**
 * digest-summary.mjs — 摘要清洗、数字校验、正文可读性判断与 markdown 渲染。
 *
 * 全部为纯函数（不联网、不读写文件），可在 node --test 下直接验证。
 */

import { collapseWhitespace } from "./digest-text.mjs";

export const UNREADABLE_SUMMARY = "未能读取原文";
export const FAILED_SUMMARY = "摘要生成失败";

export const MEANINGFUL_MIN_CHARS = 300;
export const SUMMARY_MIN_CHARS = 20;
export const SUMMARY_MAX_CHARS = 420;
export const SUMMARY_TARGET_MIN_CHARS = 120;
export const SUMMARY_TARGET_MAX_CHARS = 300;

const BLOCK_MARKERS = [
  "Enable JavaScript and cookies to continue",
  "Just a moment...",
  "Access Denied",
  "Attention Required",
];

// ---------- 摘要清洗 ----------

export function cleanSummary(raw) {
  let text = String(raw ?? "");
  // 去掉模型可能附带的代码块围栏
  text = text.replace(/```[a-zA-Z0-9_-]*\n?/g, " ").replace(/```/g, " ");
  // 去掉开头的标签
  text = text.replace(/^\s*(摘要|总结|概述|概要|Summary|Abstract)\s*[:：]\s*/i, "");
  // 去掉任何 URL
  text = text.replace(/https?:\/\/[^\s，。！？、；：）)】\]"'<>]+/gi, " ");
  text = text.replace(/www\.[^\s，。！？、；：）)】\]"'<>]+/gi, " ");
  text = collapseWhitespace(text);
  // 折叠后再次尝试去掉残留标签
  text = text.replace(/^(摘要|总结|概述|概要|Summary|Abstract)\s*[:：]\s*/i, "");
  return text.trim();
}

export function hasCjk(text) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(text ?? ""));
}

export function isValidSummaryShape(text) {
  const value = String(text ?? "");
  return value.length >= SUMMARY_MIN_CHARS && value.length <= SUMMARY_MAX_CHARS && hasCjk(value);
}

/**
 * 校验摘要，返回结构化结果，便于重试提示与日志给出具体原因。
 * 失败原因：too_short / too_long（附 length）/ no_cjk / numbers（附 offending）。
 */
export function validateSummary(summary, sourceText = "", title = "", date = "") {
  const value = String(summary ?? "");
  if (value.length < SUMMARY_MIN_CHARS) return { ok: false, reason: "too_short" };
  if (value.length > SUMMARY_MAX_CHARS) return { ok: false, reason: "too_long", length: value.length };
  if (!hasCjk(value)) return { ok: false, reason: "no_cjk" };
  const offending = checkSummaryNumbers(value, sourceText, title, date);
  if (offending.length) return { ok: false, reason: "numbers", offending };
  return { ok: true };
}

/** 给重试提示用的具体原因（自然中文，可直接拼进 prompt）。 */
export function summaryRetryHint(result) {
  if (!result || result.ok) return "";
  switch (result.reason) {
    case "too_long":
      return `上次输出 ${result.length} 字，超过 ${SUMMARY_MAX_CHARS} 字上限，请压缩到 ${SUMMARY_TARGET_MAX_CHARS} 字以内。`;
    case "too_short":
      return `上次输出不足 ${SUMMARY_MIN_CHARS} 字，请补充到 ${SUMMARY_TARGET_MIN_CHARS}-${SUMMARY_TARGET_MAX_CHARS} 字。`;
    case "no_cjk":
      return "上次输出几乎没有中文，请只用自然的中文写作（产品名/专有名词除外）。";
    case "numbers":
      return `这些数字在正文中找不到：${result.offending.join("、")}，请删除或改正。`;
    default:
      return "上次输出不合格，请严格按上面的要求重写。";
  }
}

/** 给 WARN 日志用的简短原因（不含摘要正文）。 */
export function describeSummaryValidation(result) {
  if (!result || result.ok) return "ok";
  if (result.reason === "too_long") return `too_long（${result.length} 字）`;
  if (result.reason === "numbers") return `numbers（${result.offending.join("、")}）`;
  return result.reason;
}

// ---------- 数字校验 ----------

export function normalizeNumberText(text) {
  let out = String(text ?? "");
  let previous;
  do {
    previous = out;
    out = out.replace(/(\d),(\d)/g, "$1$2");
  } while (out !== previous);
  return out;
}

export function extractNumbers(text) {
  // 把连续的点分数字（如版本号 0.24.0）当作一个 token，避免拆成 "0.24" 和 "0"。
  const matches = normalizeNumberText(text).match(/\d+(?:\.\d+)*/g);
  return matches || [];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 判断数字 N 是否作为独立数字出现在正文里。
 * 边界规则：N 前不能是数字或 "."，后不能是数字或 ".数字"。
 * 这样 "4" 不会命中 "414"，"99" 不会命中 "99.5"，但可以命中 "99%"。
 * sourceText 需已通过 normalizeNumberText 去除千分位逗号。
 */
export function numberInSource(number, sourceText) {
  const pattern = new RegExp(`(?<![\\d.])${escapeRegExp(number)}(?![\\d]|\\.\\d)`);
  return pattern.test(String(sourceText ?? ""));
}

// 英文月份名/缩写 -> 月份数字；供「正文用英文日期、摘要写成中文日期」时放宽校验。
const MONTH_NUMBERS = {
  january: "1", jan: "1",
  february: "2", feb: "2",
  march: "3", mar: "3",
  april: "4", apr: "4",
  may: "5",
  june: "6", jun: "6",
  july: "7", jul: "7",
  august: "8", aug: "8",
  september: "9", sep: "9", sept: "9",
  october: "10", oct: "10",
  november: "11", nov: "11",
  december: "12", dec: "12",
};

/** material.date（YYYY-MM-DD）派生出的允许数字：2026、09、9、24 等（含去零形式）。 */
export function dateNumberTokens(date) {
  const value = String(date ?? "");
  const match = value.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  const tokens = new Set();
  if (match) {
    for (const part of [match[1], match[2], match[3]]) {
      tokens.add(part);
      tokens.add(String(Number(part)));
    }
  } else {
    for (const part of value.match(/\d+/g) || []) tokens.add(String(Number(part)));
  }
  return tokens;
}

/** 正文/标题里出现英文月份名时，允许其对应的月份数字（1-12）。 */
export function monthNumberTokens(text) {
  const haystack = String(text ?? "").toLowerCase();
  const tokens = new Set();
  for (const [name, number] of Object.entries(MONTH_NUMBERS)) {
    if (new RegExp(`\\b${name}\\b`).test(haystack)) tokens.add(number);
  }
  return tokens;
}

/**
 * 返回摘要里出现、但正文与标题里都找不到的数字（已忽略千分位逗号）。
 * 数字按边界匹配，避免 "4" 因 "414" 存在而误判为命中。
 * 额外放行由日期派生的数字（material.date 的年月日、正文里的英文月份名）。
 * 返回空数组代表通过。
 */
export function checkSummaryNumbers(summary, sourceText, title = "", date = "") {
  const source = normalizeNumberText(`${sourceText ?? ""}\n${title ?? ""}`);
  const allowed = new Set([...dateNumberTokens(date), ...monthNumberTokens(source)]);
  const offending = [];
  for (const number of extractNumbers(summary)) {
    if (allowed.has(number)) continue;
    if (!numberInSource(number, source) && !offending.includes(number)) offending.push(number);
  }
  return offending;
}

// ---------- 可读性判断 ----------

export function isTooThin(text, min = MEANINGFUL_MIN_CHARS) {
  return collapseWhitespace(text).length < min;
}

export function isBlockPage(text, maxChars = 2_000) {
  const value = String(text ?? "");
  const lower = value.toLowerCase();
  const hit = BLOCK_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
  if (!hit) return false;
  return collapseWhitespace(value).length < maxChars;
}

// ---------- 来源解析 ----------

export function parseGithubRepoUrl(raw) {
  const value = String(raw ?? "").trim();
  const match = value.match(/^https?:\/\/github\.com\/([^/\s?#]+)\/([^/\s?#]+)\/?$/i);
  if (!match) return null;
  const repo = match[2].replace(/\.git$/i, "");
  if (!repo) return null;
  return { owner: match[1], repo };
}

export function extractHnId(text) {
  const match = String(text ?? "").match(/news\.ycombinator\.com\/item\?id=(\d+)/i);
  return match ? match[1] : null;
}

export function isHnItemUrl(raw) {
  return Boolean(extractHnId(raw));
}

// ---------- markdown 渲染 ----------

/**
 * 单条干货：摘要在前、链接在后。
 * body 由调用方根据 status 决定（摘要原文 / 未能读取原文 / 摘要生成失败）。
 */
export function renderItemMarkdown({ index, title, body, material, tag }) {
  const lines = [`### ${index}. ${title}`, "", String(body ?? ""), ""];
  lines.push(`- 原文：[${material.title}](${material.url})`);
  if (material.source === "Hacker News") {
    const hnId = extractHnId(material.summary) || extractHnId(material.url);
    if (hnId) lines.push(`- HN 讨论：https://news.ycombinator.com/item?id=${hnId}`);
  }
  lines.push(`- 来源：${material.source} · ${material.date || "无日期"}`);
  lines.push(`- 标签：${tag || "未分类"}`);
  return lines.join("\n");
}
