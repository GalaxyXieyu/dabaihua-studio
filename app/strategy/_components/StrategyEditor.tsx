"use client";

import { useState } from "react";

type ContentRouting = Record<string, { allowed: boolean | string; rule?: string; reason?: string; heat?: number }>;
type TitleFormulas = Record<string, string>;
type PublishRules = string[];

type PlatformData = {
  positioning: string;
  key_metric?: string;
  content_routing: ContentRouting;
  title_formulas: TitleFormulas & { structure?: string; required_two_of_three?: string[]; blacklist?: string[] };
  publish_rules?: PublishRules;
};

type StrategyData = {
  platforms: Record<string, PlatformData>;
  topic_routing_matrix?: Record<string, Record<string, string>>;
  banned_patterns?: { words?: string[]; punctuation?: Record<string, string>; structures?: string[]; vague_refs?: string[] };
  derivation_order?: string[];
  cta_templates?: Record<string, string>;
};

type Retrospective = {
  id: number; date: string; title: string; problem: string; result: string; lesson: string;
  version: number; isActive: boolean;
};

const STATUS_CYCLE: (boolean | string)[] = [true, "conditional", false];
const STATUS_LABEL: Record<string, string> = { true: "✅ 允许", conditional: "⚠️ 条件", false: "❌ 禁止" };
const STATUS_COLOR: Record<string, string> = {
  true: "bg-green-100 text-green-700",
  conditional: "bg-amber-100 text-amber-700",
  false: "bg-red-100 text-red-600",
};

const TABS = ["平台路由", "标题公式", "发布规则", "复盘记录"] as const;

