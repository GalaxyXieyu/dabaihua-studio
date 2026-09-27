import { env } from "cloudflare:workers";
import { assertSameOrigin, authErrorResponse, requireSessionUser } from "../../../../../lib/auth";
import { addAnnotation, deleteAnnotation, listTopicReviews, setReviewDecision } from "../../../../../lib/reviews";

function topicId(params: { id: string }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("选题 ID 不合法");
  return id;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireSessionUser(env, request);
    return Response.json({ reviews: await listTopicReviews(env, topicId(params)) });
  } catch (error) {
    return authErrorResponse(error, "读取审稿记录失败");
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(env, request);
    const id = topicId(params);
    const body = await request.json() as { action?: "annotate" | "delete" | "approve" | "reject"; blockIndex?: number; quote?: string; body?: string; reviewId?: number; comment?: string };
    if (body.action === "annotate") {
      return Response.json({ review: await addAnnotation(env, user.id, id, { blockIndex: body.blockIndex, quote: body.quote, body: body.body }) });
    }
    if (body.action === "delete") {
      return Response.json(await deleteAnnotation(env, user.id, Number(body.reviewId)));
    }
    if (body.action === "approve" || body.action === "reject") {
      return Response.json(await setReviewDecision(env, user.id, id, body.action, body.comment));
    }
    throw new Error("审稿操作不合法");
  } catch (error) {
    return authErrorResponse(error, "保存审稿记录失败");
  }
}
