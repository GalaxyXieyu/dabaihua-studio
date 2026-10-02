/**
 * gzh-markdown.ts — 把 markdown 渲染成公众号风格的红白主题 HTML 片段
 *
 * 当文章没有 article.html（公众号成稿排版）时，用这里作为兜底渲染。
 * 输出只包含内联样式，不使用 class/id，可直接贴进公众号编辑器。
 * 依赖 lib/review-markdown.ts 的 parseMarkdownBlocks / parseInline 解析。
 */

import { parseInline, parseMarkdownBlocks, type InlineToken } from "./review-markdown.ts";

/**
 * pageTitle：页面已经在头部显示了标题时传入；正文第一个标题如果是 `# H1` 且与它相同
 * （忽略首尾空白、连续空白和 ** ` 等行内标记），正文里就不再重复渲染这个 H1。
 */
export type GzhOptions = { assetBase?: string; pageTitle?: string | null };

export function normalizeTitleText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const BODY_COLOR = "#333";
const TITLE_COLOR = "#1C1917";
const RED = "#DC2626";
const DEEP_RED = "#991B1B";

function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeBase(value: string | undefined) {
  const base = String(value ?? "").trim();
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(String(value ?? "").trim());
}

function resolveImageSrc(src: string, assetBase: string) {
  const value = String(src ?? "").trim();
  if (isHttpUrl(value)) return value;
  if (assetBase) {
    const matched = /^(?:\.\/)?(images\/[^"'\s>]+)$/.exec(value);
    if (matched) return `${assetBase}/${matched[1]}`;
  }
  return null;
}

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

function renderImage(alt: string, src: string, assetBase: string) {
  const resolved = resolveImageSrc(src, assetBase);
  if (!resolved) return escapeHtml(alt);
  return `<section style="margin:0 0 20px;text-align:center;"><img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;display:block;margin:0 auto;border-radius:8px;"></section>`;
}

function inlineTokenHtml(token: InlineToken): string {
  switch (token.type) {
    case "bold":
      return `<strong><span leaf="">${escapeHtml(token.value)}</span></strong>`;
    case "italic":
      return `<em><span leaf="">${escapeHtml(token.value)}</span></em>`;
    case "code":
      return `<code style="background:#F3F4F6;color:#1F2937;padding:2px 6px;border-radius:4px;font-size:14px;font-weight:600;"><span leaf="">${escapeHtml(token.value)}</span></code>`;
    case "link":
      if (isHttpUrl(token.href)) {
        return `<a href="${escapeHtml(token.href)}" target="_blank" rel="noopener noreferrer" style="color:${RED};text-decoration:none;border-bottom:1px solid #FECACA;"><span leaf="">${escapeHtml(token.value)}</span></a>`;
      }
      if (token.href.startsWith("/") && !token.href.startsWith("//")) {
        return `<a href="${escapeHtml(token.href)}" style="color:${RED};text-decoration:none;border-bottom:1px solid #FECACA;"><span leaf="">${escapeHtml(token.value)}</span></a>`;
      }
      return escapeHtml(token.value);
    default:
      return escapeHtml(token.value);
  }
}

function renderInline(text: string, assetBase: string): string {
  const source = String(text ?? "");
  const output: string[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  IMAGE_MARKDOWN.lastIndex = 0;
  while ((match = IMAGE_MARKDOWN.exec(source))) {
    if (match.index > last) output.push(escapeInline(source.slice(last, match.index)));
    output.push(renderImage(match[1], match[2], assetBase));
    last = match.index + match[0].length;
  }
  if (last < source.length) output.push(escapeInline(source.slice(last)));
  return output.join("");
}

function escapeInline(text: string) {
  return parseInline(text).map((token) => inlineTokenHtml(token)).join("");
}

function isImageOnly(text: string) {
  IMAGE_MARKDOWN.lastIndex = 0;
  const match = IMAGE_MARKDOWN.exec(String(text ?? "").trim());
  return Boolean(match && match[0].length === String(text ?? "").trim().length);
}

function renderParagraph(text: string, assetBase: string) {
  const trimmed = String(text ?? "").trim();
  if (isImageOnly(trimmed)) {
    IMAGE_MARKDOWN.lastIndex = 0;
    const match = IMAGE_MARKDOWN.exec(trimmed)!;
    return renderImage(match[1], match[2], assetBase);
  }
  return `<p style="margin-bottom:20px;font-size:16px;line-height:1.8;text-align:justify;color:${BODY_COLOR};"><span leaf="">${renderInline(trimmed, assetBase)}</span></p>`;
}

function renderTitle(text: string) {
  return `<section data-gzh-title="" style="margin:0 0 32px;padding:24px 20px 20px;border-bottom:3px solid ${RED};background:#FFFFFF;"><p style="margin:0;font-size:24px;font-weight:900;color:${TITLE_COLOR};line-height:1.35;letter-spacing:-0.5px;"><span leaf="">${escapeHtml(text)}</span></p></section>`;
}

function renderChapter(text: string) {
  return `<section style="margin-top:28px;margin-bottom:28px;padding:0 10px;"><section style="padding-bottom:14px;border-bottom:3px solid ${RED};"><h2 style="font-size:18px;font-weight:800;color:${TITLE_COLOR};margin:0;letter-spacing:0.5px;line-height:1.5;text-align:center;"><span leaf="">${escapeHtml(text)}</span></h2></section></section>`;
}

function renderSubheading(text: string, level: number) {
  const size = level >= 4 ? 14 : 15;
  return `<p style="font-size:${size}px;font-weight:800;color:${TITLE_COLOR};margin:28px 0 14px;padding-left:10px;border-left:3px solid ${RED};line-height:1.4;"><span leaf="">${escapeHtml(text)}</span></p>`;
}

function renderList(items: string[], ordered: boolean, assetBase: string) {
  const tag = ordered ? "ol" : "ul";
  const style = ordered ? "list-style:decimal;" : "list-style:disc;";
  const body = items.map((item) => `<li style="margin-bottom:8px;"><span leaf="">${renderInline(item, assetBase)}</span></li>`).join("");
  return `<section style="margin:0 0 20px;padding:0 10px;"><${tag} style="margin:0;padding-left:22px;font-size:16px;line-height:1.8;color:${BODY_COLOR};${style}">${body}</${tag}></section>`;
}

const CALLOUT_LABELS: Record<string, string> = {
  note: "注",
  info: "说明",
  tip: "提示",
  warning: "注意",
  caution: "注意",
  important: "重点",
  quote: "引用",
};

function parseCallout(text: string): { type: string; title: string; body: string } | null {
  const lines = String(text ?? "").split("\n");
  const match = /^\[!([A-Za-z][A-Za-z-]*)\][+-]?(?:\s+(.*))?$/.exec((lines[0] || "").trim());
  if (!match) return null;
  return { type: match[1].toLowerCase(), title: (match[2] || "").trim(), body: lines.slice(1).join("\n").trim() };
}

function renderCallout(type: string, title: string, body: string, assetBase: string) {
  const label = title || CALLOUT_LABELS[type] || type;
  const bodyHtml = body
    ? `<p style="margin:0;font-size:15px;color:#333;font-weight:400;line-height:1.8;"><span leaf="">${renderInline(body, assetBase)}</span></p>`
    : "";
  return `<section style="background:#F7F3EA;border-left:3px solid #1C1917;padding:14px 18px;margin:0 0 24px;"><p style="margin:0${body ? " 8px" : ""};font-size:13px;font-weight:700;color:#57534E;letter-spacing:1px;line-height:1.4;"><span leaf="">${escapeHtml(label)}</span></p>${bodyHtml}</section>`;
}

function renderBlockquote(text: string, assetBase: string) {
  const callout = parseCallout(text);
  if (callout) return renderCallout(callout.type, callout.title, callout.body, assetBase);
  return `<section style="background:#FEF2F2;border-radius:0 10px 10px 0;border-left:4px solid ${RED};padding:18px 22px;margin-bottom:24px;"><p style="font-size:16px;font-weight:700;color:${DEEP_RED};margin:0;line-height:1.8;"><span leaf="">${renderInline(text, assetBase)}</span></p></section>`;
}

function renderTable(block: { header: string[]; align: ("left" | "center" | "right" | null)[]; rows: string[][] }, assetBase: string) {
  const alignStyle = (align: "left" | "center" | "right" | null) => (align ? `text-align:${align};` : "");
  const header = block.header
    .map(
      (cell, index) =>
        `<th style="${alignStyle(block.align[index])}font-family:Georgia,'Songti SC','Noto Serif SC',serif;font-weight:700;color:#1C1917;background:#F7F3EA;border-bottom:2px solid #1C1917;padding:8px 10px;"><span leaf="">${renderInline(cell, assetBase)}</span></th>`,
    )
    .join("");
  const rows = block.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, index) =>
              `<td style="${alignStyle(block.align[index])}border-bottom:1px solid #E7E0D2;padding:8px 10px;vertical-align:top;"><span leaf="">${renderInline(cell, assetBase)}</span></td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  return `<section style="margin:0 0 24px;overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;color:#333;"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></section>`;
}

function renderCode(text: string) {
  return `<section style="margin:0 0 20px;background:#F3F4F6;border-radius:10px;padding:16px 18px;overflow-x:auto;"><p style="margin:0;font-size:13px;line-height:1.7;color:#1F2937;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;"><span leaf="">${escapeHtml(text)}</span></p></section>`;
}

function renderDivider() {
  return `<section style="padding:0 10px;"><section style="height:1px;background:#E7E0D2;margin:0;"><span leaf=""><br></span></section></section>`;
}

export function renderMarkdownAsGzhHtml(markdown: string, options: GzhOptions = {}): string {
  const assetBase = normalizeBase(options.assetBase);
  const blocks = parseMarkdownBlocks(String(markdown ?? ""));
  const body: string[] = [];
  let titleUsed = false;
  const pageTitle = normalizeTitleText(options.pageTitle);
  const firstHeading = blocks.find((block) => block.type === "heading");
  const skipBlock =
    pageTitle && firstHeading && firstHeading.type === "heading" && firstHeading.level === 1 &&
    normalizeTitleText(firstHeading.text) === pageTitle
      ? firstHeading
      : null;

  for (const block of blocks) {
    if (block === skipBlock) {
      titleUsed = true;
      continue;
    }
    switch (block.type) {
      case "heading":
        if (block.level === 1 && !titleUsed) {
          titleUsed = true;
          body.push(renderTitle(block.text));
        } else if (block.level <= 2) {
          body.push(renderChapter(block.text));
        } else {
          body.push(renderSubheading(block.text, block.level));
        }
        break;
      case "paragraph":
        body.push(renderParagraph(block.text, assetBase));
        break;
      case "list":
        body.push(renderList(block.items, block.ordered, assetBase));
        break;
      case "blockquote":
        body.push(renderBlockquote(block.text, assetBase));
        break;
      case "code":
        body.push(renderCode(block.text));
        break;
      case "table":
        body.push(renderTable(block, assetBase));
        break;
      case "hr":
        body.push(renderDivider());
        break;
      default:
        break;
    }
  }

  const inner = body.join("\n  ");
  return `<section data-gzh-md="" style="max-width:677px;margin:0 auto;background:#ffffff;font-family:${FONT_STACK};color:${BODY_COLOR};line-height:1.8;letter-spacing:0.5px;overflow-x:hidden;">\n  ${inner}\n</section>`;
}

export default renderMarkdownAsGzhHtml;
