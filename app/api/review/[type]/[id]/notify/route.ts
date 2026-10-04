import { env } from "cloudflare:workers";
import { assertSameOrigin, authErrorResponse, AuthError, requireSessionUser } from "../../../../../../lib/auth";
import { requireArticleRead } from "../../../../../../lib/article-access";
import { parseTargetType } from "../../../../../../lib/article-review";
import { notifyArticleReview } from "../../../../../../lib/review-notify";
import { publicBaseUrl } from "../../../../../../lib/weekly";
import { ensureSchema } from "../../../../../../lib/store";

type Params = { params: Promise<{ type: string; id: string }> };

/**
 * 重发某轮审稿的助手通知（仅文章所有者会话；设计 §4）。
 *
 * body `{ round? }`：缺省取最新已提交轮；那一轮 / 文章不存在 → 404。
 */
export async function POST(request: Request, { params }: Params) {
  try {
    await ensureSchema(env.DB);
    assertSameOrigin(request);
    const user = await requireSessionUser(env, request);
    const { type, id } = await params;
    const target = parseTargetType(type);
    if (target !== "article") throw new AuthError("只有文章审稿支持通知", 404);
    await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    let body: { round?: unknown } = {};
    try {
      body = (await request.json()) as { round?: unknown } ?? {};
    } catch {
      body = {};
    }
    const round = body.round;
    if (round !== undefined && round !== null && round !== "") {
      const value = Number(round);
      if (!Number.isInteger(value) || value < 1) throw new AuthError("轮次不合法", 400);
    }
    const notify = await notifyArticleReview(env, {
      slug: id,
      round: round === undefined || round === null || round === "" ? null : Number(round),
      origin: publicBaseUrl(env, request),
    });
    if (!notify) return Response.json({ error: "还没有已提交的审稿轮次" }, { status: 404 });
    return Response.json({ notify });
  } catch (error) {
    return authErrorResponse(error, "重发审稿通知失败");
  }
}
