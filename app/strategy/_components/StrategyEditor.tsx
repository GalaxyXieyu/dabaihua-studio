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
const STATUS_LABEL: Record<string, string> = { true: "允许", conditional: "条件", false: "禁止" };
const STATUS_CLASS: Record<string, string> = { true: "", conditional: "conditional", false: "forbidden" };

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
  const [messageKind, setMessageKind] = useState<"ok" | "err">("ok");
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
      if (!resp.ok) throw new Error(((await resp.json().catch(() => ({}))) as { message?: string })?.message || "保存失败");
      setMessageKind("ok");
      setMessage("已保存为新版本");
    } catch (err) {
      setMessageKind("err");
      setMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const loadRetros = async () => {
    if (retroLoaded) return;
    try {
      const resp = await fetch("/api/retrospectives");
      const json = (await resp.json()) as { retrospectives?: Retrospective[] };
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
    } catch {
      setMessageKind("err");
      setMessage("创建复盘失败");
    }
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
    } catch {
      setMessageKind("err");
      setMessage("修订复盘失败");
    }
  };

  const renderPlatformRouting = (key: string, label: string, platform: PlatformData) => {
    const routing = platform.content_routing || {};
    return (
      <section className="strat-section">
        <div className="strat-section-head">
          <h3 className="strat-section-title">{label}</h3>
          <input
            className="strat-input strat-positioning"
            value={platform.positioning || ""}
            onChange={(e) => updatePlatform(key, "positioning", e.target.value)}
            placeholder="平台定位"
            aria-label={`${label}平台定位`}
          />
        </div>
        {platform.key_metric && (
          <div className="strat-metric">核心指标：{platform.key_metric}</div>
        )}
        <div className="strat-rows">
          {Object.entries(routing).map(([typeName, config]) => (
            <div key={typeName} className="strat-row">
              <span className="strat-row-label">{typeName}</span>
              <button
                onClick={() => cycleStatus(key, typeName)}
                className={`strategy-status strat-status ${STATUS_CLASS[String(config.allowed)] || ""}`}
              >
                {STATUS_LABEL[String(config.allowed)] || "允许"}
              </button>
              <input
                className="strat-inline-input"
                value={config.rule || config.reason || ""}
                onChange={(e) => updateRouting(key, typeName, config.allowed === false ? "reason" : "rule", e.target.value)}
                placeholder={config.allowed === false ? "禁止原因" : "规则说明"}
                aria-label={`${label} ${typeName} 规则`}
              />
            </div>
          ))}
        </div>
        <div className="strat-actions-end">
          <button
            disabled={saving}
            onClick={() => saveStrategy(`${label}路由`)}
            className="strat-btn-primary"
          >
            保存
          </button>
        </div>
      </section>
    );
  };

  const renderTitleFormulas = (key: string, label: string, platform: PlatformData) => {
    const formulas = platform.title_formulas || {};
    const entries = Object.entries(formulas).filter(([k]) => !["structure", "required_two_of_three", "blacklist"].includes(k));
    const blacklist = (formulas as TitleFormulas & { blacklist?: string[] }).blacklist || [];
    return (
      <section className="strat-section">
        <div className="strat-section-head">
          <h3 className="strat-section-title">{label}</h3>
        </div>
        <div className="strat-rows">
          {entries.map(([type, formula]) => (
            <div key={type} className="strat-row">
              <span className="strat-row-label">{type}</span>
              <input
                className="strat-inline-input"
                value={String(formula)}
                aria-label={`${label} ${type} 公式`}
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
          <div className="strat-tags">
            {blacklist.map((word, i) => (
              <span key={i} className="strat-tag">
                {word}
                <button
                  aria-label={`移除 ${word}`}
                  onClick={() => {
                    const newList = blacklist.filter((_, j) => j !== i);
                    setData((prev) => ({
                      ...prev,
                      platforms: {
                        ...prev.platforms,
                        [key]: {
                          ...prev.platforms[key],
                          title_formulas: { ...prev.platforms[key]?.title_formulas, blacklist: newList } as PlatformData["title_formulas"],
                        },
                      },
                    }));
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="strat-actions-end">
          <button
            disabled={saving}
            onClick={() => saveStrategy(`${label}标题公式`)}
            className="strat-btn-primary"
          >
            保存
          </button>
        </div>
      </section>
    );
  };

  const renderPublishRules = () => {
    const gzhRules = gzh.publish_rules || [];
    return (
      <section className="strat-section">
        <div className="strat-section-head">
          <h3 className="strat-section-title">发布规则</h3>
          <button
            onClick={() => {
              updatePlatform("wechat_gzh", "publish_rules", [...gzhRules, ""]);
            }}
            className="strat-btn-secondary"
          >
            添加规则
          </button>
        </div>
        <div className="strat-rows">
          {gzhRules.map((rule, i) => (
            <div key={i} className="strat-row">
              <span className="strat-num strat-row-index">{i + 1}</span>
              <input
                className="strat-inline-input"
                value={rule}
                aria-label={`发布规则 ${i + 1}`}
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
                className="strat-btn-text danger"
              >
                删除
              </button>
            </div>
          ))}
        </div>
        <div className="strat-actions-end">
          <button
            disabled={saving}
            onClick={() => saveStrategy("发布规则")}
            className="strat-btn-primary"
          >
            保存
          </button>
        </div>
      </section>
    );
  };

  const renderRetros = () => {
    if (!retroLoaded) {
      loadRetros();
      return <div className="strat-metric">加载中…</div>;
    }
    return (
      <section className="strat-section">
        <div className="strat-section-head">
          <h3 className="strat-section-title">复盘记录</h3>
          <button
            onClick={() => setShowNewRetro(true)}
            className="strat-btn-secondary"
          >
            新建复盘
          </button>
        </div>

        {showNewRetro && (
          <div className="strat-new-retro">
            <div className="strat-new-retro-title">新建复盘</div>
            <div className="strat-form-grid">
              <input type="date" className="strat-input" aria-label="复盘日期" value={newRetro.date} onChange={(e) => setNewRetro((p) => ({ ...p, date: e.target.value }))} />
              <input className="strat-input" placeholder="标题" aria-label="复盘标题" value={newRetro.title} onChange={(e) => setNewRetro((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <textarea className="strat-textarea" rows={2} placeholder="问题" aria-label="复盘问题" value={newRetro.problem} onChange={(e) => setNewRetro((p) => ({ ...p, problem: e.target.value }))} />
            <textarea className="strat-textarea" rows={2} placeholder="结果" aria-label="复盘结果" value={newRetro.result} onChange={(e) => setNewRetro((p) => ({ ...p, result: e.target.value }))} />
            <textarea className="strat-textarea" rows={2} placeholder="教训" aria-label="复盘教训" value={newRetro.lesson} onChange={(e) => setNewRetro((p) => ({ ...p, lesson: e.target.value }))} />
            <div className="strat-form-actions">
              <button onClick={saveNewRetro} className="strat-btn-primary">保存</button>
              <button onClick={() => setShowNewRetro(false)} className="strat-btn-secondary">取消</button>
            </div>
          </div>
        )}

        {retros.map((r) => (
          <div key={r.id} className="strat-retro">
            {editRetroId === r.id ? (
              <div>
                <div className="strat-new-retro-title">修订复盘（将产生新版本）</div>
                <div className="strat-form-grid">
                  <input type="date" className="strat-input" aria-label="复盘日期" value={editRetro.date} onChange={(e) => setEditRetro((p) => ({ ...p, date: e.target.value }))} />
                  <input className="strat-input" placeholder="标题" aria-label="复盘标题" value={editRetro.title} onChange={(e) => setEditRetro((p) => ({ ...p, title: e.target.value }))} />
                </div>
                <textarea className="strat-textarea" rows={2} placeholder="问题" aria-label="复盘问题" value={editRetro.problem} onChange={(e) => setEditRetro((p) => ({ ...p, problem: e.target.value }))} />
                <textarea className="strat-textarea" rows={2} placeholder="结果" aria-label="复盘结果" value={editRetro.result} onChange={(e) => setEditRetro((p) => ({ ...p, result: e.target.value }))} />
                <textarea className="strat-textarea" rows={2} placeholder="教训" aria-label="复盘教训" value={editRetro.lesson} onChange={(e) => setEditRetro((p) => ({ ...p, lesson: e.target.value }))} />
                <div className="strat-form-actions">
                  <button onClick={saveEditRetro} className="strat-btn-primary">保存新版本</button>
                  <button onClick={() => setEditRetroId(null)} className="strat-btn-secondary">取消</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="strat-retro-head">
                  <div className="strat-retro-meta">
                    <span className="strat-retro-date">{r.date}</span>
                    <span className="strat-retro-title">{r.title}</span>
                    <span className="strat-retro-version">v{r.version}</span>
                  </div>
                  <button
                    onClick={() => { setEditRetroId(r.id); setEditRetro({ date: r.date, title: r.title, problem: r.problem, result: r.result, lesson: r.lesson }); }}
                    className="strat-btn-text"
                  >
                    修订
                  </button>
                </div>
                <div className="strat-retro-body">
                  <div><span className="label">问题：</span>{r.problem}</div>
                  <div><span className="label">结果：</span>{r.result}</div>
                  <div><span className="label">教训：</span>{r.lesson}</div>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
    );
  };

  return (
    <div className="strat-editor">
      {/* Tab 导航 */}
      <div className="strat-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`strat-tab ${tab === t ? "active" : ""}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* 版本信息 */}
      <div className="strat-version-bar">
        <span className="strat-version-note">当前版本</span>
        <span className="strat-num">v{initialVersion}</span>
        <span className="strat-version-note">{initialNote}</span>
        <input
          className="strat-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="版本说明（保存时备注）"
          aria-label="版本说明"
        />
      </div>

      {message && (
        <p className={`strat-message ${messageKind}`}>{message}</p>
      )}

      {/* Tab 内容 */}
      <div className="strat-sections">
        {tab === "平台路由" && (
          <>
            {renderPlatformRouting("wechat_gzh", "公众号 GZH", gzh)}
            {renderPlatformRouting("xiaohongshu", "小红书 XHS", xhs)}
          </>
        )}
        {tab === "标题公式" && (
          <>
            {renderTitleFormulas("wechat_gzh", "公众号标题公式", gzh)}
            {renderTitleFormulas("xiaohongshu", "小红书标题公式", xhs)}
          </>
        )}
        {tab === "发布规则" && renderPublishRules()}
        {tab === "复盘记录" && renderRetros()}
      </div>
    </div>
  );
}
