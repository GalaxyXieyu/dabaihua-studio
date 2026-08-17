import { headers } from "next/headers";
import { Board } from "./_components/Board";

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
  updatedAt: string | null;
};

type SeriesSummary = {
  series: string;
  count: number;
  minOrder: number | null;
  maxOrder: number | null;
};

async function fetchTopics(origin: string, cookie: string | null): Promise<Topic[]> {
  const response = await fetch(`${origin}/api/topics`, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { topics?: Topic[] };
  return data.topics ?? [];
}

async function fetchSeries(origin: string, cookie: string | null): Promise<SeriesSummary[]> {
  const response = await fetch(`${origin}/api/series`, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { series?: SeriesSummary[] };
  return data.series ?? [];
}

export default async function TopicsPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const cookie = requestHeaders.get("cookie");

  const [topics, series] = await Promise.all([
    fetchTopics(origin, cookie),
    fetchSeries(origin, cookie),
  ]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-6 py-4">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 text-sm font-bold text-[var(--muted)] hover:text-[var(--green)]">
            <span className="text-base">🌊</span>
            <span>清流工作室</span>
          </a>
          <span className="text-[var(--line-strong)]">/</span>
          <h1 className="text-lg font-bold">📋 选题看板</h1>
        </div>
        <nav className="flex items-center gap-2">
          <a href="/strategy" className="rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--green)]">⚙️ 策略</a>
          <a href="/" className="rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--green)]">返回首页</a>
        </nav>
      </header>
      <main className="p-6">
        <Board initialTopics={topics} initialSeries={series} />
      </main>
    </div>
  );
}
