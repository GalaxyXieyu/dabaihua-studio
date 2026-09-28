import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../lib/auth";
import { getTopic } from "../../../lib/topics";
import { getTopicReviewTarget, listMarks, listRounds } from "../../../lib/article-review";
import { requestOrigin } from "../../../lib/request-origin";
import { ArticleReviewer, type ReviewMark, type ReviewRoundSummary } from "../../_components/ArticleReviewer";
import { SiteAppBar } from "../../_components/SiteAppBar";
import { statusLabelFor } from "../../_components/article-status";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" as const };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/review/${id}`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect(`/login?next=/review/${id}`);

  const topic = await getTopic(env, id);
  if (!topic) notFound();

  if (!topic.draftMarkdown || !String(topic.draftMarkdown).trim()) {
    return (
      <div className="ar-page">
        <SiteAppBar user={user} pathname={`/review/${id}`} />
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--canvas)] px-5 text-[var(--ink)]">
          <div className="max-w-[420px] desk:max-w-[760px]">
            <p className="text-[13px] tracking-[.12em] text-[var(--muted)]">内容 · 审稿</p>
            <h1 className="mt-3 font-[family-name:var(--font-serif)] text-2xl font-bold">这个选题还没有草稿</h1>
            <div className="relative mt-4 border-t-[3px] border-[var(--ink)]">
              <span className="absolute inset-x-0 top-[5px] border-t border-[var(--ink)]" />
            </div>
            <p className="mt-4 text-sm text-[var(--muted)]">
              先运行 <code className="bg-[var(--paper)] px-1.5 py-0.5">npm run draft -- {id}</code> 生成草稿，再回来审稿。
            </p>
            <a href="/topics" className="mt-5 inline-block text-[13px] tracking-[.06em] text-[var(--ink)] underline decoration-[var(--line)] underline-offset-4">← 返回选题看板</a>
          </div>
        </div>
      </div>
    );
  }

  const target = await getTopicReviewTarget(env, id);
  const marks = await listMarks(env, "topic", id) as unknown as ReviewMark[];
  const rounds = await listRounds(env, "topic", id) as unknown as ReviewRoundSummary[];
  const articleRow = await env.DB.prepare("SELECT slug FROM articles WHERE topic_id = ? ORDER BY updated_at DESC LIMIT 1")
    .bind(id).first<{ slug: string }>();

  return (
    <div className="ar-page has-action-bar">
      <SiteAppBar user={user} pathname={`/review/${id}`} />
      <ArticleReviewer
        target={{ type: "topic", id: String(id) }}
        title={target.title || String(topic.title || `选题 #${id}`)}
        html={target.renderedHtml}
        htmlSource={target.htmlSource}
        round={target.round}
        statusLabel={statusLabelFor(topic.reviewStatus as string | null | undefined)}
        initialMarks={marks}
        rounds={rounds}
        canReview
        currentUserId={user.id}
        backHref="/topics"
        backLabel="选题"
        updatedAt={topic.updatedAt ? String(topic.updatedAt) : null}
        extraHeader={
          articleRow?.slug ? (
            <a
              href={`/articles/${articleRow.slug}`}
              className="text-[13px] tracking-[.04em] text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
            >
              查看文章 →
            </a>
          ) : null
        }
      />
    </div>
  );
}
