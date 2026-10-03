// 编辑态：把同一份策略数据渲染成下划线式的行内输入。
// 所有输入都只在这里出现；阅读态的 StrategyDocument 不包含任何输入控件。

"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import {
  TITLE_META_KEYS,
  platformLabel,
  statusLabel,
  type PlatformData,
  type Retrospective,
  type StrategyData,
  type Tab,
  type TitleFormulas,
} from "./strategy-model";

type EditableProps = {
  tab: Tab;
  data: StrategyData;
  setData: Dispatch<SetStateAction<StrategyData>>;
  retros: Retrospective[];
  retrosLoaded: boolean;
  reloadRetros: () => void;
  onError: (message: string) => void;
};

function EditableTags({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  };
  return (
    <div className="strat-edit-tagrow">
      <span className="strat-edit-label">{label}</span>
      <span className="strat-edit-tags">
        {items.map((item, index) => (
          <span className="strat-edit-tag" key={`${item}-${index}`}>
            {item}
            <button
              type="button"
              aria-label={`移除 ${item}`}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </span>
        ))}
        <span className="strat-edit-tag-add">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder="添加"
            aria-label={`添加${label}`}
          />
          <button type="button" onClick={add}>
            添加
          </button>
        </span>
      </span>
    </div>
  );
}

