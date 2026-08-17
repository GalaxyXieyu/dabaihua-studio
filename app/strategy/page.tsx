import { headers } from "next/headers";
import { StrategyEditor } from "./_components/StrategyEditor";
import { VersionHistory } from "./_components/VersionHistory";

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

async function fetchStrategy(origin: string, cookie: string | null): Promise<StrategyData | null> {
  const response = await fetch(`${origin}/api/strategy`, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as StrategyData;
}

async function fetchVersions(origin: string, cookie: string | null): Promise<VersionEntry[]> {
  const response = await fetch(`${origin}/api/strategy/versions`, {
    headers: cookie ? { cookie } : {},
    cache: "no-store",
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { versions?: VersionEntry[] };
  return data.versions ?? [];
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

  const contentJson = strategy ? JSON.stringify(strategy.data, null, 2) : "{}";

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--line)] bg-[var(--paper)] px-6 py-4">
        <div className="flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 text-sm font-bold text-[var(--muted)] hover:text-[var(--green)]">
            <span className="text-base">🌊</span>
            <span>清流工作室</span>
          </a>
          <span className="text-[var(--line-strong)]">/</span>
          <h1 className="text-lg font-bold">⚙️ 策略配置</h1>
        </div>
        <nav className="flex items-center gap-2">
          <a href="/topics" className="rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--green)]">📋 选题</a>
          <a href="/" className="rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--green)]">返回首页</a>
        </nav>
      </header>

      <main className="flex gap-4 p-6">
        <div className="flex-1">
          {strategy ? (
            <StrategyEditor
              initialVersion={strategy.version}
              initialNote={strategy.note}
              initialData={strategy.data}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-[var(--muted)]">策略加载失败，请检查登录状态</div>
          )}
        </div>
        <div className="w-72 shrink-0">
          <VersionHistory versions={versions} />
        </div>
      </main>
    </div>
  );
}
