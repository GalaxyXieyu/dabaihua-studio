import { env } from "cloudflare:workers";
import { authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { requireArticleRead } from "../../../../../../lib/article-access";
import { listRounds, parseTargetType } from "../../../../../../lib/article-review";
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
        return Response.json({ rounds: await listRounds(env, target, id) });
      }
    }
    const user = await requireSessionUser(env, request);
    if (target === "article") await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    return Response.json({ rounds: await listRounds(env, target, id) });
  } catch (error) {
    return authErrorResponse(error, "读取审稿轮次失败");
  }
}
