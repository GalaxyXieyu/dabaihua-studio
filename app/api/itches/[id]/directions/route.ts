import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../lib/auth";
import { createDirection, listDirections } from "../../../../../lib/sensemaking";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    const status = new URL(request.url).searchParams.get("status") || "";
    return Response.json({ directions: await listDirections(env, user.id, id, status) });
  } catch (error) {
    return authErrorResponse(error, "读取候选方向失败");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    return Response.json({ ok: true, direction: await createDirection(env, user.id, id, body) });
  } catch (error) {
    return authErrorResponse(error, "创建候选方向失败");
  }
}
