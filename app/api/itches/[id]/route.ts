import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../lib/auth";
import { getItch, setItchStatus } from "../../../../lib/itches";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    return Response.json({ itch: await getItch(env, user.id, id) });
  } catch (error) {
    return authErrorResponse(error, "读取心结失败");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    const body = await request.json() as { status?: unknown; note?: unknown };
    const result = await setItchStatus(env, user.id, id, body.status, body.note);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return authErrorResponse(error, "更新心结失败");
  }
}
