import { env } from "cloudflare:workers";
import { authErrorResponse, getSessionUser } from "../../../lib/auth";
import { listArticles } from "../../../lib/article-review";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(env, request);
    return Response.json({ articles: await listArticles(env, { includePrivate: Boolean(user) }) });
  } catch (error) {
    return authErrorResponse(error, "读取文章列表失败");
  }
}
