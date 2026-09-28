import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { listArticles } from "../../lib/article-review";
import { requestOrigin } from "../../lib/request-origin";
import { SiteAppBar } from "../_components/SiteAppBar";
import { statusLabelFor } from "../_components/article-status";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };

function statusClasses(status: string | null | undefined) {
  switch (String(status || "")) {
    case "approved":
      return "bg-emerald-50 text-emerald-700";
    case "pending":
    case "drafting":
      return "bg-sky-50 text-sky-700";
    case "changes-requested":
      return "bg-amber-50 text-amber-700";
    case "published":
      return "bg-violet-50 text-violet-700";
    default:
      return "bg-[var(--canvas)] text-[var(--muted)]";
  }
}

export default async function ArticlesPage() {
  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/articles`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  const articles = await listArticles(env, { includePrivate: Boolean(user) });

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[var(--canvas)] text-[var(--ink)]">
      <SiteAppBar role={user?.role} pathname="/articles" />
      <header className="border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-4 py-3">
          <h1 className="text-base font-bold">📰 文章</h1>
          <span className="shrink-0 text-xs text-[var(--faint)]">共 {articles.length} 篇</span>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 py-4">
        {articles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--paper)] p-8 text-center">
            <div className="mb-2 text-2xl">📭</div>
            <h2 className="mb-1 text-base font-bold">还没有同步的文章</h2>
            <p className="text-sm text-[var(--muted)]">
              运行 <code className="rounded bg-[var(--canvas)] px-1.5 py-0.5">npm run articles:sync</code> 导入已有文章，
              或让 watcher <code className="rounded bg-[var(--canvas)] px-1.5 py-0.5">npm run articles:watch</code> 持续同步。
            </p>
            {!user ? <p className="mt-2 text-xs text-[var(--faint)]">登录后可以看到私有文章。</p> : null}
          </div>
        ) : (
          <ul className="space-y-3">
            {articles.map((article) => (
              <li key={article.slug}>
                <a
                  href={`/articles/${article.slug}`}
                  className="block rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm transition hover:border-[var(--green)] hover:shadow-md"
                >
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] text-[var(--faint)]">
                    {article.date ? <span>{article.date}</span> : <span>{article.slug}</span>}
                    <span className={`rounded-full px-2 py-0.5 font-bold ${statusClasses(article.status)}`}>{statusLabelFor(article.status)}</span>
                    <span className="rounded-full bg-[var(--canvas)] px-2 py-0.5 font-bold text-[var(--muted)]">第 {article.reviewRound} 轮</span>
                    {article.hasHtml ? <span className="rounded-full bg-[var(--green-soft)] px-2 py-0.5 font-bold text-[var(--green)]">已排版</span> : null}
                    {article.isPublic ? <span className="rounded-full bg-sky-50 px-2 py-0.5 font-bold text-sky-700">公开</span> : null}
                  </div>
                  <h2 className="text-sm font-bold leading-snug text-[var(--ink)]">{article.title || article.slug}</h2>
                  {article.topic ? <p className="mt-1 line-clamp-1 text-xs text-[var(--muted)]">{article.topic}</p> : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
