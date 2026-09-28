import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { StrategyEditor } from "./_components/StrategyEditor";
import { VersionHistory } from "./_components/VersionHistory";
import { SiteAppBar } from "../_components/SiteAppBar";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import "./strategy.css";

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
    <div className="strat-page">
      <SiteAppBar user={user} pathname="/strategy" />
      <main className="strat-main">
        <header>
          <p className="page-kicker">内容 · 策略</p>
          <h1 className="page-title">策略</h1>
          {strategy && (
            <p className="page-sub">
              当前版本 v<span className="strat-num">{strategy.version}</span>
            </p>
          )}
          <div className="double-rule" />
        </header>

        <div className="strat-layout">
          <div className="strat-editor">
            {strategy ? (
              <StrategyEditor
                initialVersion={strategy.version}
                initialNote={strategy.note}
                initialData={strategy.data}
              />
            ) : (
              <div className="strat-failed">策略加载失败，请检查登录状态</div>
            )}
          </div>
          <aside className="strat-aside">
            <VersionHistory versions={versions} />
          </aside>
        </div>
      </main>
    </div>
  );
}