export function StrategyEditor({ initialVersion, initialNote, initialData }: {
  initialVersion: number;
  initialNote: string | null;
  initialData: unknown;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("平台路由");
  const [data, setData] = useState<StrategyData>(() => {
    try {
      if (typeof initialData === "string") return JSON.parse(initialData);
      if (initialData && typeof initialData === "object") return initialData as StrategyData;
    } catch { /* ignore */ }
    return { platforms: {} };
  });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [retros, setRetros] = useState<Retrospective[]>([]);
  const [retroLoaded, setRetroLoaded] = useState(false);
  const [showNewRetro, setShowNewRetro] = useState(false);
  const [newRetro, setNewRetro] = useState({ date: "", title: "", problem: "", result: "", lesson: "" });
  const [editRetroId, setEditRetroId] = useState<number | null>(null);
  const [editRetro, setEditRetro] = useState({ date: "", title: "", problem: "", result: "", lesson: "" });

  const platforms = data.platforms || {};
  const gzh = platforms.wechat_gzh || ({} as PlatformData);
  const xhs = platforms.xiaohongshu || ({} as PlatformData);

  const updatePlatform = (key: string, field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      platforms: { ...prev.platforms, [key]: { ...prev.platforms[key], [field]: value } },
    }));
  };

  const updateRouting = (platform: string, typeName: string, field: string, value: unknown) => {
    setData((prev) => ({
      ...prev,
      platforms: {
        ...prev.platforms,
        [platform]: {
          ...prev.platforms[platform],
          content_routing: {
            ...prev.platforms[platform]?.content_routing,
            [typeName]: { ...prev.platforms[platform]?.content_routing?.[typeName], [field]: value },
          },
        },
      },
    }));
  };

  const cycleStatus = (platform: string, typeName: string) => {
    const current = platforms[platform]?.content_routing?.[typeName]?.allowed ?? true;
    const idx = STATUS_CYCLE.indexOf(current);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    updateRouting(platform, typeName, "allowed", next);
  };

  const saveStrategy = async (section?: string) => {
    setSaving(true);
    setMessage("");
    try {
      const resp = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: JSON.stringify(data), note: note || `更新${section || "策略"}` }),
      });
      if (!resp.ok) throw new Error((await resp.json())?.message || "保存失败");
      setMessage(`✅ 已保存为新版本`);
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : "保存失败"}`);
    } finally {
      setSaving(false);
    }
  };

  const loadRetros = async () => {
    if (retroLoaded) return;
    try {
      const resp = await fetch("/api/retrospectives");
      const json = await resp.json();
      setRetros(json.retrospectives || []);
      setRetroLoaded(true);
    } catch { /* ignore */ }
  };

  const saveNewRetro = async () => {
    if (!newRetro.date || !newRetro.title) return;
    try {
      const resp = await fetch("/api/retrospectives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRetro),
      });
      if (!resp.ok) throw new Error("创建失败");
      setShowNewRetro(false);
      setNewRetro({ date: "", title: "", problem: "", result: "", lesson: "" });
      setRetroLoaded(false);
      await loadRetros();
    } catch { setMessage("❌ 创建复盘失败"); }
  };

  const saveEditRetro = async () => {
    if (!editRetroId) return;
    try {
      const resp = await fetch(`/api/retrospectives/${editRetroId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editRetro),
      });
      if (!resp.ok) throw new Error("修订失败");
      setEditRetroId(null);
      setRetroLoaded(false);
      await loadRetros();
    } catch { setMessage("❌ 修订复盘失败"); }
  };

  const renderPlatformRouting = (key: string, label: string, platform: PlatformData) => {
    const routing = platform.content_routing || {};
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-[var(--ink)]">{label}</h3>
          <input
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-sm outline-none focus:border-[var(--green)] sm:w-64"
            value={platform.positioning || ""}
            onChange={(e) => updatePlatform(key, "positioning", e.target.value)}
            placeholder="平台定位"
          />
        </div>
        {platform.key_metric && (
          <div className="mb-4 text-sm text-[var(--muted)]">核心指标：{platform.key_metric}</div>
        )}
        <div className="space-y-2">
          {Object.entries(routing).map(([typeName, config]) => (
            <div key={typeName} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 sm:gap-3 sm:px-4">
              <span className="w-20 shrink-0 text-sm font-medium text-[var(--ink)] sm:w-24">{typeName}</span>
              <button
                onClick={() => cycleStatus(key, typeName)}
                className={`strategy-status shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_COLOR[String(config.allowed)]}`}
              >
                {STATUS_LABEL[String(config.allowed)] || "✅"}
              </button>
              <input
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-[var(--muted)] outline-none hover:border-[var(--line)] focus:border-[var(--green)]"
                value={config.rule || config.reason || ""}
                onChange={(e) => updateRouting(key, typeName, config.allowed === false ? "reason" : "rule", e.target.value)}
                placeholder={config.allowed === false ? "禁止原因" : "规则说明"}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            disabled={saving}
            onClick={() => saveStrategy(`${label}路由`)}
            className="rounded-full bg-[var(--green)] px-5 py-2 text-sm font-bold text-white hover:bg-[var(--green-hover)] disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    );
  };

  const renderTitleFormulas = (key: string, label: string, platform: PlatformData) => {
    const formulas = platform.title_formulas || {};
    const entries = Object.entries(formulas).filter(([k]) => !["structure", "required_two_of_three", "blacklist"].includes(k));
    const blacklist = (formulas as TitleFormulas & { blacklist?: string[] }).blacklist || [];
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-[var(--shadow-card)]">
        <h3 className="mb-4 text-lg font-bold text-[var(--ink)]">{label}</h3>
        <div className="space-y-2">
          {entries.map(([type, formula]) => (
            <div key={type} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 sm:gap-3 sm:px-4">
              <span className="w-20 shrink-0 text-sm font-medium text-[var(--ink)] sm:w-24">{type}</span>
              <input
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-[var(--line)] focus:border-[var(--green)]"
                value={String(formula)}
                onChange={(e) => {
                  setData((prev) => ({
                    ...prev,
                    platforms: {
                      ...prev.platforms,
                      [key]: {
                        ...prev.platforms[key],
                        title_formulas: { ...prev.platforms[key]?.title_formulas, [type]: e.target.value },
                      },
                    },
                  }));
                }}
              />
            </div>
          ))}
        </div>
        {blacklist.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-bold text-[var(--muted)]">标题黑名单词</div>
            <div className="flex flex-wrap gap-1.5">
              {blacklist.map((word, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-600">
                  {word}
                  <button
                    onClick={() => {
                      const newList = blacklist.filter((_, j) => j !== i);
                      setData((prev) => ({
                        ...prev,
                        platforms: {
                          ...prev.platforms,
                          [key]: {
                            ...prev.platforms[key],
                            title_formulas: { ...prev.platforms[key]?.title_formulas, blacklist: newList },
                          },
                        },
                      }));
                    }}
                    className="text-red-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            disabled={saving}
            onClick={() => saveStrategy(`${label}标题公式`)}
            className="rounded-full bg-[var(--green)] px-5 py-2 text-sm font-bold text-white hover:bg-[var(--green-hover)] disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    );
  };

  const renderPublishRules = () => {
    const gzhRules = gzh.publish_rules || [];
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--ink)]">发布规则</h3>
          <button
            onClick={() => {
              updatePlatform("wechat_gzh", "publish_rules", [...gzhRules, ""]);
            }}
            className="rounded-full border border-[var(--line)] px-3 py-1 text-sm text-[var(--muted)] hover:bg-[var(--canvas)]"
          >
            + 添加规则
          </button>
        </div>
        <div className="space-y-2">
          {gzhRules.map((rule, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 sm:gap-3 sm:px-4">
              <span className="shrink-0 text-sm text-[var(--faint)]">{i + 1}.</span>
              <input
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-[var(--line)] focus:border-[var(--green)]"
                value={rule}
                onChange={(e) => {
                  const newRules = [...gzhRules];
                  newRules[i] = e.target.value;
                  updatePlatform("wechat_gzh", "publish_rules", newRules);
                }}
              />
              <button
                onClick={() => {
                  const newRules = gzhRules.filter((_, j) => j !== i);
                  updatePlatform("wechat_gzh", "publish_rules", newRules);
                }}
                className="shrink-0 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            disabled={saving}
            onClick={() => saveStrategy("发布规则")}
            className="rounded-full bg-[var(--green)] px-5 py-2 text-sm font-bold text-white hover:bg-[var(--green-hover)] disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    );
  };

  const renderRetros = () => {
    if (!retroLoaded) {
      loadRetros();
      return <div className="text-center text-sm text-[var(--muted)]">加载中...</div>;
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--ink)]">复盘记录</h3>
          <button
            onClick={() => setShowNewRetro(true)}
            className="rounded-full bg-[var(--green)] px-4 py-1.5 text-sm font-bold text-white hover:bg-[var(--green-hover)]"
          >
            + 新建复盘
          </button>
        </div>

        {showNewRetro && (
          <div className="rounded-2xl border border-[var(--green)] bg-[var(--paper)] p-5 shadow-[var(--shadow-card)]">
            <div className="mb-3 text-sm font-bold text-[var(--ink)]">新建复盘</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input type="date" className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" value={newRetro.date} onChange={(e) => setNewRetro((p) => ({ ...p, date: e.target.value }))} />
              <input className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" placeholder="标题" value={newRetro.title} onChange={(e) => setNewRetro((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <textarea className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" rows={2} placeholder="问题" value={newRetro.problem} onChange={(e) => setNewRetro((p) => ({ ...p, problem: e.target.value }))} />
            <textarea className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" rows={2} placeholder="结果" value={newRetro.result} onChange={(e) => setNewRetro((p) => ({ ...p, result: e.target.value }))} />
            <textarea className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" rows={2} placeholder="教训" value={newRetro.lesson} onChange={(e) => setNewRetro((p) => ({ ...p, lesson: e.target.value }))} />
            <div className="mt-3 flex gap-2">
              <button onClick={saveNewRetro} className="rounded-full bg-[var(--green)] px-4 py-1.5 text-sm font-bold text-white hover:bg-[var(--green-hover)]">保存</button>
              <button onClick={() => setShowNewRetro(false)} className="rounded-full border border-[var(--line)] px-4 py-1.5 text-sm text-[var(--muted)]">取消</button>
            </div>
          </div>
        )}

        {retros.map((r) => (
          <div key={r.id} className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 shadow-[var(--shadow-card)]">
            {editRetroId === r.id ? (
              <div>
                <div className="mb-3 text-sm font-bold">修订复盘（将产生新版本）</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input type="date" className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" value={editRetro.date} onChange={(e) => setEditRetro((p) => ({ ...p, date: e.target.value }))} />
                  <input className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" placeholder="标题" value={editRetro.title} onChange={(e) => setEditRetro((p) => ({ ...p, title: e.target.value }))} />
                </div>
                <textarea className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" rows={2} placeholder="问题" value={editRetro.problem} onChange={(e) => setEditRetro((p) => ({ ...p, problem: e.target.value }))} />
                <textarea className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" rows={2} placeholder="结果" value={editRetro.result} onChange={(e) => setEditRetro((p) => ({ ...p, result: e.target.value }))} />
                <textarea className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" rows={2} placeholder="教训" value={editRetro.lesson} onChange={(e) => setEditRetro((p) => ({ ...p, lesson: e.target.value }))} />
                <div className="mt-3 flex gap-2">
                  <button onClick={saveEditRetro} className="rounded-full bg-[var(--green)] px-4 py-1.5 text-sm font-bold text-white hover:bg-[var(--green-hover)]">保存新版本</button>
                  <button onClick={() => setEditRetroId(null)} className="rounded-full border border-[var(--line)] px-4 py-1.5 text-sm text-[var(--muted)]">取消</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--faint)]">📅 {r.date}</span>
                    <span className="font-bold text-[var(--ink)]">{r.title}</span>
                    <span className="rounded-full bg-[var(--canvas)] px-2 py-0.5 text-[10px] font-bold text-[var(--muted)]">v{r.version}</span>
                  </div>
                  <button
                    onClick={() => { setEditRetroId(r.id); setEditRetro({ date: r.date, title: r.title, problem: r.problem, result: r.result, lesson: r.lesson }); }}
                    className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--muted)] hover:bg-[var(--canvas)]"
                  >
                    修订
                  </button>
                </div>
                <div className="space-y-1 text-sm">
                  <div><span className="font-medium text-[var(--muted)]">问题：</span>{r.problem}</div>
                  <div><span className="font-medium text-[var(--muted)]">结果：</span>{r.result}</div>
                  <div><span className="font-medium text-[var(--muted)]">教训：</span>{r.lesson}</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Tab 导航 */}
      <div className="flex gap-1 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-1.5 shadow-[var(--shadow-card)]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`min-w-0 flex-1 whitespace-nowrap rounded-xl px-2 py-2 text-xs font-bold transition sm:px-4 sm:text-sm ${
              tab === t ? "bg-[var(--green)] text-white" : "text-[var(--muted)] hover:bg-[var(--canvas)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* 版本信息 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 shadow-[var(--shadow-card)] sm:gap-3 sm:px-5">
        <span className="text-xs text-[var(--muted)]">当前版本</span>
        <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-700">v{initialVersion}</span>
        <span className="text-xs text-[var(--faint)]">{initialNote}</span>
        <input
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-sm outline-none focus:border-[var(--green)] sm:ml-auto sm:w-64"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="版本说明（保存时备注）"
        />
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-2 text-sm ${message.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
          {message}
        </div>
      )}

      {/* Tab 内容 */}
      {tab === "平台路由" && (
        <div className="space-y-4">
          {renderPlatformRouting("wechat_gzh", "公众号 GZH", gzh)}
          {renderPlatformRouting("xiaohongshu", "小红书 XHS", xhs)}
        </div>
      )}
      {tab === "标题公式" && (
        <div className="space-y-4">
          {renderTitleFormulas("wechat_gzh", "公众号标题公式", gzh)}
          {renderTitleFormulas("xiaohongshu", "小红书标题公式", xhs)}
        </div>
      )}
      {tab === "发布规则" && renderPublishRules()}
      {tab === "复盘记录" && renderRetros()}
    </div>
  );
}
