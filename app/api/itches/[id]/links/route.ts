import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../lib/auth";
import { addItchLink, deleteItchLink } from "../../../../../lib/itches";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    const body = await request.json() as { targetType?: unknown; targetId?: unknown; relation?: unknown; note?: unknown };
    return Response.json({ ok: true, ...(await addItchLink(env, user.id, id, body)) });
  } catch (error) {
    return authErrorResponse(error, "关联心结失败");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    const body = await request.json() as { linkId?: unknown };
    return Response.json({ ok: true, ...(await deleteItchLink(env, user.id, id, body.linkId)) });
  } catch (error) {
    return authErrorResponse(error, "删除心结关联失败");
  }
}
