import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { Board } from "./_components/Board";
import { SiteAppBar } from "../_components/SiteAppBar";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import "./topics.css";

export const dynamic = "force-dynamic";

type Topic = {
  id: number;
  title: string;
  angle: string | null;
  reason: string | null;
  platform: string | null;
  contentType: string | null;
  series: string | null;
  seriesOrder: number | null;
  scheduledDate: string | null;
  publishedDate: string | null;
  publishedUrl: string | null;
  notes: string | null;
  heat: number;
  matchScore: number;
  feasibility: number;
  total: number;
  hkr: string | null;
  status: string;
  itemIds: string | null;
  createdAt: string;
  updatedAt: string;
  hasDraft?: number | boolean | null;
  draftUpdatedAt?: string | null;
  reviewStatus?: string | null;
};

type SeriesSummary = {
  series: string;
  count: number;
  minOrder: number | null;
  maxOrder: number | null;
};

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

export default async function TopicsPage() {
  const requestHeaders = await headers();
  const origin = requestOrigin(requestHeaders);
  const cookie = requestHeaders.get("cookie");
  const user = await getSessionUser(
    env,
    new Request(`${origin}/topics`, {
      headers: {
        cookie: cookie || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/topics");

  const [topics, series] = await Promise.all([
    fetchTopics(origin, cookie),
    fetchSeries(origin, cookie),
  ]);

  return (
    <div className="tp-page">
      <SiteAppBar user={user} pathname="/topics" />
      <main className="tp-main">
        <header>
          <p className="tp-kicker">内容 · 选题</p>
          <h1 className="tp-title">选题看板</h1>
          <p className="tp-subtitle">共 <span className="tp-num">{topics.length}</span> 个选题</p>
          <div className="tp-double-rule" />
        </header>
        <Board initialTopics={topics} initialSeries={series} />
      </main>
    </div>
  );
}
