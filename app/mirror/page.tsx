import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { loadMirrorData } from "../../lib/mirror-data";
import {
  computeStats,
  entriesForTab,
  formatMirrorDate,
  mirrorTabCounts,
  resolveMirrorTab,
  tabKeyForCategory,
} from "../../lib/mirror";
import { SiteAppBar } from "../_components/SiteAppBar";
import { MirrorDeck, type MirrorCardVariant } from "./_components/MirrorDeck";
import "./mirror.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: "照照镜子 · 成长", robots: { index: false, follow: false } };

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

export default async function MirrorPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: requestedTab } = await searchParams;

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
  const tab = resolveMirrorTab(requestedTab);
  const entries = entriesForTab(data.entries, data.inbox, tab);
  const counts = mirrorTabCounts(data.entries, data.inbox);

  // 「已被 H-xxx 取代」要跳到新卡，先记下每个条目属于哪个 tab。
  const tabByEntryId: Record<string, string> = {};
  for (const entry of data.entries) {
    const key = tabKeyForCategory(entry.category);
    if (key) tabByEntryId[entry.id] = key;
  }
  for (const entry of data.inbox) {
    tabByEntryId[entry.id] = "inbox";
  }

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
        {/* 计数本身就是类型标签；标签是链接，无 JS 时服务端按 ?tab 直接渲染。 */}
        <nav className="mirror-a-tabs" aria-label="按类型查看">
          {counts.map((item) => {
            const active = item.key === tab.key;
            return (
              <a
                key={item.key}
                className={`mirror-a-tab${active ? " is-active" : ""}${item.key === "inbox" ? " is-inbox" : ""}`}
                href={`/mirror?tab=${item.key}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="mirror-a-tab-num">{item.count}</span>
                <span className="mirror-a-tab-label">{item.label}</span>
              </a>
            );
          })}
        </nav>

        <section className="mirror-a-deck-section">
          <div className="mirror-a-deck-head">
            <h2 className="mirror-a-heading">{tab.label}</h2>
            <p className="mirror-a-deck-hint">
              {tab.inbox ? "只用来展示，确认都在对话里做。" : `${entries.length} 条 · 左右滑动或点箭头`}
            </p>
          </div>
          {entries.length > 0 ? (
            <MirrorDeck entries={entries} variant={tab.key as MirrorCardVariant} tabByEntryId={tabByEntryId} />
          ) : (
            <p className="mirror-a-empty-line">这个类型还没有记录。</p>
          )}
        </section>
      </main>
    </div>
  );
}
