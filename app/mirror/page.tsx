import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { loadMirrorData } from "../../lib/mirror-data";
import {
  categoryCounts,
  computeStats,
  decisionEntries,
  decisionScopes,
  entriesByCategory,
  entryOwnDate,
  formatMirrorDate,
  monthlyTrend,
  preferenceGroups,
  sourceAgent,
  sourceLine,
  type MirrorEntry,
} from "../../lib/mirror";
import { SiteAppBar } from "../_components/SiteAppBar";
import { MiniMarkdown } from "../topics/daily/_components/mini-markdown";
import "./mirror.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: "照照镜子 · 成长", robots: { index: false, follow: false } };

/** 摘要里的短标签，复盘结论缩成「复盘」。 */
const CATEGORY_SHORT: Record<string, string> = {
  画像: "画像",
  偏好: "偏好",
  方法论: "方法论",
  决策: "决策",
  复盘结论: "复盘",
  待调整: "待调整",
};

const TREND_MAX_HEIGHT = 64;

/** 占比条色板：和分段、图例共用，保证颜色对得上。 */
const RATIO_COLORS = [
  { color: "var(--ink)", tone: "dark" },
  { color: "var(--accent)", tone: "dark" },
  { color: "var(--muted)", tone: "dark" },
  { color: "var(--faint)", tone: "light" },
  { color: "var(--line-strong)", tone: "light" },
  { color: "var(--line)", tone: "light" },
] as const;

function caret() {
  return <span className="mirror-a-caret" aria-hidden="true">›</span>;
}

