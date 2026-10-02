import { env } from "cloudflare:workers";
import { assertSameOrigin, authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { requireArticleRead } from "../../../../../../lib/article-access";
import { addMark, listMarks, parseTargetType } from "../../../../../../lib/article-review";

type Params = { params: Promise<{ type: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await requireSessionUser(env, request);
    const { type, id } = await params;
    const target = parseTargetType(type);
    if (target === "article") await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    const round = new URL(request.url).searchParams.get("round");
    return Response.json({ marks: await listMarks(env, target, id, { round }) });
  } catch (error) {
    return authErrorResponse(error, "读取标记失败");
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(env, request);
    const { type, id } = await params;
    const target = parseTargetType(type);
    if (target === "article") await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    const body = await request.json() as Record<string, unknown>;
    return Response.json({ mark: await addMark(env, user.id, target, id, body) });
  } catch (error) {
    return authErrorResponse(error, "保存标记失败");
  }
}
