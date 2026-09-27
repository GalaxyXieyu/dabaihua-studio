import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../lib/auth";
import { getTopic } from "../../../lib/topics";
import { getTopicReviewTarget, listMarks, listRounds } from "../../../lib/article-review";
import { requestOrigin } from "../../../lib/request-origin";
import { ArticleReviewer, type ReviewMark, type ReviewRoundSummary } from "../../_components/ArticleReviewer";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };

function topicStatusLabel(status: string | null | undefined) {
  if (status === "approved") return "已通过";
  if (status === "rejected") return "已打回";
  return "待审";
}

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
      <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-6 text-center text-[var(--ink)]">
        <div className="max-w-[420px]">
          <div className="mb-2 text-2xl">📝</div>
          <h1 className="mb-2 text-lg font-bold">这个选题还没有草稿</h1>
          <p className="text-sm text-[var(--muted)]">
            先运行 <code className="rounded bg-[var(--paper)] px-1.5 py-0.5">npm run draft -- {id}</code> 生成草稿，再回来审稿。
          </p>
          <a href="/topics" className="mt-4 inline-block rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-1.5 text-sm font-bold text-[var(--muted)]">返回选题看板</a>
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
    <ArticleReviewer
      target={{ type: "topic", id: String(id) }}
      title={target.title || String(topic.title || `选题 #${id}`)}
      html={target.renderedHtml}
      htmlSource={target.htmlSource}
      round={target.round}
      statusLabel={topicStatusLabel(topic.reviewStatus as string | null | undefined)}
      initialMarks={marks}
      rounds={rounds}
      canReview
      currentUserId={user.id}
      backHref="/topics"
      extraHeader={
        articleRow?.slug ? (
          <a
            href={`/articles/${articleRow.slug}`}
            className="min-h-[36px] rounded-full bg-[var(--green-soft)] px-3 text-xs font-bold leading-[36px] text-[var(--green)]"
          >
            查看文章
          </a>
        ) : null
      }
    />
  );
}
