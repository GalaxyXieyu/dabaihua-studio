import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { listArticles } from "../../lib/article-review";
import { requestOrigin } from "../../lib/request-origin";
import { SiteAppBar } from "../_components/SiteAppBar";
import { statusLabelFor } from "../_components/article-status";
import "./articles.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };

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
    <div className="art-a fixed inset-0 overflow-y-auto bg-[var(--canvas)] text-[var(--ink)]">
      <SiteAppBar user={user} pathname="/articles" />
      <header className="art-a-header">
        <div className="art-a-head-inner">
          <p className="page-kicker">内容 · 文章</p>
          <h1 className="page-title">文章</h1>
          <p className="page-sub">共 {articles.length} 篇</p>
          <div className="double-rule" />
        </div>
      </header>

      <main className="art-a-list">
        {articles.length === 0 ? (
          <div className="art-a-empty">
            <h2 className="art-a-empty-title">还没有同步的文章</h2>
            <p className="art-a-empty-text">
              运行 <code>npm run articles:sync</code> 导入已有文章，或让 watcher <code>npm run articles:watch</code> 持续同步。
            </p>
            {!user ? <p className="art-a-empty-note">登录后可以看到私有文章。</p> : null}
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
