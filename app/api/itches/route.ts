import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../lib/auth";
import { createItch, listItches } from "../../../lib/itches";

export async function GET(request: Request) {
  try {
    const user = await requireSessionUser(env, request);
    const status = new URL(request.url).searchParams.get("status") || "";
    return Response.json({ itches: await listItches(env, user.id, status) });
  } catch (error) {
    return authErrorResponse(error, "读取心结失败");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSessionUser(env, request);
    const body = await request.json() as { body?: unknown; note?: unknown; sourceType?: unknown; sourceId?: unknown };
    const result = await createItch(env, user.id, {
      body: body.body,
      note: body.note,
      sourceType: body.sourceType,
      sourceId: body.sourceId,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return authErrorResponse(error, "记录心结失败");
  }
}
