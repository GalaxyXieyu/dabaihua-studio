"use client";

/* eslint-disable @next/next/no-img-element */

import { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowBendDownRight,
  ArrowSquareOut,
  ArrowsClockwise,
  Bell,
  BookmarkSimple,
  BookOpenText,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  ChartBar,
  ChatText,
  CircleNotch,
  ClipboardText,
  ClockCountdown,
  CornersIn,
  CornersOut,
  Gear,
  Heart,
  LockKey,
  Key,
  Copy,
  Trash,
  MagnifyingGlass,
  Password,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  SignIn,
  SignOut,
  Trophy,
  Quotes,
  UploadSimple,
  User,
  Waves,
  X,
} from "@phosphor-icons/react";
import { SOURCE_CATEGORIES, sourceCategoryLabel, type SourceCategory } from "../lib/source-category";

type SessionUser = { id: number; account: string; nickname: string; bio: string; avatarUrl: string | null; role: "user" | "admin"; createdAt: string };
type Source = { id: number; kind: "rss" | "wechat" | "x"; category: SourceCategory; name: string; url: string; enabled: number | boolean; lastSyncedAt: string | null; lastError: string | null; avatarUrl: string | null; itemCount: number; contributorUserId: number | null; contributorNickname: string; canManage: number | boolean; isFollowed: number | boolean };
type Item = { id: number; sourceId: number | null; kind: "rss" | "link"; title: string; author: string | null; originalExcerpt: string | null; translatedTitle: string | null; translatedExcerpt: string | null; url: string; publishedAt: string | null; topic: string | null; status: "pending" | "ready" | "needs_ai"; isRead: number | boolean; isSaved: number | boolean; sourceName: string | null };
type Detail = Item & { contentMarkdown: string | null };
type ImportJob = { id: number; query: string; status: "pending" | "completed" | "failed"; stage: "queued" | "reading" | "importing" | "history" | "retrying" | "completed"; resultName: string | null; itemCount: number; lastError: string | null; createdAt: string; updatedAt: string | null };
type Dashboard = { sources: Source[]; items: Item[]; totalItems: number; imports: ImportJob[]; idea: { id: number; headline: string; angle: string } | null; itemsLoaded: boolean; user: SessionUser | null };
type LeaderboardData = { period: "today" | "yesterday"; day: string; reading: Array<{ id: number; nickname: string; avatarUrl: string | null; readCount: number; readSeconds: number }>; contribution: Array<{ id: number; nickname: string; avatarUrl: string | null; contributionCount: number }> };
type AnnotationReply = { id: number; annotationId: number; userId: number; nickname: string; avatarUrl: string | null; replyToUserId: number | null; replyToNickname: string | null; body: string; createdAt: string };
type Annotation = { id: number; itemId: number; userId: number; nickname: string; avatarUrl: string | null; quote: string; body: string; blockIndex: number; startOffset: number; endOffset: number; createdAt: string; updatedAt: string; replyCount: number; replies: AnnotationReply[]; itemTitle?: string; itemAuthor?: string | null; sourceName?: string | null };
type AnnotationSelection = { itemId: number; quote: string; blockIndex: number; startOffset: number; endOffset: number; top: number; left: number };
type ProfileSource = { id: number; kind: "rss" | "wechat" | "x"; category: SourceCategory | null; name: string; url: string; avatarUrl: string | null; itemCount: number };
type ProfileMessage = { id: number; authorUserId: number; nickname: string; avatarUrl: string | null; body: string; createdAt: string };
type PublicProfile = {
  user: Pick<SessionUser, "id" | "account" | "nickname" | "bio" | "avatarUrl" | "createdAt">;
  isOwner: boolean;
  metrics: { readCount: number; readSeconds: number; followedCount: number; contributionCount: number };
  likes: { count: number; likedByViewer: boolean; recent: Array<{ id: number; nickname: string; avatarUrl: string | null }> };
  annotations: Annotation[];
  followedSources: ProfileSource[];
  messages: ProfileMessage[];
};
type Notification = { id: number; type: "annotation_reply" | "profile_message" | "profile_like"; actorUserId: number; actorNickname: string; actorAvatarUrl: string | null; annotationId: number | null; itemId: number | null; profileMessageId: number | null; isRead: number | boolean; createdAt: string };
type DeskView = "today" | "discover" | "annotations" | "leaderboard" | "profile" | "settings";

const blank: Dashboard = { sources: [], items: [], totalItems: 0, imports: [], idea: null, itemsLoaded: false, user: null };
const SOURCE_PANE_PREFERENCE = "rss-ai-source-pane-collapsed";
const SOURCE_PANE_EVENT = "rss-ai-source-pane-preference";
const ARTICLE_PANE_WIDTH_PREFERENCE = "rss-ai-article-pane-width";
const DEFAULT_ARTICLE_PANE_WIDTH = 340;
const MIN_ARTICLE_PANE_WIDTH = 280;
const MAX_ARTICLE_PANE_WIDTH = 520;
const TOAST_DURATION_MS = 4_000;
const TODAY_REFRESH_INTERVAL_MS = 60_000;
const ARTICLE_BATCH_SIZE = 60;

function subscribeSourcePanePreference(onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === SOURCE_PANE_PREFERENCE) onStoreChange(); };
  window.addEventListener(SOURCE_PANE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SOURCE_PANE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function sourcePanePreferenceSnapshot() {
  return window.localStorage.getItem(SOURCE_PANE_PREFERENCE) === "1";
}

function setSourcePanePreference(collapsed: boolean) {
  window.localStorage.setItem(SOURCE_PANE_PREFERENCE, collapsed ? "1" : "0");
  window.dispatchEvent(new Event(SOURCE_PANE_EVENT));
}

function subscribeMobileViewport(onStoreChange: () => void) {
  const media = window.matchMedia("(max-width: 760px)");
  const initialCheck = window.setTimeout(onStoreChange, 0);
  media.addEventListener("change", onStoreChange);
  return () => {
    window.clearTimeout(initialCheck);
    media.removeEventListener("change", onStoreChange);
  };
}

function mobileViewportSnapshot() {
  return window.matchMedia("(max-width: 760px)").matches;
}

async function jsonRequest<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "暂时没处理好，请稍后再试");
  return data;
}

function post<T = Record<string, unknown>>(path: string, body: unknown) {
  return jsonRequest<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function verifyImageCanRender(url: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("头像已经保存，但新图片暂时无法显示，请刷新页面确认"));
    image.src = url;
  });
}

function when(value: string | null, long = false) {
  if (!value) return "日期未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.UTC(2006, 2, 21)) return "日期待同步";
  return new Intl.DateTimeFormat("zh-CN", long ? { year: "numeric", month: "long", day: "numeric" } : { month: "numeric", day: "numeric" }).format(date);
}

function annotationWhen(value: string) {
  const timestamp = new Date(value).getTime();
  const elapsed = Date.now() - timestamp;
  if (!Number.isFinite(timestamp) || elapsed < 0) return "刚刚";
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return when(value);
}

function shanghaiDateKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function isToday(value: string | null) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && shanghaiDateKey(date) === shanghaiDateKey();
}

function todayHeading() {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date());
}

function sourceStatus(source: Source) {
  if (!source.enabled) return "已暂停";
  if (source.lastError) return `同步失败：${source.lastError}`;
  if (source.lastSyncedAt) return `更新于 ${when(source.lastSyncedAt)}`;
  return source.kind === "x" ? "每小时自动更新" : "每日自动更新";
}

function sourceKind(source: Source) {
  if (source.kind === "wechat") return "微信公众号";
  if (source.kind === "x") return "X";
  return "博客";
}

function importStatusCopy(job: ImportJob) {
  const name = job.resultName || "公众号作者";
  if (job.status === "completed" && job.lastError) return { title: `${name} 已加入左侧`, detail: `已收录 ${job.itemCount || 1} 篇；历史文章会在后续同步中继续补齐` };
  if (job.status === "completed") return { title: `${name} 已加入左侧`, detail: `已导入 ${job.itemCount || 1} 篇文章，可以开始阅读` };
  if (job.stage === "reading") return { title: "正在识别公众号作者", detail: "先读取你刚提交的这篇文章" };
  if (job.stage === "importing") return { title: `正在导入 ${name}`, detail: "正文和图片上传完成后会自动清理缓存" };
  if (job.stage === "history") return { title: `正在补齐 ${name} 的文章`, detail: "完成后会自动出现在左侧来源列表" };
  if (job.stage === "retrying") return { title: "导入暂时未完成，正在重试", detail: "不用重新添加；若持续出现，请检查本地采集登录状态" };
  return { title: "已收到公众号链接", detail: "通常 1 分钟内开始识别" };
}

function importStageIndex(job: ImportJob) {
  if (job.status === "completed") return 4;
  return ({ queued: 0, reading: 1, importing: 2, history: 3, retrying: 1, completed: 4 })[job.stage] ?? 0;
}

function inlineMarkdown(text: string) {
  const chunks = text.split(/(\[[^\]]+\]\(https?:\/\/[^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return chunks.map((chunk, index): ReactNode => {
    const link = chunk.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (chunk.startsWith("**") && chunk.endsWith("**")) return <strong key={index}>{chunk.slice(2, -2)}</strong>;
    if (chunk.startsWith("`") && chunk.endsWith("`")) return <code key={index}>{chunk.slice(1, -1)}</code>;
    return chunk;
  });
}

const markdownImage = /^!\[([^\]]*)\]\(((?:https?:\/\/|\/api\/media\?key=|\/wechat-media\/)[^)]+)\)$/;

function articleBlocks(markdown: string) {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let fence: string[] | null = null;
  const flush = () => {
    const value = paragraph.join("\n").trim();
    if (value) blocks.push(value);
    paragraph = [];
  };
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      if (fence) {
        fence.push(rawLine);
        blocks.push(fence.join("\n"));
        fence = null;
      } else {
        flush();
        fence = [rawLine];
      }
      continue;
    }
    if (fence) {
      fence.push(rawLine);
      continue;
    }
    if (!line) {
      flush();
    } else if (markdownImage.test(line)) {
      flush();
      blocks.push(line);
    } else {
      paragraph.push(rawLine);
    }
  }
  if (fence) blocks.push(fence.join("\n"));
  flush();
  return blocks;
}

function textPoint(root: Element, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length || 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode();
  }
  return null;
}

function rangeFromOffsets(block: Element, startOffset: number, endOffset: number) {
  const start = textPoint(block, startOffset);
  const end = textPoint(block, endOffset);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function offsetWithin(block: Element, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(block);
  range.setEnd(node, offset);
  return range.toString().length;
}

function MarkdownArticle({ markdown, itemId, annotations, activeAnnotationId, onSelection, onAnnotationFocus }: { markdown: string; itemId: number; annotations: Annotation[]; activeAnnotationId: number | null; onSelection: (selection: AnnotationSelection | null, error?: string) => void; onAnnotationFocus: (annotation: Annotation) => void }) {
  const blocks = articleBlocks(markdown);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectingRef = useRef(false);
  const readSelectionRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const root = rootRef.current;
    const registry = (CSS as unknown as { highlights?: { set: (name: string, value: unknown) => void; delete: (name: string) => void } }).highlights;
    const HighlightConstructor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!root || !registry || !HighlightConstructor) return;
    const ranges = annotations.map((annotation) => {
      const block = root.querySelector(`[data-annotation-block="${annotation.blockIndex}"]`);
      return block ? rangeFromOffsets(block, annotation.startOffset, annotation.endOffset) : null;
    }).filter((range): range is Range => Boolean(range));
    if (ranges.length) registry.set("reader-annotations", new HighlightConstructor(...ranges));
    else registry.delete("reader-annotations");
    const active = activeAnnotationId ? annotations.find((annotation) => annotation.id === activeAnnotationId) : null;
    const activeBlock = active ? root.querySelector(`[data-annotation-block="${active.blockIndex}"]`) : null;
    const activeRange = active && activeBlock ? rangeFromOffsets(activeBlock, active.startOffset, active.endOffset) : null;
    if (activeRange) registry.set("reader-annotation-active", new HighlightConstructor(activeRange));
    else registry.delete("reader-annotation-active");
    return () => {
      registry.delete("reader-annotations");
      registry.delete("reader-annotation-active");
    };
  }, [activeAnnotationId, annotations, markdown]);

  useEffect(() => {
    const finishSelection = () => {
      if (!selectingRef.current) return;
      selectingRef.current = false;
      readSelectionRef.current();
    };
    window.addEventListener("pointerup", finishSelection, true);
    window.addEventListener("pointercancel", finishSelection, true);
    return () => {
      window.removeEventListener("pointerup", finishSelection, true);
      window.removeEventListener("pointercancel", finishSelection, true);
    };
  }, []);

  function readSelection() {
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || !rootRef.current) {
        onSelection(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const startElement = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement) as Element | null;
      const endElement = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement) as Element | null;
      const startBlock = startElement?.closest<HTMLElement>("[data-annotation-block]");
      const endBlock = endElement?.closest<HTMLElement>("[data-annotation-block]");
      if (!startBlock || startBlock !== endBlock || !rootRef.current.contains(startBlock)) {
        onSelection(null, "一次请选择同一段中的文字");
        return;
      }
      const quote = selection.toString().replace(/\s+/g, " ").trim();
      if (!quote) { onSelection(null); return; }
      if (quote.length > 800) { onSelection(null, "单条批注最多选择 800 个字符"); return; }
      const rect = range.getBoundingClientRect();
      const startOffset = offsetWithin(startBlock, range.startContainer, range.startOffset);
      const endOffset = offsetWithin(startBlock, range.endContainer, range.endOffset);
      onSelection({
        itemId,
        quote,
        blockIndex: Number(startBlock.dataset.annotationBlock),
        startOffset: Math.min(startOffset, endOffset),
        endOffset: Math.max(startOffset, endOffset),
        top: Math.max(12, rect.top - 52),
        left: Math.min(window.innerWidth - 58, Math.max(58, rect.left + rect.width / 2)),
      });
    }, 0);
  }

  useEffect(() => { readSelectionRef.current = readSelection; });

  function focusClickedAnnotation(event: ReactMouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const position = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
    const fallbackRange = position ? null : documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = position?.offsetNode || fallbackRange?.startContainer;
    const offset = position?.offset ?? fallbackRange?.startOffset;
    if (!node || offset === undefined || !rootRef.current) return;
    const element = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element | null;
    const block = element?.closest<HTMLElement>("[data-annotation-block]");
    if (!block || !rootRef.current.contains(block)) return;
    const blockIndex = Number(block.dataset.annotationBlock);
    const clickOffset = offsetWithin(block, node, offset);
    const annotation = annotations.find((candidate) => candidate.blockIndex === blockIndex && clickOffset >= candidate.startOffset && clickOffset <= candidate.endOffset);
    if (annotation) onAnnotationFocus(annotation);
  }

  return <div className="markdown-article" lang="zh-CN" ref={rootRef} onPointerDown={() => { selectingRef.current = true; }} onClick={focusClickedAnnotation} onKeyUp={readSelection}>
    <style>{`::highlight(reader-annotations){color:inherit;background:transparent;text-decoration-line:underline;text-decoration-color:oklch(56% .15 264 / .72);text-decoration-thickness:1px;text-underline-offset:4px}::highlight(reader-annotation-active){color:inherit;background:transparent;text-decoration-line:underline;text-decoration-color:var(--green);text-decoration-thickness:2px;text-underline-offset:4px}`}</style>
    {blocks.map((block, index) => {
      const image = block.match(markdownImage);
      if (image) return <figure key={index}><img src={image[2]} alt={image[1]} loading="lazy" /><figcaption>{image[1]}</figcaption></figure>;
      const codeFence = block.match(/^```([^\n]*)\n([\s\S]*?)\n?```$/);
      if (codeFence) return <pre key={index} data-language={codeFence[1] || undefined} data-annotation-block={index}><code>{codeFence[2]}</code></pre>;
      const heading = block.match(/^(#{1,4})\s+([\s\S]+)$/);
      if (heading) {
        const Tag = `h${Math.min(heading[1].length + 1, 5)}` as keyof React.JSX.IntrinsicElements;
        return <Tag key={index} data-annotation-block={index}>{inlineMarkdown(heading[2])}</Tag>;
      }
      if (block.startsWith("> ")) return <blockquote key={index} data-annotation-block={index}>{inlineMarkdown(block.slice(2))}</blockquote>;
      const lines = block.split("\n");
      if (lines.every((line) => /^-\s+/.test(line))) return <ul key={index} data-annotation-block={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineMarkdown(line.replace(/^-\s+/, ""))}</li>)}</ul>;
      return <p key={index} data-annotation-block={index}>{lines.map((line, lineIndex) => <span key={lineIndex}>{inlineMarkdown(line)}{lineIndex < lines.length - 1 && <br />}</span>)}</p>;
    })}
  </div>;
}

