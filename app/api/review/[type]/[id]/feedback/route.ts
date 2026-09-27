import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { getFeedback, parseTargetType } from "../../../../../../lib/article-review";

type Params = { params: Promise<{ type: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await requireSessionUser(env, request);
    const { type, id } = await params;
    const round = new URL(request.url).searchParams.get("round");
    return Response.json({ feedback: await getFeedback(env, parseTargetType(type), id, round || "latest") });
  } catch (error) {
    return authErrorResponse(error, "读取审稿反馈失败");
  }
}
