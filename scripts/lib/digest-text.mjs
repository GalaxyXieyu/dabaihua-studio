/**
 * digest-text.mjs — 每日摘要脚本的纯文本工具。
 *
 * 这里只放不依赖网络、不依赖 DOM 的纯函数，便于在单元测试里直接引用。
 */

export function decodeXml(input) {
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

export function stripHtml(input) {
  const withoutTags = String(input ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ");
  return decodeXml(withoutTags).replace(/\s+/g, " ").trim();
}

export function collapseWhitespace(input) {
  return String(input ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 把分块的字节流解码成 UTF-8 文本。
 *
 * 用流式 TextDecoder（内部等价于 StringDecoder），保证跨 chunk 被切断的
 * 多字节字符（如 3 字节的 CJK）也能正确拼接，而不是变成 U+FFFD。
 */
export function decodeUtf8Chunks(chunks) {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  for (const chunk of chunks || []) {
    if (chunk == null) continue;
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

export function truncate(text, max = 300) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function normalizeUrl(raw) {
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