function Avatar({ user, size = "normal" }: { user: { nickname: string; avatarUrl: string | null }; size?: "small" | "normal" | "large" | "leaderboard" }) {
  return <span className={`user-avatar ${size}`} aria-hidden="true">
    {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user.nickname.slice(0, 1).toUpperCase()}
  </span>;
}

function sourceImageUrl(source: Source) {
  if (source.avatarUrl) return source.avatarUrl;
  if (source.kind === "rss" || source.kind === "x") return `/api/source-avatar?id=${source.id}`;
  return null;
}

function scrollToContainerCenter(container: HTMLElement | null, element: Element | null) {
  if (!container || !element) return;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const top = container.scrollTop + elementRect.top - containerRect.top - (container.clientHeight - elementRect.height) / 2;
  container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function keepAnnotationPosition(block: Element, card: HTMLElement) {
  const recenter = () => {
    scrollToContainerCenter(document.querySelector<HTMLElement>(".reader-pane"), block);
    scrollToContainerCenter(document.querySelector<HTMLElement>(".annotation-sidebar-scroll"), card);
  };
  recenter();
  const pendingImages = [...document.querySelectorAll<HTMLImageElement>(".reader-document img")].filter((image) =>
    !image.complete && Boolean(image.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING));
  pendingImages.forEach((image) => {
    image.addEventListener("load", recenter, { once: true });
    image.addEventListener("error", recenter, { once: true });
  });
  return () => pendingImages.forEach((image) => {
    image.removeEventListener("load", recenter);
    image.removeEventListener("error", recenter);
  });
}

function SourceAvatar({ source }: { source: Source }) {
  const imageUrl = sourceImageUrl(source);
  const [failedUrl, setFailedUrl] = useState("");
  const showImage = Boolean(imageUrl && imageUrl !== failedUrl);
  return <span className={`source-avatar ${showImage ? "has-image" : ""}`}>
    {showImage ? <img src={imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(imageUrl!)} /> : source.name.slice(0, 1).toUpperCase()}
  </span>;
}

function ProfileSourceAvatar({ source }: { source: ProfileSource }) {
  const imageUrl = source.avatarUrl || (source.kind === "rss" || source.kind === "x" ? `/api/source-avatar?id=${source.id}` : null);
  const [failedUrl, setFailedUrl] = useState("");
  const showImage = Boolean(imageUrl && imageUrl !== failedUrl);
  return <span className={`source-avatar ${showImage ? "has-image" : ""}`}>
    {showImage ? <img src={imageUrl!} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(imageUrl!)} /> : source.name.slice(0, 1).toUpperCase()}
  </span>;
}

function ProfileSourceLink({ source, onOpen }: { source: ProfileSource; onOpen: () => void }) {
  return <button type="button" onClick={onOpen}><ProfileSourceAvatar source={source} /><span><strong>{source.name}</strong><small>{source.kind === "wechat" ? "微信公众号" : source.kind === "x" ? "X" : "博客"} · {source.itemCount} 篇</small></span><CaretRight size={14} weight="bold" /></button>;
}

function AnnotationCard({ annotation, active, user, busy, onFocus, onReply, onRequireLogin, onOpenProfile }: { annotation: Annotation; active: boolean; user: SessionUser | null; busy: string; onFocus: () => void; onReply: (annotationId: number, replyToUserId: number, body: string) => Promise<void>; onRequireLogin: () => void; onOpenProfile: (userId: number) => void }) {
  const [replyTarget, setReplyTarget] = useState<{ id: number; nickname: string } | null>(null);
  const [replyBody, setReplyBody] = useState("");

  function startReply(target: { id: number; nickname: string }) {
    if (!user) { onRequireLogin(); return; }
    setReplyTarget(target);
    setReplyBody("");
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!replyTarget || !replyBody.trim()) return;
    try {
      await onReply(annotation.id, replyTarget.id, replyBody);
      setReplyTarget(null);
      setReplyBody("");
    } catch { /* Keep the draft in place so the user can retry. */ }
  }

  return <article className={`annotation-card ${active ? "active" : ""}`} id={`annotation-card-${annotation.id}`} onClick={onFocus}>
    <div className="annotation-card-marker" aria-label={`原文第 ${annotation.blockIndex + 1} 段`}><span aria-hidden="true" />原文第 {annotation.blockIndex + 1} 段</div>
    <button className="annotation-quote" type="button" onClick={onFocus}><Quotes size={14} weight="fill" aria-hidden="true" /><span>{annotation.quote}</span></button>
    <div className="annotation-author"><button className="user-identity-link" type="button" onClick={(event) => { event.stopPropagation(); onOpenProfile(annotation.userId); }}><Avatar user={annotation} size="small" /><strong>{annotation.nickname}</strong></button><time>{annotationWhen(annotation.createdAt)}</time></div>
    <p>{annotation.body}</p>
    <button className="annotation-reply-action" type="button" onClick={(event) => { event.stopPropagation(); startReply({ id: annotation.userId, nickname: annotation.nickname }); }}><ArrowBendDownRight size={13} aria-hidden="true" />回复</button>
    {annotation.replies.length > 0 && <div className="annotation-replies">
      {annotation.replies.map((reply) => <div className="annotation-reply" key={reply.id}>
        <button className="avatar-link" type="button" aria-label={`查看 ${reply.nickname} 的主页`} onClick={(event) => { event.stopPropagation(); onOpenProfile(reply.userId); }}><Avatar user={reply} size="small" /></button>
        <div><p><button type="button" onClick={(event) => { event.stopPropagation(); onOpenProfile(reply.userId); }}>{reply.nickname}</button>{reply.replyToNickname && <><span> 回复 </span><strong>@{reply.replyToNickname}</strong></>}：{reply.body}</p><time>{annotationWhen(reply.createdAt)}</time><button className="annotation-inline-reply" type="button" onClick={(event) => { event.stopPropagation(); startReply({ id: reply.userId, nickname: reply.nickname }); }}>回复</button></div>
      </div>)}
    </div>}
    {replyTarget && <form className="annotation-reply-form" onSubmit={submitReply} onClick={(event) => event.stopPropagation()}>
      <label htmlFor={`reply-${annotation.id}`}>回复 @{replyTarget.nickname}</label>
      <div><textarea id={`reply-${annotation.id}`} value={replyBody} maxLength={500} rows={2} autoFocus placeholder={`@${replyTarget.nickname}：`} onChange={(event) => setReplyBody(event.target.value)} /><button type="submit" aria-label="发布回复" disabled={!replyBody.trim() || busy === `reply-${annotation.id}`}><PaperPlaneTilt size={15} weight="fill" /></button></div>
      <button type="button" onClick={() => setReplyTarget(null)}>取消</button>
    </form>}
  </article>;
}

function AnnotationSidebar({ annotations, loading, draft, user, activeAnnotationId, busy, onCollapse, onCancelDraft, onCreate, onFocus, onReply, onRequireLogin, onOpenProfile }: { annotations: Annotation[]; loading: boolean; draft: AnnotationSelection | null; user: SessionUser | null; activeAnnotationId: number | null; busy: string; onCollapse: () => void; onCancelDraft: () => void; onCreate: (body: string) => Promise<void>; onFocus: (annotation: Annotation) => void; onReply: (annotationId: number, replyToUserId: number, body: string) => Promise<void>; onRequireLogin: () => void; onOpenProfile: (userId: number) => void }) {
  const [body, setBody] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!draft) setBody("");
      else inputRef.current?.focus();
    }, draft ? 80 : 0);
    return () => window.clearTimeout(timer);
  }, [draft]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    try {
      await onCreate(body);
      setBody("");
    } catch { /* Keep the draft in place so the user can retry. */ }
  }

  return <aside className="annotation-sidebar" aria-label="文章批注">
    <header><div><ChatText size={17} weight="duotone" aria-hidden="true" /><strong>批注</strong><span>{annotations.length}</span></div><button type="button" aria-label="收起批注栏" title="收起批注栏" onClick={onCollapse}><CaretRight size={15} weight="bold" /></button></header>
    <div className="annotation-sidebar-scroll">
      {draft && <form className="annotation-composer" onSubmit={submit}>
        <blockquote>{draft.quote}</blockquote>
        {user ? <><div className="annotation-author"><Avatar user={user} size="small" /><strong>{user.nickname}</strong></div><textarea ref={inputRef} value={body} maxLength={1000} rows={4} placeholder="写下你对这段话的理解…" onChange={(event) => setBody(event.target.value)} /><div className="annotation-composer-actions"><button type="button" onClick={onCancelDraft}>取消</button><button className="primary" disabled={!body.trim() || busy === "annotation-create"}>{busy === "annotation-create" ? "发布中" : "发布批注"}</button></div></> : <button className="annotation-login" type="button" onClick={onRequireLogin}>登录后发布批注</button>}
      </form>}
      {loading && <div className="annotation-loading" role="status"><i /><i /><i /></div>}
      {!loading && annotations.length === 0 && draft && <p className="annotation-first-note">这会成为这段原文的第一条公开批注。</p>}
      {!loading && annotations.map((annotation) => <AnnotationCard annotation={annotation} active={activeAnnotationId === annotation.id} user={user} busy={busy} key={annotation.id} onFocus={() => onFocus(annotation)} onReply={onReply} onRequireLogin={onRequireLogin} onOpenProfile={onOpenProfile} />)}
    </div>
  </aside>;
}

