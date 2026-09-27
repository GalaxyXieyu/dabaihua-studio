"use client";

import { useMemo, useState } from "react";
import { blockPlainText, parseInline, parseMarkdownBlocks, type InlineToken, type MarkdownBlock } from "../../../lib/review-markdown";

export type TopicDetail = {
  id: number;
  title: string;
  draftMarkdown: string | null;
  reviewStatus: string | null;
  reviewComment: string | null;
  reviewedAt: string | null;
};

export type ReviewRecord = {
  id: number;
  topicId: number;
  userId: number;
  nickname: string;
  kind: string;
  blockIndex: number | null;
  quote: string | null;
  body: string;
  resolved: number | boolean;
  createdAt: string;
  updatedAt: string;
};

type Decision = "approve" | "reject";

function formatTime(value: string | null) {
  if (!value) return "";
  return value.slice(0, 16).replace("T", " ");
}

function statusMeta(status: string) {
  if (status === "approved") return { label: "已通过", className: "bg-emerald-50 text-emerald-700" };
  if (status === "rejected") return { label: "已打回", className: "bg-red-50 text-red-600" };
  return { label: "待审", className: "bg-amber-50 text-amber-700" };
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token: InlineToken, index: number) => {
        if (token.type === "bold") return <strong key={index}>{token.value}</strong>;
        if (token.type === "italic") return <em key={index}>{token.value}</em>;
        if (token.type === "code") return <code key={index} className="rounded bg-[var(--canvas)] px-1 py-0.5 text-[0.9em]">{token.value}</code>;
        if (token.type === "link") {
          return <a key={index} href={token.href} target="_blank" rel="noopener noreferrer" className="text-[var(--green)] underline">{token.value}</a>;
        }
        return <span key={index}>{token.value}</span>;
      })}
    </>
  );
}

function BlockBody({ block }: { block: Exclude<MarkdownBlock, { type: "hr" }> }) {
  if (block.type === "heading") {
    const size = { 1: "text-[24px]", 2: "text-[20px]", 3: "text-[18px]", 4: "text-[17px]" }[block.level];
    return <div className={`${size} font-bold leading-snug`}><InlineText text={block.text} /></div>;
  }
  if (block.type === "code") {
    return <pre className="overflow-x-auto rounded-lg bg-[var(--canvas)] p-3 text-[14px] leading-relaxed"><code>{block.text}</code></pre>;
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className={`${block.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-6`}>
        {block.items.map((item, index) => <li key={index}><InlineText text={item} /></li>)}
      </Tag>
    );
  }
  if (block.type === "blockquote") {
    return <blockquote className="border-l-4 border-[var(--line-strong)] pl-3 text-[var(--muted)]"><InlineText text={block.text} /></blockquote>;
  }
  return <p className="whitespace-pre-wrap"><InlineText text={block.text} /></p>;
}

function AnnotationCard({ review, canDelete, busy, onDelete }: { review: ReviewRecord; canDelete: boolean; busy: boolean; onDelete: (id: number) => void }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)] p-2.5 text-[13px]" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-[var(--ink)]">{review.nickname}</span>
        <span className="text-[11px] text-[var(--faint)]">{formatTime(review.createdAt)}</span>
      </div>
      {review.quote ? <p className="mt-1 border-l-2 border-[var(--line)] pl-2 text-[12px] text-[var(--muted)]">{review.quote}</p> : null}
      <p className="mt-1 whitespace-pre-wrap text-[var(--ink)]">{review.body}</p>
      {canDelete ? (
        <button type="button" onClick={() => onDelete(review.id)} disabled={busy} className="mt-1 text-[11px] font-bold text-[var(--danger)] disabled:opacity-50">
          删除
        </button>
      ) : null}
    </div>
  );
}