/** 一条条目：只露标题，点开看正文和历史；已推翻的划线并链到新条目。 */
function EntryCard({
  entry,
  index,
  tag,
  tagTone = "accent",
  hideDate = false,
  extraScopes,
}: {
  entry: MirrorEntry;
  index?: number;
  tag?: string;
  tagTone?: "accent" | "outline";
  hideDate?: boolean;
  extraScopes?: string[];
}) {
  const superseded = entry.status === "已推翻";
  return (
    <details id={`entry-${entry.id}`} className={`mirror-a-entry ${superseded ? "is-superseded" : ""}`}>
      <summary className="mirror-a-entry-summary">
        {typeof index === "number" ? (
          <span className="mirror-a-entry-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        ) : null}
        <span className="mirror-a-entry-head">
          <span className="mirror-a-entry-title">{entry.title}</span>
          {tag ? <span className={`mirror-a-tag is-${tagTone}`}>{tag}</span> : null}
          {superseded ? <span className="mirror-a-tag">已推翻</span> : null}
        </span>
        <span className="mirror-a-entry-meta">
          <span className="mirror-a-entry-source">{hideDate ? sourceAgent(entry) : sourceLine(entry)}</span>
          {extraScopes && extraScopes.length > 0 ? (
            <span className="mirror-a-scope-tags">
              {extraScopes.map((scope) => (
                <span key={scope} className="mirror-a-scope-tag">{scope}</span>
              ))}
            </span>
          ) : null}
        </span>
        {superseded && entry.supersededBy ? (
          <a className="mirror-a-entry-new" href={`#entry-${entry.supersededBy}`}>
            已被 {entry.supersededBy} 取代
          </a>
        ) : null}
        {caret()}
      </summary>
      <div className="mirror-a-entry-body">
        <MiniMarkdown text={entry.body} />
        {entry.options.length > 0 ? <p className="mirror-a-detail">考虑过：{entry.options.join("；")}</p> : null}
        {entry.owner ? <p className="mirror-a-detail">负责人：{entry.owner}</p> : null}
        {entry.reason ? <p className="mirror-a-detail">说明：{entry.reason}</p> : null}
        {entry.confirmedBy ? (
          <p className="mirror-a-detail">
            由 {entry.confirmedBy} 确认{entry.confirmedAt ? ` · ${formatMirrorDate(entry.confirmedAt)}` : ""}
          </p>
        ) : null}
        <div className="mirror-a-history">
          <p className="mirror-a-history-title">历史</p>
          <ol className="mirror-a-history-list">
            {entry.history.map((item) => (
              <li key={`${entry.id}-v${item.version}`}>
                <span className="mirror-a-history-version">v{item.version}</span>
                <span className="mirror-a-history-status">{item.status}</span>
                {item.recordedAt ? <span className="mirror-a-history-date">{item.recordedAt}</span> : null}
                {item.reason ? <span className="mirror-a-history-reason">{item.reason}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </details>
  );
}

/** 刊头下面的可视化摘要：类别小数字 + 横向比例条 + 按月新增/推翻。 */
function MirrorSummary({ entries, inbox }: { entries: MirrorEntry[]; inbox: MirrorEntry[] }) {
  const counts = categoryCounts(entries);
  const total = entries.length;
  const trend = monthlyTrend(entries);
  const maxTrend = Math.max(1, ...trend.map((point) => Math.max(point.added, point.superseded)));
  const segments = counts
    .filter((item) => item.count > 0)
    .map((item, index) => {
      const swatch = RATIO_COLORS[index % RATIO_COLORS.length];
      return {
        category: item.category,
        label: CATEGORY_SHORT[item.category] ?? item.category,
        count: item.count,
        share: total > 0 ? item.count / total : 0,
        color: swatch.color,
        tone: swatch.tone,
      };
    });

  return (
    <section className="mirror-a-summary" aria-label="资料概况">
      <div className="mirror-a-figures">
        {counts.map(({ category, count }) => (
          <div className="mirror-a-figure" key={category}>
            <span className="mirror-a-figure-num">{count}</span>
            <span className="mirror-a-figure-label">{CATEGORY_SHORT[category] ?? category}</span>
          </div>
        ))}
        <div className={`mirror-a-figure ${inbox.length > 0 ? "is-inbox" : ""}`}>
          <span className="mirror-a-figure-num">{inbox.length}</span>
          <span className="mirror-a-figure-label">等你确认</span>
        </div>
      </div>

      <div className="mirror-a-summary-row">
        <div className="mirror-a-ratio">
          <p className="mirror-a-summary-label">类别占比</p>
          <div className="mirror-a-ratio-track" role="img" aria-label={`共 ${total} 条`}>
            {segments.map((segment) => (
              <span
                key={segment.category}
                className={`mirror-a-ratio-seg is-${segment.tone}`}
                style={{ width: `${segment.share * 100}%`, background: segment.color }}
                title={`${segment.label} ${segment.count}`}
              >
                {/* 段够宽时由 CSS 容器查询直接把类别名写在里面，窄段靠下面的图例。 */}
                <span className="mirror-a-ratio-name">{segment.label}</span>
              </span>
            ))}
          </div>
          {segments.length > 0 ? (
            <ul className="mirror-a-ratio-legend">
              {segments.map((segment) => (
                <li key={segment.category}>
                  <i style={{ background: segment.color }} />
                  <span className="mirror-a-ratio-legend-name">{segment.label}</span>
                  <span className="mirror-a-ratio-legend-count">{segment.count}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mirror-a-trend">
          <div className="mirror-a-trend-head">
            <p className="mirror-a-summary-label">按月新增 / 推翻</p>
            {trend.length > 2 ? (
              <span className="mirror-a-trend-legend">
                <span><i className="is-added" />新增</span>
                <span><i className="is-superseded" />推翻</span>
              </span>
            ) : null}
          </div>
          {trend.length === 0 ? (
            <p className="mirror-a-empty-line">还没有按月数据。</p>
          ) : trend.length <= 2 ? (
            /* 只有一两个月时柱子没有意义，改成一行数字说明。 */
            <p className="mirror-a-trend-line">
              {trend.map((point) => `${point.label}新增 ${point.added} 条，推翻 ${point.superseded} 条`).join("；")}
            </p>
          ) : (
            <div className="mirror-a-months">
              {trend.map((point) => (
                <div className="mirror-a-month" key={point.month}>
                  <div className="mirror-a-month-bars">
                    <span
                      className="mirror-a-month-bar is-added"
                      style={{
                        height: `${point.added > 0 ? Math.max(4, Math.round((point.added / maxTrend) * TREND_MAX_HEIGHT)) : 0}px`,
                      }}
                      title={`新增 ${point.added}`}
                    />
                    <span
                      className="mirror-a-month-bar is-superseded"
                      style={{
                        height: `${point.superseded > 0 ? Math.max(4, Math.round((point.superseded / maxTrend) * TREND_MAX_HEIGHT)) : 0}px`,
                      }}
                      title={`推翻 ${point.superseded}`}
                    />
                  </div>
                  <span className="mirror-a-month-label">{point.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Section({
  title,
  note,
  variant,
  children,
}: {
  title: string;
  note?: string;
  variant?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`mirror-a-section ${variant ? `is-${variant}` : ""}`}>
      <h2 className="mirror-a-heading">{title}</h2>
      {note ? <p className="mirror-a-note">{note}</p> : null}
      {children}
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="mirror-a-empty-line">{children}</p>;
}

function EmptyState({ user }: { user: Awaited<ReturnType<typeof getSessionUser>> }) {
  return (
    <div className="mirror-a">
      <SiteAppBar user={user} pathname="/mirror" />
      <div className="mirror-a-masthead-wrap">
        <header className="mirror-a-masthead">
          <p className="page-kicker">成长 · 照照镜子</p>
          <h1 className="page-title">照照镜子</h1>
        </header>
        <div className="double-rule" />
      </div>
      <main className="mirror-a-main">
        <div className="mirror-a-empty">
          <h2>还没有正本数据</h2>
          <p>
            运行 <code>npm run mirror:build</code> 汇总本机正本后再刷新。
          </p>
        </div>
      </main>
    </div>
  );
}

export default async function MirrorPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope: requestedScope } = await searchParams;

  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/mirror`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/mirror");
  if (user.role !== "admin") notFound();

  const data = loadMirrorData();
  if (!data || data.entries.length === 0) return <EmptyState user={user} />;

  const stats = computeStats(data.entries, data.inbox, new Date(data.generatedAt));
  const profiles = entriesByCategory(data.entries, "画像");
  const methods = entriesByCategory(data.entries, "方法论");
  const reviews = entriesByCategory(data.entries, "复盘结论");
  const adjustments = entriesByCategory(data.entries, "待调整");
  const scopes = decisionScopes(data.entries);
  const activeScope = requestedScope && scopes.includes(requestedScope) ? requestedScope : null;
  const decisions = decisionEntries(data.entries, activeScope);
  const prefGroups = preferenceGroups(data.entries);

  return (
    <div className="mirror-a">
      <SiteAppBar user={user} pathname="/mirror" />

      <div className="mirror-a-masthead-wrap">
        <header className="mirror-a-masthead">
          <p className="page-kicker">成长 · 照照镜子</p>
          <h1 className="page-title">照照镜子</h1>
          <p className="page-sub">
            共 {stats.entryCount} 条
            {stats.latestDate ? ` · 最近更新 ${formatMirrorDate(stats.latestDate)}` : ""}
          </p>
        </header>
        <div className="double-rule" />
      </div>

      <main className="mirror-a-main">
        <MirrorSummary entries={data.entries} inbox={data.inbox} />

        {profiles.length > 0 ? (
          <Section title="我是怎样的人">
            <div className="mirror-a-profiles" data-count={profiles.length}>
              {profiles.map((entry, index) => (
                <EntryCard key={entry.id} entry={entry} index={index} />
              ))}
            </div>
          </Section>
        ) : null}

        {prefGroups.length > 0 ? (
          <Section title="我喜欢这样">
            <div className="mirror-a-prefs">
              {prefGroups.map((group) => (
                <div key={group.scope} className="mirror-a-pref-group">
                  <p className="mirror-a-pref-scope">{group.scope}</p>
                  <div className="mirror-a-list">
                    {group.entries.map((entry) => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        extraScopes={entry.scope.filter((scope) => scope !== group.scope)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {methods.length > 0 ? (
          <Section title="我怎么做事">
            <div className="mirror-a-list">
              {methods.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          </Section>
        ) : null}

        {scopes.length > 0 || decisions.length > 0 ? (
          <Section title="定过的事">
            <div className="mirror-a-filters">
              <a className={activeScope === null ? "active" : ""} href="/mirror">
                全部
              </a>
              {scopes.map((scope) => (
                <a
                  key={scope}
                  className={activeScope === scope ? "active" : ""}
                  href={`/mirror?scope=${encodeURIComponent(scope)}`}
                >
                  {scope}
                </a>
              ))}
            </div>
            {decisions.length > 0 ? (
              <ol className="mirror-a-timeline">
                {decisions.map((entry) => (
                  <li key={entry.id} className="mirror-a-timeline-item">
                    <span className="mirror-a-timeline-date">{formatMirrorDate(entryOwnDate(entry))}</span>
                    <EntryCard entry={entry} hideDate />
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyLine>这个范围还没有决策。</EmptyLine>
            )}
          </Section>
        ) : null}

        {reviews.length > 0 ? (
          <Section title="复盘学到的">
            <div className="mirror-a-list">
              {reviews.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          </Section>
        ) : null}

        {adjustments.length > 0 ? (
          <Section title="正在调整" variant="adjustment">
            <div className="mirror-a-list">
              {adjustments.map((entry) => (
                <EntryCard key={entry.id} entry={entry} tag="调整中" tagTone="outline" />
              ))}
            </div>
          </Section>
        ) : null}

        {data.inbox.length > 0 ? (
          <Section title="等你确认" note="只用来展示，确认都在对话里做。">
            <ul className="mirror-a-inbox">
              {data.inbox.map((entry) => (
                <li key={entry.id}>
                  <details className="mirror-a-inbox-item">
                    <summary className="mirror-a-inbox-summary">
                      <span className="mirror-a-inbox-title">{entry.title}</span>
                      <span className="mirror-a-inbox-meta">
                        <span>{entry.category}</span>
                        {sourceLine(entry) ? <span>{sourceLine(entry)}</span> : null}
                        <span className="mirror-a-tag is-accent">待确认</span>
                      </span>
                      {caret()}
                    </summary>
                    <div className="mirror-a-inbox-body">
                      <MiniMarkdown text={entry.body} />
                      {entry.options.length > 0 ? (
                        <p className="mirror-a-detail">备选：{entry.options.join("；")}</p>
                      ) : null}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </main>
    </div>
  );
}