function AnnotationFeedCard({ annotation, onOpen, onOpenProfile }: { annotation: Annotation; onOpen: () => void; onOpenProfile: (userId: number) => void }) {
  return <article className="annotation-feed-card">
    <div className="annotation-feed-author"><button className="user-identity-link" type="button" onClick={() => onOpenProfile(annotation.userId)}><Avatar user={annotation} size="normal" /><strong>{annotation.nickname}</strong></button><time>{annotationWhen(annotation.createdAt)}</time>{annotation.replyCount > 0 && <span><ChatText size={13} />{annotation.replyCount}</span>}</div>
    <p>{annotation.body}</p>
    <button type="button" onClick={onOpen}>
      <blockquote>{annotation.quote}</blockquote>
      <span><strong>{annotation.itemTitle || "未命名文章"}</strong><small>{annotation.itemAuthor || annotation.sourceName || "未知作者"}</small></span>
      <CaretRight size={15} weight="bold" aria-hidden="true" />
    </button>
  </article>;
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("input,button,textarea,select")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`modal-card ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialogRef}>
      <div className="modal-head"><h2 id="modal-title">{title}</h2><button type="button" aria-label="关闭" onClick={onClose}><X size={16} /></button></div>
      {children}
    </div>
  </div>;
}

function formatDuration(seconds: number) {
  if (seconds < 60) return seconds > 0 ? "不足 1 分钟" : "0 分钟";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
}

function ProfileDurationValue({ seconds }: { seconds: number }) {
  if (seconds < 60) return <>{seconds > 0 ? "<1" : "0"}<em>分钟</em></>;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return <>{hours}<em>小时{minutes ? ` ${minutes} 分` : ""}</em></>;
  return <>{minutes}<em>分钟</em></>;
}

function RankMarker({ position }: { position: number }) {
  return <span className={`rank-number ${position <= 3 ? "podium" : ""} rank-${position}`} aria-label={`第 ${position} 名`}><span aria-hidden="true">{position}</span></span>;
}

export function DeskApp({ initialView = "today" }: { initialView?: DeskView }) {
  const [data, setData] = useState<Dashboard>(blank);
  const [sourceItems, setSourceItems] = useState<Record<number, Item[]>>({});
  const [linkedItems, setLinkedItems] = useState<Record<number, Item>>({});
  const [loading, setLoading] = useState(true);
  const [dashboardInitialized, setDashboardInitialized] = useState(false);
  const [selectedSource, setSelectedSource] = useState<number | "all">("all");
  const [selectedCategory, setSelectedCategory] = useState<SourceCategory | "all">("all");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [readerMode, setReaderMode] = useState<"clean" | "original">("clean");
  const [details, setDetails] = useState<Record<number, Detail>>({});
  const [query, setQuery] = useState("");
  const [articleStatus, setArticleStatus] = useState<"unread" | "read">("unread");
  const [visibleItemLimit, setVisibleItemLimit] = useState(ARTICLE_BATCH_SIZE);
  const [addOpen, setAddOpen] = useState(false);
  const [sourceInput, setSourceInput] = useState("");
  const [sourceCategory, setSourceCategory] = useState<SourceCategory>("ai");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [avatarFeedback, setAvatarFeedback] = useState<{ kind: "working" | "success" | "error"; message: string } | null>(null);
  const [activeImportId, setActiveImportId] = useState<number | null>(null);
  const [view, setView] = useState<DeskView>(initialView);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");
  const [registrationSuccess, setRegistrationSuccess] = useState<SessionUser | null>(null);
  const [authAccount, setAuthAccount] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirm, setAuthConfirm] = useState("");
  const [authNickname, setAuthNickname] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [apiTokens, setApiTokens] = useState<Array<{ id: number; name: string; createdAt: string; lastUsedAt: string | null }>>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [freshToken, setFreshToken] = useState<{ name: string; token: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileNickname, setProfileNickname] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileUserId, setProfileUserId] = useState<number | null>(null);
  const [profileData, setProfileData] = useState<PublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileTargetResolved, setProfileTargetResolved] = useState(initialView !== "profile");
  const [profileError, setProfileError] = useState("");
  const [profileMessageBody, setProfileMessageBody] = useState("");
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<"today" | "yesterday">("today");
  const [leaderboardMetric, setLeaderboardMetric] = useState<"reading" | "contribution">("reading");
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardData | null>(null);
  const [todayItemId, setTodayItemId] = useState<number | null>(null);
  const [todaySessionStarted, setTodaySessionStarted] = useState(false);
  const [discoverImmersive, setDiscoverImmersive] = useState(false);
  const [mobileSourcePaneOpen, setMobileSourcePaneOpen] = useState(false);
  const [articlePaneWidth, setArticlePaneWidth] = useState(DEFAULT_ARTICLE_PANE_WIDTH);
  const [annotationsByItem, setAnnotationsByItem] = useState<Record<number, Annotation[]>>({});
  const [annotationsLoading, setAnnotationsLoading] = useState(false);
  const [annotationPanelOpen, setAnnotationPanelOpen] = useState(false);
  const [selectionDraft, setSelectionDraft] = useState<AnnotationSelection | null>(null);
  const [selectionActionVisible, setSelectionActionVisible] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<number | null>(null);
  const [plazaSort, setPlazaSort] = useState<"latest" | "hot">("latest");
  const [plazaAnnotations, setPlazaAnnotations] = useState<Annotation[]>([]);
  const [plazaLoading, setPlazaLoading] = useState(false);
  const storedSourcePaneCollapsed = useSyncExternalStore(subscribeSourcePanePreference, sourcePanePreferenceSnapshot, () => false);
  const mobileViewport = useSyncExternalStore(subscribeMobileViewport, mobileViewportSnapshot, () => false);
  const sourcePaneCollapsed = mobileViewport ? false : storedSourcePaneCollapsed;
  const announcedImports = useRef(new Set<number>());
  const linkedItemRequests = useRef(new Set<number>());
  const lastActivityAt = useRef(0);
  const requestedAnnotationId = useRef<number | null>(null);
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(ARTICLE_PANE_WIDTH_PREFERENCE);
    if (storedValue === null) return;
    const storedWidth = Number(storedValue);
    const timer = window.setTimeout(() => {
      if (Number.isFinite(storedWidth)) setArticlePaneWidth(Math.min(MAX_ARTICLE_PANE_WIDTH, Math.max(MIN_ARTICLE_PANE_WIDTH, storedWidth)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleSourcePane() {
    if (mobileViewport) {
      setMobileSourcePaneOpen((open) => !open);
      return;
    }
    setSourcePanePreference(!sourcePaneCollapsed);
  }

  function articlePaneWidthBounds() {
    const sourceWidth = sourcePaneCollapsed ? 56 : 280;
    const availableMaximum = window.innerWidth - sourceWidth - 560;
    return { min: MIN_ARTICLE_PANE_WIDTH, max: Math.max(MIN_ARTICLE_PANE_WIDTH, Math.min(MAX_ARTICLE_PANE_WIDTH, availableMaximum)) };
  }

  function saveArticlePaneWidth(width: number) {
    const { min, max } = articlePaneWidthBounds();
    const nextWidth = Math.round(Math.min(max, Math.max(min, width)));
    setArticlePaneWidth(nextWidth);
    window.localStorage.setItem(ARTICLE_PANE_WIDTH_PREFERENCE, String(nextWidth));
  }

  function startArticlePaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = articlePaneWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (pointerEvent: PointerEvent) => {
      const { min, max } = articlePaneWidthBounds();
      setArticlePaneWidth(Math.round(Math.min(max, Math.max(min, startWidth + pointerEvent.clientX - startX))));
    };
    const finish = (pointerEvent: PointerEvent) => {
      move(pointerEvent);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.localStorage.setItem(ARTICLE_PANE_WIDTH_PREFERENCE, String(Math.round(Math.min(articlePaneWidthBounds().max, Math.max(MIN_ARTICLE_PANE_WIDTH, startWidth + pointerEvent.clientX - startX)))));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function resizeArticlePaneWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") { event.preventDefault(); saveArticlePaneWidth(articlePaneWidth - 16); }
    if (event.key === "ArrowRight") { event.preventDefault(); saveArticlePaneWidth(articlePaneWidth + 16); }
    if (event.key === "Home") { event.preventDefault(); saveArticlePaneWidth(MIN_ARTICLE_PANE_WIDTH); }
    if (event.key === "End") { event.preventDefault(); saveArticlePaneWidth(MAX_ARTICLE_PANE_WIDTH); }
  }

  function openAddSource() {
    setSourcePanePreference(false);
    if (!data.user) {
      openAuth("register");
      setNotice("注册或登录后即可收录新来源");
      return;
    }
    setAddOpen(true);
  }

  function openAuth(mode: "login" | "register") {
    setAuthMode(mode);
    setAuthError("");
    setAuthOpen(true);
  }

  function navigate(next: DeskView) {
    setView(next);
    if (next === "settings") void loadApiTokens();
    if (next !== "discover") setMobileSourcePaneOpen(false);
    setUserMenuOpen(false);
    setNotificationOpen(false);
    if (next === "today") {
      setTodayItemId(null);
      setTodaySessionStarted(false);
    }
    if (next !== "discover") setDiscoverImmersive(false);
    if (next === "profile" && data.user) {
      setProfileUserId(data.user.id);
      setProfileData(null);
      setProfileError("");
      setProfileTargetResolved(true);
      setProfileNickname(data.user.nickname);
      setProfileBio(data.user.bio);
      setProfileEditing(false);
    } else if (next === "profile") {
      setProfileUserId(null);
      setProfileData(null);
      setProfileError("");
      setProfileTargetResolved(true);
    }
    if (next === "leaderboard") setLeaderboardData(null);
    const path = next === "today" ? "/" : next === "discover" ? "/discover" : `/${next}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  }

  function openProfile(userId: number) {
    if (!Number.isInteger(userId) || userId <= 0) return;
    setView("profile");
    setProfileUserId(userId);
    setProfileData(null);
    setProfileError("");
    setProfileTargetResolved(true);
    setProfileEditing(false);
    setProfileMessageBody("");
    setUserMenuOpen(false);
    setNotificationOpen(false);
    setDiscoverImmersive(false);
    const path = data.user?.id === userId ? "/profile" : `/profile?user=${userId}`;
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState({}, "", path);
  }

  async function refresh() {
    const dashboard = await jsonRequest<Dashboard>("/api/dashboard?view=discover", { cache: "no-store" });
    setData(dashboard);
    if (selectedSource !== "all") {
      const result = await jsonRequest<{ items: Item[] }>(`/api/items?sourceId=${selectedSource}`, { cache: "no-store" });
      setSourceItems((current) => ({ ...current, [selectedSource]: result.items }));
    }
    return dashboard;
  }

  const loadLinkedItem = useCallback(async (itemId: number) => {
    if (data.items.some((item) => item.id === itemId) || linkedItems[itemId] || linkedItemRequests.current.has(itemId)) return;
    linkedItemRequests.current.add(itemId);
    try {
      const detail = await jsonRequest<Detail>(`/api/items?id=${itemId}`, { cache: "no-store" });
      setDetails((current) => ({ ...current, [itemId]: detail }));
      setLinkedItems((current) => ({ ...current, [itemId]: detail }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "对应文章暂时没有加载出来");
    } finally {
      linkedItemRequests.current.delete(itemId);
    }
  }, [data.items, linkedItems]);

  useEffect(() => {
    let active = true;
    jsonRequest<Dashboard>(`/api/dashboard?view=${initialView}`, { cache: "no-store" })
      .then((dashboard) => {
        if (!active) return;
        setData(dashboard);
        if (dashboard.user) {
          setProfileNickname(dashboard.user.nickname);
          setProfileBio(dashboard.user.bio);
        }
        if (initialView === "profile") {
          const requestedId = Number(new URLSearchParams(window.location.search).get("user"));
          const targetId = Number.isInteger(requestedId) && requestedId > 0 ? requestedId : dashboard.user?.id || null;
          setProfileUserId(targetId);
          setProfileLoading(Boolean(targetId));
          setProfileTargetResolved(true);
        }
      })
      .catch((error) => {
        if (!active) return;
        setNotice(error.message);
        if (initialView === "profile") setProfileTargetResolved(true);
      })
      .finally(() => { if (active) { setLoading(false); setDashboardInitialized(true); } });
    return () => { active = false; };
  }, [initialView]);

  useEffect(() => {
    const needsReadingData = view === "discover" || (view === "today" && Boolean(data.user));
    if (!dashboardInitialized || !needsReadingData || data.itemsLoaded) return;
    let active = true;
    Promise.resolve().then(() => { if (active) setLoading(true); });
    jsonRequest<Dashboard>("/api/dashboard?view=discover", { cache: "no-store" })
      .then((dashboard) => {
        if (!active) return;
        setData(dashboard);
        if (dashboard.user) {
          setProfileNickname(dashboard.user.nickname);
          setProfileBio(dashboard.user.bio);
        }
      })
      .catch((error) => { if (active) setNotice(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [dashboardInitialized, data.itemsLoaded, data.user, view]);

  useEffect(() => {
    const onPopState = () => {
      const nextView = window.location.pathname === "/annotations" ? "annotations" : window.location.pathname === "/leaderboard" ? "leaderboard" : window.location.pathname === "/profile" ? "profile" : window.location.pathname === "/discover" ? "discover" : "today";
      setView(nextView);
      if (nextView === "profile") {
        const requestedId = Number(new URLSearchParams(window.location.search).get("user"));
        setProfileUserId(Number.isInteger(requestedId) && requestedId > 0 ? requestedId : data.user?.id || null);
        setProfileData(null);
        setProfileError("");
        setProfileTargetResolved(true);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [data.user?.id]);

  useEffect(() => {
    if (loading || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const itemId = Number(params.get("item"));
    const annotationId = Number(params.get("annotation"));
    if (!Number.isInteger(itemId) || itemId <= 0) return;
    requestedAnnotationId.current = Number.isInteger(annotationId) && annotationId > 0 ? annotationId : null;
    window.setTimeout(() => {
      if (!data.items.some((item) => item.id === itemId)) void loadLinkedItem(itemId);
      setView("discover");
      setSelectedCategory("all");
      setSelectedSource("all");
      setSelectedItemId(itemId);
      setReaderMode("clean");
      setDiscoverImmersive(params.get("immersive") !== "0");
    }, 0);
  }, [data.items, loadLinkedItem, loading]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!mobileSourcePaneOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileSourcePaneOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileSourcePaneOpen]);

  useEffect(() => {
    if (!userMenuOpen && !notificationOpen) return;
    const closeMenus = () => {
      setUserMenuOpen(false);
      setNotificationOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenus();
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".global-user-wrap")) closeMenus();
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [notificationOpen, userMenuOpen]);

  useEffect(() => {
    if (view !== "leaderboard") return;
    let active = true;
    jsonRequest<LeaderboardData>(`/api/leaderboard?period=${leaderboardPeriod}`, { cache: "no-store" })
      .then((result) => { if (active) setLeaderboardData(result); })
      .catch((error) => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [leaderboardPeriod, view]);

  useEffect(() => {
    if (view !== "annotations") return;
    let active = true;
    Promise.resolve().then(() => { if (active) setPlazaLoading(true); });
    jsonRequest<{ annotations: Annotation[] }>(`/api/annotations?scope=plaza&sort=${plazaSort}`, { cache: "no-store" })
      .then((result) => { if (active) setPlazaAnnotations(result.annotations); })
      .catch((error) => { if (active) setNotice(error.message); })
      .finally(() => { if (active) setPlazaLoading(false); });
    return () => { active = false; };
  }, [plazaSort, view]);

  useEffect(() => {
    if (view !== "profile" || !profileUserId) return;
    let active = true;
    Promise.resolve().then(() => { if (active) { setProfileLoading(true); setProfileError(""); } });
    jsonRequest<{ profile: PublicProfile }>(`/api/profile?userId=${profileUserId}`, { cache: "no-store" })
      .then((result) => {
        if (!active) return;
        setProfileData(result.profile);
        if (result.profile.isOwner) {
          setProfileNickname(result.profile.user.nickname);
          setProfileBio(result.profile.user.bio);
        }
      })
      .catch((error) => { if (active) { setProfileData(null); setProfileError(error.message); setNotice(error.message); } })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [profileUserId, view]);

  useEffect(() => {
    if (!data.user) return;
    let active = true;
    const load = () => {
      setNotificationsLoading(true);
      jsonRequest<{ notifications: Notification[] }>("/api/notifications", { cache: "no-store" })
        .then((result) => { if (active) setNotifications(result.notifications); })
        .catch(() => undefined)
        .finally(() => { if (active) setNotificationsLoading(false); });
    };
    load();
    const timer = window.setInterval(load, 45_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [data.user]);

  const hasPendingImports = data.imports.some((job) => job.status === "pending");
  const pendingImportId = data.imports.find((job) => job.status === "pending")?.id || null;

  useEffect(() => {
    if (!hasPendingImports) return;
    const timer = window.setInterval(() => {
      jsonRequest<Dashboard>("/api/dashboard?view=discover", { cache: "no-store" }).then((dashboard) => {
        setData(dashboard);
        const trackedId = activeImportId || pendingImportId;
        if (activeImportId === null && trackedId) setActiveImportId(trackedId);
        const job = dashboard.imports.find((candidate) => candidate.id === trackedId);
        if (!job || job.status !== "completed" || announcedImports.current.has(job.id)) return;
        announcedImports.current.add(job.id);
        setNotice(job.lastError
          ? `${job.resultName || "公众号"} 已收录并自动关注，目前收录 ${job.itemCount || 1} 篇；历史文章稍后补齐，可前往发现来源查看`
          : `${job.resultName || "公众号"} 已收录并自动关注，导入 ${job.itemCount || 1} 篇文章，可前往发现来源查看`);
      }).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeImportId, hasPendingImports, pendingImportId]);

  useEffect(() => {
    if (selectedSource === "all") return;
    const controller = new AbortController();
    jsonRequest<{ items: Item[] }>(`/api/items?sourceId=${selectedSource}`, { cache: "no-store", signal: controller.signal })
      .then((result) => setSourceItems((current) => ({ ...current, [selectedSource]: result.items })))
      .catch((error) => { if (error.name !== "AbortError") setNotice(error.message); });
    return () => controller.abort();
  }, [selectedSource]);

  const filteredSources = useMemo(() => selectedCategory === "all"
    ? data.sources
    : data.sources.filter((source) => source.category === selectedCategory), [data.sources, selectedCategory]);

  const sourceCategoryCounts = useMemo(() => Object.fromEntries(SOURCE_CATEGORIES.map(({ value }) => [
    value,
    data.sources.filter((source) => source.category === value).length,
  ])) as Record<SourceCategory, number>, [data.sources]);

  const currentItems = useMemo(() => {
    if (selectedSource !== "all") return sourceItems[selectedSource] || data.items.filter((item) => item.sourceId === selectedSource);
    if (selectedCategory === "all") {
      const existingIds = new Set(data.items.map((item) => item.id));
      return [...Object.values(linkedItems).filter((item) => !existingIds.has(item.id)), ...data.items];
    }
    const sourceIds = new Set(filteredSources.map((source) => source.id));
    return data.items.filter((item) => item.sourceId !== null && sourceIds.has(item.sourceId));
  }, [data.items, filteredSources, linkedItems, selectedCategory, selectedSource, sourceItems]);

  const articleStatusCounts = useMemo(() => ({
    unread: currentItems.filter((item) => !Boolean(item.isRead)).length,
    read: currentItems.filter((item) => Boolean(item.isRead)).length,
  }), [currentItems]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return currentItems.filter((item) => {
      const sourceMatch = selectedSource === "all" || item.sourceId === selectedSource;
      const statusMatch = articleStatus === "read" ? Boolean(item.isRead) : !Boolean(item.isRead);
      const textMatch = !needle || `${item.title} ${item.translatedTitle || ""} ${item.author || ""} ${item.sourceName || ""}`.toLowerCase().includes(needle);
      return sourceMatch && statusMatch && textMatch;
    }).sort((left, right) => {
      const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : Number.NEGATIVE_INFINITY;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return right.id - left.id;
    });
  }, [articleStatus, currentItems, query, selectedSource]);

  const renderedItems = useMemo(() => visibleItems.slice(0, visibleItemLimit), [visibleItemLimit, visibleItems]);

  const followedSourceIds = useMemo(() => new Set(data.sources.filter((source) => Boolean(source.isFollowed)).map((source) => source.id)), [data.sources]);
  const todayItems = useMemo(() => data.items.filter((item) => item.sourceId !== null && followedSourceIds.has(item.sourceId) && isToday(item.publishedAt)).sort((left, right) => {
    const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
    const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
    return rightTime - leftTime || right.id - left.id;
  }), [data.items, followedSourceIds]);
  const todaySourceIds = useMemo(() => new Set(todayItems.map((item) => item.sourceId).filter((id): id is number => id !== null)), [todayItems]);
  const todaySources = useMemo(() => data.sources.filter((source) => todaySourceIds.has(source.id)), [data.sources, todaySourceIds]);
  const todayReadCount = todayItems.filter((item) => Boolean(item.isRead)).length;
  const todayUnreadCount = todayItems.length - todayReadCount;
  const todayEstimatedMinutes = todayItems.length ? Math.max(5, todayItems.length * 4) : 0;

  const effectiveItemId = selectedItemId && currentItems.some((item) => item.id === selectedItemId) ? selectedItemId : null;
  const discoveryItem = currentItems.find((item) => item.id === effectiveItemId) || null;
  const todayItem = todayItems.find((item) => item.id === todayItemId) || null;
  const selectedItem = view === "today" ? todayItem : discoveryItem;
  const todayCurrentIndex = todayItem ? todayItems.findIndex((item) => item.id === todayItem.id) : -1;
  const todayNextItem = todayCurrentIndex >= 0 ? todayItems.slice(todayCurrentIndex + 1).find((item) => !Boolean(item.isRead)) || null : null;
  const detailItemId = selectedItem?.id || null;

  useEffect(() => {
    if (!detailItemId || details[detailItemId]) return;
    const controller = new AbortController();
    jsonRequest<Detail>(`/api/items?id=${detailItemId}`, { cache: "no-store", signal: controller.signal })
      .then((detail) => setDetails((current) => ({ ...current, [detailItemId]: detail })))
      .catch((error) => { if (error.name !== "AbortError") setNotice(error.message); })
    return () => controller.abort();
  }, [detailItemId, details]);

  const selectedDetail = detailItemId ? details[detailItemId] : null;
  const detailLoading = Boolean(detailItemId && !selectedDetail);
  const itemAnnotations = useMemo(() => detailItemId ? annotationsByItem[detailItemId] || [] : [], [annotationsByItem, detailItemId]);
  const sessionUserId = data.user?.id || null;
  const heartbeatItemId = selectedItem?.id || null;
  const todayRefreshUserId = data.user?.id || null;
  const activeSource = selectedSource === "all" ? null : data.sources.find((source) => source.id === selectedSource) || null;
  const activeCategory = selectedCategory === "all" ? null : sourceCategoryLabel(selectedCategory);
  const articlePaneCount = query.trim() ? visibleItems.length : articleStatusCounts[articleStatus];
  const activeImport = data.imports.find((job) => job.id === activeImportId) || data.imports.find((job) => job.status === "pending") || null;

  useEffect(() => {
    if (!detailItemId || (view !== "today" && view !== "discover")) {
      window.setTimeout(() => {
        setSelectionDraft(null);
        setSelectionActionVisible(false);
        setAnnotationPanelOpen(false);
        setActiveAnnotationId(null);
      }, 0);
      return;
    }
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setAnnotationsLoading(true);
      setSelectionDraft(null);
      setSelectionActionVisible(false);
      setActiveAnnotationId(null);
    });
    jsonRequest<{ annotations: Annotation[] }>(`/api/annotations?itemId=${detailItemId}`, { cache: "no-store" })
      .then((result) => {
        if (!active) return;
        setAnnotationsByItem((current) => ({ ...current, [detailItemId]: result.annotations }));
        const requested = requestedAnnotationId.current;
        const target = requested ? result.annotations.find((annotation) => annotation.id === requested) : null;
        setAnnotationPanelOpen(result.annotations.length > 0);
        if (target) {
          setActiveAnnotationId(target.id);
        }
      })
      .catch((error) => { if (active) setNotice(error.message); })
      .finally(() => { if (active) setAnnotationsLoading(false); });
    return () => { active = false; };
  }, [detailItemId, view]);

  useEffect(() => {
    const requested = requestedAnnotationId.current;
    if (!requested || !selectedDetail?.contentMarkdown) return;
    const target = itemAnnotations.find((annotation) => annotation.id === requested);
    if (!target) return;
    let cancelled = false;
    let attempts = 0;
    let timer = 0;
    let stopKeepingPosition = () => {};
    setAnnotationPanelOpen(true);
    setActiveAnnotationId(target.id);
    const reveal = () => {
      if (cancelled) return;
      const block = document.querySelector(`[data-annotation-block="${target.blockIndex}"]`);
      const card = document.getElementById(`annotation-card-${target.id}`);
      if (block && card) {
        stopKeepingPosition = keepAnnotationPosition(block, card);
        requestedAnnotationId.current = null;
        return;
      }
      attempts += 1;
      if (attempts < 40) timer = window.setTimeout(reveal, 50);
    };
    timer = window.setTimeout(reveal, 0);
    return () => { cancelled = true; window.clearTimeout(timer); stopKeepingPosition(); };
  }, [itemAnnotations, selectedDetail?.contentMarkdown]);

  useEffect(() => {
    if (view !== "today" || !todayRefreshUserId || heartbeatItemId) return;
    let active = true;
    const refreshToday = () => {
      jsonRequest<Dashboard>("/api/dashboard?view=discover", { cache: "no-store" }).then((dashboard) => {
        if (!active) return;
        setData(dashboard);
        if (!todaySessionStarted) return;
        const followed = new Set(dashboard.sources.filter((source) => Boolean(source.isFollowed)).map((source) => source.id));
        const hasNewUnread = dashboard.items.some((item) => item.sourceId !== null && followed.has(item.sourceId) && isToday(item.publishedAt) && !Boolean(item.isRead));
        if (hasNewUnread) {
          setTodayItemId(null);
          setTodaySessionStarted(false);
        }
      }).catch(() => undefined);
    };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refreshToday(); };
    refreshToday();
    window.addEventListener("focus", refreshToday);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = window.setInterval(refreshToday, TODAY_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshToday);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [heartbeatItemId, todayRefreshUserId, todaySessionStarted, view]);

  useEffect(() => {
    lastActivityAt.current = Date.now();
    const markActive = () => { lastActivityAt.current = Date.now(); };
    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    window.addEventListener("scroll", markActive, { passive: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("scroll", markActive, true);
    };
  }, []);

  useEffect(() => {
    if (!heartbeatItemId || !sessionUserId || (view !== "discover" && view !== "today")) return;
    let active = true;
    const heartbeat = () => {
      if (!active || document.visibilityState !== "visible" || Date.now() - lastActivityAt.current > 60_000) return;
      post<{ activeSeconds: number }>("/api/reading", { itemId: heartbeatItemId }).catch(() => undefined);
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [heartbeatItemId, sessionUserId, view]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    const mode = authMode;
    setBusy("auth"); setNotice(""); setAuthError("");
    try {
      const result = await post<{ user: SessionUser }>("/api/auth", mode === "login"
        ? { action: "login", account: authAccount, password: authPassword }
        : { action: "register", account: authAccount, password: authPassword, confirmPassword: authConfirm, nickname: authNickname });
      setData((current) => ({ ...current, user: result.user }));
      setProfileNickname(result.user.nickname); setProfileBio(result.user.bio);
      setAuthOpen(false); setAuthPassword(""); setAuthConfirm(""); setAuthNickname("");
      await refresh().catch(() => undefined);
      if (mode === "register") {
        navigate("discover");
        setRegistrationSuccess(result.user);
      } else {
        navigate("today");
        setNotice(`欢迎回来，${result.user.nickname}`);
      }
    } catch (error) { setAuthError(error instanceof Error ? error.message : mode === "register" ? "注册失败，请稍后再试" : "登录失败，请稍后再试"); }
    finally { setBusy(""); }
  }

  async function loadApiTokens() {
    try {
      const res = await jsonRequest<{ tokens: typeof apiTokens }>("/api/tokens", { cache: "no-store" });
      setApiTokens(res.tokens || []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "读取密钥失败"); }
  }

  async function createApiToken(event: FormEvent) {
    event.preventDefault();
    setBusy("token-create"); setNotice(""); setFreshToken(null); setTokenCopied(false);
    try {
      const res = await post<{ name: string; token: string }>("/api/tokens", { name: newTokenName || "新设备" });
      setFreshToken({ name: res.name, token: res.token });
      setNewTokenName("");
      await loadApiTokens();
    } catch (error) { setNotice(error instanceof Error ? error.message : "创建密钥失败"); }
    finally { setBusy(""); }
  }

  async function revokeApiToken(id: number) {
    setBusy(`token-${id}`); setNotice("");
    try {
      await fetch("/api/tokens", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      await loadApiTokens();
    } catch (error) { setNotice(error instanceof Error ? error.message : "撤销失败"); }
    finally { setBusy(""); }
  }

  function copyFreshToken() {
    if (!freshToken) return;
    navigator.clipboard?.writeText(freshToken.token).then(() => { setTokenCopied(true); setTimeout(() => setTokenCopied(false), 2000); }).catch(() => {});
  }

  async function logout() {
    setBusy("logout");
    try {
      await post("/api/auth", { action: "logout" });
      setData((current) => ({ ...current, user: null, imports: [], items: current.items.map((item) => ({ ...item, isRead: false, isSaved: false })) }));
      setNotifications([]); setProfileData(null); setProfileUserId(null);
      setSourceItems({}); setDetails({}); navigate("today");
      setNotice("已退出登录");
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "退出失败"); }
    finally { setBusy(""); }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setBusy("profile"); setNotice("");
    try {
      const result = await post<{ user: SessionUser }>("/api/profile", { action: "update", nickname: profileNickname, bio: profileBio });
      setData((current) => ({ ...current, user: result.user, sources: current.sources.map((source) => source.contributorUserId === result.user.id ? { ...source, contributorNickname: result.user.nickname } : source) }));
      setProfileData((current) => current ? { ...current, user: { ...current.user, nickname: result.user.nickname, bio: result.user.bio } } : current);
      setProfileEditing(false);
      setNotice("个人资料已保存");
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(""); }
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setBusy("avatar"); setNotice(""); setAvatarFeedback({ kind: "working", message: "正在上传并保存…" });
    try {
      const form = new FormData(); form.append("avatar", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body: form });
      const result = await response.json() as { avatarUrl?: string; error?: string };
      if (!response.ok || !result.avatarUrl) throw new Error(result.error || "上传失败");
      await verifyImageCanRender(result.avatarUrl);
      setData((current) => current.user ? { ...current, user: { ...current.user, avatarUrl: result.avatarUrl! } } : current);
      setProfileData((current) => current?.isOwner ? { ...current, user: { ...current.user, avatarUrl: result.avatarUrl! } } : current);
      setAvatarFeedback({ kind: "success", message: "上传成功，头像已更新" });
      setNotice("头像已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "上传头像失败";
      setAvatarFeedback({ kind: "error", message: message.startsWith("头像已经保存") ? message : `上传失败：${message}` });
      setNotice(message);
    }
    finally { setBusy(""); }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault(); setBusy("password"); setNotice("");
    try {
      await post("/api/profile/password", { currentPassword, newPassword, confirmPassword });
      setPasswordOpen(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setNotice("密码已修改，其他设备已退出登录");
    } catch (error) { setNotice(error instanceof Error ? error.message : "修改密码失败"); }
    finally { setBusy(""); }
  }

  function openItem(id: number) {
    navigate("discover");
    setSelectedItemId(id);
    setReaderMode("clean");
    setDiscoverImmersive(window.matchMedia("(max-width: 1179px)").matches);
  }

  function handleArticleSelection(selection: AnnotationSelection | null, error?: string) {
    if (error) setNotice(error);
    setSelectionDraft(selection);
    setSelectionActionVisible(Boolean(selection));
  }

  function beginAnnotation() {
    if (!selectionDraft) return;
    setSelectionActionVisible(false);
    setAnnotationPanelOpen(true);
    setActiveAnnotationId(null);
    if (!data.user) {
      openAuth("login");
      setNotice("登录后即可发布公开批注");
    }
  }

  function cancelAnnotationDraft() {
    setSelectionDraft(null);
    setSelectionActionVisible(false);
    window.getSelection()?.removeAllRanges();
  }

  async function createCurrentAnnotation(body: string) {
    if (!selectionDraft || !data.user) return;
    setBusy("annotation-create");
    try {
      const result = await post<{ annotation: Annotation }>("/api/annotations", { action: "create", ...selectionDraft, body });
      setAnnotationsByItem((current) => ({ ...current, [selectionDraft.itemId]: [...(current[selectionDraft.itemId] || []), result.annotation].sort((left, right) => left.blockIndex - right.blockIndex || left.startOffset - right.startOffset) }));
      setSelectionDraft(null);
      setSelectionActionVisible(false);
      window.getSelection()?.removeAllRanges();
      setAnnotationPanelOpen(true);
      setActiveAnnotationId(result.annotation.id);
      setNotice("批注已公开发布");
    } catch (error) { setNotice(error instanceof Error ? error.message : "批注发布失败"); throw error; }
    finally { setBusy(""); }
  }

  async function replyToAnnotation(annotationId: number, replyToUserId: number, body: string) {
    if (!detailItemId || !data.user) { openAuth("login"); return; }
    setBusy(`reply-${annotationId}`);
    try {
      const result = await post<{ reply: AnnotationReply }>("/api/annotations", { action: "reply", annotationId, replyToUserId, body });
      setAnnotationsByItem((current) => ({ ...current, [detailItemId]: (current[detailItemId] || []).map((annotation) => annotation.id === annotationId ? { ...annotation, replyCount: annotation.replyCount + 1, replies: [...annotation.replies, result.reply] } : annotation) }));
      setNotice("回复已发布");
    } catch (error) { setNotice(error instanceof Error ? error.message : "回复发布失败"); throw error; }
    finally { setBusy(""); }
  }

  async function toggleProfileLike() {
    if (!profileData) return;
    if (!data.user) { openAuth("login"); setNotice("登录后即可给主页点赞"); return; }
    setBusy("profile-like");
    try {
      const result = await post<{ liked: boolean; count: number }>("/api/profile", { action: "like", userId: profileData.user.id });
      setProfileData((current) => current ? { ...current, likes: { ...current.likes, likedByViewer: result.liked, count: result.count } } : current);
      setNotice(result.liked ? "已赞这个主页" : "已取消点赞");
    } catch (error) { setNotice(error instanceof Error ? error.message : "点赞失败"); }
    finally { setBusy(""); }
  }

  async function submitProfileMessage(event: FormEvent) {
    event.preventDefault();
    if (!profileData || !profileMessageBody.trim()) return;
    if (!data.user) { openAuth("login"); setNotice("登录后即可留言"); return; }
    setBusy("profile-message");
    try {
      const result = await post<{ message: ProfileMessage }>("/api/profile", { action: "message", userId: profileData.user.id, body: profileMessageBody });
      setProfileData((current) => current ? { ...current, messages: [result.message, ...current.messages] } : current);
      setProfileMessageBody("");
      setNotice("留言已发布");
    } catch (error) { setNotice(error instanceof Error ? error.message : "留言发布失败"); }
    finally { setBusy(""); }
  }

  function focusAnnotation(annotation: Annotation, origin: "document" | "sidebar" = "sidebar") {
    setAnnotationPanelOpen(true);
    setActiveAnnotationId(annotation.id);
    window.setTimeout(() => {
      const block = document.querySelector(`[data-annotation-block="${annotation.blockIndex}"]`);
      const card = document.getElementById(`annotation-card-${annotation.id}`);
      if (block && card && origin === "sidebar") keepAnnotationPosition(block, card);
      else scrollToContainerCenter(document.querySelector<HTMLElement>(".annotation-sidebar-scroll"), card);
    }, origin === "document" ? 120 : 0);
  }

  function openAnnotation(annotation: Annotation) {
    if (!data.items.some((item) => item.id === annotation.itemId)) void loadLinkedItem(annotation.itemId);
    setView("discover");
    setSelectedCategory("all");
    setSelectedSource("all");
    setSelectedItemId(annotation.itemId);
    setReaderMode("clean");
    setDiscoverImmersive(true);
    setSelectionDraft(null);
    setSelectionActionVisible(false);
    requestedAnnotationId.current = annotation.id;
    window.history.pushState({}, "", `/discover?item=${annotation.itemId}&annotation=${annotation.id}&immersive=1`);
  }

  async function markAllNotificationsRead() {
    if (!notifications.some((notification) => !notification.isRead)) return;
    try {
      await post("/api/notifications", {});
      setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
    } catch (error) { setNotice(error instanceof Error ? error.message : "更新通知失败"); }
  }

  async function openNotification(notification: Notification) {
    setNotificationOpen(false);
    if (!notification.isRead) {
      setNotifications((current) => current.map((candidate) => candidate.id === notification.id ? { ...candidate, isRead: true } : candidate));
      post("/api/notifications", { notificationId: notification.id }).catch(() => undefined);
    }
    if (notification.type === "annotation_reply" && notification.itemId && notification.annotationId) {
      setView("discover");
      setSelectedCategory("all");
      setSelectedSource("all");
      setSelectedItemId(notification.itemId);
      setReaderMode("clean");
      setDiscoverImmersive(true);
      requestedAnnotationId.current = notification.annotationId;
      window.history.pushState({}, "", `/discover?item=${notification.itemId}&annotation=${notification.annotationId}&immersive=1`);
      return;
    }
    if (data.user) openProfile(data.user.id);
  }

  function chooseSource(id: number | "all") {
    navigate("discover");
    if (id === "all") setSelectedCategory("all");
    setSelectedSource(id);
    setArticleStatus("unread");
    setSelectedItemId(null);
    setVisibleItemLimit(ARTICLE_BATCH_SIZE);
    setReaderMode("clean");
    setDiscoverImmersive(false);
    setMobileSourcePaneOpen(false);
  }

  function chooseCategory(category: SourceCategory | "all") {
    navigate("discover");
    setSelectedCategory(category);
    setSelectedSource("all");
    setArticleStatus("unread");
    setSelectedItemId(null);
    setVisibleItemLimit(ARTICLE_BATCH_SIZE);
    setReaderMode("clean");
    setDiscoverImmersive(false);
    setMobileSourcePaneOpen(false);
  }

  async function addSubscription(event: FormEvent) {
    event.preventDefault();
    const value = sourceInput.trim();
    if (!value) return;
    setBusy("source"); setNotice("");
    try {
      const result = await post<{ kind: "rss" | "x" | "wechat" | "article"; id?: number; requestId?: number; name?: string; added: number; pending?: boolean; warning?: string; contentReady?: boolean }>("/api/sources", { action: "add", url: value, category: sourceCategory });
      if (result.kind === "article" && result.id) {
        chooseSource("all"); setSelectedItemId(result.id);
        setNotice(result.contentReady ? "X 文章已保存，正文已经放进阅读区" : "X 文章链接已保存；正文服务暂时没读到内容");
      } else if (result.kind === "wechat") {
        setSelectedCategory(sourceCategory);
        if (result.requestId) setActiveImportId(result.requestId);
      } else if (result.id) {
        setSelectedCategory(sourceCategory);
        chooseSource(result.id);
        if (result.warning) setNotice(`${result.name || "来源"} 已收录并自动关注；${result.warning}`);
        else setNotice(result.added > 0 ? `${result.name} 已收录并自动关注，导入 ${result.added} 篇${result.kind === "x" ? "长文章" : "内容"}` : `${result.name} 已收录并自动关注，目前没有新内容`);
      }
      setSourceInput(""); setSourceCategory("ai"); setAddOpen(false); await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "暂时没处理好"); }
    finally { setBusy(""); }
  }

  async function syncSubscription(source: Source) {
    setBusy(`sync-${source.id}`); setNotice("");
    try {
      const result = await post<{ added: number }>("/api/sources", { action: "sync", id: source.id });
      setNotice(result.added > 0 ? `${source.name} 新增 ${result.added} 篇文章` : `${source.name} 已是最新`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "同步失败"); }
    finally { setBusy(""); }
  }

  async function toggleSubscription(source: Source) {
    setBusy(`toggle-${source.id}`); setNotice("");
    try {
      const enabled = !Boolean(source.enabled);
      await post("/api/sources", { action: "toggle", id: source.id, enabled });
      setNotice(`${source.name} 已${enabled ? "恢复" : "暂停"}`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "状态更新失败"); }
    finally { setBusy(""); }
  }

  async function removeSubscription(source: Source) {
    if (!window.confirm(`删除“${source.name}”以及它的全部文章？`)) return;
    setBusy(`delete-${source.id}`); setNotice("");
    try {
      await post("/api/sources", { action: "delete", id: source.id });
      chooseSource("all"); setDetails({});
      setNotice(`${source.name} 已删除`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "删除失败"); }
    finally { setBusy(""); }
  }

  async function toggleFollowing(source: Source) {
    if (!data.user) {
      openAuth("login"); setNotice("登录后才能关注来源");
      return;
    }
    const following = !Boolean(source.isFollowed);
    setBusy(`follow-${source.id}`); setNotice("");
    try {
      await post("/api/sources", { action: "follow", id: source.id, following });
      setData((current) => ({ ...current, sources: current.sources.map((candidate) => candidate.id === source.id ? { ...candidate, isFollowed: following } : candidate) }));
      setTodayItemId(null);
      setNotice(following ? `已关注 ${source.name}，今后的更新会进入今日阅读` : `已取消关注 ${source.name}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "关注状态更新失败"); }
    finally { setBusy(""); }
  }

  function patchItemState(id: number, patch: Partial<Pick<Item, "isRead" | "isSaved">>) {
    setData((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) }));
    setSourceItems((current) => Object.fromEntries(Object.entries(current).map(([sourceId, items]) => [sourceId, items.map((item) => item.id === id ? { ...item, ...patch } : item)])));
    setDetails((current) => current[id] ? { ...current, [id]: { ...current[id], ...patch } } : current);
  }

  async function toggleSaved() {
    if (!selectedItem) return;
    if (!data.user) {
      openAuth("login"); setNotice("登录后才能收藏文章");
      return;
    }
    setBusy("save");
    try {
      await post("/api/items", { action: "save", id: selectedItem.id });
      const next = !Boolean(selectedItem.isSaved);
      patchItemState(selectedItem.id, { isSaved: next });
    } catch (error) { setNotice(error instanceof Error ? error.message : "收藏失败"); }
    finally { setBusy(""); }
  }

  async function markSelectedRead() {
    if (!selectedItem || view !== "discover" || Boolean(selectedItem.isRead)) return;
    if (!data.user) {
      openAuth("login"); setNotice("登录后才能标记已读");
      return;
    }
    setBusy("read");
    try {
      setSelectedItemId(selectedItem.id);
      await post("/api/items", { action: "mark-read", id: selectedItem.id });
      patchItemState(selectedItem.id, { isRead: true });
    } catch (error) { setNotice(error instanceof Error ? error.message : "标记已读失败"); }
    finally { setBusy(""); }
  }

  async function advanceToday(saveForLater = false) {
    if (!selectedItem || view !== "today") return;
    setBusy(saveForLater ? "today-later" : "today-next");
    try {
      if (saveForLater && !Boolean(selectedItem.isSaved)) await post("/api/items", { action: "save", id: selectedItem.id });
      if (!Boolean(selectedItem.isRead)) await post("/api/items", { action: "mark-read", id: selectedItem.id });
      patchItemState(selectedItem.id, { isRead: true, ...(saveForLater ? { isSaved: true } : {}) });
      const currentIndex = todayItems.findIndex((item) => item.id === selectedItem.id);
      const next = todayItems.slice(currentIndex + 1).find((item) => !Boolean(item.isRead));
      setTodayItemId(next?.id || null);
      setReaderMode("clean");
      requestAnimationFrame(() => document.querySelector(".today-scroll")?.scrollTo({ top: 0, behavior: "smooth" }));
      if (saveForLater) setNotice("已放入收藏，继续下一篇");
    } catch (error) { setNotice(error instanceof Error ? error.message : "暂时无法进入下一篇"); }
    finally { setBusy(""); }
  }

  function startTodayReading() {
    if (!data.user) {
      openAuth("login");
      return;
    }
    const firstUnread = todayItems.find((item) => !Boolean(item.isRead));
    setTodayItemId(firstUnread?.id || null);
    setTodaySessionStarted(true);
    setReaderMode("clean");
  }

  const immersiveTodayReading = view === "today" && todaySessionStarted && Boolean(selectedItem);
  const immersiveDiscoverReading = view === "discover" && discoverImmersive && Boolean(selectedItem);
  const immersiveReading = immersiveTodayReading || immersiveDiscoverReading;
  const sidebarDraft = selectionActionVisible ? null : selectionDraft;
  const showAnnotationSidebar = annotationPanelOpen && Boolean(detailItemId) && (annotationsLoading || itemAnnotations.length > 0 || sidebarDraft);
  const canToggleAnnotations = itemAnnotations.length > 0 || Boolean(selectionDraft);
  const unreadNotificationCount = notifications.filter((notification) => !notification.isRead).length;

  return <main className={`reader-workspace ${sourcePaneCollapsed ? "sources-collapsed" : ""} ${mobileSourcePaneOpen ? "mobile-sources-open" : ""} view-${view} ${immersiveTodayReading ? "today-immersive" : ""} ${immersiveDiscoverReading ? "discover-immersive" : ""} ${showAnnotationSidebar ? "annotations-open" : ""}`} id="main-content" style={{ "--article-pane-width": `${articlePaneWidth}px` } as CSSProperties}>
    <a className="skip-link" href={view === "today" ? "#today-content" : view === "discover" ? immersiveDiscoverReading ? "#reader-pane" : "#article-list" : "#view-content"}>跳到主要内容</a>

    {!immersiveReading && <header className="global-appbar">
      <button className="global-brand" onClick={() => navigate("today")} aria-label="前往今日阅读">
        <span className="brand-mark"><Waves size={19} weight="bold" aria-hidden="true" /></span>
        <span><strong>清流工作室</strong><small>RSS · X · 公众号</small></span>
      </button>
      <nav aria-label="主导航">
        <button className={view === "today" ? "active" : ""} aria-current={view === "today" ? "page" : undefined} onClick={() => navigate("today")}><BookOpenText size={16} weight="duotone" />今日阅读</button>
        <button className={view === "discover" ? "active" : ""} aria-current={view === "discover" ? "page" : undefined} onClick={() => navigate("discover")}><MagnifyingGlass size={16} />发现来源</button>
        <button className={view === "annotations" ? "active" : ""} aria-current={view === "annotations" ? "page" : undefined} onClick={() => navigate("annotations")}><ChatText size={16} weight="duotone" />批注广场</button>
        <button className={view === "leaderboard" ? "active" : ""} aria-current={view === "leaderboard" ? "page" : undefined} onClick={() => navigate("leaderboard")}><Trophy size={16} />排行榜</button>
        <a className="nav-link" href="/topics"><ClipboardText size={16} weight="duotone" />选题</a>
        <a className="nav-link" href="/strategy"><Gear size={16} weight="duotone" />策略</a>
      </nav>
      {data.user
        ? <div className="global-user-wrap">
          <div className="global-notification-wrap">
            <button className={`global-notification ${notificationOpen ? "active" : ""}`} type="button" aria-label={unreadNotificationCount ? `通知，${unreadNotificationCount} 条未读` : "通知"} aria-expanded={notificationOpen} onClick={() => { setNotificationOpen((open) => !open); setUserMenuOpen(false); }}><Bell size={17} weight={unreadNotificationCount ? "fill" : "regular"} aria-hidden="true" />{unreadNotificationCount > 0 && <span className="unread-dot" />}</button>
            {notificationOpen && <div className="notification-menu" role="dialog" aria-label="通知">
              <header><div><strong>通知</strong>{unreadNotificationCount > 0 && <span>{unreadNotificationCount} 条未读</span>}</div><button type="button" disabled={!unreadNotificationCount} onClick={markAllNotificationsRead}>全部已读</button></header>
              <div className="notification-list">
                {notificationsLoading && notifications.length === 0 && <div className="notification-loading"><i /><i /><i /></div>}
                {!notificationsLoading && notifications.length === 0 && <p className="notification-empty">暂时没有新消息</p>}
                {notifications.map((notification) => <button className={notification.isRead ? "read" : "unread"} type="button" key={notification.id} onClick={() => openNotification(notification)}><Avatar user={{ nickname: notification.actorNickname, avatarUrl: notification.actorAvatarUrl }} size="small" /><span><strong>{notification.actorNickname}</strong><small>{notification.type === "annotation_reply" ? "回复了你的批注" : notification.type === "profile_message" ? "给你的主页留言" : "赞了你的主页"}</small><time>{annotationWhen(notification.createdAt)}</time></span>{!notification.isRead && <em aria-hidden="true" />}</button>)}
              </div>
            </div>}
          </div>
          <button className={`global-user ${view === "profile" && profileData?.isOwner ? "active" : ""} ${unreadNotificationCount ? "has-unread" : ""}`} aria-expanded={userMenuOpen} onClick={() => { setUserMenuOpen((open) => !open); setNotificationOpen(false); }}><Avatar user={data.user} size="small" /><span>{data.user.nickname}</span><CaretDown size={11} weight="bold" aria-hidden="true" /></button>
          {userMenuOpen && <div className="user-menu global-user-menu" role="menu"><button role="menuitem" onClick={() => openProfile(data.user!.id)}><User size={15} />个人主页</button><button role="menuitem" onClick={() => { navigate("settings"); setUserMenuOpen(false); }}><Key size={15} />API 密钥</button><button role="menuitem" onClick={() => { setPasswordOpen(true); setUserMenuOpen(false); }}><Password size={15} />修改密码</button><button role="menuitem" disabled={busy === "logout"} onClick={logout}><SignOut size={15} />退出登录</button></div>}
        </div>
        : <button className="global-login" onClick={() => openAuth("login")}><SignIn size={16} />登录</button>}
    </header>}

    {view === "discover" && !immersiveDiscoverReading && mobileSourcePaneOpen && <button className="mobile-source-drawer-backdrop" type="button" aria-label="关闭来源列表" onClick={() => setMobileSourcePaneOpen(false)} />}

    {view === "discover" && !immersiveDiscoverReading && <aside className="source-pane" id="source-pane" aria-label="内容来源" aria-hidden={mobileViewport && !mobileSourcePaneOpen ? true : undefined} inert={mobileViewport && !mobileSourcePaneOpen ? true : undefined}>
      <div className="brand-block source-context-header">
        <span className="brand-mark"><MagnifyingGlass size={18} weight="bold" aria-hidden="true" /></span>
        <div className="brand-copy"><strong>内容来源</strong><small>筛选与管理订阅</small></div>
        <button className="source-pane-toggle" aria-controls="source-pane" aria-expanded={mobileViewport ? mobileSourcePaneOpen : !sourcePaneCollapsed} aria-label={mobileViewport ? "关闭订阅来源" : sourcePaneCollapsed ? "展开订阅来源" : "收起订阅来源"} title={mobileViewport ? "关闭订阅来源" : sourcePaneCollapsed ? "展开订阅来源" : "收起订阅来源"} onClick={toggleSourcePane}>
          {sourcePaneCollapsed ? <CaretRight size={14} weight="bold" aria-hidden="true" /> : <CaretLeft size={14} weight="bold" aria-hidden="true" />}
        </button>
      </div>
      <button className={`source-filter all-source ${selectedSource === "all" && selectedCategory === "all" ? "active" : ""}`} aria-label={`全部来源，共 ${data.sources.length} 个`} title={sourcePaneCollapsed ? `全部来源 · ${data.sources.length} 个` : undefined} onClick={() => chooseSource("all")}>
        <span className="source-avatar">源</span><span className="source-copy"><strong>全部来源</strong><small>浏览大家的贡献</small></span><em>{data.sources.length}</em>
      </button>
      <div className="source-add">
        <button className="add-source-button" type="button" aria-label={data.user ? "收录新来源" : "登录后收录新来源"} title={data.user ? "收录新来源" : "登录后收录新来源"} onClick={openAddSource}><Plus size={17} weight="bold" /><span>收录新来源</span></button>
      </div>
      <div className="source-section-title">
        <span>来源分类</span>
        <label className={`source-category-filter ${selectedCategory !== "all" ? "active" : ""}`}>
          <select aria-label="按分类筛选来源" value={selectedCategory} onChange={(event) => chooseCategory(event.target.value as SourceCategory | "all")}>
            <option value="all">全部 · {data.sources.length}</option>
            {SOURCE_CATEGORIES.map((category) => <option value={category.value} key={category.value}>{category.label} · {sourceCategoryCounts[category.value]}</option>)}
          </select>
          <CaretDown size={11} weight="bold" aria-hidden="true" />
        </label>
      </div>
      <nav className="source-list" aria-label="内容来源列表">
        {filteredSources.map((source) => <div className={`source-entry ${!source.enabled ? "paused" : ""}`} key={source.id}>
          <div className={`source-filter source-row ${view === "discover" && selectedSource === source.id ? "active" : ""}`} title={sourcePaneCollapsed ? `${source.name} · ${sourceCategoryLabel(source.category)}` : undefined}>
            <button className="source-row-primary" type="button" aria-expanded={view === "discover" && selectedSource === source.id} aria-label={`${source.name}，${sourceCategoryLabel(source.category)}分类，${source.isFollowed ? "已关注" : "未关注"}，${sourceKind(source)}，${sourceStatus(source)}，${source.itemCount || 0} 篇`} onClick={() => chooseSource(source.id)}><SourceAvatar source={source} /><span className="source-copy"><strong title={source.name}>{source.name}</strong><small className="source-status" title={source.lastError || undefined}>{sourceKind(source)}<span aria-hidden="true"> · </span>{sourceStatus(source)}</small></span><span className="source-count" aria-label={`${source.itemCount || 0} 篇内容`}><strong>{source.itemCount || 0}</strong><small>篇</small></span></button>
          </div>
          {view === "discover" && selectedSource === source.id && <div className="source-selected-detail">
            <div className="source-entry-contributor">由 {source.contributorUserId ? <button type="button" onClick={() => openProfile(source.contributorUserId!)}>{source.contributorNickname}</button> : <span>{source.contributorNickname}</span>} 收录</div>
            <div className="source-actions">
              <button className={source.isFollowed ? "following" : "follow"} title={source.isFollowed ? "点击取消关注" : "点击关注来源"} disabled={busy === `follow-${source.id}`} onClick={() => toggleFollowing(source)}>{source.isFollowed ? <><Check size={13} weight="bold" />取消关注</> : <><Plus size={13} weight="bold" />关注来源</>}</button>
              {Boolean(source.canManage) && <>{source.kind === "wechat"
                ? <span className="source-sync-note" title="微信公众号由 Mac 本地采集器每天自动更新"><ClockCountdown size={13} aria-hidden="true" />每日自动</span>
                : <button disabled={!source.enabled || busy === `sync-${source.id}`} title={!source.enabled ? "请先恢复这个来源" : "立即检查新文章"} onClick={() => syncSubscription(source)}><ArrowsClockwise className={busy === `sync-${source.id}` ? "spinning" : ""} size={13} weight="bold" aria-hidden="true" />{busy === `sync-${source.id}` ? "同步中" : "立即同步"}</button>}
              <button disabled={busy === `toggle-${source.id}`} onClick={() => toggleSubscription(source)}>{source.enabled ? "暂停更新" : "恢复更新"}</button>
              <button className="danger" disabled={busy === `delete-${source.id}`} onClick={() => removeSubscription(source)}>删除来源</button></>}
            </div>
          </div>}
        </div>)}
        {!loading && filteredSources.length === 0 && <p className="source-empty">{data.sources.length === 0 ? "还没有来源，登录后收录一个经常看的作者或网站。" : `${activeCategory}分类还没有来源。`}</p>}
      </nav>
      {activeImport && <div className={`import-status ${activeImport.status === "completed" ? "done" : "working"}`} role="status" aria-live="polite">
        <div className="import-status-head"><span>{activeImport.status === "completed" ? <Check size={14} weight="bold" aria-hidden="true" /> : <CircleNotch size={15} weight="bold" aria-hidden="true" />}</span><div><strong>{importStatusCopy(activeImport).title}</strong><small>{importStatusCopy(activeImport).detail}</small></div>{activeImport.status === "completed" && <button aria-label="关闭导入状态" onClick={() => setActiveImportId(null)}><X size={13} aria-hidden="true" /></button>}</div>
        <div className="import-progress" aria-hidden="true">{[1, 2, 3, 4].map((step) => <i className={step <= importStageIndex(activeImport) ? "active" : ""} key={step} />)}</div>
      </div>}
    </aside>}

    {view === "discover" && !immersiveDiscoverReading && <div className="reader-resize-handle" role="separator" aria-label="调整文章列表与正文宽度" aria-orientation="vertical" aria-valuemin={MIN_ARTICLE_PANE_WIDTH} aria-valuemax={MAX_ARTICLE_PANE_WIDTH} aria-valuenow={articlePaneWidth} tabIndex={0} title="拖动调整文章列表与正文宽度；双击恢复默认" onDoubleClick={() => saveArticlePaneWidth(DEFAULT_ARTICLE_PANE_WIDTH)} onPointerDown={startArticlePaneResize} onKeyDown={resizeArticlePaneWithKeyboard}><span aria-hidden="true" /></div>}

    {view === "today" && <section className="today-view" id="today-content" aria-label="今日阅读">
      <div className="today-scroll">
        {loading && <div className="today-loading" role="status"><i /><i /><i /><span>正在整理今天的更新</span></div>}

        {!loading && !data.user && <div className="today-state today-auth-state">
          <span className="today-state-mark"><BookOpenText size={28} weight="duotone" /></span>
          <small>{todayHeading()}</small>
          <h1>登录后，开始你的今日阅读</h1>
          <p>你关注的作者更新后，会在这里排成一条可以读完的内容流。</p>
          <div className="today-state-actions"><button className="today-primary" onClick={() => openAuth("login")}>登录并开始</button><button onClick={() => navigate("discover")}>先看看有哪些来源</button></div>
        </div>}

        {!loading && data.user && followedSourceIds.size === 0 && <div className="today-state today-onboarding-state">
          <span className="today-state-mark"><Plus size={26} weight="duotone" /></span>
          <small>第一次来到这里</small>
          <h1>先关注几位你想长期阅读的作者</h1>
          <p>关注决定你的阅读边界。以后登录时，这里会直接出现他们当天的新内容。</p>
          <button className="today-primary" onClick={() => navigate("discover")}>去发现来源</button>
        </div>}

        {!loading && data.user && followedSourceIds.size > 0 && todayItems.length === 0 && <div className="today-state today-empty-state">
          <div className="today-avatar-stack quiet" aria-hidden="true">{data.sources.filter((source) => Boolean(source.isFollowed)).slice(0, 6).map((source) => <span key={source.id}><SourceAvatar source={source} /></span>)}</div>
          <small>{todayHeading()}</small>
          <h1>今天还没有新的更新</h1>
          <p>你关注的作者有新内容时，会先在这里出现。也可以去来源库看看过去的文章。</p>
          <button onClick={() => navigate("discover")}>浏览来源库</button>
        </div>}

        {!loading && data.user && todayItems.length > 0 && todayUnreadCount === 0 && !todaySessionStarted && <div className="today-state today-complete-state">
          <div className="today-avatar-stack complete" aria-label={`今天有 ${todaySources.length} 位作者更新`}>{todaySources.slice(0, 8).map((source) => <span title={source.name} key={source.id}><SourceAvatar source={source} /></span>)}</div>
          <small>{todayHeading()}</small>
          <h1>今天的更新已经读完</h1>
          <p>你处理了 {todayItems.length} 篇内容。新的更新到来时，这里会继续为你准备好。</p>
          <button onClick={() => navigate("discover")}>去发现更多作者</button>
        </div>}

        {!loading && data.user && todayUnreadCount > 0 && !todaySessionStarted && <div className="today-opening">
          <div className="today-opening-copy">
            <small>{todayHeading()}</small>
            <h1>今天，他们为你更新了</h1>
            <p>不用再挑选先看谁，今天的新内容已经排好顺序。</p>
          </div>
          <div className="today-avatar-stack" aria-label={`今天有 ${todaySources.length} 位作者更新`}>
            {todaySources.slice(0, 8).map((source) => <span className={todayItems.filter((item) => item.sourceId === source.id).every((item) => Boolean(item.isRead)) ? "done" : ""} title={source.name} key={source.id}><SourceAvatar source={source} /></span>)}
            {todaySources.length > 8 && <em>+{todaySources.length - 8}</em>}
          </div>
          <div className="today-summary" aria-label="今日阅读概览">
            <span><strong>{todaySources.length}</strong><small>位作者更新</small></span>
            <span><strong>{todayItems.length}</strong><small>篇今日内容</small></span>
            <span><strong>{todayEstimatedMinutes}</strong><small>分钟预计阅读</small></span>
          </div>
          {todayReadCount > 0 && <div className="today-resume"><div><span style={{ width: `${Math.round(todayReadCount / todayItems.length * 100)}%` }} /></div><p>今天已经读了 {todayReadCount} 篇，还剩 {todayUnreadCount} 篇</p></div>}
          <button className="today-start" onClick={startTodayReading}><span>{todayReadCount > 0 ? "继续今日阅读" : "开始今日阅读"}</span><CaretRight size={18} weight="bold" /></button>
        </div>}

        {!loading && data.user && todaySessionStarted && selectedItem && <div className="today-reading-stage">
          <div className="today-reading-toolbar">
            <button className="today-back" onClick={() => setTodaySessionStarted(false)}><CaretLeft size={15} weight="bold" />今日概览</button>
            <div className="today-progress"><span>{todayReadCount + (selectedItem.isRead ? 0 : 1)} / {todayItems.length}</span><div><i style={{ width: `${Math.min(100, Math.round((todayReadCount + (selectedItem.isRead ? 0 : 1)) / todayItems.length * 100))}%` }} /></div></div>
            <div className="today-reading-actions">{canToggleAnnotations && <button className={annotationPanelOpen ? "active" : ""} onClick={() => setAnnotationPanelOpen((open) => !open)}><ChatText size={15} weight="duotone" />批注 {itemAnnotations.length}</button>}<button className={selectedItem.isSaved ? "saved" : ""} disabled={busy === "save"} onClick={toggleSaved}><BookmarkSimple size={15} weight={selectedItem.isSaved ? "fill" : "regular"} />{selectedItem.isSaved ? "已收藏" : "收藏"}</button><a href={selectedItem.url} target="_blank" rel="noreferrer">原文 <ArrowSquareOut size={14} /></a></div>
          </div>
          {readerMode === "clean" && <div className={`reader-annotation-layout ${showAnnotationSidebar ? "with-sidebar" : ""}`}><article className="today-document reader-document"><header><div className="reader-kicker"><span>{selectedDetail?.author || selectedItem.author || selectedItem.sourceName || "未知作者"}</span><time>{when(selectedItem.publishedAt, true)}</time>{selectedItem.topic && <em>{selectedItem.topic}</em>}</div><h1>{selectedItem.translatedTitle || selectedItem.title}</h1>{(selectedItem.translatedExcerpt || selectedItem.originalExcerpt) && <p className="reader-summary">{selectedItem.translatedExcerpt || selectedItem.originalExcerpt}</p>}</header>{detailLoading && !selectedDetail && <div className="document-loading"><i /><i /><i /><i /></div>}{selectedDetail?.contentMarkdown && <MarkdownArticle markdown={selectedDetail.contentMarkdown} itemId={selectedItem.id} annotations={itemAnnotations} activeAnnotationId={activeAnnotationId} onSelection={handleArticleSelection} onAnnotationFocus={(annotation) => focusAnnotation(annotation, "document")} />}
              <footer className="today-next">
                <div><small>{todayNextItem ? "下一篇" : "今天的最后一篇"}</small><strong>{todayNextItem ? todayNextItem.translatedTitle || todayNextItem.title : "读完这篇，今天就完成了"}</strong>{todayNextItem && <span>{todayNextItem.sourceName}</span>}</div>
                <div><button disabled={busy === "today-later" || busy === "today-next"} onClick={() => advanceToday(true)}>稍后看</button><button className="today-primary" disabled={busy === "today-later" || busy === "today-next"} onClick={() => advanceToday(false)}>{busy === "today-next" ? "正在进入" : todayNextItem ? "下一篇" : "完成今日阅读"}<CaretRight size={16} weight="bold" /></button></div>
              </footer>
            </article>{showAnnotationSidebar && <AnnotationSidebar annotations={itemAnnotations} loading={annotationsLoading} draft={sidebarDraft} user={data.user} activeAnnotationId={activeAnnotationId} busy={busy} onCollapse={() => setAnnotationPanelOpen(false)} onCancelDraft={cancelAnnotationDraft} onCreate={createCurrentAnnotation} onFocus={focusAnnotation} onReply={replyToAnnotation} onRequireLogin={() => openAuth("login")} onOpenProfile={openProfile} />}</div>}
        </div>}

        {!loading && data.user && todaySessionStarted && !selectedItem && todayItems.length > 0 && <div className="today-state today-complete-state reading-complete">
          <span className="today-state-mark"><Check size={28} weight="bold" /></span>
          <small>{todayHeading()}</small>
          <h1>今天的更新已经读完</h1>
          <p>你处理了 {todayItems.length} 篇内容，收藏的文章可以以后慢慢重读。</p>
          <div className="today-state-actions"><button className="today-primary" onClick={() => { setTodaySessionStarted(false); setTodayItemId(null); }}>回到今日概览</button><button onClick={() => navigate("discover")}>发现更多来源</button></div>
        </div>}
      </div>
    </section>}

    {view === "discover" && <>
      {!immersiveDiscoverReading && <section className="article-pane" aria-label="文章列表">
        <header className="article-pane-header"><div><small>{activeSource ? "正在浏览" : activeCategory ? "当前分类" : "发现内容"}</small><h1>{activeSource?.name || activeCategory || "全部来源"}</h1></div><div className="article-pane-context"><button className="mobile-source-drawer-toggle" type="button" aria-controls="source-pane" aria-expanded={mobileSourcePaneOpen} onClick={toggleSourcePane}><Waves size={15} weight="bold" />来源</button>{activeSource && <button className={activeSource.isFollowed ? "following" : ""} title={activeSource.isFollowed ? "点击取消关注" : "点击关注来源"} disabled={busy === `follow-${activeSource.id}`} onClick={() => toggleFollowing(activeSource)}>{activeSource.isFollowed ? <><Check size={12} weight="bold" />取消关注</> : <><Plus size={12} weight="bold" />关注来源</>}</button>}<span className="article-pane-count"><strong>{articlePaneCount}</strong><small>篇{articleStatus === "unread" ? "未读" : "已读"}</small></span></div></header>
        <label className="article-search"><MagnifyingGlass size={17} aria-hidden="true" /><input aria-label="搜索文章和作者" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleItemLimit(ARTICLE_BATCH_SIZE); }} placeholder="搜索文章、作者" /></label>
        <div className="article-status-tabs" role="tablist" aria-label="阅读状态">
          <button role="tab" aria-controls="article-list" aria-selected={articleStatus === "unread"} className={articleStatus === "unread" ? "active" : ""} onClick={() => { setArticleStatus("unread"); setSelectedItemId(null); setVisibleItemLimit(ARTICLE_BATCH_SIZE); }}><span>未读</span><em>{articleStatusCounts.unread}</em></button>
          <button role="tab" aria-controls="article-list" aria-selected={articleStatus === "read"} className={articleStatus === "read" ? "active" : ""} onClick={() => { setArticleStatus("read"); setSelectedItemId(null); setVisibleItemLimit(ARTICLE_BATCH_SIZE); }}><span>已读</span><em>{articleStatusCounts.read}</em></button>
        </div>
        <div className="article-list" id="article-list" onScroll={(event) => {
          const list = event.currentTarget;
          if (list.scrollHeight - list.scrollTop - list.clientHeight < 320) {
            setVisibleItemLimit((limit) => Math.min(visibleItems.length, limit + ARTICLE_BATCH_SIZE));
          }
        }}>
          {loading && <div className="list-loading"><i /><i /><i /></div>}
          {!loading && visibleItems.length === 0 && <div className="list-empty"><strong>{query.trim() ? "没有找到匹配文章" : articleStatus === "unread" ? "未读已经清空" : "还没有已读文章"}</strong><p>{query.trim() ? "换个关键词试试。" : !data.user ? "登录后会保存你的已读状态。" : articleStatus === "unread" ? "新文章同步后会出现在这里。" : "在文章中点击「标记已读」后，文章会出现在这里。"}</p></div>}
          {renderedItems.map((item) => <button className={`article-row ${effectiveItemId === item.id ? "active" : ""} ${item.isRead ? "read" : ""}`} key={item.id} onClick={() => openItem(item.id)}>
            <div className="article-row-meta"><span>{item.author || item.sourceName || "未知作者"}</span><span className="article-meta-trailing"><time>{when(item.publishedAt)}</time>{Boolean(item.isRead) && <span className="read-status"><Check size={11} weight="bold" aria-hidden="true" />已读</span>}{Boolean(item.isSaved) && <span className="saved-status" aria-label="已收藏" title="已收藏"><BookmarkSimple size={12} weight="fill" aria-hidden="true" /></span>}</span></div><h2>{item.translatedTitle || item.title}</h2><p>{item.translatedExcerpt || item.originalExcerpt || "等待读取正文"}</p>
          </button>)}
          {renderedItems.length < visibleItems.length && <button className="article-load-more" type="button" onClick={() => setVisibleItemLimit((limit) => Math.min(visibleItems.length, limit + ARTICLE_BATCH_SIZE))}>继续加载 {Math.min(ARTICLE_BATCH_SIZE, visibleItems.length - renderedItems.length)} 篇</button>}
        </div>
      </section>}
      <section className="reader-pane" id="reader-pane" aria-label="文章正文">
        {!selectedItem && <div className="reader-empty"><BookOpenText size={28} weight="duotone" aria-hidden="true" /><h2>选择一篇文章开始阅读</h2><p>正文会留在这里，不再跳出当前页面。</p></div>}
        {selectedItem && <>
          <div className="reader-toolbar"><div className="reader-toolbar-leading">{immersiveDiscoverReading && <button className="immersive-back" onClick={() => setDiscoverImmersive(false)}><CaretLeft size={14} weight="bold" />返回来源列表</button>}<span>{selectedItem.sourceName || "随手收录"}</span><div className="reader-mode-switch" role="group" aria-label="阅读模式"><button className={readerMode === "clean" ? "active" : ""} aria-pressed={readerMode === "clean"} onClick={() => setReaderMode("clean")}>净化阅读</button><button className={readerMode === "original" ? "active" : ""} aria-pressed={readerMode === "original"} onClick={() => setReaderMode("original")}>原网页</button></div></div><div className="reader-toolbar-actions">{canToggleAnnotations && <button className={annotationPanelOpen ? "active" : ""} onClick={() => setAnnotationPanelOpen((open) => !open)}><ChatText size={14} weight="duotone" aria-hidden="true" />批注 {itemAnnotations.length}</button>}<button onClick={() => { if (!discoverImmersive) setSelectedItemId(selectedItem.id); setDiscoverImmersive((immersive) => !immersive); }}>{immersiveDiscoverReading ? <CornersIn size={14} /> : <CornersOut size={14} />}{immersiveDiscoverReading ? "退出沉浸" : "沉浸阅读"}</button><button className={selectedItem.isRead ? "read" : ""} disabled={Boolean(selectedItem.isRead) || busy === "read"} onClick={markSelectedRead}><Check size={14} weight="bold" aria-hidden="true" />{selectedItem.isRead ? "已读" : busy === "read" ? "正在标记" : "标记已读"}</button><button className={selectedItem.isSaved ? "saved" : ""} disabled={busy === "save"} onClick={toggleSaved}><BookmarkSimple size={14} weight={selectedItem.isSaved ? "fill" : "regular"} aria-hidden="true" />{selectedItem.isSaved ? "已收藏" : "收藏"}</button><a href={selectedItem.url} target="_blank" rel="noreferrer">打开原文 <ArrowSquareOut size={14} aria-hidden="true" /></a></div></div>
          {readerMode === "clean" && <div className={`reader-annotation-layout ${showAnnotationSidebar ? "with-sidebar" : ""}`}><article className="reader-document"><header><div className="reader-kicker"><span>{selectedDetail?.author || selectedItem.author || selectedItem.sourceName || "未知作者"}</span><time>{when(selectedItem.publishedAt, true)}</time>{selectedItem.topic && <em>{selectedItem.topic}</em>}</div><h1>{selectedItem.translatedTitle || selectedItem.title}</h1>{(selectedItem.translatedExcerpt || selectedItem.originalExcerpt) && <p className="reader-summary">{selectedItem.translatedExcerpt || selectedItem.originalExcerpt}</p>}</header>{detailLoading && !selectedDetail && <div className="document-loading"><i /><i /><i /><i /></div>}{selectedDetail?.contentMarkdown && <MarkdownArticle markdown={selectedDetail.contentMarkdown} itemId={selectedItem.id} annotations={itemAnnotations} activeAnnotationId={activeAnnotationId} onSelection={handleArticleSelection} onAnnotationFocus={(annotation) => focusAnnotation(annotation, "document")} />}</article>{showAnnotationSidebar && <AnnotationSidebar annotations={itemAnnotations} loading={annotationsLoading} draft={sidebarDraft} user={data.user} activeAnnotationId={activeAnnotationId} busy={busy} onCollapse={() => setAnnotationPanelOpen(false)} onCancelDraft={cancelAnnotationDraft} onCreate={createCurrentAnnotation} onFocus={focusAnnotation} onReply={replyToAnnotation} onRequireLogin={() => openAuth("login")} onOpenProfile={openProfile} />}</div>}
          {readerMode === "original" && <div className="original-reader"><div className="original-reader-note"><span>正在显示原站页面</span><p>如果网站拒绝嵌入，请使用右上角“新窗口打开”。</p></div><iframe key={selectedItem.url} src={selectedItem.url} title={`${selectedItem.title} 原网页`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts" /></div>}
        </>}
      </section>
    </>}

    {selectionDraft && selectionActionVisible && <div className="selection-annotation-action" style={{ top: selectionDraft.top, left: selectionDraft.left }} role="toolbar" aria-label="选中文字操作"><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={beginAnnotation}><ChatText size={16} weight="fill" aria-hidden="true" />批注</button></div>}
    {detailItemId && canToggleAnnotations && !annotationPanelOpen && <button className="annotation-reopen-button" type="button" aria-label={`展开批注栏，共 ${itemAnnotations.length} 条批注`} title="展开批注栏" onClick={() => setAnnotationPanelOpen(true)}><ChatText size={16} weight="duotone" aria-hidden="true" /><span>批注 {itemAnnotations.length}</span><CaretLeft size={14} weight="bold" aria-hidden="true" /></button>}

    {view === "annotations" && <section className="full-view annotation-plaza-view" id="view-content">
      <header className="view-header"><div><small>一起读，也一起留下判断</small><h1>批注广场</h1><p>从一段原文出发，看看其他读者如何理解和回应。</p></div><ChatText size={30} weight="duotone" /></header>
      <div className="annotation-plaza-controls"><div className="segmented"><button className={plazaSort === "latest" ? "active" : ""} onClick={() => setPlazaSort("latest")}>最新</button><button className={plazaSort === "hot" ? "active" : ""} onClick={() => setPlazaSort("hot")}>热门</button></div><span>{plazaSort === "latest" ? "按发布时间排列" : "回复越多越靠前"}</span></div>
      {plazaLoading && <div className="annotation-feed-loading" role="status"><i /><i /><i /></div>}
      {!plazaLoading && plazaAnnotations.length === 0 && <div className="annotation-plaza-empty"><ChatText size={28} weight="duotone" /><h2>还没有公开批注</h2><p>阅读文章时选中一段文字，就可以留下第一条批注。</p><button onClick={() => navigate("discover")}>去发现文章</button></div>}
      {!plazaLoading && plazaAnnotations.length > 0 && <div className="annotation-feed">{plazaAnnotations.map((annotation) => <AnnotationFeedCard annotation={annotation} onOpen={() => openAnnotation(annotation)} onOpenProfile={openProfile} key={annotation.id} />)}</div>}
    </section>}

    {view === "leaderboard" && <section className="full-view leaderboard-view" id="view-content">
      <header className="view-header"><div><small>共同阅读</small><h1>排行榜</h1><p>阅读按日记录，贡献按累计订阅源排行。</p></div><ChartBar size={30} weight="duotone" /></header>
      <div className="view-controls"><div className="segmented"><button className={leaderboardMetric === "reading" ? "active" : ""} onClick={() => setLeaderboardMetric("reading")}>阅读榜</button><button className={leaderboardMetric === "contribution" ? "active" : ""} onClick={() => setLeaderboardMetric("contribution")}>贡献榜</button></div>{leaderboardMetric === "reading" && <div className="segmented"><button className={leaderboardPeriod === "today" ? "active" : ""} onClick={() => { setLeaderboardData(null); setLeaderboardPeriod("today"); }}>今日</button><button className={leaderboardPeriod === "yesterday" ? "active" : ""} onClick={() => { setLeaderboardData(null); setLeaderboardPeriod("yesterday"); }}>昨日</button></div>}</div>
      <div className="leaderboard-card">
        <div className="leaderboard-caption"><strong>{leaderboardMetric === "reading" ? "有效阅读排行" : "订阅贡献排行"}</strong><span>{leaderboardMetric === "contribution" ? "全站累计" : leaderboardData?.day || "读取中"}</span></div>
        {!leaderboardData && <div className="list-loading"><i /><i /><i /></div>}
        {leaderboardData && (leaderboardMetric === "reading" ? leaderboardData.reading : leaderboardData.contribution).length === 0 && <div className="list-empty"><strong>还没有用户上榜</strong><p>注册后开始阅读或贡献内容来源吧。</p></div>}
        {leaderboardData && leaderboardMetric === "reading" && leaderboardData.reading.map((row, index) => <div className={`rank-row ${index < 3 ? `podium-row podium-${index + 1}` : ""}`} key={row.id}><RankMarker position={index + 1} /><button className="rank-user-link" type="button" onClick={() => openProfile(row.id)}><Avatar user={row} size="leaderboard" /><span className="rank-user-name">{row.nickname}</span></button><div className="rank-stats"><span><small><BookOpenText size={12} aria-hidden="true" />阅读文章</small><strong>{row.readCount}<em>篇</em></strong></span><span><small><ClockCountdown size={12} aria-hidden="true" />阅读时间</small><strong>{formatDuration(row.readSeconds)}</strong></span></div></div>)}
        {leaderboardData && leaderboardMetric === "contribution" && leaderboardData.contribution.map((row, index) => <div className={`rank-row ${index < 3 ? `podium-row podium-${index + 1}` : ""}`} key={row.id}><RankMarker position={index + 1} /><button className="rank-user-link" type="button" onClick={() => openProfile(row.id)}><Avatar user={row} size="leaderboard" /><span className="rank-user-name">{row.nickname}</span></button><div className="rank-stats contribution"><span><small><Trophy size={12} aria-hidden="true" />贡献来源</small><strong>{row.contributionCount}<em>个</em></strong></span></div></div>)}
      </div>
    </section>}

    {view === "profile" && <section className="full-view profile-view" id="view-content">
      {!profileTargetResolved ? <div className="profile-page-loading" role="status"><i /><i /><i /><i /></div>
        : !profileUserId ? <div className="profile-card signed-out"><LockKey size={28} weight="duotone" /><h2>登录后查看自己的主页</h2><p>也可以从批注广场或排行榜点击他人的头像，查看公开主页。</p><button className="primary-button" onClick={() => openAuth("login")}>登录 / 注册</button></div>
        : profileLoading && !profileData ? <div className="profile-page-loading" role="status"><i /><i /><i /><i /></div>
        : profileError && !profileData ? <div className="profile-card signed-out"><LockKey size={28} weight="duotone" /><h2>主页暂时没有加载出来</h2><p>{profileError}</p><button className="primary-button" onClick={() => window.location.reload()}>重新加载</button></div>
        : profileData && <div className="profile-page-shell">
          <header className="profile-page-heading"><div><small>{profileData.isOwner ? "我的阅读档案" : "读者主页"}</small><h1>{profileData.isOwner ? "个人主页" : `${profileData.user.nickname} 的主页`}</h1></div><span>加入于 {when(profileData.user.createdAt, true)}</span></header>

          <article className="profile-identity-card">
            <div className="profile-identity-main">
              <Avatar user={profileData.user} size="large" />
              <div className="profile-identity-copy"><div><h2>{profileData.user.nickname}</h2><span>@{profileData.user.account}</span></div><p>{profileData.user.bio || "这位读者还没有写个人简介。"}</p><div className="profile-like-summary"><Heart size={15} weight="fill" aria-hidden="true" /><strong>{profileData.likes.count}</strong><span>收到的主页赞</span>{profileData.likes.recent.length > 0 && <div className="profile-liker-stack" aria-label="最近点赞的读者">{profileData.likes.recent.map((liker) => <button className="avatar-link" type="button" title={liker.nickname} aria-label={`查看 ${liker.nickname} 的主页`} key={liker.id} onClick={() => openProfile(liker.id)}><Avatar user={liker} size="small" /></button>)}</div>}</div></div>
              <div className="profile-identity-actions">{profileData.isOwner
                ? <button className="profile-edit-button" type="button" onClick={() => { setProfileNickname(profileData.user.nickname); setProfileBio(profileData.user.bio); setAvatarFeedback(null); setProfileEditing((editing) => !editing); }}><PencilSimple size={15} />{profileEditing ? "收起编辑" : "编辑资料"}</button>
                : <button className={`profile-like-button ${profileData.likes.likedByViewer ? "liked" : ""}`} type="button" aria-pressed={profileData.likes.likedByViewer} disabled={busy === "profile-like"} onClick={toggleProfileLike}><Heart size={16} weight={profileData.likes.likedByViewer ? "fill" : "regular"} />{profileData.likes.likedByViewer ? "已赞" : "赞一下"}</button>}</div>
            </div>

            {profileData.isOwner && profileEditing && <form className="profile-edit-form" onSubmit={saveProfile}>
              <div className="profile-avatar-edit"><label className="upload-button"><UploadSimple size={15} />{busy === "avatar" ? "正在上传…" : "更换头像"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy === "avatar"} onChange={(event) => { const input = event.currentTarget; void uploadAvatar(input.files?.[0]).finally(() => { input.value = ""; }); }} /></label>{avatarFeedback && <span className={`avatar-feedback ${avatarFeedback.kind}`} role={avatarFeedback.kind === "error" ? "alert" : "status"} aria-live="polite">{avatarFeedback.message}</span>}</div>
              <label>昵称<input value={profileNickname} maxLength={40} onChange={(event) => setProfileNickname(event.target.value)} /></label>
              <label>个人简介<textarea value={profileBio} maxLength={300} rows={4} placeholder="简单介绍一下你关注的领域" onChange={(event) => setProfileBio(event.target.value)} /><span className="field-count">{profileBio.length}/300</span></label>
              <div className="form-actions"><button type="button" onClick={() => { setProfileEditing(false); setProfileNickname(profileData.user.nickname); setProfileBio(profileData.user.bio); }}>取消</button><button className="primary-button" disabled={busy === "profile"}>{busy === "profile" ? "保存中" : "保存资料"}</button></div>
            </form>}

            <div className="profile-metrics" aria-label="阅读数据">
              <span><strong>{profileData.metrics.readCount}<em>篇</em></strong><small><BookOpenText size={14} aria-hidden="true" />已读文章</small></span>
              <span><strong><ProfileDurationValue seconds={profileData.metrics.readSeconds} /></strong><small><ClockCountdown size={14} aria-hidden="true" />阅读时间</small></span>
              <span><strong>{profileData.metrics.followedCount}<em>个</em></strong><small><Waves size={14} aria-hidden="true" />关注来源</small></span>
              <span><strong>{profileData.metrics.contributionCount}<em>个</em></strong><small><Trophy size={14} aria-hidden="true" />贡献来源</small></span>
            </div>
          </article>

          <div className="profile-content-stack">
          <section className="profile-section profile-annotation-section" aria-label={`${profileData.user.nickname} 的批注`}>
            <header><div className="profile-section-heading"><span className="profile-section-icon"><Quotes size={18} weight="fill" /></span><div><div className="profile-section-title"><h2>{profileData.isOwner ? "我的批注" : "他的批注"}</h2><strong>{profileData.annotations.length}<span>条</span></strong></div><p>读过、想过，并留下来的判断。</p></div></div></header>
            {profileData.annotations.length === 0 ? <div className="profile-section-empty"><div><strong>还没有公开批注</strong><p>{profileData.isOwner ? "阅读文章时选中一句话，就能留下第一条批注。" : "这位读者还没有留下公开批注。"}</p></div>{profileData.isOwner && <button type="button" onClick={() => navigate("discover")}>去阅读文章</button>}</div>
              : <div className="profile-annotation-list">{profileData.annotations.map((annotation) => <AnnotationFeedCard annotation={annotation} onOpen={() => openAnnotation(annotation)} onOpenProfile={openProfile} key={annotation.id} />)}</div>}
          </section>

          <section className="profile-section profile-source-section" aria-label={`${profileData.user.nickname} 关注的订阅源`}>
            <header><div className="profile-section-heading"><span className="profile-section-icon"><Waves size={18} weight="duotone" /></span><div><div className="profile-section-title"><h2>{profileData.isOwner ? "我关注的来源" : "他关注的来源"}</h2><strong>{profileData.followedSources.length}<span>个</span></strong></div><p>长期阅读这些作者和站点。</p></div></div></header>
            {profileData.followedSources.length === 0 ? <div className="profile-section-empty"><div><strong>还没有关注来源</strong><p>关注后，新内容会进入今日阅读。</p></div></div>
              : <><div className="profile-source-list">{profileData.followedSources.slice(0, 8).map((source) => <ProfileSourceLink source={source} onOpen={() => chooseSource(source.id)} key={source.id} />)}</div>{profileData.followedSources.length > 8 && <details className="profile-source-more"><summary><span className="profile-source-expand-label">展开其余 {profileData.followedSources.length - 8} 个来源</span><span className="profile-source-collapse-label">收起来源</span><CaretDown size={13} weight="bold" aria-hidden="true" /></summary><div className="profile-source-list">{profileData.followedSources.slice(8).map((source) => <ProfileSourceLink source={source} onOpen={() => chooseSource(source.id)} key={source.id} />)}</div></details>}</>}
          </section>

          <section className="profile-section profile-message-section" aria-label={`${profileData.user.nickname} 的留言板`}>
            <header><div className="profile-section-heading"><span className="profile-section-icon"><ChatText size={18} weight="duotone" /></span><div><div className="profile-section-title"><h2>留言板</h2><strong>{profileData.messages.length}<span>条</span></strong></div><p>{profileData.isOwner ? "其他读者写给你的公开留言。" : `给 ${profileData.user.nickname} 留下一句话。`}</p></div></div></header>
            {!profileData.isOwner && <form className="profile-message-form" onSubmit={submitProfileMessage}><Avatar user={data.user || { nickname: "访客", avatarUrl: null }} size="small" /><textarea value={profileMessageBody} maxLength={500} rows={3} placeholder={data.user ? `给 ${profileData.user.nickname} 留言…` : "登录后可以留言"} disabled={!data.user || busy === "profile-message"} onChange={(event) => setProfileMessageBody(event.target.value)} /><button className="primary-button" disabled={!data.user || !profileMessageBody.trim() || busy === "profile-message"}>{busy === "profile-message" ? "发布中" : "发布留言"}</button></form>}
            {profileData.messages.length === 0 ? <div className="profile-section-empty compact"><div><strong>还没有公开留言</strong><p>第一条留言会出现在这里。</p></div></div>
              : <div className="profile-message-list">{profileData.messages.map((message) => <article key={message.id}><button className="avatar-link" type="button" aria-label={`查看 ${message.nickname} 的主页`} onClick={() => openProfile(message.authorUserId)}><Avatar user={message} size="normal" /></button><div><button className="message-author-link" type="button" onClick={() => openProfile(message.authorUserId)}>{message.nickname}</button><time>{annotationWhen(message.createdAt)}</time><p>{message.body}</p></div></article>)}</div>}
          </section>
          </div>
        </div>}
    </section>}

    {view === "settings" && <section className="full-view settings-view" id="view-content">
      {!data.user ? <div className="profile-card signed-out"><Key size={28} weight="duotone" /><h2>登录后管理 API 密钥</h2><p>API 密钥让你在命令行、其他电脑上免密码读取订阅与选题。</p><button className="primary-button" onClick={() => openAuth("login")}>登录 / 注册</button></div>
        : <div className="settings-shell">
          <header className="profile-page-heading"><div><small>账号设置</small><h1>API 密钥</h1></div></header>
          <p className="settings-intro">API 密钥用于 <code>topics</code> 命令行工具和其他设备免密码登录。每台设备建议单独生成一枚，丢失或不用时随时撤销，不影响其它设备。</p>

          <form className="token-create-form" onSubmit={createApiToken}>
            <input value={newTokenName} maxLength={40} placeholder="给这枚密钥起个名字，如 workbuddy" onChange={(event) => setNewTokenName(event.target.value)} />
            <button className="primary-button" disabled={busy === "token-create"}>{busy === "token-create" ? "生成中…" : <><Plus size={15} weight="bold" />生成新密钥</>}</button>
          </form>

          {freshToken && <div className="token-fresh" role="status">
            <div className="token-fresh-head"><Key size={16} weight="fill" /><strong>「{freshToken.name}」已生成 —— 只显示这一次，请立即复制</strong></div>
            <div className="token-fresh-value"><code>{freshToken.token}</code><button type="button" className="token-copy" onClick={copyFreshToken}><Copy size={14} weight="bold" />{tokenCopied ? "已复制" : "复制"}</button></div>
            <div className="token-fresh-hint">目标设备执行：<code>topics login --token {freshToken.token.slice(0, 16)}…</code></div>
          </div>}

          <div className="token-list">
            {apiTokens.length === 0 ? <div className="token-empty">还没有 API 密钥。生成一枚后即可在其他设备上用它登录。</div>
              : apiTokens.map((token) => <div className="token-row" key={token.id}>
                <div className="token-row-main"><Key size={15} weight="duotone" /><div><strong>{token.name}</strong><small>创建于 {when(token.createdAt, true)} · {token.lastUsedAt ? `最近使用 ${when(token.lastUsedAt, true)}` : "尚未使用"}</small></div></div>
                <button className="token-revoke danger" disabled={busy === `token-${token.id}`} onClick={() => revokeApiToken(token.id)}><Trash size={14} />撤销</button>
              </div>)}
          </div>

          <div className="settings-install">
            <h2>在新设备上安装命令行</h2>
            <pre><code>{`mkdir -p ~/bin\ncurl -fsSL https://topic.aigalaxy.top:8443/cli/topics -o ~/bin/topics\nchmod +x ~/bin/topics\ntopics login --token <上面生成的密钥>`}</code></pre>
            <p className="settings-install-note">注意端口 <code>:8443</code>——本站的 443 端口在腾讯云备案接入完成前不可用。GitHub 备用源：<code>curl -fsSL https://raw.githubusercontent.com/GalaxyXieyu/qingliu-studio/main/public/cli/topics -o ~/bin/topics</code></p>
          </div>
        </div>}
    </section>}

    {addOpen && <Modal title="收录新来源" onClose={() => setAddOpen(false)} wide><form className="modal-form" onSubmit={addSubscription}><label htmlFor="source-input">作者主页、公众号文章或博客地址</label><input id="source-input" value={sourceInput} onChange={(event) => setSourceInput(event.target.value)} placeholder="粘贴作者主页、公众号文章或博客地址" /><fieldset className="source-category-choice"><legend>内容分类</legend><p>选择这个来源最常发布的主题。</p><div>{SOURCE_CATEGORIES.map((category) => <label className={sourceCategory === category.value ? "selected" : ""} key={category.value}><input type="radio" name="source-category" value={category.value} checked={sourceCategory === category.value} onChange={() => setSourceCategory(category.value)} /><span>{category.label}</span></label>)}</div></fieldset><p>收录成功后会自动关注。系统首次导入最近 20 篇，X 默认每小时更新，其他默认每天更新；可在 topics CLI 用 sources set 调整每源拉取间隔。</p><div className="form-actions"><button type="button" onClick={() => setAddOpen(false)}>取消</button><button className="primary-button" disabled={busy === "source"}>{busy === "source" ? "正在识别" : "收录并关注"}</button></div></form></Modal>}

    {authOpen && <Modal title={authMode === "login" ? "登录清流工作室" : "注册清流工作室"} onClose={() => { setAuthOpen(false); setAuthError(""); }}><form className="modal-form" onSubmit={submitAuth}><div className="auth-switch"><button type="button" className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }}>登录</button><button type="button" className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAuthError(""); }}>注册</button></div><label>账号<input value={authAccount} maxLength={64} autoComplete="username" onChange={(event) => setAuthAccount(event.target.value)} /></label>{authMode === "register" && <label>昵称<input value={authNickname} maxLength={40} autoComplete="nickname" onChange={(event) => setAuthNickname(event.target.value)} /></label>}<label>密码<input type="password" value={authPassword} minLength={8} maxLength={128} autoComplete={authMode === "login" ? "current-password" : "new-password"} onChange={(event) => setAuthPassword(event.target.value)} /></label>{authMode === "register" && <label>确认密码<input type="password" value={authConfirm} minLength={8} maxLength={128} autoComplete="new-password" onChange={(event) => setAuthConfirm(event.target.value)} /></label>}<p>{authMode === "login" ? "登录后会保存你的阅读、收藏和批注记录。" : "账号用于登录，昵称会显示在排行榜和公开批注中。"}</p>{authError && <div className="auth-feedback error" role="alert">{authError}</div>}<button className="primary-button full" disabled={busy === "auth"}>{busy === "auth" ? authMode === "login" ? "正在登录…" : "正在注册…" : authMode === "login" ? "登录" : "注册并登录"}</button></form></Modal>}

    {registrationSuccess && <Modal title="注册成功" onClose={() => setRegistrationSuccess(null)}><div className="registration-success" role="status"><span className="success-mark"><Check size={22} weight="bold" aria-hidden="true" /></span><strong>欢迎你，{registrationSuccess.nickname}</strong><p>账号已经创建并自动登录。先关注几位作者，关注后即可进入今日阅读；下次登录会直接回到那里。</p><button className="primary-button full" onClick={() => setRegistrationSuccess(null)}>开始关注作者</button></div></Modal>}

    {passwordOpen && <Modal title="修改密码" onClose={() => setPasswordOpen(false)}><form className="modal-form" onSubmit={submitPassword}><label>当前密码<input type="password" value={currentPassword} autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>新密码<input type="password" value={newPassword} minLength={8} maxLength={128} autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} /></label><label>确认新密码<input type="password" value={confirmPassword} minLength={8} maxLength={128} autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} /></label><p>修改后，其他设备上的登录会话会自动退出。</p><button className="primary-button full" disabled={busy === "password"}>{busy === "password" ? "保存中" : "确认修改"}</button></form></Modal>}

    {notice && <div className="toast" role="status" aria-live="polite"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice("")}><X size={15} aria-hidden="true" /></button></div>}
  </main>;
}

export default function Home() {
  return <DeskApp />;
}
