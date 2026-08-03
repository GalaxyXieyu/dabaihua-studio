import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../lib/auth";
import { createExploration, listExplorations } from "../../../../../lib/sensemaking";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    return Response.json({ explorations: await listExplorations(env, user.id, id) });
  } catch (error) {
    return authErrorResponse(error, "读取心结探索失败");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSessionUser(env, request);
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    return Response.json({ ok: true, exploration: await createExploration(env, user.id, id, body) });
  } catch (error) {
    return authErrorResponse(error, "创建心结探索失败");
  }
}