export function StrategyEditable({
  tab,
  data,
  setData,
  retros,
  retrosLoaded,
  reloadRetros,
  onError,
}: EditableProps) {
  const [showNewRetro, setShowNewRetro] = useState(false);
  const [newRetro, setNewRetro] = useState({ date: "", title: "", problem: "", result: "", lesson: "" });
  const [editRetroId, setEditRetroId] = useState<number | null>(null);
  const [editRetro, setEditRetro] = useState({ date: "", title: "", problem: "", result: "", lesson: "" });

  const platforms = data.platforms || {};

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
    const cycle = [true, "conditional", false];
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    updateRouting(platform, typeName, "allowed", next);
  };

  const patchTitleFormulas = (platform: string, patch: Record<string, unknown>) => {
    setData((prev) => ({
      ...prev,
      platforms: {
        ...prev.platforms,
        [platform]: {
          ...prev.platforms[platform],
          title_formulas: {
            ...prev.platforms[platform]?.title_formulas,
            ...patch,
          } as TitleFormulas,
        },
      },
    }));
  };

  const patchData = (patch: Partial<StrategyData>) => {
    setData((prev) => ({ ...prev, ...patch }));
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
      reloadRetros();
    } catch {
      onError("创建复盘失败");
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
      reloadRetros();
    } catch {
      onError("修订复盘失败");
    }
  };

  const renderPlatformRouting = (key: string, platform: PlatformData) => (
    <section className="strat-edit-section" key={key}>
      <h3 className="strat-edit-h3">{platformLabel(key)}</h3>
      <label className="strat-edit-line">
        <span className="strat-edit-label">定位</span>
        <input
          className="strat-edit-input"
          value={platform.positioning || ""}
          onChange={(event) => updatePlatform(key, "positioning", event.target.value)}
          placeholder="平台定位"
          aria-label={`${platformLabel(key)}平台定位`}
        />
      </label>
      <label className="strat-edit-line">
        <span className="strat-edit-label">核心指标</span>
        <input
          className="strat-edit-input"
          value={platform.key_metric || ""}
          onChange={(event) => updatePlatform(key, "key_metric", event.target.value)}
          placeholder="核心指标"
          aria-label={`${platformLabel(key)}核心指标`}
        />
      </label>
      <div className="strat-edit-rows">
        {Object.entries(platform.content_routing || {}).map(([typeName, config]) => (
          <div className="strat-edit-row" key={typeName}>
            <span className="strat-edit-row-label">{typeName}</span>
            <button
              type="button"
              onClick={() => cycleStatus(key, typeName)}
              className={`strat-edit-status ${config.allowed === "conditional" ? "conditional" : config.allowed === false ? "forbidden" : ""}`}
              aria-label={`${typeName} 状态：${statusLabel(config.allowed)}`}
            >
              {statusLabel(config.allowed)}
            </button>
            <input
              className="strat-edit-input strat-edit-rule"
              value={config.rule || config.reason || ""}
              onChange={(event) =>
                updateRouting(key, typeName, config.allowed === false ? "reason" : "rule", event.target.value)
              }
              placeholder={config.allowed === false ? "禁止原因" : "规则说明"}
              aria-label={`${platformLabel(key)} ${typeName} 规则`}
            />
          </div>
        ))}
      </div>
    </section>
  );

  const renderTitleFormulas = (key: string, platform: PlatformData) => {
    const formulas = platform.title_formulas || {};
    const entries = Object.entries(formulas).filter(([name]) => !TITLE_META_KEYS.has(name));
    const structure = typeof formulas.structure === "string" ? formulas.structure : "";
    const required = formulas.required_two_of_three || [];
    const blacklist = formulas.blacklist || [];
    return (
      <section className="strat-edit-section" key={key}>
        <h3 className="strat-edit-h3">{platformLabel(key)}标题公式</h3>
        <div className="strat-edit-rows">
          {entries.map(([type, formula]) => (
            <div className="strat-edit-row" key={type}>
              <span className="strat-edit-row-label">{type}</span>
              <input
                className="strat-edit-input strat-edit-rule"
                value={String(formula)}
                onChange={(event) => patchTitleFormulas(key, { [type]: event.target.value })}
                aria-label={`${platformLabel(key)} ${type} 公式`}
              />
            </div>
          ))}
        </div>
        {(structure || "structure" in formulas) && (
          <label className="strat-edit-line">
            <span className="strat-edit-label">结构</span>
            <input
              className="strat-edit-input"
              value={structure}
              onChange={(event) => patchTitleFormulas(key, { structure: event.target.value })}
              placeholder="标题结构"
              aria-label={`${platformLabel(key)}标题结构`}
            />
          </label>
        )}
        {("required_two_of_three" in formulas || required.length > 0) && (
          <EditableTags
            label="三选二"
            items={required}
            onChange={(next) => patchTitleFormulas(key, { required_two_of_three: next })}
          />
        )}
        {("blacklist" in formulas || blacklist.length > 0) && (
          <EditableTags
            label="禁用词"
            items={blacklist}
            onChange={(next) => patchTitleFormulas(key, { blacklist: next })}
          />
        )}
      </section>
    );
  };

  const renderPublishRules = () => {
    const gzh = platforms.wechat_gzh || ({} as PlatformData);
    const rules = gzh.publish_rules || [];
    const banned = data.banned_patterns || {};
    const punctuation = Object.entries(banned.punctuation || {});
    const cta = Object.entries(data.cta_templates || {});
    return (
      <>
        <section className="strat-edit-section">
          <div className="strat-edit-head">
            <h3 className="strat-edit-h3">公众号发布规则</h3>
            <button
              type="button"
              className="strat-btn-text"
              onClick={() => updatePlatform("wechat_gzh", "publish_rules", [...rules, ""])}
            >
              添加规则
            </button>
          </div>
          <div className="strat-edit-rows">
            {rules.map((rule, index) => (
              <div className="strat-edit-row" key={index}>
                <span className="strat-edit-row-label strat-edit-row-index">{index + 1}</span>
                <input
                  className="strat-edit-input strat-edit-rule"
                  value={rule}
                  onChange={(event) => {
                    const next = [...rules];
                    next[index] = event.target.value;
                    updatePlatform("wechat_gzh", "publish_rules", next);
                  }}
                  aria-label={`发布规则 ${index + 1}`}
                />
                <button
                  type="button"
                  className="strat-btn-text danger"
                  onClick={() => updatePlatform("wechat_gzh", "publish_rules", rules.filter((_, i) => i !== index))}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="strat-edit-section">
          <h3 className="strat-edit-h3">禁用表达</h3>
          <EditableTags
            label="空词"
            items={banned.words || []}
            onChange={(next) => patchData({ banned_patterns: { ...banned, words: next } })}
          />
          <EditableTags
            label="结构"
            items={banned.structures || []}
            onChange={(next) => patchData({ banned_patterns: { ...banned, structures: next } })}
          />
          <EditableTags
            label="模糊指代"
            items={banned.vague_refs || []}
            onChange={(next) => patchData({ banned_patterns: { ...banned, vague_refs: next } })}
          />
          {punctuation.length > 0 && (
            <div className="strat-edit-rows">
              {punctuation.map(([name, value]) => (
                <div className="strat-edit-row" key={name}>
                  <span className="strat-edit-row-label">{name}</span>
                  <input
                    className="strat-edit-input strat-edit-rule"
                    value={value}
                    onChange={(event) =>
                      patchData({
                        banned_patterns: {
                          ...banned,
                          punctuation: { ...banned.punctuation, [name]: event.target.value },
                        },
                      })
                    }
                    aria-label={`标点规则 ${name}`}
                  />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="strat-edit-section">
          <h3 className="strat-edit-h3">衍生顺序</h3>
          <label className="strat-edit-line">
            <span className="strat-edit-label">顺序</span>
            <input
              className="strat-edit-input"
              value={(data.derivation_order || []).join(" → ")}
              onChange={(event) =>
                patchData({
                  derivation_order: event.target.value
                    .split(/\s*→\s*/)
                    .map((step) => step.trim())
                    .filter(Boolean),
                })
              }
              aria-label="衍生顺序"
            />
          </label>
        </section>

        <section className="strat-edit-section">
          <h3 className="strat-edit-h3">CTA 模板</h3>
          <div className="strat-edit-rows">
            {cta.map(([name, value]) => (
              <label className="strat-edit-line strat-edit-line-block" key={name}>
                <span className="strat-edit-label">{name}</span>
                <textarea
                  className="strat-edit-textarea"
                  rows={2}
                  value={value}
                  onChange={(event) => patchData({ cta_templates: { ...data.cta_templates, [name]: event.target.value } })}
                  aria-label={`CTA 模板 ${name}`}
                />
              </label>
            ))}
          </div>
        </section>
      </>
    );
  };

  const renderRetros = () => {
    if (!retrosLoaded) return <p className="strat-doc-empty">加载中…</p>;
    return (
      <section className="strat-edit-section">
        <div className="strat-edit-head">
          <h3 className="strat-edit-h3">复盘记录</h3>
          <button type="button" className="strat-btn-text" onClick={() => setShowNewRetro(true)}>
            新建复盘
          </button>
        </div>

        {showNewRetro && (
          <div className="strat-new-retro">
            <div className="strat-new-retro-title">新建复盘</div>
            <div className="strat-form-grid">
              <input
                type="date"
                className="strat-input"
                aria-label="复盘日期"
                value={newRetro.date}
                onChange={(event) => setNewRetro((prev) => ({ ...prev, date: event.target.value }))}
              />
              <input
                className="strat-input"
                placeholder="标题"
                aria-label="复盘标题"
                value={newRetro.title}
                onChange={(event) => setNewRetro((prev) => ({ ...prev, title: event.target.value }))}
              />
            </div>
            <textarea
              className="strat-textarea"
              rows={2}
              placeholder="问题"
              aria-label="复盘问题"
              value={newRetro.problem}
              onChange={(event) => setNewRetro((prev) => ({ ...prev, problem: event.target.value }))}
            />
            <textarea
              className="strat-textarea"
              rows={2}
              placeholder="结果"
              aria-label="复盘结果"
              value={newRetro.result}
              onChange={(event) => setNewRetro((prev) => ({ ...prev, result: event.target.value }))}
            />
            <textarea
              className="strat-textarea"
              rows={2}
              placeholder="教训"
              aria-label="复盘教训"
              value={newRetro.lesson}
              onChange={(event) => setNewRetro((prev) => ({ ...prev, lesson: event.target.value }))}
            />
            <div className="strat-form-actions">
              <button type="button" onClick={saveNewRetro} className="strat-btn-primary">
                保存
              </button>
              <button type="button" onClick={() => setShowNewRetro(false)} className="strat-btn-secondary">
                取消
              </button>
            </div>
          </div>
        )}

        {retros.map((retro) => (
          <div className="strat-retro" key={retro.id}>
            {editRetroId === retro.id ? (
              <div>
                <div className="strat-new-retro-title">修订复盘（将产生新版本）</div>
                <div className="strat-form-grid">
                  <input
                    type="date"
                    className="strat-input"
                    aria-label="复盘日期"
                    value={editRetro.date}
                    onChange={(event) => setEditRetro((prev) => ({ ...prev, date: event.target.value }))}
                  />
                  <input
                    className="strat-input"
                    placeholder="标题"
                    aria-label="复盘标题"
                    value={editRetro.title}
                    onChange={(event) => setEditRetro((prev) => ({ ...prev, title: event.target.value }))}
                  />
                </div>
                <textarea
                  className="strat-textarea"
                  rows={2}
                  placeholder="问题"
                  aria-label="复盘问题"
                  value={editRetro.problem}
                  onChange={(event) => setEditRetro((prev) => ({ ...prev, problem: event.target.value }))}
                />
                <textarea
                  className="strat-textarea"
                  rows={2}
                  placeholder="结果"
                  aria-label="复盘结果"
                  value={editRetro.result}
                  onChange={(event) => setEditRetro((prev) => ({ ...prev, result: event.target.value }))}
                />
                <textarea
                  className="strat-textarea"
                  rows={2}
                  placeholder="教训"
                  aria-label="复盘教训"
                  value={editRetro.lesson}
                  onChange={(event) => setEditRetro((prev) => ({ ...prev, lesson: event.target.value }))}
                />
                <div className="strat-form-actions">
                  <button type="button" onClick={saveEditRetro} className="strat-btn-primary">
                    保存新版本
                  </button>
                  <button type="button" onClick={() => setEditRetroId(null)} className="strat-btn-secondary">
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="strat-retro-head">
                  <div className="strat-retro-meta">
                    <span className="strat-retro-date">{retro.date}</span>
                    <span className="strat-retro-title">{retro.title}</span>
                    <span className="strat-retro-version">v{retro.version}</span>
                  </div>
                  <button
                    type="button"
                    className="strat-btn-text"
                    onClick={() => {
                      setEditRetroId(retro.id);
                      setEditRetro({
                        date: retro.date,
                        title: retro.title,
                        problem: retro.problem,
                        result: retro.result,
                        lesson: retro.lesson,
                      });
                    }}
                  >
                    修订
                  </button>
                </div>
                <div className="strat-retro-body">
                  <div>
                    <span className="label">问题：</span>
                    {retro.problem}
                  </div>
                  <div>
                    <span className="label">结果：</span>
                    {retro.result}
                  </div>
                  <div>
                    <span className="label">教训：</span>
                    {retro.lesson}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
    );
  };

  return (
    <div className="strat-edit">
      {tab === "平台路由" && Object.entries(platforms).map(([key, platform]) => renderPlatformRouting(key, platform))}
      {tab === "标题公式" && Object.entries(platforms).map(([key, platform]) => renderTitleFormulas(key, platform))}
      {tab === "发布规则" && renderPublishRules()}
      {tab === "复盘记录" && renderRetros()}
    </div>
  );
}
