import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { listArticlesForViewer } from "../../lib/article-access";
import { getBrief, getLatestBriefDate, listBriefDates, listResponses } from "../../lib/daily-brief";
import { listSelections } from "../../lib/brief-pipeline";
import { isValidBriefDate } from "../../lib/daily-brief-core";
import { findMaterialItemsByUrls } from "../../lib/store";
import { orderBriefTopics, pickInitialTopic, toMaterialView, type MaterialView } from "../../lib/brief-view";
import { dateLabel, shanghaiDate } from "../../lib/today-core";
import { CONTENT_NAMES } from "../../lib/site-nav";
import { SiteAppBar } from "../_components/SiteAppBar";
import { statusLabelFor } from "../_components/article-status";
import { Board, type SeriesSummary, type Topic } from "../topics/_components/Board";
import { ContentSwitchBar, type ContentCounts, type ContentView } from "./_components/ContentSwitchBar";
import { DailyBrief } from "./_brief/DailyBrief";
import "./content.css";
import "./_brief/daily-brief.css";
import "./_brief/outline-editor.css";
import "../topics/topics.css";
import "../articles/articles.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: CONTENT_NAMES.content.label, robots: { index: false, follow: false } };

async function fetchJson<T>(origin: string, path: string, cookie: string | null): Promise<T | null> {
  try {
    const response = await fetch(`${origin}${path}`, {
      headers: cookie ? { cookie } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchTopics(origin: string, cookie: string | null): Promise<Topic[]> {
  const data = await fetchJson<{ topics?: Topic[] }>(origin, "/api/topics", cookie);
  return data?.topics ?? [];
}

async function fetchSeries(origin: string, cookie: string | null): Promise<SeriesSummary[]> {
  const data = await fetchJson<{ series?: SeriesSummary[] }>(origin, "/api/series", cookie);
  return data?.series ?? [];
}

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; topic?: string }>;
}) {
  const { view: requestedView, date: requested, topic: requestedTopic } = await searchParams;

  const requestHeaders = await headers();
  const origin = requestOrigin(requestHeaders);
  const cookie = requestHeaders.get("cookie");
  const user = await getSessionUser(
    env,
    new Request(`${origin}/content`, {
      headers: {
        cookie: cookie || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/content");
  const isAdmin = user.role === "admin";

  // 管理员默认看今日简报，其他人默认看选题看板；非管理员永远看不到简报视图。
  const fallbackView: ContentView = isAdmin ? "brief" : "board";
  let view: ContentView =
    requestedView === "brief" || requestedView === "board" || requestedView === "articles"
      ? requestedView
      : fallbackView;
  if (!isAdmin && view === "brief") view = "board";

  const [topics, series, articles, latestBriefDate] = await Promise.all([
    fetchTopics(origin, cookie),
    view === "board" ? fetchSeries(origin, cookie) : Promise.resolve<SeriesSummary[]>([]),
    listArticlesForViewer(env.DB, { id: user.id, role: user.role }),
    isAdmin ? getLatestBriefDate(env) : Promise.resolve<string | null>(null),
  ]);

  const latestBrief = latestBriefDate ? await getBrief(env, latestBriefDate) : null;
  const counts: ContentCounts = {
    brief: latestBrief?.brief.topics.length ?? 0,
    board: topics.length,
    articles: articles.length,
  };

  if (view === "brief") {
    const dates = await listBriefDates(env);
    const selected = requested && isValidBriefDate(requested) ? requested : latestBriefDate;
    const stored = selected && selected === latestBriefDate ? latestBrief : selected ? await getBrief(env, selected) : null;
    const label = dateLabel(selected ?? shanghaiDate());

    const materialsByUrl: Record<string, MaterialView> = {};
    let initialTopicId: string | null = null;
    let initialResponses: Awaited<ReturnType<typeof listResponses>> = [];
    let initialSelections: Awaited<ReturnType<typeof listSelections>> = [];
    if (stored && selected) {
      const materialUrls = stored.brief.topics
        .flatMap((topic) => topic.materials.map((material) => material.url))
        .filter(Boolean);
      const materialItems = await findMaterialItemsByUrls(env, materialUrls);
      for (const topic of stored.brief.topics) {
        for (const material of topic.materials) {
          if (!material.url) continue;
          materialsByUrl[material.url] = toMaterialView(material, materialItems.get(material.url) ?? null);
        }
      }

      initialResponses = await listResponses(env, { date: selected });
      initialSelections = await listSelections(env, selected);
      const decided: Record<string, "pick" | "reject" | null> = {};
      for (const response of initialResponses) {
        if (response.user.account !== user.account) continue;
        decided[response.topicId] = response.decision;
      }
      const ordered = orderBriefTopics(stored.brief.topics, stored.brief.recommendation?.topicId ?? null);
      initialTopicId = pickInitialTopic(
        ordered.map((topic) => topic.id),
        stored.brief.recommendation?.topicId ?? null,
        decided,
        requestedTopic ?? null,
      );
    }

    return (
      <div className="db-page">
        <SiteAppBar user={user} pathname="/content" />
        <ContentSwitchBar view="brief" isAdmin={isAdmin} counts={counts} />
        {stored && selected ? (
          <DailyBrief
            date={selected}
            dateLabel={label}
            brief={stored.brief}
            dates={dates}
            userAccount={user.account}
            initialResponses={initialResponses}
            initialSelections={initialSelections}
            materialsByUrl={materialsByUrl}
            initialTopicId={initialTopicId}
            requestedTopic={requestedTopic ?? null}
          />
        ) : (
          <main className="db-empty-wrap">
            <h1 className="page-title">{label}</h1>
            <div className="double-rule" />
            <div className="db-empty">
              <h2>还没有选题简报</h2>
              <p>等晴儿推送后，这里会显示当天的选题卡片。</p>
            </div>
          </main>
        )}
      </div>
    );
  }

  if (view === "board") {
    return (
      <div className="tp-page">
        <SiteAppBar user={user} pathname="/content" />
        <ContentSwitchBar view="board" isAdmin={isAdmin} counts={counts} />
        <main className="tp-main">
          <Board initialTopics={topics} initialSeries={series} />
        </main>
      </div>
    );
  }

  return (
    <div className="art-a art-a-view">
      <SiteAppBar user={user} pathname="/content" />
      <ContentSwitchBar view="articles" isAdmin={isAdmin} counts={counts} />
      <main className="art-a-list">
        {articles.length === 0 ? (
          <div className="art-a-empty">
            <h2 className="art-a-empty-title">还没有同步的文章</h2>
            <p className="art-a-empty-text">
              运行 <code>npm run articles:sync</code> 导入已有文章，或让 watcher <code>npm run articles:watch</code> 持续同步。
            </p>
          </div>
        ) : (
          <ol className="art-a-rows">
            {articles.map((article, index) => {
              const attention = article.status === "changes-requested";
              return (
                <li key={article.slug}>
                  <a href={`/articles/${article.slug}`} className="art-a-row">
                    <span className="art-a-seq">{String(index + 1).padStart(2, "0")}</span>
                    <span className="art-a-row-body">
                      <span className="art-a-row-title">{article.title || article.slug}</span>
                      {article.topic ? <span className="art-a-row-topic">{article.topic}</span> : null}
                    </span>
                    <span className="art-a-row-meta">
                      <span className={`art-a-status${attention ? " is-attention" : ""}`}>{statusLabelFor(article.status)}</span>
                      <span className="art-a-sep">·</span>
                      <span>第 <span className="art-a-num">{article.reviewRound}</span> 轮</span>
                      {article.isPublic ? (
                        <>
                          <span className="art-a-sep">·</span>
                          <span>公开</span>
                        </>
                      ) : null}
                      {article.hasHtml ? (
                        <>
                          <span className="art-a-sep">·</span>
                          <span>已排版</span>
                        </>
                      ) : null}
                      <span className="art-a-sep">·</span>
                      <span className="art-a-date">{article.date || article.slug}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
