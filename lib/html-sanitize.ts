/**
 * html-sanitize.ts — 公众号排版片段的保守清洗器
 *
 * 输入是「可信流水线」产出的公众号 HTML 片段（例如 article.html），
 * 这里不做完整的 HTML 解析，只按已知的公众号限制做保守的正则清洗：
 *   - 删除 script / style / iframe / object / embed / link / meta / base / form
 *   - 删除所有 on* 事件属性
 *   - 中和 javascript: / vbscript: / data: 的 href、src（data:image/* 仅在 src 放行）
 *   - 把相对图片 `images/x`、`./images/x` 重写到 assetBase
 *   - 给 http(s) 链接补 target="_blank" rel="noopener noreferrer"
 *
 * 纯函数，可单元测试。
 */

export type SanitizeOptions = { assetBase?: string };

const BLOCK_ELEMENTS = /<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const VOID_ELEMENTS = /<(?:link|meta|base)\b[^>]*>/gi;
const STRAY_BLOCK_TAGS = /<\/?(?:script|style|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const EVENT_ATTR = /\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_ATTR = /(\s)(href|src|xlink:href)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi;
const IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp)[;,]/i;
const UNSAFE_SCHEME = /^(?:javascript|vbscript|livescript|mocha):/i;
const RELATIVE_IMAGE = /^(?:\.\/)?(images\/[^"'\s>]+)$/;

function normalizeBase(value: string | undefined) {
  const base = String(value ?? "").trim();
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function unquote(raw: string) {
  const value = raw.trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function quoteAttr(value: string) {
  return `"${value.replace(/"/g, "&quot;")}"`;
}

/** 解码数字实体，用于识别 `java&#115;cript:` 这类伪装。返回值仅用于判定，不写回 HTML。 */
function decodeNumericEntities(value: string) {
  return value.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function compact(value: string) {
  return decodeNumericEntities(value).replace(/[\u0000-\u0020\u007f]/g, "").toLowerCase();
}

function isHttpUrl(value: string) {
  return /^(?:https?:)?\/\//i.test(value.trim());
}

/**
 * 返回允许保留的 URL；返回 null 表示属性必须删除。
 */
function sanitizeUrl(name: string, value: string, assetBase: string) {
  const trimmed = value.trim();
  const compacted = compact(trimmed);
  if (!compacted) return trimmed;
  if (UNSAFE_SCHEME.test(compacted)) return null;
  if (compacted.startsWith("data:")) {
    if (name === "src" && IMAGE_DATA.test(compacted)) return trimmed;
    return null;
  }
  if (name === "src" && assetBase) {
    const matched = RELATIVE_IMAGE.exec(trimmed);
    if (matched) return `${assetBase}/${matched[1]}`;
  }
  return trimmed;
}

function sanitizeAttributes(tagName: string, rawAttrs: string, assetBase: string) {
  let attrs = rawAttrs.replace(EVENT_ATTR, "");
  attrs = attrs.replace(URL_ATTR, (_full, lead: string, name: string, equals: string, raw: string) => {
    const checked = sanitizeUrl(name.toLowerCase(), unquote(raw), assetBase);
    if (checked === null) return "";
    return `${lead}${name}${equals}${quoteAttr(checked)}`;
  });
  if (tagName.toLowerCase() === "a") {
    const hrefMatch = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const href = hrefMatch ? hrefMatch[1] ?? hrefMatch[2] ?? "" : "";
    if (isHttpUrl(href)) {
      const trimmed = attrs.replace(/\s+$/, "");
      const extras: string[] = [];
      if (!/\starget\s*=/i.test(trimmed)) extras.push('target="_blank"');
      if (!/\srel\s*=/i.test(trimmed)) extras.push('rel="noopener noreferrer"');
      attrs = extras.length ? `${trimmed} ${extras.join(" ")}` : trimmed;
      return attrs;
    }
  }
  return attrs;
}

export function sanitizeArticleHtml(html: string, options: SanitizeOptions = {}): string {
  const assetBase = normalizeBase(options.assetBase);
  let output = String(html ?? "");

  // 危险元素整块删除；循环几次以覆盖嵌套情况。
  for (let pass = 0; pass < 3; pass += 1) output = output.replace(BLOCK_ELEMENTS, "");
  output = output.replace(VOID_ELEMENTS, "");
  output = output.replace(STRAY_BLOCK_TAGS, "");
  output = output.replace(HTML_COMMENT, "");

  output = output.replace(TAG, (full, tagName: string, attrs: string) => {
    const cleaned = sanitizeAttributes(tagName, attrs, assetBase);
    return `<${tagName}${cleaned}>`;
  });

  return output;
}

export default sanitizeArticleHtml;
