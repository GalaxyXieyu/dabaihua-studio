export type InlineToken =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type MarkdownBlock =
  | { type: "heading"; index: number; level: 1 | 2 | 3 | 4; text: string }
  | { type: "paragraph"; index: number; text: string }
  | { type: "list"; index: number; ordered: boolean; items: string[] }
  | { type: "blockquote"; index: number; text: string }
  | { type: "code"; index: number; text: string; language: string }
  | { type: "hr" };

const HEADING = /^(#{1,4})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const BLOCKQUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```(\w*)\s*$/;

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  const index = () => blocks.length;

  for (let line = 0; line < lines.length;) {
    const raw = lines[line];
    if (!raw.trim()) {
      line += 1;
      continue;
    }

    const fence = FENCE.exec(raw);
    if (fence) {
      const language = fence[1] || "";
      const body: string[] = [];
      line += 1;
      while (line < lines.length && !/^\s*```\s*$/.test(lines[line])) {
        body.push(lines[line]);
        line += 1;
      }
      if (line < lines.length) line += 1;
      blocks.push({ type: "code", index: index(), text: body.join("\n"), language });
      continue;
    }

    if (HR.test(raw)) {
      blocks.push({ type: "hr" });
      line += 1;
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      const level = Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ type: "heading", index: index(), level, text: heading[2].trim() });
      line += 1;
      continue;
    }

    if (UNORDERED.test(raw) || ORDERED.test(raw)) {
      const ordered = ORDERED.test(raw);
      const items: string[] = [];
      while (line < lines.length) {
        const match = (ordered ? ORDERED : UNORDERED).exec(lines[line]);
        if (!match) break;
        items.push(match[1].trim());
        line += 1;
      }
      blocks.push({ type: "list", index: index(), ordered, items });
      continue;
    }

    if (BLOCKQUOTE.test(raw)) {
      const quoted: string[] = [];
      while (line < lines.length) {
        const match = BLOCKQUOTE.exec(lines[line]);
        if (!match) break;
        quoted.push(match[1]);
        line += 1;
      }
      blocks.push({ type: "blockquote", index: index(), text: quoted.join("\n").trim() });
      continue;
    }

    const paragraph: string[] = [];
    while (line < lines.length && lines[line].trim() && !FENCE.test(lines[line]) && !HR.test(lines[line]) && !HEADING.test(lines[line]) && !UNORDERED.test(lines[line]) && !ORDERED.test(lines[line]) && !BLOCKQUOTE.test(lines[line])) {
      paragraph.push(lines[line].trim());
      line += 1;
    }
    blocks.push({ type: "paragraph", index: index(), text: paragraph.join("\n") });
  }

  return blocks;
}

function safeHref(href: string) {
  if (/^https?:\/\//i.test(href)) return href;
  if (href === "/" || (/^\/[^/]/.test(href) && !href.startsWith("//"))) return href;
  if (/^\.\.?\//.test(href) || href.startsWith("#")) return href;
  return null;
}

export function parseInline(text: string): InlineToken[] {
  const source = String(text ?? "");
  const tokens: InlineToken[] = [];
  let buffer = "";
  let cursor = 0;

  const flush = () => {
    if (buffer) {
      tokens.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (cursor < source.length) {
    const rest = source.slice(cursor);
    let match: RegExpExecArray | null;

    match = /^`([^`]+)`/.exec(rest);
    if (match) {
      flush();
      tokens.push({ type: "code", value: match[1] });
      cursor += match[0].length;
      continue;
    }

    match = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (match) {
      const href = safeHref(match[2]);
      flush();
      if (href) tokens.push({ type: "link", value: match[1], href });
      else tokens.push({ type: "text", value: match[0] });
      cursor += match[0].length;
      continue;
    }

    match = /^\*\*([^*]+)\*\*/.exec(rest);
    if (match) {
      flush();
      tokens.push({ type: "bold", value: match[1] });
      cursor += match[0].length;
      continue;
    }

    match = /^\*([^*\n]+)\*/.exec(rest);
    if (match) {
      flush();
      tokens.push({ type: "italic", value: match[1] });
      cursor += match[0].length;
      continue;
    }

    match = /^https?:\/\/[^\s)<>]+/.exec(rest);
    if (match) {
      flush();
      tokens.push({ type: "link", value: match[0], href: match[0] });
      cursor += match[0].length;
      continue;
    }

    buffer += source[cursor];
    cursor += 1;
  }

  flush();
  return tokens;
}

export function blockPlainText(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "blockquote":
    case "code":
      return block.text;
    case "list":
      return block.items.join(" ");
    default:
      return "";
  }
}