export function ReviewClient({ topic, initialReviews, currentUserId }: { topic: TopicDetail; initialReviews: ReviewRecord[]; currentUserId: number }) {
  const [reviews, setReviews] = useState<ReviewRecord[]>(initialReviews);
  const [status, setStatus] = useState(topic.reviewStatus || "pending");
  const [comment, setComment] = useState(topic.reviewComment || "");
  const [reviewedAt, setReviewedAt] = useState(topic.reviewedAt || "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<Decision | null>(null);
  const [decisionComment, setDecisionComment] = useState("");
  const [showAll, setShowAll] = useState(false);

  const blocks = useMemo(() => parseMarkdownBlocks(topic.draftMarkdown || ""), [topic.draftMarkdown]);
  const annotations = useMemo(() => reviews.filter((review) => review.kind === "annotation"), [reviews]);
  const badge = statusMeta(status);

  const annotationsFor = (index: number) => annotations.filter((review) => review.blockIndex === index);

  function quoteFor(index: number) {
    const block = blocks.find((item) => item.type !== "hr" && item.index === index);
    return block ? blockPlainText(block).slice(0, 120) : "";
  }

  async function request(payload: Record<string, unknown>) {
    const response = await fetch(`/api/topics/${topic.id}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(data.error || "操作失败");
    return data;
  }

  async function saveAnnotation() {
    if (activeIndex === null) return;
    const body = draft.trim();
    if (!body) {
      setError("批注不能为空");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await request({ action: "annotate", blockIndex: activeIndex, quote: quoteFor(activeIndex), body });
      if (data.review) setReviews((previous) => [...previous, data.review as ReviewRecord]);
      setDraft("");
      setActiveIndex(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存批注失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeAnnotation(id: number) {
    setBusy(true);
    setError("");
    try {
      await request({ action: "delete", reviewId: id });
      setReviews((previous) => previous.filter((review) => review.id !== id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除批注失败");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: Decision) {
    const text = decisionComment.trim();
    if (decision === "reject" && !text) {
      setError("打回必须填写意见");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await request({ action: decision, comment: text });
      setStatus(String(data.reviewStatus || ""));
      setComment(String(data.comment || ""));
      setReviewedAt(String(data.reviewedAt || ""));
      if (data.review) setReviews((previous) => [...previous, data.review as ReviewRecord]);
      setSheet(null);
      setDecisionComment("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交审稿意见失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto flex max-w-[680px] items-center justify-between gap-3 px-4 py-3">
          <a href="/topics" className="text-sm font-bold text-[var(--muted)]">← 选题看板</a>
          <span className="text-xs text-[var(--faint)]">#{topic.id}</span>
          <span data-review-status={status} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${badge.className}`}>{badge.label}</span>
        </div>
      </header>

      <main className="mx-auto max-w-[680px] px-4 pb-40 pt-4">
        <h1 className="mb-3 text-[20px] font-bold leading-snug">{topic.title}</h1>
        {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
        {status !== "pending" ? (
          <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-[13px]">
            <div className="font-bold">{status === "approved" ? "✅ 已通过" : "↩️ 已打回"}{reviewedAt ? ` · ${formatTime(reviewedAt)}` : ""}</div>
            {comment ? <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">{comment}</p> : null}
          </div>
        ) : null}

        <div className="space-y-3 text-[17px] leading-[1.85]">
          {blocks.map((block, position) => {
            if (block.type === "hr") return <hr key={position} className="border-[var(--line)]" />;
            const index = block.index;
            const items = annotationsFor(index);
            const active = activeIndex === index;
            return (
              <section
                key={position}
                data-review-block={index}
                onClick={() => setActiveIndex(active ? null : index)}
                className={`relative cursor-pointer rounded-lg px-3 py-2 transition ${active ? "bg-[var(--green-soft)] ring-1 ring-[var(--green)]" : "hover:bg-[var(--canvas)]"}`}
              >
                <BlockBody block={block} />
                {items.length > 0 ? (
                  <span className="absolute right-2 top-2 rounded-full bg-[var(--paper)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--green)] ring-1 ring-[var(--line)]">{items.length}</span>
                ) : null}
                {items.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {items.map((review) => (
                      <AnnotationCard key={review.id} review={review} canDelete={review.userId === currentUserId} busy={busy} onDelete={removeAnnotation} />
                    ))}
                  </div>
                ) : null}
                {active ? (
                  <div className="mt-2 rounded-lg border border-[var(--green)] bg-[var(--paper)] p-2.5" onClick={(event) => event.stopPropagation()}>
                    <textarea
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={3}
                      maxLength={1000}
                      placeholder="写下你的批注…"
                      className="w-full resize-y rounded border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-[14px] leading-normal outline-none focus:border-[var(--green)]"
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button type="button" onClick={() => { setActiveIndex(null); setDraft(""); }} className="rounded-lg px-3 py-1.5 text-[12px] font-bold text-[var(--muted)]">取消</button>
                      <button type="button" onClick={saveAnnotation} disabled={busy} className="rounded-lg bg-[var(--green)] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">保存批注</button>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        <div className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--paper)]">
          <button type="button" onClick={() => setShowAll((value) => !value)} className="w-full px-4 py-3 text-left text-sm font-bold">
            全部批注 ({annotations.length}) {showAll ? "▲" : "▼"}
          </button>
          {showAll ? (
            <div className="space-y-2 border-t border-[var(--line)] p-3">
              {annotations.length ? annotations.map((review) => (
                <div key={review.id}>
                  <div className="mb-1 text-[11px] text-[var(--faint)]">{review.blockIndex === null ? "" : `第 ${review.blockIndex + 1} 段 · `}{review.nickname} · {formatTime(review.createdAt)}</div>
                  <AnnotationCard review={review} canDelete={review.userId === currentUserId} busy={busy} onDelete={removeAnnotation} />
                </div>
              )) : <p className="text-sm text-[var(--muted)]">还没有批注</p>}
            </div>
          ) : null}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--paper)] px-4 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.05)]" style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-[680px] gap-3">
          <button type="button" onClick={() => { setSheet("reject"); setDecisionComment(""); setError(""); }} disabled={busy} className="flex-1 rounded-xl border border-[var(--danger)] py-3 text-sm font-bold text-[var(--danger)] disabled:opacity-50">↩️ 打回</button>
          <button type="button" onClick={() => { setSheet("approve"); setDecisionComment(""); setError(""); }} disabled={busy} className="flex-1 rounded-xl bg-[var(--green)] py-3 text-sm font-bold text-white disabled:opacity-50">✅ 通过</button>
        </div>
      </div>

      {sheet ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/30" onClick={() => setSheet(null)}>
          <div className="w-full rounded-t-2xl bg-[var(--paper)] p-4" onClick={(event) => event.stopPropagation()} style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}>
            <h2 className="mb-2 text-base font-bold">{sheet === "reject" ? "打回意见" : "通过确认"}</h2>
            <textarea
              autoFocus
              value={decisionComment}
              onChange={(event) => setDecisionComment(event.target.value)}
              rows={sheet === "reject" ? 4 : 2}
              maxLength={2000}
              placeholder={sheet === "reject" ? "说明需要修改的地方…" : "可选：留一句通过备注"}
              className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-[14px] outline-none focus:border-[var(--green)]"
            />
            {sheet === "reject" && !decisionComment.trim() ? <p className="mt-1 text-xs text-[var(--danger)]">打回必须填写意见</p> : null}
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={() => setSheet(null)} className="flex-1 rounded-xl border border-[var(--line)] py-2.5 text-sm font-bold text-[var(--muted)]">取消</button>
              <button type="button" onClick={() => decide(sheet)} disabled={busy || (sheet === "reject" && !decisionComment.trim())} className={`flex-1 rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-50 ${sheet === "reject" ? "bg-[var(--danger)]" : "bg-[var(--green)]"}`}>
                {sheet === "reject" ? "确认打回" : "确认通过"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
