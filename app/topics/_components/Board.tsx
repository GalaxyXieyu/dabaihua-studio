"use client";

import { useState, useCallback, useEffect } from "react";
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
  { key: "candidate", roman: "I", label: "候选", empty: "等待 AI 评估产出候选选题" },
  { key: "approved", roman: "II", label: "入选", empty: "从候选中挑选优质选题" },
  { key: "scheduled", roman: "III", label: "排期中", empty: "设置排期后出现在这里" },
  { key: "published", roman: "IV", label: "已发布", empty: "发布回填后归档在这里" },
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

  // 深链：/content?view=board&card=<id> 进入时直接打开对应选题抽屉。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const card = new URLSearchParams(window.location.search).get("card");
    if (!card) return;
    const id = Number(card);
    if (!Number.isFinite(id)) return;
    const hit = initialTopics.find((topic) => topic.id === id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 深链只在挂载时读取一次外部 URL
    if (hit) setSelected(hit);
  }, [initialTopics]);

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
      {/* 筛选行 */}
      <div className="tp-filters">
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="tp-select"
          aria-label="按平台筛选"
        >
          {PLATFORM_FILTERS.map((p) => <option key={p} value={p}>{p === "全部" ? "全部平台" : p}</option>)}
        </select>
        <select
          value={seriesFilter}
          onChange={(e) => setSeriesFilter(e.target.value)}
          className="tp-select"
          aria-label="按系列筛选"
        >
          <option value="全部">全部系列</option>
          {initialSeries.map((s) => <option key={s.series} value={s.series}>{s.series}</option>)}
        </select>
      </div>

      {/* 看板列：窄屏横向滑动，宽屏网格 */}
      <div className={`tp-board ${showPublished ? "is-four" : ""}`}>
        {visibleColumns.map((col) => {
          const items = byStatus(col.key);
          return (
            <div key={col.key} className="tp-col">
              {/* 列头 */}
              <div className="tp-col-head">
                <span className="tp-col-roman">{col.roman}</span>
                <span className="tp-col-name">{col.label}</span>
                <span className="tp-col-count tp-num">{items.length}</span>
              </div>
              {/* 列条目 */}
              <div>
                {items.length === 0 ? (
                  <p className="tp-empty">{col.empty}</p>
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
      <div className="tp-fold">
        <button
          onClick={() => setShowPublished(!showPublished)}
          aria-expanded={showPublished}
        >
          {showPublished ? "收起已发布" : `展开已发布（${byStatus("published").length}）`}
        </button>
      </div>

      {/* 编辑抽屉 */}
      {selected && (
        <TopicDrawer
          key={selected.id}
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
