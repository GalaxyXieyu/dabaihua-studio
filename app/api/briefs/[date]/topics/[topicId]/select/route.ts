import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../../../../../lib/auth";
import { isValidBriefDate } from "../../../../../../../lib/daily-brief-core";
import { selectBriefTopic, type SelectInput } from "../../../../../../../lib/brief-pipeline";
import { publicBaseUrl } from "../../../../../../../lib/weekly";

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

/** 「就写这个」：pick 回复 + 看板卡片（入选）+ select 通知。 */
export async function POST(request: Request, { params }: Params) {
  const { date, topicId } = await params;
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;
  if (!isValidBriefDate(date)) return json({ error: "简报不存在" }, 404);
  if (!topicId) return json({ error: "topicId 不能为空" }, 400);

  const parsed = await request.json().catch(() => null);
  const body =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!body) return json({ error: "请求体不是合法 JSON" }, 400);

  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const input: SelectInput = { date, topicId, userId: auth.user.id, baseUrl: publicBaseUrl(env, request) };
  if (has("scenarioIndex")) {
    input.scenarioIndex = body.scenarioIndex === null || body.scenarioIndex === undefined ? null : Number(body.scenarioIndex);
  }
  if (has("scenarioCustom")) input.scenarioCustom = String(body.scenarioCustom ?? "");
  if (has("answers")) input.answers = Array.isArray(body.answers) ? body.answers.map((answer) => String(answer ?? "")) : [];

  const result = await selectBriefTopic(env, input);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ selection: result.selection, response: result.response, notify: result.notify });
}
