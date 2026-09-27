import { env } from "cloudflare:workers";
import { assertSameOrigin, authErrorResponse, requireSessionUser } from "../../../../../../../lib/auth";
import { deleteMark, updateMark } from "../../../../../../../lib/article-review";

type Params = { params: Promise<{ type: string; id: string; markId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(env, request);
    const { markId } = await params;
    const body = await request.json() as { kind?: unknown; comment?: unknown };
    return Response.json({ mark: await updateMark(env, user.id, markId, body) });
  } catch (error) {
    return authErrorResponse(error, "更新标记失败");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(env, request);
    const { markId } = await params;
    return Response.json(await deleteMark(env, user.id, markId));
  } catch (error) {
    return authErrorResponse(error, "删除标记失败");
  }
}
