import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { getExploration, updateExploration } from "../../../../../../lib/sensemaking";

type Params = { params: Promise<{ id: string; explorationId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await requireSessionUser(env, request);
    const { id, explorationId } = await params;
    return Response.json({ exploration: await getExploration(env, user.id, id, explorationId) });
  } catch (error) {
    return authErrorResponse(error, "读取探索失败");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireSessionUser(env, request);
    const { id, explorationId } = await params;
    const body = await request.json() as Record<string, unknown>;
    return Response.json({ ok: true, exploration: await updateExploration(env, user.id, id, explorationId, body) });
  } catch (error) {
    return authErrorResponse(error, "更新探索失败");
  }
}
