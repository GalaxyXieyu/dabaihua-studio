import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../../../../../lib/auth";
import { isValidBriefDate } from "../../../../../../../lib/daily-brief-core";
import { getResponse } from "../../../../../../../lib/daily-brief";
import { getSelection, updateBriefPipeline } from "../../../../../../../lib/brief-pipeline";

type Params = { params: Promise<{ date: string; topicId: string }> };

type Actor = { kind: "assistant"; name: string } | { kind: "admin"; user: SessionUser };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function bearerToken(request: Request): string {
  const matched = /^Bearer\s+(.+)$/.exec((request.headers.get("authorization") || "").trim());
  return matched ? matched[1] : "";
}

/** 恒定时间比较，避免按字符提前返回泄漏 token。 */
function sameSecret(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/**
 * 助手 Bearer token（与卡片助手共用）或 admin（topk_ key / 会话）。
 * 助手名字只在写请求里要求，且最多 20 字。
 */
async function authorize(
  request: Request,
  write: boolean,
  body: Record<string, unknown> | null,
): Promise<Actor | Response> {
  const token = bearerToken(request);
  const assistantToken = (env.DABAIHUA_CARDS_ASSISTANT_TOKEN || "").trim();
  if (token && assistantToken && sameSecret(token, assistantToken)) {
    if (!write) return { kind: "assistant", name: "助手" };
    const name = body && typeof body.assistant === "string" ? body.assistant.trim() : "";
    if (!name || name.length > 20) return json({ error: "assistant_required" }, 422);
    return { kind: "assistant", name };
  }

  const viaKey = await authenticateApiKey(env, request);
  if (viaKey.status === "ok") {
    if (viaKey.user.role !== "admin") return json({ error: "forbidden" }, 403);
    return { kind: "admin", user: viaKey.user };
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
  return { kind: "admin", user };
}

/** 读取管线状态（助手 token 或 admin 都可以）。 */
export async function GET(request: Request, { params }: Params) {
  const { date, topicId } = await params;
  const auth = await authorize(request, false, null);
  if (auth instanceof Response) return auth;
  if (!isValidBriefDate(date)) return json({ error: "简报不存在" }, 404);
  if (!topicId) return json({ error: "topicId 不能为空" }, 400);
  const selection = await getSelection(env, date, topicId);
  if (!selection) return json({ selection: null });
  const response = selection.selectedBy === null ? null : await getResponse(env, date, topicId, selection.selectedBy);
  return json({ selection, response });
}

/** 助手写回：只允许改 status / outline；规则见 assistantStatusRule。 */
export async function PATCH(request: Request, { params }: Params) {
  const { date, topicId } = await params;
  const parsed = await request.json().catch(() => null);
  const body =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (parsed !== null && body === null) return json({ error: "请求体不是合法 JSON" }, 400);

  const auth = await authorize(request, true, body);
  if (auth instanceof Response) return auth;
  if (!isValidBriefDate(date)) return json({ error: "简报不存在" }, 404);
  if (!topicId) return json({ error: "topicId 不能为空" }, 400);

  const result = await updateBriefPipeline(env, {
    date,
    topicId,
    actorName: auth.kind === "assistant" ? auth.name : "Yu",
    status: body ? body.status : undefined,
    outline: body ? body.outline : undefined,
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
