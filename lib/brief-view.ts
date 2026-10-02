// Pure view helpers for the /topics/daily split view. This module imports
// nothing and only uses erasable TypeScript syntax so Node's type-stripping
// test runner can load it directly.

/** One brief material, joined with its stored item row (when there is one). */
export type MaterialView = {
  url: string;
  itemId: number | null;
  site: string;
  title: string;
  translatedTitle: string;
  publishedLabel: string;
  body: string;
  summary: string;
  translatedBody: string;
  hasText: boolean;
  missingReason: string;
};

/** The subset of an `items` row that the view needs. */
export type MaterialItemSource = {
  id: number;
  title?: string | null;
  translatedTitle?: string | null;
  originalExcerpt?: string | null;
  translatedExcerpt?: string | null;
  contentMarkdown?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  fetchStatus?: string | null;
  fetchReason?: string | null;
};

export type TopicRatingState = {
  decision: "pick" | "reject" | null;
  rating: number | null;
};

const REASON_LABELS: Record<string, string> = {
  login: "需要登录或付费",
  unreachable: "网页打不开",
  extract: "正文提取失败",
};

const ORIGINAL_LINK_RE = /\[原文链接\]\([^)]*\)/g;
const ORIGINAL_LINK_TOKEN = "[原文链接](";
/** 抽取时常混进来的站点导航行。 */
const NAV_LINE_RE = /^(skip to (main )?content|loading(…|\.\.\.)?|share|copy link|back to (top|blog))$/i;

/** A CJK text detector; used to decide whether an excerpt is a Chinese translation. */
export function hasCjk(text: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(text ?? ""));
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const trimmed = text(value);
    if (trimmed) return trimmed;
  }
  return "";
}

function reasonText(reason: string | null | undefined): string {
  return REASON_LABELS[String(reason ?? "")] ?? "";
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function publishedLabelFrom(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  if (!match) return "";
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return "";
  return `${month}月${day}日`;
}

/** Mirrors `isSummaryOnly` from lib/material-fetch-core without importing it. */
function summaryOnly(contentMarkdown: string | null | undefined, originalExcerpt?: string | null, translatedExcerpt?: string | null): boolean {
  const raw = String(contentMarkdown ?? "");
  const stripped = raw.replace(ORIGINAL_LINK_RE, "").trim();
  if (!stripped) return true;
  const original = text(originalExcerpt);
  const translated = text(translatedExcerpt);
  if (original && stripped === original) return true;
  if (translated && stripped === translated) return true;
  if (raw.includes(ORIGINAL_LINK_TOKEN) && stripped.length < 600) return true;
  return false;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return "";
      }
    });
}

/** Splits a punctuation-less run into ~300 char chunks so long text still breaks. */
function chunkText(value: string, size = 300): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size).trim());
  }
  return chunks.filter(Boolean);
}

const CJK_TAIL_RE = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** Chinese sentences join without a space; Latin ones keep one. */
function joinSentences(parts: string[]): string {
  return parts.reduce((acc, part) => (acc && !CJK_TAIL_RE.test(acc.slice(-1)) ? `${acc} ${part}` : `${acc}${part}`), "");
}

