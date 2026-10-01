import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { loadMirrorData } from "../../lib/mirror-data";
import {
  computeStats,
  decisionEntries,
  decisionScopes,
  entriesByCategory,
  entryDate,
  formatMirrorDate,
  preferenceGroups,
  sourceLine,
  type MirrorEntry,
} from "../../lib/mirror";
import { SiteAppBar } from "../_components/SiteAppBar";
import { MiniMarkdown } from "../topics/daily/_components/mini-markdown";
import "./mirror.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: "照照镜子 · 成长", robots: { index: false, follow: false } };

function caret() {
  return <span className="mirror-a-caret" aria-hidden="true">›</span>;
}

/** 一条条目：只露标题，点开看正文和历史；已推翻的划线并链到新条目。 */
function EntryCard({ entry }: { entry: MirrorEntry }) {
  const superseded = entry.status === "已推翻";
  const date = entryDate(entry);
  return (
    <details id={`entry-${entry.id}`} className={`mirror-a-entry ${superseded ? "is-superseded" : ""}`}>
      <summary className="mirror-a-entry-summary">
        <span className="mirror-a-entry-title">{entry.title}</span>
        <span className="mirror-a-entry-meta">
          {sourceLine(entry)}
          {entry.confirmedBy ? ` · ${entry.confirmedBy} 确认` : ""}
          {entry.status !== "有效" ? ` · ${entry.status}` : ""}
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

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mirror-a-section">
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
            {stats.inboxCount > 0 ? ` · ${stats.inboxCount} 条等你确认` : ""}
          </p>
          <p className="mirror-a-lede">
            {stats.monthLabel ? `${stats.monthLabel} 新增 ${stats.newThisMonth} 条，推翻 ${stats.supersededThisMonth} 条。` : ""}
          </p>
        </header>
        <div className="double-rule" />
      </div>

      <main className="mirror-a-main">
        <Section title="我是怎样的人">
          {profiles.length > 0 ? (
            <div className="mirror-a-profiles">
              {profiles.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <EmptyLine>还没有画像。</EmptyLine>
          )}
        </Section>

        <Section title="我喜欢这样">
          {prefGroups.length > 0 ? (
            <div className="mirror-a-prefs">
              {prefGroups.map((group) => (
                <div key={group.scope} className="mirror-a-pref-group">
                  <p className="mirror-a-pref-scope">{group.scope}</p>
                  {group.entries.map((entry) => (
                    <EntryCard key={`${group.scope}-${entry.id}`} entry={entry} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine>还没有偏好。</EmptyLine>
          )}
        </Section>

        <Section title="我怎么做事">
          {methods.length > 0 ? (
            <div className="mirror-a-list">
              {methods.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <EmptyLine>还没有方法论。</EmptyLine>
          )}
        </Section>

        <Section title="定过的事">
          {scopes.length > 0 ? (
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
          ) : null}
          {decisions.length > 0 ? (
            <ol className="mirror-a-timeline">
              {decisions.map((entry) => (
                <li key={entry.id} className="mirror-a-timeline-item">
                  <span className="mirror-a-timeline-date">{formatMirrorDate(entryDate(entry))}</span>
                  <EntryCard entry={entry} />
                </li>
              ))}
            </ol>
          ) : (
            <EmptyLine>这个范围还没有决策。</EmptyLine>
          )}
        </Section>

        <Section title="复盘学到的">
          {reviews.length > 0 ? (
            <div className="mirror-a-list">
              {reviews.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <EmptyLine>还没有复盘结论，等下一次复盘。</EmptyLine>
          )}
        </Section>

        <Section title="正在调整">
          {adjustments.length > 0 ? (
            <div className="mirror-a-list">
              {adjustments.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <EmptyLine>暂时没有要调整的地方。</EmptyLine>
          )}
        </Section>

        <Section title="等你确认" note="只用来展示，确认都在对话里做。">
          {data.inbox.length > 0 ? (
            <ul className="mirror-a-inbox">
              {data.inbox.map((entry) => (
                <li key={entry.id}>
                  <p className="mirror-a-inbox-title">{entry.title}</p>
                  <p className="mirror-a-inbox-meta">
                    {entry.category}
                    {sourceLine(entry) ? ` · ${sourceLine(entry)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyLine>没有待确认的条目。</EmptyLine>
          )}
        </Section>
      </main>
    </div>
  );
}
