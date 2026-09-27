/* eslint-disable @next/next/no-html-link-for-pages */
import { headers } from "next/headers";
import { Board } from "./_components/Board";
import { requestOrigin } from "../../lib/request-origin";
import { BRAND_NAME } from "../../lib/brand";

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

  const [topics, series] = await Promise.all([
    fetchTopics(origin, cookie),
    fetchSeries(origin, cookie),
  ]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="page-header sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="page-header-inner">
          <a href="/" className="page-header-brand" aria-label={`返回${BRAND_NAME}首页`}>
            <span className="brand-mark">🌊</span>
            <span className="page-header-brand-name">{BRAND_NAME}</span>
          </a>
          <h1 className="page-header-title">📋 选题看板</h1>
          <nav className="page-header-nav" aria-label="页面导航">
            <a href="/articles">📰 文章</a>
            <a href="/strategy">⚙️ 策略</a>
            <a href="/">返回首页</a>
          </nav>
        </div>
      </header>
      <main className="p-4 sm:p-6">
        <Board initialTopics={topics} initialSeries={series} />
      </main>
    </div>
  );
}
