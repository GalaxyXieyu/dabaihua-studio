import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { requireArticleRead } from "../../../../../../lib/article-access";
import { getFeedback, parseTargetType } from "../../../../../../lib/article-review";
import { bearerToken, sameSecret } from "../../../../../../lib/assistant-auth";
import { ensureSchema } from "../../../../../../lib/store";

type Params = { params: Promise<{ type: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    await ensureSchema(env.DB);
    const { type, id } = await params;
    const target = parseTargetType(type);
    // 助手 token（DABAIHUA_CARDS_ASSISTANT_TOKEN）：只读，仅 article 且文章存在时
    // 跳过会话检查；topic 仍走会话逻辑（助手 token → 401）。未配置时不启用。
    const token = bearerToken(request);
    const assistantToken = (env.DABAIHUA_CARDS_ASSISTANT_TOKEN || "").trim();
    if (token && assistantToken && sameSecret(token, assistantToken) && target === "article") {
      const article = await env.DB.prepare("SELECT 1 AS ok FROM articles WHERE slug = ?").bind(id).first();
      if (article) {
        const round = new URL(request.url).searchParams.get("round");
        return Response.json({ feedback: await getFeedback(env, target, id, round || "latest") });
      }
    }
    const user = await requireSessionUser(env, request);
    if (target === "article") await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    const round = new URL(request.url).searchParams.get("round");
    return Response.json({ feedback: await getFeedback(env, target, id, round || "latest") });
  } catch (error) {
    return authErrorResponse(error, "读取审稿反馈失败");
  }
}
