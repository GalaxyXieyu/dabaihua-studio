import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../../../../../lib/auth";
import { isValidBriefDate } from "../../../../../../../lib/daily-brief-core";
import { saveOutlineDraft } from "../../../../../../../lib/brief-pipeline";

type Params = { params: Promise<{ date: string; topicId: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Bearer `topk_…` key 或网站会话，admin only；不认助手 token。 */
async function authorize(request: Request, write: boolean): Promise<{ user: SessionUser } | Response> {
  const viaKey = await authenticateApiKey(env, request);
  if (viaKey.status === "ok") {
    if (viaKey.user.role !== "admin") return json({ error: "forbidden" }, 403);
    return { user: viaKey.user };
  }
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);
  if (write) {
    try {
      assertSameOrigin(request);
    } catch {
      return json({ error: "forbidden" }, 403);
    }
  }
  return { user };
}

/**
 * Yu 页面侧自动保存 outlineJson：只更新 JSON（rev 条件更新），保留 feedback，
 * 不动 Markdown、不发通知、不改 outline_by。
 */
export async function PUT(request: Request, { params }: Params) {
  const { date, topicId } = await params;
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;
  if (!isValidBriefDate(date)) return json({ error: "简报不存在" }, 404);
  if (!topicId) return json({ error: "topicId 不能为空" }, 400);

  const parsed = await request.json().catch(() => null);
  const body =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;

  const result = await saveOutlineDraft(env, {
    date,
    topicId,
    outlineJson: body ? body.outlineJson : undefined,
    baseRev: body ? body.baseRev : undefined,
  });
  if (!result.ok) {
    const errorBody: Record<string, unknown> = { error: result.error };
    if (result.field) errorBody.field = result.field;
    if (result.rev !== undefined) errorBody.rev = result.rev;
    return json(errorBody, result.status);
  }
  return json({ selection: result.selection });
}
