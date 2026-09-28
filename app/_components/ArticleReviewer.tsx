"use client";

/**
 * ArticleReviewer — 文章 / 选题共用的手机端公众号审稿视图
 *
 * - 用服务端已清洗好的公众号 HTML 还原「排版后的文章」，宽度贴近微信。
 * - 登录用户可划词标记「写得好 / 要改」，标记会持久化并渲染成高亮。
 * - 支持总评：提交批注 / 打回 / 通过。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { splitSentences, type SentenceSpan } from "../../lib/sentences";
import { htmlSourceLabel } from "./article-status";

export type ReviewTargetType = "article" | "topic";
export type MarkKind = "good" | "change";
export type ReviewVerdict = "approved" | "changes_requested" | "comments";

export type ReviewMark = {
  id: number;
  type: MarkKind;
  quote: string;
  prefix: string;
  suffix: string;
  blockIndex: number | null;
  startOffset: number | null;
  endOffset: number | null;
  comment: string;
  userId: number;
  round: number;
  nickname: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewRoundSummary = {
  round: number;
  verdict: string;
  comment: string;
  markCount: number;
  nickname?: string;
  createdAt: string;
  exportPath?: string | null;
};

export type ArticleReviewerProps = {
  target: { type: ReviewTargetType; id: string };
  title: string;
  html: string;
  htmlSource: string;
  round: number;
  statusLabel: string;
  initialMarks: ReviewMark[];
  rounds: ReviewRoundSummary[];
  canReview: boolean;
  currentUserId: number | null;
  backHref: string;
  extraHeader?: ReactNode;
};

type PendingSelection = {
  exact: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  blockIndex: number | null;
};

type TouchScope = {
  blockStart: number;
  blockEnd: number;
  sentences: SentenceSpan[];
  index: number;
};

type Sheet =
  | { kind: "new"; markKind: MarkKind }
  | { kind: "mark"; markId: number }
  | { kind: "list" }
  | { kind: "comments" }
  | { kind: "reject" }
  | { kind: "approve" }
  | null;

const MARK_STYLE_GOOD = "background:rgba(16,185,129,.22);border-bottom:2px solid #10b981;";
const MARK_STYLE_CHANGE = "background:rgba(245,158,11,.28);border-bottom:2px solid #ef4444;";
const MARK_STYLE_PENDING = "background:rgba(59,130,246,.25);border-bottom:2px dashed #3b82f6;color:inherit;border-radius:2px;";

const TOUCH_BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, pre, td, th";
const INLINE_DISPLAY = /^(inline|contents|ruby)/;


function commonPrefix(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffix(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[left.length - 1 - index] === right[right.length - 1 - index]) index += 1;
  return index;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 16).replace("T", " ");
}

function textOffset(container: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(container);
  try {
    range.setEnd(node, offset);
  } catch {
    return -1;
  }
  return range.toString().length;
}

function blockIndexFor(container: HTMLElement, node: Node) {
  const scope = (container.querySelector(":scope > section") as HTMLElement | null) || container;
  const children = Array.from(scope.children);
  for (let index = 0; index < children.length; index += 1) {
    if (children[index].contains(node)) return index;
  }
  return null;
}

function buildAnchor(container: HTMLElement, range: Range): PendingSelection | null {
  const textContent = container.textContent || "";
  let startOffset = textOffset(container, range.startContainer, range.startOffset);
  let endOffset = textOffset(container, range.endContainer, range.endOffset);
  if (startOffset < 0 || endOffset < 0 || endOffset <= startOffset) return null;
  while (startOffset < endOffset && /\s/.test(textContent[startOffset])) startOffset += 1;
  while (endOffset > startOffset && /\s/.test(textContent[endOffset - 1])) endOffset -= 1;
  if (endOffset <= startOffset) return null;
  if (endOffset - startOffset > 2000) endOffset = startOffset + 2000;
  const exact = textContent.slice(startOffset, endOffset).normalize("NFC");
  if (!exact) return null;
  return {
    exact,
    prefix: textContent.slice(Math.max(0, startOffset - 32), startOffset),
    suffix: textContent.slice(endOffset, endOffset + 32),
    startOffset,
    endOffset,
    blockIndex: blockIndexFor(container, range.startContainer),
  };
}

function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let position = 0;
  let started = false;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const nodeStart = position;
    const nodeEnd = position + node.data.length;
    if (!started && start < nodeEnd) {
      range.setStart(node, Math.max(0, start - nodeStart));
      started = true;
    }
    if (started && end <= nodeEnd) {
      range.setEnd(node, Math.max(0, end - nodeStart));
      return range;
    }
    position = nodeEnd;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

function hasOwnInlineText(element: HTMLElement) {
  const view = element.ownerDocument.defaultView;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent || "").trim()) return true;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const childElement = child as HTMLElement;
    if (childElement.tagName === "IMG") continue;
    const display = view ? view.getComputedStyle(childElement).display : "";
    if (INLINE_DISPLAY.test(display) && (childElement.textContent || "").trim()) return true;
  }
  return false;
}

function findTouchBlock(container: HTMLElement, target: HTMLElement): HTMLElement | null {
  const explicit = target.closest(TOUCH_BLOCK_SELECTOR) as HTMLElement | null;
  if (explicit && explicit !== container && container.contains(explicit)) {
    return (explicit.textContent || "").trim() ? explicit : null;
  }
  let current: HTMLElement | null = target;
  while (current && current !== container) {
    if (current.tagName === "SECTION" && hasOwnInlineText(current)) return current;
    current = current.parentElement;
  }
  current = target;
  const view = target.ownerDocument.defaultView;
  while (current && current !== container) {
    const display = view ? view.getComputedStyle(current).display : "";
    if (display && !INLINE_DISPLAY.test(display) && (current.textContent || "").trim()) return current;
    current = current.parentElement;
  }
  return null;
}

function resolveRange(textContent: string, mark: ReviewMark): { start: number; end: number } | null {
  const exact = mark.quote;
  if (!exact) return null;
  const { startOffset, endOffset } = mark;
  if (
    startOffset !== null && endOffset !== null && endOffset > startOffset &&
    textContent.slice(startOffset, endOffset) === exact
  ) {
    return { start: startOffset, end: endOffset };
  }
  let best: { start: number; end: number; score: number } | null = null;
  let index = textContent.indexOf(exact);
  while (index !== -1) {
    const end = index + exact.length;
    const before = textContent.slice(Math.max(0, index - mark.prefix.length), index);
    const after = textContent.slice(end, end + mark.suffix.length);
    const score = commonSuffix(before, mark.prefix) + commonPrefix(after, mark.suffix);
    if (!best || score > best.score) best = { start: index, end, score };
    index = textContent.indexOf(exact, index + 1);
  }
  return best ? { start: best.start, end: best.end } : null;
}

function markStyle(mark: ReviewMark, currentRound: number) {
  const base = mark.type === "good" ? MARK_STYLE_GOOD : MARK_STYLE_CHANGE;
  const historical = mark.round !== currentRound;
  const extra = historical ? "opacity:.6;border-bottom-style:dashed;" : "cursor:pointer;";
  return `${base}color:inherit;border-radius:2px;${extra}`;
}

function unwrapHighlights(container: HTMLElement) {
  const marks = Array.from(container.querySelectorAll("mark[data-mark-id], mark[data-pending]"));
  for (const element of marks) {
    const parent = element.parentNode;
    if (!parent) continue;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
  }
  container.normalize();
}

function wrapRange(container: HTMLElement, start: number, end: number, mark: ReviewMark, currentRound: number) {
  const nodes: Array<{ node: Text; start: number }> = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let position = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push({ node, start: position });
    position += node.data.length;
  }
  for (const { node, start: nodeStart } of nodes) {
    const nodeEnd = nodeStart + node.data.length;
    const from = Math.max(start, nodeStart);
    const to = Math.min(end, nodeEnd);
    if (from >= to) continue;
    const localStart = from - nodeStart;
    const localEnd = to - nodeStart;
    if (localEnd < node.data.length) node.splitText(localEnd);
    let segment: Text = node;
    if (localStart > 0) segment = node.splitText(localStart);
    const wrapper = document.createElement("mark");
    wrapper.setAttribute("data-mark-id", String(mark.id));
    wrapper.setAttribute("data-kind", mark.type);
    wrapper.setAttribute("data-round", String(mark.round));
    wrapper.setAttribute("style", markStyle(mark, currentRound));
    segment.parentNode?.replaceChild(wrapper, segment);
    wrapper.appendChild(segment);
  }
}

function wrapPendingRange(container: HTMLElement, start: number, end: number) {
  const nodes: Array<{ node: Text; start: number }> = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let position = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push({ node, start: position });
    position += node.data.length;
  }
  for (const { node, start: nodeStart } of nodes) {
    const nodeEnd = nodeStart + node.data.length;
    const from = Math.max(start, nodeStart);
    const to = Math.min(end, nodeEnd);
    if (from >= to) continue;
    const localStart = from - nodeStart;
    const localEnd = to - nodeStart;
    if (localEnd < node.data.length) node.splitText(localEnd);
    let segment: Text = node;
    if (localStart > 0) segment = node.splitText(localStart);
    const wrapper = document.createElement("mark");
    wrapper.setAttribute("data-pending", "1");
    wrapper.setAttribute("style", MARK_STYLE_PENDING);
    segment.parentNode?.replaceChild(wrapper, segment);
    wrapper.appendChild(segment);
  }
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/35"
      onClick={onClose}
      style={{ userSelect: "none" }}
    >
      <div
        className="max-h-[82dvh] w-full overflow-y-auto rounded-t-2xl bg-[var(--paper)] p-4 text-[var(--ink)] shadow-2xl desk:mx-auto desk:mb-8 desk:w-[560px] desk:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
        style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))", userSelect: "text" }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg px-3 text-sm font-bold text-[var(--muted)]"
          >
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MarkRow({
  mark,
  currentRound,
  onOpen,
}: {
  mark: ReviewMark;
  currentRound: number;
  onOpen: (mark: ReviewMark) => void;
}) {
  const historical = mark.round !== currentRound;
  return (
    <button
      type="button"
      onClick={() => onOpen(mark)}
      className="w-full rounded-lg border border-[var(--line)] bg-[var(--canvas)] p-2.5 text-left"
    >
      <div className="mb-1 flex items-center gap-2 text-[11px] text-[var(--muted)]">
        <span className={`rounded-full px-1.5 py-0.5 font-bold ${mark.type === "good" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {mark.type === "good" ? "👍 写得好" : "✏️ 要改"}
        </span>
        {historical ? <span className="rounded-full bg-[var(--canvas)] px-1.5 py-0.5 font-bold text-[var(--muted)]">第 {mark.round} 轮</span> : null}
        <span className="ml-auto">{formatTime(mark.createdAt)}</span>
      </div>
      <p className="line-clamp-3 text-[13px] leading-snug text-[var(--ink)]">{mark.quote}</p>
      {mark.comment ? <p className="mt-1 border-l-2 border-[var(--line)] pl-2 text-[12px] text-[var(--muted)]">{mark.comment}</p> : null}
    </button>
  );
}

export function ArticleReviewer({
  target,
  title,
  html,
  htmlSource,
  round,
  statusLabel,
  initialMarks,
  rounds,
  canReview,
  currentUserId,
  backHref,
  extraHeader,
}: ArticleReviewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const [marks, setMarks] = useState<ReviewMark[]>(initialMarks);
  const [historical, setHistorical] = useState<ReviewMark[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [touchScope, setTouchScope] = useState<TouchScope | null>(null);
  const [touchHighlight, setTouchHighlight] = useState<{ start: number; end: number } | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [comment, setComment] = useState("");
  const [verdictComment, setVerdictComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [unlocated, setUnlocated] = useState<Set<number>>(new Set());
  const [flashId, setFlashId] = useState<number | null>(null);

  const base = `/api/review/${target.type}/${target.id}`;

  // React replaces a dangerouslySetInnerHTML node's content whenever the prop
  // object identity changes. Memoizing it keeps the rendered article stable so
  // the <mark> highlights we inject with renderHighlights() survive re-renders.
  const articleHtml = useMemo(() => ({ __html: html }), [html]);

  const changeCount = useMemo(() => marks.filter((mark) => mark.type === "change").length, [marks]);
  const goodCount = useMemo(() => marks.filter((mark) => mark.type === "good").length, [marks]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? "" : current)), 4000);
  }, []);

  const api = useCallback(async (url: string, method: string, body?: unknown) => {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error || "操作失败，请稍后再试");
    return data;
  }, []);

  // ─── 输入方式检测（以主指针为准） ───
  // 桌面/笔记本即使带触摸屏或触摸驱动，只要主指针是鼠标（fine + hover），
  // 就应该保持桌面拖选体验，而不是被触摸点数量 / touch 事件探针误判为触屏。
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => setIsTouch(coarse.matches && !fine.matches);
    update();
    fine.addEventListener?.("change", update);
    coarse.addEventListener?.("change", update);
    return () => {
      fine.removeEventListener?.("change", update);
      coarse.removeEventListener?.("change", update);
    };
  }, []);

  // ─── 划词捕获（桌面拖选） ───
  const captureSelection = useCallback(() => {
    if (!canReview || isTouch) return;
    const container = containerRef.current;
    if (!container) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return;
    if (range.startContainer === range.endContainer && range.startOffset === range.endOffset) return;
    const anchor = buildAnchor(container, range);
    if (!anchor) return;
    setPending(anchor);
  }, [canReview, isTouch]);

  useEffect(() => {
    if (!canReview || isTouch) return;
    const schedule = () => {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(captureSelection, 150);
    };
    const onSelectionChange = () => schedule();
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("mouseup", schedule);
    window.addEventListener("touchend", schedule);
    return () => {
      window.clearTimeout(debounceRef.current);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("mouseup", schedule);
      window.removeEventListener("touchend", schedule);
    };
  }, [canReview, isTouch, captureSelection]);

  // ─── 高亮渲染 ───
  const renderHighlights = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    unwrapHighlights(container);
    const textContent = container.textContent || "";
    const visible = showHistory ? [...marks, ...historical] : marks;
    const unresolved = new Set<number>();
    for (const mark of visible) {
      const span = resolveRange(textContent, mark);
      if (!span) {
        unresolved.add(mark.id);
        continue;
      }
      wrapRange(container, span.start, span.end, mark, round);
    }
    if (touchHighlight) {
      wrapPendingRange(container, touchHighlight.start, touchHighlight.end);
    }
    if (flashId !== null) {
      const element = container.querySelector(`mark[data-mark-id="${flashId}"]`) as HTMLElement | null;
      if (element) element.style.outline = "3px solid var(--green)";
    }
    setUnlocated((current) => {
      if (current.size === unresolved.size && [...unresolved].every((id) => current.has(id))) return current;
      return unresolved;
    });
  }, [marks, historical, showHistory, round, flashId, touchHighlight]);

  useEffect(() => {
    renderHighlights();
  }, [renderHighlights, html]);

  // ─── 触屏选中后自动让高亮避开顶栏和底部操作栏 ───
  useEffect(() => {
    if (!isTouch || !touchHighlight) return;
    const frame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const segments = Array.from(container.querySelectorAll<HTMLElement>("mark[data-pending]"));
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const segment of segments) {
        const rect = segment.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
      }
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
      const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      const bar = document.querySelector('[data-testid="mark-action-bar"]') as HTMLElement | null;
      const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
      const topLimit = headerBottom + 12;
      const bottomLimit = barTop - 12;
      const available = bottomLimit - topLimit;
      let delta = 0;
      if (bottom - top > available) {
        // Whole block (or a very long sentence) taller than the space between
        // the sticky header and the action bar: at least reveal its first lines.
        delta = top - topLimit;
      } else if (bottom > bottomLimit) {
        delta = bottom - bottomLimit;
        if (top - delta < topLimit) delta = top - topLimit;
      } else if (top < topLimit) {
        delta = top - topLimit;
      }
      if (Math.abs(delta) < 1) return;
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollBy({ top: delta, behavior: "smooth" });
      } else {
        window.scrollBy({ top: delta, behavior: "smooth" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isTouch, touchHighlight]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
  }, []);

  const clearPending = useCallback(() => {
    setPending(null);
    setTouchScope(null);
    setTouchHighlight(null);
    clearSelection();
  }, [clearSelection]);

  const openMarkSheet = useCallback((mark: ReviewMark) => {
    setComment(mark.comment);
    setSheet({ kind: "mark", markId: mark.id });
  }, []);

  const selectTouchBlock = useCallback((block: HTMLElement) => {
    const container = containerRef.current;
    if (!container) return;
    const range = document.createRange();
    range.selectNodeContents(block);
    const anchor = buildAnchor(container, range);
    if (!anchor) return;
    setTouchScope({
      blockStart: anchor.startOffset,
      blockEnd: anchor.endOffset,
      sentences: splitSentences(anchor.exact),
      index: -1,
    });
    setTouchHighlight({ start: anchor.startOffset, end: anchor.endOffset });
    setPending(anchor);
  }, []);

  const applyTouchSentence = useCallback((index: number) => {
    if (!touchScope) return;
    const container = containerRef.current;
    if (!container) return;
    const total = touchScope.sentences.length;
    const clamped = index < 0 ? -1 : Math.max(0, Math.min(index, total - 1));
    const whole = clamped < 0 || total === 0;
    const start = whole ? touchScope.blockStart : touchScope.blockStart + touchScope.sentences[clamped].start;
    const end = whole ? touchScope.blockEnd : touchScope.blockStart + touchScope.sentences[clamped].end;
    // Rebuild the range from container-level offsets instead of a stored DOM
    // node: highlighter re-renders replace the article's innerHTML, so any
    // captured element reference would be detached.
    const range = rangeFromOffsets(container, start, end);
    if (!range) return;
    const anchor = buildAnchor(container, range);
    if (!anchor) return;
    setTouchScope({ ...touchScope, index: clamped });
    setTouchHighlight({ start: anchor.startOffset, end: anchor.endOffset });
    setPending(anchor);
  }, [touchScope]);

  const stepTouchSentence = useCallback((delta: number) => {
    if (!touchScope) return;
    if (touchScope.index < 0) {
      applyTouchSentence(delta > 0 ? 0 : touchScope.sentences.length - 1);
      return;
    }
    applyTouchSentence(touchScope.index + delta);
  }, [touchScope, applyTouchSentence]);

  const handleArticleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const element = (event.target as HTMLElement).closest("mark[data-mark-id]") as HTMLElement | null;
    if (element) {
      const id = Number(element.getAttribute("data-mark-id"));
      const mark = marks.find((item) => item.id === id) || historical.find((item) => item.id === id);
      if (mark) openMarkSheet(mark);
      return;
    }
    if (!isTouch || !canReview) return;
    const container = containerRef.current;
    if (!container) return;
    const target = event.target as HTMLElement;
    if (target.closest("a")) event.preventDefault();
    if (target.closest("img, picture, svg, video, audio, canvas")) return;
    const figure = target.closest("figure");
    if (figure && !(figure.textContent || "").trim()) return;
    const block = findTouchBlock(container, target);
    if (!block) return;
    selectTouchBlock(block);
  }, [isTouch, canReview, marks, historical, openMarkSheet, selectTouchBlock]);

  async function saveNewMark(markKind: MarkKind) {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(`${base}/marks`, "POST", {
        kind: markKind,
        exact: pending.exact,
        prefix: pending.prefix,
        suffix: pending.suffix,
        startOffset: pending.startOffset,
        endOffset: pending.endOffset,
        blockIndex: pending.blockIndex,
        comment,
      });
      setMarks((current) => [...current, data.mark as ReviewMark]);
      setSheet(null);
      setPending(null);
      setTouchScope(null);
      setTouchHighlight(null);
      setComment("");
      clearSelection();
      showToast("已保存划词，记得在底部提交本轮审稿");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存划词失败");
    } finally {
      setBusy(false);
    }
  }

  async function patchMark(markId: number, patch: { kind?: MarkKind; comment?: string }) {
    setBusy(true);
    setError("");
    try {
      const data = await api(`${base}/marks/${markId}`, "PATCH", patch);
      setMarks((current) => current.map((mark) => (mark.id === markId ? (data.mark as ReviewMark) : mark)));
      setSheet(null);
      setComment("");
      showToast("已更新划词");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新划词失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeMark(markId: number) {
    setBusy(true);
    setError("");
    try {
      await api(`${base}/marks/${markId}`, "DELETE");
      setMarks((current) => current.filter((mark) => mark.id !== markId));
      setSheet(null);
      showToast("已删除划词");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除划词失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitVerdict(verdict: ReviewVerdict, overall: string) {
    setBusy(true);
    setError("");
    try {
      const data = await api(`${base}/submit`, "POST", { verdict, comment: overall });
      const submittedRound = Number(data.round || round);
      setSheet(null);
      setVerdictComment("");
      showToast(`已提交第 ${submittedRound} 轮审稿，反馈文件会在几秒内写入文章目录`);
      window.setTimeout(() => window.location.reload(), 1400);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交审稿失败");
      setBusy(false);
    }
  }

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && historical.length === 0) {
      const past = rounds.filter((item) => item.round !== round);
      if (!past.length) return;
      setHistoryLoading(true);
      try {
        const results = await Promise.all(past.map(async (item) => {
          const data = await api(`${base}/marks?round=${item.round}`, "GET");
          return (Array.isArray(data.marks) ? data.marks : []) as ReviewMark[];
        }));
        setHistorical(results.flat());
        if (!results.flat().length) showToast("过往轮次没有划词");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "读取历史划词失败");
      } finally {
        setHistoryLoading(false);
      }
    }
  }

  function scrollToMark(markId: number) {
    setSheet(null);
    const element = containerRef.current?.querySelector(`mark[data-mark-id="${markId}"]`) as HTMLElement | null;
    if (!element) {
      showToast("这条划词在当前版本里未能定位");
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(markId);
    window.setTimeout(() => setFlashId((current) => (current === markId ? null : current)), 1800);
  }

  const activeMark = sheet?.kind === "mark" ? marks.find((mark) => mark.id === sheet.markId) || historical.find((mark) => mark.id === sheet.markId) || null : null;
  const markReadOnly = activeMark ? activeMark.round !== round || activeMark.userId !== currentUserId : true;
  const historicalMarks = useMemo(() => historical.filter((mark) => mark.round !== round), [historical, round]);

  return (
    <div ref={scrollRef} className="fixed inset-0 overflow-y-auto bg-[var(--canvas)] text-[var(--ink)]" style={{ WebkitOverflowScrolling: "touch" }}>
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--paper)]" style={{ userSelect: "none" }}>
        <div className="mx-auto flex max-w-[420px] items-center gap-2 px-3 pb-1 pt-2 desk:max-w-[760px]">
          <a href={backHref} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-base font-bold text-[var(--muted)]" aria-label="返回">←</a>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold leading-tight desk:text-base">{title || "未命名"}</div>
            <div className="truncate text-[11px] text-[var(--faint)]">排版：{htmlSourceLabel(htmlSource)}</div>
          </div>
          <span className="shrink-0 rounded-full bg-[var(--green-soft)] px-2 py-1 text-[11px] font-bold text-[var(--green)]">第 {round} 轮</span>
          <span className="shrink-0 rounded-full bg-[var(--canvas)] px-2 py-1 text-[11px] font-bold text-[var(--muted)]">{statusLabel}</span>
        </div>
        <div className="mx-auto flex max-w-[420px] flex-wrap items-center gap-2 px-3 pb-2 desk:max-w-[760px]">
          <button
            type="button"
            data-testid="marks-list-button"
            onClick={() => setSheet({ kind: "list" })}
            className="min-h-[36px] rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 text-xs font-bold text-[var(--ink)]"
          >
            划线 ({marks.length})
          </button>
          {canReview ? (
            <span className="text-[11px] text-[var(--faint)]">{isTouch ? "点一下段落即可标记" : "选中正文即可标记"}</span>
          ) : (
            <a href={`/login?next=${encodeURIComponent("/" + (target.type === "article" ? `articles/${target.id}` : `review/${target.id}`))}`} className="min-h-[36px] rounded-full bg-[var(--green-soft)] px-3 text-xs font-bold leading-[36px] text-[var(--green)]">
              登录后审稿
            </a>
          )}
          {extraHeader}
        </div>
      </header>

      <div className="mx-auto w-full max-w-[420px] px-3 desk:max-w-[760px]" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 112px)" }}>
        {error ? <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
        <div
          ref={containerRef}
          onClick={handleArticleClick}
          onContextMenu={isTouch ? (event) => event.preventDefault() : undefined}
          className="my-3 w-full max-w-[420px] rounded-xl bg-[var(--paper)] p-4 shadow-sm desk:max-w-[760px] desk:px-12 desk:py-10"
          style={isTouch
            ? { userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }
            : { userSelect: "text", WebkitUserSelect: "text" }}
          dangerouslySetInnerHTML={articleHtml}
        />
        {!html ? (
          <div className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            这篇内容还没有可审稿的正文。
          </div>
        ) : null}
      </div>

      {pending && !sheet ? (
        <div
          data-testid="mark-action-bar"
          className="fixed inset-x-0 z-40 border-t border-[var(--line)] bg-[var(--paper)] px-3 pt-2 shadow-[0_-6px_20px_rgba(0,0,0,0.08)]"
          style={{ bottom: 0, paddingBottom: "calc(10px + env(safe-area-inset-bottom))", userSelect: "none" }}
        >
          <div className="mx-auto max-w-[420px] desk:max-w-[760px]">
            {isTouch && touchScope && touchScope.sentences.length > 1 ? (
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="mark-sentence-prev"
                  aria-label="上一句"
                  onClick={() => stepTouchSentence(-1)}
                  className="min-h-[44px] min-w-[44px] rounded-xl border border-[var(--line)] text-lg font-bold text-[var(--muted)]"
                >
                  ‹
                </button>
                <button
                  type="button"
                  data-testid="mark-sentence-whole"
                  onClick={() => applyTouchSentence(-1)}
                  className={`min-h-[44px] rounded-xl px-3 text-xs font-bold ${touchScope.index < 0 ? "bg-[var(--canvas)] text-[var(--ink)]" : "border border-[var(--line)] text-[var(--muted)]"}`}
                >
                  整段
                </button>
                <span data-testid="mark-sentence-label" className="flex-1 text-center text-xs font-bold text-[var(--muted)]">
                  {touchScope.index < 0 ? "整段" : `第 ${touchScope.index + 1}/${touchScope.sentences.length} 句`}
                </span>
                <button
                  type="button"
                  data-testid="mark-sentence-next"
                  aria-label="下一句"
                  onClick={() => stepTouchSentence(1)}
                  className="min-h-[44px] min-w-[44px] rounded-xl border border-[var(--line)] text-lg font-bold text-[var(--muted)]"
                >
                  ›
                </button>
              </div>
            ) : null}
            <p data-testid="mark-pending-text" className="mb-2 line-clamp-2 text-[12px] text-[var(--muted)]">「{pending.exact}」</p>
            <div className="flex gap-2">
              <button type="button" data-testid="mark-good" onClick={() => { setComment(""); setSheet({ kind: "new", markKind: "good" }); }} className="min-h-[44px] flex-1 rounded-xl bg-emerald-50 text-sm font-bold text-emerald-700 desk:min-h-[36px]">👍 写得好</button>
              <button type="button" data-testid="mark-change" onClick={() => { setComment(""); setSheet({ kind: "new", markKind: "change" }); }} className="min-h-[44px] flex-1 rounded-xl bg-amber-50 text-sm font-bold text-amber-700 desk:min-h-[36px]">✏️ 要改</button>
              <button type="button" data-testid="mark-cancel" onClick={clearPending} className="min-h-[44px] rounded-xl border border-[var(--line)] px-4 text-sm font-bold text-[var(--muted)] desk:min-h-[36px]">取消</button>
            </div>
          </div>
        </div>
      ) : null}

      {canReview && !pending && !sheet ? (
        <div
          className="fixed inset-x-0 z-40 border-t border-[var(--line)] bg-[var(--paper)] px-3 pt-3 shadow-[0_-6px_20px_rgba(0,0,0,0.08)]"
          style={{ bottom: 0, paddingBottom: "calc(10px + env(safe-area-inset-bottom))", userSelect: "none" }}
        >
          <div className="mx-auto flex max-w-[420px] gap-2 desk:max-w-[760px]">
            <button
              type="button"
              onClick={() => { setVerdictComment(""); setSheet({ kind: "comments" }); }}
              disabled={busy || marks.length === 0}
              className="min-h-[44px] flex-1 rounded-xl border border-[var(--line)] text-sm font-bold text-[var(--muted)] disabled:opacity-40 desk:min-h-[36px]"
            >
              提交批注{marks.length ? ` (${marks.length})` : ""}
            </button>
            <button
              type="button"
              onClick={() => { setVerdictComment(""); setSheet({ kind: "reject" }); }}
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-xl border border-[var(--danger)] text-sm font-bold text-[var(--danger)] disabled:opacity-40 desk:min-h-[36px]"
            >
              ↩️ 打回
            </button>
            <button
              type="button"
              onClick={() => { setVerdictComment(""); setSheet({ kind: "approve" }); }}
              disabled={busy}
              className="min-h-[44px] flex-1 rounded-xl bg-[var(--green)] text-sm font-bold text-white disabled:opacity-40 desk:min-h-[36px]"
            >
              ✅ 通过
            </button>
          </div>
        </div>
      ) : null}

      {sheet?.kind === "new" && pending ? (
        <Sheet title={pending ? "标记选中的文字" : "标记"} onClose={() => setSheet(null)}>
          <div className="mb-3 flex gap-2">
            <button
              type="button"
              onClick={() => setSheet({ kind: "new", markKind: "good" })}
              className={`min-h-[44px] flex-1 rounded-xl text-sm font-bold ${sheet.markKind === "good" ? "bg-emerald-100 text-emerald-800" : "bg-[var(--canvas)] text-[var(--muted)]"}`}
            >
              👍 写得好
            </button>
            <button
              type="button"
              onClick={() => setSheet({ kind: "new", markKind: "change" })}
              className={`min-h-[44px] flex-1 rounded-xl text-sm font-bold ${sheet.markKind === "change" ? "bg-amber-100 text-amber-800" : "bg-[var(--canvas)] text-[var(--muted)]"}`}
            >
              ✏️ 要改
            </button>
          </div>
          <p className="mb-2 line-clamp-4 rounded-lg bg-[var(--canvas)] p-2 text-[13px] text-[var(--muted)]">{pending.exact}</p>
          <textarea
            autoFocus
            data-testid="mark-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={sheet.markKind === "good" ? "可选：说说好在哪里" : "哪里要改？怎么改？"}
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[14px] outline-none focus:border-[var(--green)]"
          />
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setSheet(null)} className="min-h-[44px] flex-1 rounded-xl border border-[var(--line)] text-sm font-bold text-[var(--muted)]">取消</button>
            <button type="button" data-testid="mark-save" onClick={() => saveNewMark(sheet.markKind)} disabled={busy} className="min-h-[44px] flex-1 rounded-xl bg-[var(--green)] text-sm font-bold text-white disabled:opacity-50">保存</button>
          </div>
        </Sheet>
      ) : null}

      {sheet?.kind === "mark" && activeMark ? (
        <Sheet title="划词详情" onClose={() => setSheet(null)}>
          <div className="mb-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <span className={`rounded-full px-2 py-0.5 font-bold ${activeMark.type === "good" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
              {activeMark.type === "good" ? "👍 写得好" : "✏️ 要改"}
            </span>
            <span>第 {activeMark.round} 轮</span>
            <span>{activeMark.nickname || "匿名"}</span>
            <span className="ml-auto">{formatTime(activeMark.createdAt)}</span>
          </div>
          <p className="mb-3 rounded-lg bg-[var(--canvas)] p-2 text-[13px] text-[var(--ink)]">{activeMark.quote}</p>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            maxLength={2000}
            readOnly={markReadOnly}
            placeholder="补充批注…"
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[14px] outline-none focus:border-[var(--green)] read-only:opacity-60"
          />
          {markReadOnly ? (
            <p className="mt-2 text-xs text-[var(--faint)]">他人或历史轮次的划词只能查看。</p>
          ) : (
            <>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => patchMark(activeMark.id, { kind: "good" })} disabled={busy || activeMark.type === "good"} className="min-h-[44px] flex-1 rounded-xl bg-emerald-50 text-sm font-bold text-emerald-700 disabled:opacity-40">👍 写得好</button>
                <button type="button" onClick={() => patchMark(activeMark.id, { kind: "change" })} disabled={busy || activeMark.type === "change"} className="min-h-[44px] flex-1 rounded-xl bg-amber-50 text-sm font-bold text-amber-700 disabled:opacity-40">✏️ 要改</button>
              </div>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => removeMark(activeMark.id)} disabled={busy} className="min-h-[44px] rounded-xl border border-[var(--danger)] px-4 text-sm font-bold text-[var(--danger)] disabled:opacity-50">删除</button>
                <button type="button" onClick={() => patchMark(activeMark.id, { comment })} disabled={busy} className="min-h-[44px] flex-1 rounded-xl bg-[var(--green)] text-sm font-bold text-white disabled:opacity-50">保存批注</button>
              </div>
            </>
          )}
        </Sheet>
      ) : null}

      {sheet?.kind === "list" ? (
        <Sheet title={`本轮划词 (${marks.length})`} onClose={() => setSheet(null)}>
          {rounds.length > 0 ? (
            <label className="mb-3 flex items-center gap-2 text-[13px] text-[var(--muted)]">
              <input type="checkbox" checked={showHistory} onChange={toggleHistory} className="h-4 w-4" />
              显示历史轮次划词
              {historyLoading ? <span className="text-[11px] text-[var(--faint)]">读取中…</span> : null}
            </label>
          ) : null}
          {marks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--line)] p-4 text-center text-sm text-[var(--muted)]">本轮还没有划词。</p>
          ) : (
            <div className="space-y-3">
              {changeCount > 0 ? (
                <section>
                  <h3 className="mb-1.5 text-[12px] font-bold text-amber-700">要改（{changeCount}）</h3>
                  <div className="space-y-2">
                    {marks.filter((mark) => mark.type === "change").map((mark) => (
                      <MarkRow key={mark.id} mark={mark} currentRound={round} onOpen={(item) => { setSheet(null); scrollToMark(item.id); }} />
                    ))}
                  </div>
                </section>
              ) : null}
              {goodCount > 0 ? (
                <section>
                  <h3 className="mb-1.5 text-[12px] font-bold text-emerald-700">写得好（{goodCount}）</h3>
                  <div className="space-y-2">
                    {marks.filter((mark) => mark.type === "good").map((mark) => (
                      <MarkRow key={mark.id} mark={mark} currentRound={round} onOpen={(item) => { setSheet(null); scrollToMark(item.id); }} />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )}
          {showHistory && historicalMarks.length > 0 ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-[12px] font-bold text-[var(--muted)]">历史轮次（{historicalMarks.length}）</h3>
              <div className="space-y-2">
                {historicalMarks.map((mark) => (
                  <MarkRow key={`h-${mark.id}`} mark={mark} currentRound={round} onOpen={(item) => { setSheet(null); scrollToMark(item.id); }} />
                ))}
              </div>
            </section>
          ) : null}
          {unlocated.size > 0 ? (
            <p className="mt-3 text-[11px] text-[var(--faint)]">有 {unlocated.size} 条划词在当前版本中未能定位（内容可能已改动）。</p>
          ) : null}
        </Sheet>
      ) : null}

      {sheet?.kind === "comments" ? (
        <Sheet title="提交本轮批注" onClose={() => setSheet(null)}>
          <p className="mb-2 text-[12px] text-[var(--muted)]">将当前 {marks.length} 条划词与下面的总评一起提交。结论：仅批注。</p>
          <textarea
            autoFocus
            value={verdictComment}
            onChange={(event) => setVerdictComment(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="可选：给作者的整体说明"
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[14px] outline-none focus:border-[var(--green)]"
          />
          <button type="button" onClick={() => submitVerdict("comments", verdictComment)} disabled={busy} className="mt-3 min-h-[44px] w-full rounded-xl bg-[var(--green)] text-sm font-bold text-white disabled:opacity-50">提交批注</button>
        </Sheet>
      ) : null}

      {sheet?.kind === "reject" ? (
        <Sheet title="打回这一稿" onClose={() => setSheet(null)}>
          {changeCount > 0 ? (
            <p className="mb-2 text-[12px] text-emerald-700">已有 {changeCount} 条「要改」划词，意见可留空。</p>
          ) : (
            <p className="mb-2 text-[12px] text-[var(--danger)]">没有「要改」划词时，必须写明打回意见。</p>
          )}
          <textarea
            autoFocus
            value={verdictComment}
            onChange={(event) => setVerdictComment(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="说明需要修改的地方…"
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[14px] outline-none focus:border-[var(--green)]"
          />
          <button
            type="button"
            onClick={() => submitVerdict("changes_requested", verdictComment)}
            disabled={busy || (!verdictComment.trim() && changeCount === 0)}
            className="mt-3 min-h-[44px] w-full rounded-xl bg-[var(--danger)] text-sm font-bold text-white disabled:opacity-50"
          >
            确认打回
          </button>
        </Sheet>
      ) : null}

      {sheet?.kind === "approve" ? (
        <Sheet title="通过确认" onClose={() => setSheet(null)}>
          <p className="mb-2 text-[12px] text-[var(--muted)]">通过后会写入反馈文件并进入下一轮。</p>
          <textarea
            autoFocus
            value={verdictComment}
            onChange={(event) => setVerdictComment(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="可选：留一句通过备注"
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[14px] outline-none focus:border-[var(--green)]"
          />
          <button type="button" onClick={() => submitVerdict("approved", verdictComment)} disabled={busy} className="mt-3 min-h-[44px] w-full rounded-xl bg-[var(--green)] text-sm font-bold text-white disabled:opacity-50">确认通过</button>
        </Sheet>
      ) : null}

      {toast ? (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4" style={{ userSelect: "none", pointerEvents: "none" }}>
          <div className="max-w-[420px] rounded-xl bg-[var(--ink)] px-4 py-2.5 text-center text-[13px] font-bold text-[var(--paper)] shadow-lg">{toast}</div>
        </div>
      ) : null}
    </div>
  );
}

export default ArticleReviewer;
