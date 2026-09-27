"use client";

import { useState, useCallback } from "react";
import { TopicCard } from "./TopicCard";
import { TopicDrawer } from "./TopicDrawer";

export type Topic = {
  id: number;
  title: string;
  angle: string | null;
  reason: string | null;
  platform: string | null;
  contentType: string | null;
  heat: number | null;
  matchScore: number | null;
  feasibility: number | null;
  total: number;
  hkr: string | null;
  status: string;
  series: string | null;
  seriesOrder: number | null;
  scheduledDate: string | null;
  publishedDate: string | null;
  publishedUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  hasDraft?: number | boolean | null;
  draftUpdatedAt?: string | null;
  reviewStatus?: string | null;
};

export type SeriesSummary = {
  series: string;
  count: number;
  minOrder: number | null;
  maxOrder: number | null;
};

const COLUMNS = [
  { key: "candidate", label: "📥 候选", accent: "border-t-blue-400", empty: "等待 AI 评估产出候选选题" },
  { key: "approved", label: "✅ 入选", accent: "border-t-green-400", empty: "从候选中挑选优质选题" },
  { key: "scheduled", label: "📅 排期中", accent: "border-t-amber-400", empty: "设置排期后出现在这里" },
  { key: "published", label: "🚀 已发布", accent: "border-t-purple-400", empty: "发布回填后归档在这里" },
] as const;

const PLATFORM_FILTERS = ["全部", "公众号", "小红书", "X", "B站"] as const;

function platformLabel(p: string | null) {
  if (!p) return "";
  return { gzh: "公众号", wechat_gzh: "公众号", xhs: "小红书", x: "X", bilibili: "B站" }[p] || p;
}

export { platformLabel };

