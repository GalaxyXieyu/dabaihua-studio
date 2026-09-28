/**
 * Pure sentence splitting used by the touch review flow.
 *
 * Splits on Chinese/English sentence terminators, keeps the terminator with its
 * sentence, absorbs trailing closing quotes/brackets, and ignores semicolons.
 * Offsets point into the original string so callers can build DOM ranges.
 */

export type SentenceSpan = {
  text: string;
  start: number;
  end: number;
};

const TERMINATORS = new Set(["。", "！", "？", "!", "?"]);
const CLOSERS = new Set(["”", "’", "」", "』", "）", ")", '"']);

export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const push = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (end > start) spans.push({ text: text.slice(start, end), start, end });
  };

  let cursor = 0;
  let index = 0;
  while (index < text.length) {
    if (!TERMINATORS.has(text[index])) {
      index += 1;
      continue;
    }
    index += 1;
    while (index < text.length && TERMINATORS.has(text[index])) index += 1;
    while (index < text.length && CLOSERS.has(text[index])) index += 1;
    push(cursor, index);
    cursor = index;
  }
  if (cursor < text.length) push(cursor, text.length);
  return spans;
}
