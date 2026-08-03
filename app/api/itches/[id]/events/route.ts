import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../lib/auth";
import { addItchEvent } from "../../../../../lib/itches";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    const body = await request.json() as { type?: unknown; body?: unknown; metadata?: unknown };
    return Response.json({ ok: true, ...(await addItchEvent(env, user.id, id, body)) });
  } catch (error) {
    return authErrorResponse(error, "记录心结事件失败");
  }
}
