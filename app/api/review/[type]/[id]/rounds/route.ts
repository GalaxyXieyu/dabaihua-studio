import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { listRounds, parseTargetType } from "../../../../../../lib/article-review";

type Params = { params: Promise<{ type: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await requireSessionUser(env, request);
    const { type, id } = await params;
    return Response.json({ rounds: await listRounds(env, parseTargetType(type), id) });
  } catch (error) {
    return authErrorResponse(error, "读取审稿轮次失败");
  }
}
