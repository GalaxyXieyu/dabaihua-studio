import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { getDirection, setDirectionStatus, updateDirection } from "../../../../../../lib/sensemaking";

type Params = { params: Promise<{ id: string; directionId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await requireSessionUser(env, request);
    const { id, directionId } = await params;
    return Response.json({ direction: await getDirection(env, user.id, id, directionId) });
  } catch (error) {
    return authErrorResponse(error, "读取方向失败");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await requireSessionUser(env, request);
    const { id, directionId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== undefined) {
      const status = body.action === "confirm" ? "confirmed" : body.action === "reject" ? "rejected" : body.action;
      return Response.json({ ok: true, direction: await setDirectionStatus(env, user.id, id, directionId, status, body.note) });
    }
    return Response.json({ ok: true, direction: await updateDirection(env, user.id, id, directionId, body) });
  } catch (error) {
    return authErrorResponse(error, "更新方向失败");
  }
}
