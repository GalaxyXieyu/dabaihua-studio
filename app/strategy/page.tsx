import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { StrategyEditor } from "./_components/StrategyEditor";
import { VersionHistory } from "./_components/VersionHistory";
import { SiteAppBar } from "../_components/SiteAppBar";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";

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
  const origin = requestOrigin(requestHeaders);
  const cookie = requestHeaders.get("cookie");
  const user = await getSessionUser(
    env,
    new Request(`${origin}/strategy`, {
      headers: {
        cookie: cookie || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/strategy");

  const [strategy, versions] = await Promise.all([
    fetchStrategy(origin, cookie),
    fetchVersions(origin, cookie),
  ]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <SiteAppBar role={user.role} pathname="/strategy" />
      <h1 className="px-4 pt-4 text-lg font-bold sm:px-6">⚙️ 策略配置</h1>

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
