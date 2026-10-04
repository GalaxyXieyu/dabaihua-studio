import { env } from "cloudflare:workers";
import { assertSameOrigin, authErrorResponse, requireSessionUser } from "../../../../../../lib/auth";
import { requireArticleRead } from "../../../../../../lib/article-access";
import { parseTargetType, submitReview } from "../../../../../../lib/article-review";
import { notifyArticleReview, type ReviewNotifyResult } from "../../../../../../lib/review-notify";
import { publicBaseUrl } from "../../../../../../lib/weekly";

type Params = { params: Promise<{ type: string; id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const user = await requireSessionUser(env, request);
    const { type, id } = await params;
    const target = parseTargetType(type);
    if (target === "article") await requireArticleRead(env.DB, id, { id: user.id, role: user.role });
    const body = await request.json() as { verdict?: unknown; comment?: unknown; handoff?: unknown };
    const result = await submitReview(env, user, target, id, body);
    // 审稿写库成功后发助手通知（article.review_submitted）；topic 在注册表里
    // disabled，不发。通知永不抛出，失败只记录进响应的 notify 字段。
    let notify: ReviewNotifyResult | null = null;
    if (target === "article") {
      try {
        notify = await notifyArticleReview(env, {
          slug: id,
          round: result.round,
          origin: publicBaseUrl(env, request),
        });
      } catch {
        notify = null;
      }
    }
    return Response.json({ ...result, notify });
  } catch (error) {
    return authErrorResponse(error, "提交审稿失败");
  }
}
