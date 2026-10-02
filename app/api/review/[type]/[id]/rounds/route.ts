import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { requireArticleRead } from "../../../../../../lib/article-access";
import { listRounds, parseTargetType } from "../../../../../../lib/article-review";

type Params = { params: Promise<{ type: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await requireSessionUser(env, request);
    const { type, id } = await params;
    const target = parseTargetType(type);
    if (target === "article") await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    return Response.json({ rounds: await listRounds(env, target, id) });
  } catch (error) {
    return authErrorResponse(error, "读取审稿轮次失败");
  }
}
