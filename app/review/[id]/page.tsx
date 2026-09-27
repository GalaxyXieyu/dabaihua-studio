import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../lib/auth";
import { getTopic } from "../../../lib/topics";
import { listTopicReviews } from "../../../lib/reviews";
import { requestOrigin } from "../../../lib/request-origin";
import { ReviewClient, type ReviewRecord, type TopicDetail } from "./ReviewClient";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const requestHeaders = await headers();
  const request = new Request(`${requestOrigin(requestHeaders)}/review/${id}`, {
    headers: {
      cookie: requestHeaders.get("cookie") || "",
      authorization: requestHeaders.get("authorization") || "",
    },
  });
  const user = await getSessionUser(env, request);
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

  const reviews = await listTopicReviews(env, id) as ReviewRecord[];
  return <ReviewClient topic={topic as unknown as TopicDetail} initialReviews={reviews} currentUserId={user.id} />;
}
