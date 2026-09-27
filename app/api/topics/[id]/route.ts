import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../lib/auth";
import { getTopic, updateTopic } from "../../../../lib/topics";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireSessionUser(env, request);
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("选题 ID 不合法");
    const topic = await getTopic(env, id);
    if (!topic) return Response.json({ error: "选题不存在" }, { status: 404 });
    return Response.json({ topic });
  } catch (error) {
    return authErrorResponse(error, "读取选题失败");
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireSessionUser(env, request);
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("选题 ID 不合法");
    const body = await request.json();
    await updateTopic(env, id, body);
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error, "更新选题失败");
  }
}
