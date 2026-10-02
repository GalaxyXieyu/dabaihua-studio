import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { requireArticleRead } from "../../../../../../lib/article-access";
import { getFeedback, parseTargetType } from "../../../../../../lib/article-review";

type Params = { params: Promise<{ type: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await requireSessionUser(env, request);
    const { type, id } = await params;
    const target = parseTargetType(type);
    if (target === "article") await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    const round = new URL(request.url).searchParams.get("round");
    return Response.json({ feedback: await getFeedback(env, target, id, round || "latest") });
  } catch (error) {
    return authErrorResponse(error, "读取审稿反馈失败");
  }
}
