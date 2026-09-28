"use client";

import { useState } from "react";

export function ArticleHeaderActions({
  slug,
  initialPublic,
  latestRound,
}: {
  slug: string;
  initialPublic: boolean;
  latestRound: number | null;
}) {
  const [isPublic, setIsPublic] = useState(initialPublic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function togglePublic() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/articles/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ isPublic: !isPublic }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; isPublic?: boolean };
      if (!response.ok) throw new Error(data.error || "更新公开状态失败");
      setIsPublic(Boolean(data.isPublic));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新公开状态失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-3">
      <button
        type="button"
        onClick={togglePublic}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center text-[13px] tracking-[.04em] text-[var(--muted)] transition-colors hover:text-[var(--accent)] disabled:opacity-50"
      >
        {isPublic ? "公开" : "私有"}
      </button>
      {latestRound ? (
        <a
          href={`/api/review/article/${slug}/feedback?round=latest`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center text-[13px] tracking-[.04em] text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
        >
          反馈 JSON
        </a>
      ) : null}
      {error ? <span className="text-[11px] text-[var(--danger)]">{error}</span> : null}
    </span>
  );
}

export default ArticleHeaderActions;
