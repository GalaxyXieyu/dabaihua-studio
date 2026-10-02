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
  | { type: "table"; index: number; header: string[]; align: ("left" | "center" | "right" | null)[]; rows: string[][] }
  | { type: "hr" };

const HEADING = /^(#{1,4})\s+(.*)$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const BLOCKQUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```(\w*)\s*$/;
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;

/** 按未转义的 `|` 切分表格行；`\|` 是字面量管道符。 */
function splitTableRow(line: string): string[] {
  let source = String(line ?? "").trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) source = source.slice(0, -1);
  const cells: string[] = [];
  let buffer = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === "|") {
      buffer += "|";
      index += 1;
      continue;
    }
    if (character === "|") {
      cells.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += character;
  }
  cells.push(buffer.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell));
}

function tableAlign(cell: string): "left" | "center" | "right" | null {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return null;
}

function isTableStart(lines: string[], line: number): boolean {
  return line + 1 < lines.length && lines[line].includes("|") && isTableSeparator(lines[line + 1]);
}

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

    if (isTableStart(lines, line)) {
      const header = splitTableRow(raw);
      const align = splitTableRow(lines[line + 1]).map(tableAlign);
      line += 2;
      const rows: string[][] = [];
      while (line < lines.length && lines[line].trim() && lines[line].includes("|")) {
        const cells = splitTableRow(lines[line]).slice(0, header.length);
        while (cells.length < header.length) cells.push("");
        rows.push(cells);
        line += 1;
      }
      blocks.push({ type: "table", index: index(), header, align, rows });
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
    while (line < lines.length && lines[line].trim() && !FENCE.test(lines[line]) && !HR.test(lines[line]) && !HEADING.test(lines[line]) && !UNORDERED.test(lines[line]) && !ORDERED.test(lines[line]) && !BLOCKQUOTE.test(lines[line]) && !isTableStart(lines, line)) {
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
    case "table":
      return [...block.header, ...block.rows.flat()].join(" ");
    default:
      return "";
  }
}
