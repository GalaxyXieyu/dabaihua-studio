import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../lib/auth";
import { getArticle, listMarks, listRounds } from "../../../lib/article-review";
import { canReadArticle, isArticleOwner } from "../../../lib/article-access";
import { requestOrigin } from "../../../lib/request-origin";
import { ArticleReviewer, type ReviewMark, type ReviewRoundSummary } from "../../_components/ArticleReviewer";
import { SiteAppBar } from "../../_components/SiteAppBar";
import { statusLabelFor } from "../../_components/article-status";
import { ArticleHeaderActions } from "./ArticleHeaderActions";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" as const };

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export default async function ArticleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();

  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/articles/${slug}`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );

  const article = await getArticle(env, slug);
  if (!article) notFound();
  const viewer = user ? { id: user.id, role: user.role } : null;
  if (!canReadArticle(article, viewer)) {
    if (!user) redirect(`/login?next=/articles/${slug}`);
    notFound();
  }
  const owner = isArticleOwner(article, viewer);

  if (!user) {
    return (
      <div className="ar-page">
        <SiteAppBar user={null} pathname={`/articles/${slug}`} />
        <ArticleReviewer
          target={{ type: "article", id: slug }}
          title={article.title || slug}
          html={article.renderedHtml}
          htmlSource={article.htmlSource}
          round={article.reviewRound}
          statusLabel={statusLabelFor(article.status)}
          initialMarks={[]}
          rounds={[]}
          canReview={false}
          currentUserId={null}
          backHref="/articles"
          updatedAt={article.updatedAt}
        />
      </div>
    );
  }

  const marks = await listMarks(env, "article", slug) as unknown as ReviewMark[];
  const rounds = await listRounds(env, "article", slug) as unknown as ReviewRoundSummary[];
  const latestRound = rounds.length ? Number(rounds[0].round) : null;

  return (
    <div className="ar-page has-action-bar">
      <SiteAppBar user={user} pathname={`/articles/${slug}`} />
      <ArticleReviewer
        target={{ type: "article", id: slug }}
        title={article.title || slug}
        html={article.renderedHtml}
        htmlSource={article.htmlSource}
        round={article.reviewRound}
        statusLabel={statusLabelFor(article.status)}
        initialMarks={marks}
        rounds={rounds}
        canReview
        currentUserId={user.id}
        backHref="/articles"
        updatedAt={article.updatedAt}
        extraHeader={
          owner ? <ArticleHeaderActions slug={slug} initialPublic={article.isPublic} latestRound={latestRound} /> : undefined
        }
      />
    </div>
  );
}
