// 阅读态的「策略文档」：纯排版，不渲染任何输入控件。
// 编辑态由 StrategyEditable 负责，两者共用同一份 data 形状。

import {
  TITLE_META_KEYS,
  platformLabel,
  statusClass,
  statusLabel,
  type Retrospective,
  type StrategyData,
  type Tab,
} from "./strategy-model";

type DocumentProps = {
  tab: Tab;
  data: StrategyData;
  retros: Retrospective[];
  retrosLoaded: boolean;
};

function TagRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="strat-doc-tagrow">
      <span className="strat-doc-label">{label}</span>
      <span className="strat-doc-tags">
        {items.map((item, index) => (
          <span className="strat-doc-tag" key={`${item}-${index}`}>
            {item}
          </span>
        ))}
      </span>
    </div>
  );
}

function KeyValueRows({ entries }: { entries: [string, string][] }) {
  if (entries.length === 0) return null;
  return (
    <div className="strat-doc-rows">
      {entries.map(([key, value]) => (
        <div className="strat-doc-row" key={key}>
          <span className="strat-doc-row-label">{key}</span>
          <span className="strat-doc-row-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

function PlatformRouting({ data }: { data: StrategyData }) {
  const platforms = Object.entries(data.platforms || {});
  const matrix = data.topic_routing_matrix || {};
  return (
    <>
      {platforms.map(([key, platform]) => (
        <section className="strat-doc-section" key={key}>
          <h3 className="strat-doc-h3">{platformLabel(key)}</h3>
          {platform.positioning ? <p className="strat-doc-lede">{platform.positioning}</p> : null}
          {platform.key_metric ? (
            <p className="strat-doc-metric">核心指标：{platform.key_metric}</p>
          ) : null}
          <ul className="strat-doc-routes">
            {Object.entries(platform.content_routing || {}).map(([typeName, config]) => (
              <li className="strat-doc-route" key={typeName}>
                <span className="strat-doc-route-name">{typeName}</span>
                <span className={`strat-doc-status ${statusClass(config.allowed)}`}>
                  {statusLabel(config.allowed)}
                </span>
                <span className="strat-doc-route-rule">{config.rule || config.reason || ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {Object.keys(matrix).length > 0 ? (
        <section className="strat-doc-section">
          <h3 className="strat-doc-h3">选题路由矩阵</h3>
          <div className="strat-doc-rows">
            {Object.entries(matrix).map(([topicType, cells]) => (
              <div className="strat-doc-row strat-doc-matrix-row" key={topicType}>
                <span className="strat-doc-row-label">{topicType}</span>
                <span className="strat-doc-matrix-cells">
                  {Object.entries(cells || {}).map(([platform, value]) => (
                    <span className="strat-doc-matrix-cell" key={platform}>
                      <em>{platform}</em>
                      {value}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function TitleFormulas({ data }: { data: StrategyData }) {
  return (
    <>
      {Object.entries(data.platforms || {}).map(([key, platform]) => {
        const formulas = platform.title_formulas || {};
        const entries = Object.entries(formulas).filter(([name]) => !TITLE_META_KEYS.has(name));
        const structure = typeof formulas.structure === "string" ? formulas.structure : "";
        const required = formulas.required_two_of_three || [];
        const blacklist = formulas.blacklist || [];
        return (
          <section className="strat-doc-section" key={key}>
            <h3 className="strat-doc-h3">{platformLabel(key)}标题公式</h3>
            <KeyValueRows entries={entries as [string, string][]} />
            {structure ? (
              <div className="strat-doc-tagrow">
                <span className="strat-doc-label">结构</span>
                <span className="strat-doc-row-value">{structure}</span>
              </div>
            ) : null}
            <TagRow label="三选二" items={required} />
            <TagRow label="禁用词" items={blacklist} />
          </section>
        );
      })}
    </>
  );
}

function PublishRules({ data }: { data: StrategyData }) {
  const gzh = data.platforms?.wechat_gzh;
  const rules = gzh?.publish_rules || [];
  const banned = data.banned_patterns || {};
  const punctuation = Object.entries(banned.punctuation || {});
  const cta = Object.entries(data.cta_templates || {});
  return (
    <>
      <section className="strat-doc-section">
        <h3 className="strat-doc-h3">公众号发布规则</h3>
        {rules.length > 0 ? (
          <ol className="strat-doc-list">
            {rules.map((rule, index) => (
              <li key={`${rule}-${index}`}>{rule}</li>
            ))}
          </ol>
        ) : (
          <p className="strat-doc-empty">暂无发布规则</p>
        )}
      </section>

      <section className="strat-doc-section">
        <h3 className="strat-doc-h3">禁用表达</h3>
        <TagRow label="空词" items={banned.words || []} />
        <TagRow label="结构" items={banned.structures || []} />
        <TagRow label="模糊指代" items={banned.vague_refs || []} />
        {punctuation.length > 0 ? (
          <KeyValueRows entries={punctuation} />
        ) : null}
      </section>

      <section className="strat-doc-section">
        <h3 className="strat-doc-h3">衍生顺序</h3>
        {data.derivation_order && data.derivation_order.length > 0 ? (
          <ol className="strat-doc-list strat-doc-order">
            {data.derivation_order.map((step, index) => (
              <li key={`${step}-${index}`}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="strat-doc-empty">暂无衍生顺序</p>
        )}
      </section>

      <section className="strat-doc-section">
        <h3 className="strat-doc-h3">CTA 模板</h3>
        <KeyValueRows entries={cta} />
      </section>
    </>
  );
}

function Retrospectives({ retros, retrosLoaded }: { retros: Retrospective[]; retrosLoaded: boolean }) {
  if (!retrosLoaded) return <p className="strat-doc-empty">加载中…</p>;
  if (retros.length === 0) return <p className="strat-doc-empty">暂无复盘</p>;
  return (
    <section className="strat-doc-section">
      {retros.map((retro) => (
        <article className="strat-doc-retro" key={retro.id}>
          <header className="strat-doc-retro-head">
            <span className="strat-doc-retro-date">{retro.date}</span>
            <span className="strat-doc-retro-title">{retro.title}</span>
            <span className="strat-doc-retro-version">v{retro.version}</span>
          </header>
          <p className="strat-doc-retro-line">
            <span className="strat-doc-label">问题：</span>
            {retro.problem}
          </p>
          <p className="strat-doc-retro-line">
            <span className="strat-doc-label">结果：</span>
            {retro.result}
          </p>
          <p className="strat-doc-retro-line">
            <span className="strat-doc-label">教训：</span>
            {retro.lesson}
          </p>
        </article>
      ))}
    </section>
  );
}

export function StrategyDocument({ tab, data, retros, retrosLoaded }: DocumentProps) {
  return (
    <div className="strat-doc">
      {tab === "平台路由" ? <PlatformRouting data={data} /> : null}
      {tab === "标题公式" ? <TitleFormulas data={data} /> : null}
      {tab === "发布规则" ? <PublishRules data={data} /> : null}
      {tab === "复盘记录" ? <Retrospectives retros={retros} retrosLoaded={retrosLoaded} /> : null}
    </div>
  );
}
