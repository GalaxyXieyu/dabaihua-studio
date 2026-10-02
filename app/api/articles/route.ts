import { env } from "cloudflare:workers";
import { authErrorResponse, getSessionUser } from "../../../lib/auth";
import { listArticlesForViewer } from "../../../lib/article-access";
import { ensureSchema } from "../../../lib/store";

export async function GET(request: Request) {
  try {
    await ensureSchema(env.DB);
    const user = await getSessionUser(env, request);
    const viewer = user ? { id: user.id, role: user.role } : null;
    return Response.json({ articles: await listArticlesForViewer(env.DB, viewer) });
  } catch (error) {
    return authErrorResponse(error, "读取文章列表失败");
  }
}
