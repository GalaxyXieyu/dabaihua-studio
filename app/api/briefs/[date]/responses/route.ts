import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../../../lib/auth";
import { isValidBriefDate } from "../../../../../lib/daily-brief-core";
import { upsertResponse, type ResponsePatch } from "../../../../../lib/daily-brief";

type Params = { params: Promise<{ date: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Bearer `topk_…` key or website session, admin only. */
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

export async function POST(request: Request, { params }: Params) {
  const { date } = await params;
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;
  if (!isValidBriefDate(date)) return json({ error: "简报不存在" }, 404);

  const parsed = await request.json().catch(() => null);
  const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!body) return json({ error: "请求体不是合法 JSON" }, 400);

  const topicId = String(body.topicId ?? "").trim();
  if (!topicId) return json({ error: "topicId 不能为空" }, 400);

  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const patch: ResponsePatch = {};
  if (has("rating")) patch.rating = body.rating === null || body.rating === undefined ? null : Number(body.rating);
  if (has("ratingComment")) patch.ratingComment = String(body.ratingComment ?? "");
  if (has("decision")) patch.decision = body.decision === "pick" || body.decision === "reject" ? body.decision : null;
  if (has("rejectReason")) patch.rejectReason = String(body.rejectReason ?? "");
  if (has("scenarioIndex")) patch.scenarioIndex = body.scenarioIndex === null || body.scenarioIndex === undefined ? null : Number(body.scenarioIndex);
  if (has("scenarioCustom")) patch.scenarioCustom = String(body.scenarioCustom ?? "");
  if (has("answers")) patch.answers = Array.isArray(body.answers) ? body.answers.map((answer) => String(answer ?? "")) : [];

  try {
    const response = await upsertResponse(env, date, topicId, auth.user.id, patch);
    return json({ ok: true, response });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "保存失败" }, 400);
  }
}
