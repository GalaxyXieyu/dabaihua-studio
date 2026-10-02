import { env } from "cloudflare:workers";
import { assertSameOrigin, authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { requireArticleRead } from "../../../../../../lib/article-access";
import { parseTargetType, submitReview } from "../../../../../../lib/article-review";

type Params = { params: Promise<{ type: string; id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(env, request);
    const { type, id } = await params;
    const target = parseTargetType(type);
    if (target === "article") await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    const body = await request.json() as { verdict?: unknown; comment?: unknown };
    return Response.json(await submitReview(env, user, target, id, body));
  } catch (error) {
    return authErrorResponse(error, "提交审稿失败");
  }
}