export function Board({ initialTopics, initialSeries }: { initialTopics: Topic[]; initialSeries: SeriesSummary[] }) {
  const [topics, setTopics] = useState<Topic[]>(initialTopics);
  const [selected, setSelected] = useState<Topic | null>(null);
  const [saving, setSaving] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<string>("全部");
  const [seriesFilter, setSeriesFilter] = useState<string>("全部");
  const [showPublished, setShowPublished] = useState(false);

  const filtered = topics.filter((t) => {
    if (platformFilter !== "全部" && platformLabel(t.platform) !== platformFilter) return false;
    if (seriesFilter !== "全部" && t.series !== seriesFilter) return false;
    return true;
  });

  const byStatus = useCallback(
    (status: string) => filtered.filter((t) => t.status === status),
    [filtered],
  );

  const visibleColumns = COLUMNS.filter((c) => c.key !== "published" || showPublished);

  const handleSave = useCallback(
    async (id: number, patch: Record<string, unknown>) => {
      setSaving(true);
      try {
        const resp = await fetch(`/api/topics/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!resp.ok) throw new Error("保存失败");
        setTopics((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } as Topic : t)));
        setSelected((prev) => (prev?.id === id ? { ...prev, ...patch } as Topic : prev));
      } catch { alert("保存失败"); } finally { setSaving(false); }
    },
    [],
  );

  const handleAction = useCallback(
    async (id: number, action: "approve" | "skip" | "unschedule") => {
      const patch: Record<string, unknown> =
        action === "approve" ? { status: "approved" } :
        action === "skip" ? { status: "skipped" } :
        { scheduledDate: null, status: "approved" };
      await handleSave(id, patch);
    },
    [handleSave],
  );

  const handleSchedule = useCallback(
    async (id: number, date: string) => {
      setSaving(true);
      try {
        const resp = await fetch(`/api/topics/${id}/schedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({})) as { message?: string };
          throw new Error(err?.message || "排期失败");
        }
        setTopics((prev) => prev.map((t) => (t.id === id ? { ...t, status: "scheduled", scheduledDate: date } as Topic : t)));
        setSelected((prev) => (prev?.id === id ? { ...prev, status: "scheduled", scheduledDate: date } as Topic : prev));
      } catch (e) { alert(e instanceof Error ? e.message : "排期失败"); } finally { setSaving(false); }
    },
    [],
  );

  const handlePublish = useCallback(
    async (id: number, data: { url: string; publishedDate?: string; reads?: number; likes?: number; collects?: number; shares?: number }) => {
      setSaving(true);
      try {
        const resp = await fetch(`/api/topics/${id}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        if (!resp.ok) throw new Error("发布回填失败");
        setTopics((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, status: "published", publishedUrl: data.url, publishedDate: data.publishedDate || new Date().toISOString().slice(0, 10) } as Topic
              : t,
          ),
        );
        setSelected(null);
      } catch { alert("发布回填失败"); } finally { setSaving(false); }
    },
    [],
  );

  return (
    <div>
      {/* 顶部工具栏 */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-sm text-[var(--muted)] outline-none sm:w-auto sm:py-1.5"
        >
          {PLATFORM_FILTERS.map((p) => <option key={p} value={p}>{p === "全部" ? "全部平台" : p}</option>)}
        </select>
        <select
          value={seriesFilter}
          onChange={(e) => setSeriesFilter(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-sm text-[var(--muted)] outline-none sm:w-auto sm:py-1.5"
        >
          <option value="全部">全部系列</option>
          {initialSeries.map((s) => <option key={s.series} value={s.series}>{s.series}</option>)}
        </select>
        <div className="text-sm text-[var(--faint)] sm:ml-auto">
          共 {filtered.length} 个选题
        </div>
      </div>

      {/* 看板列：窄屏横向滑动，宽屏网格 */}
      <div className={`board-columns flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 sm:grid sm:snap-none sm:overflow-visible sm:pb-0 ${showPublished ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {visibleColumns.map((col) => {
          const items = byStatus(col.key);
          return (
            <div key={col.key} className="flex w-[85vw] max-w-[340px] shrink-0 snap-start flex-col sm:w-auto sm:max-w-none sm:shrink">
              {/* 列标题 */}
              <div className={`mb-3 flex items-center justify-between rounded-t-xl border-t-4 ${col.accent} bg-[var(--paper)] px-4 py-2.5`}>
                <span className="text-sm font-bold text-[var(--ink)]">{col.label}</span>
                <span className="rounded-full bg-[var(--canvas)] px-2 py-0.5 text-xs font-bold text-[var(--muted)]">{items.length}</span>
              </div>
              {/* 列内容 */}
              <div className="board-column-body flex-1 space-y-2 overflow-y-auto pb-4">
                {items.length === 0 ? (
                  <div className="flex h-32 items-center justify-center rounded-xl border-2 border-dashed border-[var(--line)] text-center">
                    <div>
                      <div className="text-sm text-[var(--faint)]">{col.empty}</div>
                    </div>
                  </div>
                ) : (
                  items.map((t) => (
                    <TopicCard key={t.id} topic={t} onClick={() => setSelected(t)} />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 已发布折叠按钮 */}
      <div className="mt-2 flex justify-center">
        <button
          onClick={() => setShowPublished(!showPublished)}
          className="rounded-full border border-[var(--line)] px-4 py-2 text-sm text-[var(--muted)] hover:bg-[var(--canvas)]"
        >
          {showPublished ? "收起已发布 ▲" : `展开已发布 (${byStatus("published").length}) ▼`}
        </button>
      </div>

      {/* 编辑抽屉 */}
      {selected && (
        <TopicDrawer
          topic={selected}
          saving={saving}
          onClose={() => setSelected(null)}
          onSave={(patch) => handleSave(selected.id, patch)}
          onAction={(action) => handleAction(selected.id, action)}
          onSchedule={(date) => handleSchedule(selected.id, date)}
          onPublish={(data) => handlePublish(selected.id, data)}
        />
      )}
    </div>
  );
}
