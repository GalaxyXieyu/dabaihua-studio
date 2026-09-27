import { env } from "cloudflare:workers";
import { assertSameOrigin, authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { parseTargetType, submitReview } from "../../../../../../lib/article-review";

type Params = { params: Promise<{ type: string; id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(env, request);
    const { type, id } = await params;
    const body = await request.json() as { verdict?: unknown; comment?: unknown };
    return Response.json(await submitReview(env, user, parseTargetType(type), id, body));
  } catch (error) {
    return authErrorResponse(error, "提交审稿失败");
  }
}