function splitLongParagraph(value: string): string {
  // Break before inline `# ` / `## ` headings first, then group sentences.
  const withHeadings = value.replace(/(^|\s)(#{1,6}\s)/g, "$1\n\n$2");
  const rawPieces = withHeadings
    // CJK punctuation ends a sentence on its own; ASCII needs trailing whitespace.
    .split(/(?<=[。！？])\s*|(?<=[.!?])\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  const paragraphs: string[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = () => {
    if (current.length > 0) {
      paragraphs.push(joinSentences(current));
      current = [];
      length = 0;
    }
  };

  const pushLine = (line: string) => {
    if (current.length >= 2 && (length + line.length > 400 || current.length >= 4)) flush();
    current.push(line);
    length += line.length;
    if (current.length >= 4 || (current.length >= 2 && length >= 200)) flush();
  };

  for (const piece of rawPieces) {
    const lines = piece
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) pushLine(line);
  }
  flush();

  if (paragraphs.length === 1 && paragraphs[0].length > 400) {
    return chunkText(paragraphs[0]).join("\n\n");
  }
  return paragraphs.join("\n\n");
}

/**
 * Cleans a stored `content_markdown` body for reading: drops markdown images,
 * badges, HTML tags, entities and the `[原文链接](...)` tail. A single long
 * line is broken into 2–4 sentence paragraphs.
 */
export function cleanMaterialBody(markdown: string): string {
  let value = String(markdown ?? "");
  if (!value) return "";
  value = value.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  value = value.replace(/\[\s*\]\([^)]*\)/g, "");
  value = value.replace(ORIGINAL_LINK_RE, "");
  value = value.replace(/<[^>]*>/g, "");
  value = decodeEntities(value);
  value = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !NAV_LINE_RE.test(line.trim()))
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (value.length > 600 && !value.includes("\n")) value = splitLongParagraph(value);
  return value;
}

/**
 * Joins one brief material with its stored item (if any) into the read view.
 * When there is no full text yet, `body` is empty and `missingReason` explains
 * why the fetch did not produce one.
 */
export function toMaterialView(material: { title: string; summary: string; url: string }, item: MaterialItemSource | null): MaterialView {
  const url = text(material?.url);
  const itemTitle = text(item?.title);
  const title = itemTitle || text(material?.title);
  const contentMarkdown = item?.contentMarkdown ?? null;
  const hasBody = Boolean(item) && !summaryOnly(contentMarkdown, item?.originalExcerpt, item?.translatedExcerpt);
  const body = hasBody ? cleanMaterialBody(String(contentMarkdown ?? "")) : "";
  const hasText = body.length > 0;

  const summary = firstText(material?.summary, item?.translatedExcerpt, item?.originalExcerpt);
  const translatedExcerpt = text(item?.translatedExcerpt);
  const translatedBody = hasText && translatedExcerpt && hasCjk(translatedExcerpt) && !hasCjk(body) ? translatedExcerpt : "";
  const translatedTitle = text(item?.translatedTitle);

  return {
    url,
    itemId: item ? item.id : null,
    site: firstText(item?.author, hostLabel(url)),
    title,
    translatedTitle,
    publishedLabel: publishedLabelFrom(item?.publishedAt),
    body,
    summary,
    translatedBody,
    hasText,
    missingReason: hasText || !item ? "" : reasonText(item.fetchReason),
  };
}

/**
 * Initial selected topic: an explicit valid `?topic=`, else an unhandled
 * recommendation, else the first unhandled topic, else the first topic.
 */
export function pickInitialTopic(
  orderedTopicIds: string[],
  recommendedId: string | null,
  decided: Record<string, "pick" | "reject" | null>,
  requested: string | null,
): string | null {
  const ids = (orderedTopicIds ?? []).filter((id) => typeof id === "string" && id);
  if (ids.length === 0) return null;
  if (requested && ids.includes(requested)) return requested;
  if (recommendedId && ids.includes(recommendedId) && !decided?.[recommendedId]) return recommendedId;
  const undecided = ids.find((id) => !decided?.[id]);
  if (undecided) return undecided;
  return ids[0];
}

/** One-line status for a topic in the left column. */
export function topicStatusLabel(state: TopicRatingState): string {
  const decision = state?.decision ?? null;
  const rating = state?.rating ?? null;
  const base = decision === "pick" ? "已选" : decision === "reject" ? "不要" : "";
  const star = typeof rating === "number" && rating > 0 ? `${rating} 星` : "";
  if (base && star) return `${base} · ${star}`;
  return base || star || "未处理";
}

/** Recommended topic first, the rest in their original order. */
export function orderBriefTopics<T extends { id: string }>(topics: T[], recommendedId: string | null): T[] {
  if (!recommendedId) return topics;
  const recommended = topics.find((topic) => topic.id === recommendedId);
  if (!recommended) return topics;
  return [recommended, ...topics.filter((topic) => topic.id !== recommendedId)];
}
