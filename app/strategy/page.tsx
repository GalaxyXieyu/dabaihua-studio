/* eslint-disable @next/next/no-html-link-for-pages */
import { headers } from "next/headers";
import { StrategyEditor } from "./_components/StrategyEditor";
import { VersionHistory } from "./_components/VersionHistory";
import { BRAND_NAME } from "../../lib/brand";

export const dynamic = "force-dynamic";

type StrategyData = {
  version: number;
  note: string;
  data: unknown;
};

type VersionEntry = {
  id: number;
  version: number;
  note: string;
  isActive: number | boolean;
  createdAt: string;
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

async function fetchStrategy(origin: string, cookie: string | null): Promise<StrategyData | null> {
  return fetchJson<StrategyData>(origin, "/api/strategy", cookie);
}

async function fetchVersions(origin: string, cookie: string | null): Promise<VersionEntry[]> {
  const data = await fetchJson<{ versions?: VersionEntry[] }>(origin, "/api/strategy/versions", cookie);
  return data?.versions ?? [];
}

export default async function StrategyPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const cookie = requestHeaders.get("cookie");

  const [strategy, versions] = await Promise.all([
    fetchStrategy(origin, cookie),
    fetchVersions(origin, cookie),
  ]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="page-header sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="page-header-inner">
          <a href="/" className="page-header-brand" aria-label={`返回${BRAND_NAME}首页`}>
            <span className="brand-mark">🌊</span>
            <span className="page-header-brand-name">{BRAND_NAME}</span>
          </a>
          <h1 className="page-header-title">⚙️ 策略配置</h1>
          <nav className="page-header-nav" aria-label="页面导航">
            <a href="/topics">📋 选题</a>
            <a href="/">返回首页</a>
          </nav>
        </div>
      </header>

      <main className="flex flex-col gap-4 p-4 sm:p-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          {strategy ? (
            <StrategyEditor
              initialVersion={strategy.version}
              initialNote={strategy.note}
              initialData={strategy.data}
            />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-[var(--line)] text-[var(--muted)]">策略加载失败，请检查登录状态</div>
          )}
        </div>
        <div className="w-full min-w-0 lg:w-72 lg:shrink-0">
          <VersionHistory versions={versions} />
        </div>
      </main>
    </div>
  );
}
