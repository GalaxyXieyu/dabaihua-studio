import { Fragment, type ReactNode } from "react";

/**
 * Tiny, dependency-free markdown renderer for brief text. It never uses
 * `dangerouslySetInnerHTML`; everything becomes React nodes. Supported:
 * paragraphs/line breaks, `- ` and `1. ` lists (with two-space sub-lists),
 * `## ` headings, `**bold**`, `` `code` `` and [text](http url) / bare http
 * links. Anything else is rendered as plain text.
 */

type ListItem = { ordered: boolean; text: string; children: ListItem[] };

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; items: ListItem[] };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function parseListRun(lines: string[]): ListItem[] {
  const parsed = lines.map((line) => {
    const match = LIST_RE.exec(line);
    if (!match) return null;
    const indent = match[1].replace(/\t/g, "  ").length;
    return { indent, ordered: /\d/.test(match[2]), text: match[3].trim() };
  }).filter((item): item is { indent: number; ordered: boolean; text: string } => item !== null);
  if (parsed.length === 0) return [];
  const minIndent = Math.min(...parsed.map((item) => item.indent));
  const root: ListItem[] = [];
  const stack: Array<{ indent: number; items: ListItem[] }> = [{ indent: minIndent, items: root }];
  for (const item of parsed) {
    const top = stack[stack.length - 1];
    if (item.indent > top.indent) {
      const parent = top.items[top.items.length - 1];
      if (parent) stack.push({ indent: item.indent, items: parent.children });
    } else {
      while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) stack.pop();
    }
    stack[stack.length - 1].items.push({ ordered: item.ordered, text: item.text, children: [] });
  }
  return root;
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (LIST_RE.test(line)) {
      const run: string[] = [];
      while (index < lines.length && lines[index].trim() && LIST_RE.test(lines[index])) {
        run.push(lines[index]);
        index += 1;
      }
      const items = parseListRun(run);
      if (items.length > 0) blocks.push({ kind: "list", items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !HEADING_RE.test(lines[index]) && !LIST_RE.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

function renderList(items: ListItem[], keyPrefix: string): ReactNode {
  if (items.length === 0) return null;
  const Tag = items[0].ordered ? "ol" : "ul";
  return (
    <Tag className="db-md-list">
      {items.map((item, index) => (
        <li key={`${keyPrefix}-${index}`}>
          {renderInline(item.text, `${keyPrefix}-${index}`)}
          {item.children.length > 0 ? renderList(item.children, `${keyPrefix}-${index}c`) : null}
        </li>
      ))}
    </Tag>
  );
}

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"“”「」，。；、]+)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) nodes.push(<strong key={`${keyPrefix}-b-${key}`}>{match[1]}</strong>);
    else if (match[2] !== undefined) nodes.push(<code key={`${keyPrefix}-c-${key}`}>{match[2]}</code>);
    else if (match[3] !== undefined && match[4] !== undefined) {
      nodes.push(
        <a key={`${keyPrefix}-a-${key}`} href={match[4]} target="_blank" rel="noopener noreferrer">
          {match[3]}
        </a>,
      );
    } else if (match[5] !== undefined) {
      nodes.push(
        <a key={`${keyPrefix}-a-${key}`} href={match[5]} target="_blank" rel="noopener noreferrer">
          {match[5]}
        </a>,
      );
    }
    lastIndex = match.index + match[0].length;
    key += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function MiniMarkdown({ text }: { text: string }) {
  if (!text.trim()) return null;
  const blocks = parseBlocks(text);
  return (
    <div className="db-md">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Tag = block.level <= 2 ? "h3" : "h4";
          return (
            <Tag key={`h-${index}`} className="db-md-heading">
              {renderInline(block.text, `h-${index}`)}
            </Tag>
          );
        }
        if (block.kind === "list") {
          return <Fragment key={`l-${index}`}>{renderList(block.items, `l-${index}`)}</Fragment>;
        }
        return (
          <p key={`p-${index}`} className="db-md-paragraph">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`p-${index}-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line, `p-${index}-${lineIndex}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
