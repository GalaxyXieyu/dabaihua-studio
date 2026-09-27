import { env } from "cloudflare:workers";
import { assertSameOrigin, authErrorResponse, getSessionUser, requireSessionUser } from "../../../../lib/auth";
import { getArticle, setArticlePublic } from "../../../../lib/article-review";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { slug } = await params;
    const user = await getSessionUser(env, request);
    const article = await getArticle(env, slug);
    if (!article || (!article.isPublic && !user)) return Response.json({ error: "文章不存在" }, { status: 404 });
    return Response.json({ article });
  } catch (error) {
    return authErrorResponse(error, "读取文章失败");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    await requireSessionUser(env, request);
    const { slug } = await params;
    const body = await request.json() as { isPublic?: unknown };
    if (typeof body.isPublic !== "boolean") throw new Error("公开状态不合法");
    return Response.json({ ok: true, ...(await setArticlePublic(env, slug, body.isPublic)) });
  } catch (error) {
    return authErrorResponse(error, "更新文章失败");
  }
}
