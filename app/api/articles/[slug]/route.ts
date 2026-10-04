import { env } from "cloudflare:workers";
import {
  assertSameOrigin,
  authenticateApiKey,
  authErrorResponse,
  AuthError,
  getSessionUser,
} from "../../../../lib/auth";
import { canReadArticle, isArticleOwner, setArticlePublicForViewer, ArticleAccessError } from "../../../../lib/article-access";
import { getArticle } from "../../../../lib/article-review";
import { d1ArticleAssetStore } from "../../../../lib/article-assets";
import { handleArticlePut, parseAssistantName, resolveArticlesOwnerId } from "../../../../lib/article-push";
import { bearerToken, sameSecret } from "../../../../lib/assistant-auth";
import { ensureSchema } from "../../../../lib/store";
import { PayloadTooLargeError, readBodyWithLimit } from "../../../../lib/weekly";

type Params = { params: Promise<{ slug: string }> };

const NO_STORE = { "cache-control": "no-store" };
const MAX_BODY_BYTES = 32 * 1024 * 1024;

function jsonError(status: number, error: string, code: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, code, ...extra }, { status, headers: NO_STORE });
}

function viewerOf(user: { id: number; role: "user" | "admin" } | null) {
  return user ? { id: user.id, role: user.role } : null;
}

/** 读请求体（≤ 32MB）并解析 JSON，失败时返回错误 Response。 */
async function readJsonBody(request: Request): Promise<{ body: unknown } | Response> {
  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(413, "请求体最多 32MB", "too_large");
    throw error;
  }
  try {
    return { body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return jsonError(400, "请求体不是合法 JSON", "invalid");
  }
}

export async function GET(request: Request, { params }: Params) {
  try {
    await ensureSchema(env.DB);
    const { slug } = await params;
    const user = await getSessionUser(env, request);
    const viewer = viewerOf(user);
    const article = await getArticle(env, slug);
    if (!article || !canReadArticle(article, viewer)) return Response.json({ error: "文章不存在" }, { status: 404 });
    const payload = isArticleOwner(article, viewer) ? article : { ...article, metaJson: "{}", qaReport: "", draftMd: "" };
    return Response.json({ article: payload });
  } catch (error) {
    return authErrorResponse(error, "读取文章失败");
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    await ensureSchema(env.DB);
    const { slug } = await params;

    // 助手 token（与卡片 / 简报管线共用）：作者固定为文章归属账号，只能写草稿。
    // GET / PATCH 不接受助手 token，只有这里开了口子。
    const assistantToken = (env.DABAIHUA_CARDS_ASSISTANT_TOKEN || "").trim();
    const token = bearerToken(request);
    if (token && assistantToken && sameSecret(token, assistantToken)) {
      const parsed = await readJsonBody(request);
      if (parsed instanceof Response) return parsed;
      const assistant = parseAssistantName(parsed.body);
      if (assistant === null) return jsonError(422, "助手推送必须带 assistant 名字", "assistant_required");
      const ownerId = await resolveArticlesOwnerId(env.DB, env.ARTICLES_OWNER_ACCOUNT);
      if (ownerId === null) return jsonError(503, "文章归属账号不可用", "owner_unavailable");
      const result = await handleArticlePut({
        db: env.DB,
        assets: d1ArticleAssetStore(env.DB),
        viewer: { id: ownerId, role: "admin" },
        slug,
        body: parsed.body,
        now: new Date().toISOString(),
        assistant,
      });
      return Response.json(result.json, { status: result.status, headers: NO_STORE });
    }

    const viaKey = await authenticateApiKey(env, request);
    let viewer: { id: number; role: "user" | "admin" } | null = null;
    if (viaKey.status === "ok") {
      viewer = { id: viaKey.user.id, role: viaKey.user.role };
    } else if (viaKey.status === "malformed" || viaKey.status === "invalid") {
      return jsonError(401, "API Key 无效", "unauthorized");
    } else {
      const sessionUser = await getSessionUser(env, request);
      if (!sessionUser) return jsonError(401, "请先登录后再继续", "unauthorized");
      try {
        assertSameOrigin(request);
      } catch {
        return jsonError(403, "跨站请求被拒绝", "forbidden");
      }
      viewer = { id: sessionUser.id, role: sessionUser.role };
    }

    const parsed = await readJsonBody(request);
    if (parsed instanceof Response) return parsed;

    const result = await handleArticlePut({
      db: env.DB,
      assets: d1ArticleAssetStore(env.DB),
      viewer,
      slug,
      body: parsed.body,
      now: new Date().toISOString(),
    });
    return Response.json(result.json, { status: result.status, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ArticleAccessError) return jsonError(error.status, error.message, "not_found");
    return authErrorResponse(error, "推送文章失败");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    await ensureSchema(env.DB);
    assertSameOrigin(request);
    const user = await getSessionUser(env, request);
    if (!user) throw new AuthError("请先登录后再继续", 401);
    const { slug } = await params;
    const body = (await request.json()) as { isPublic?: unknown };
    if (typeof body.isPublic !== "boolean") throw new AuthError("公开状态不合法", 400);
    const result = await setArticlePublicForViewer(env.DB, { id: user.id, role: user.role }, slug, body.isPublic);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ArticleAccessError) return Response.json({ error: error.message }, { status: error.status });
    return authErrorResponse(error, "更新文章失败");
  }
}
