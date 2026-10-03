import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../../../../../lib/auth";
import { isValidBriefDate } from "../../../../../../../lib/daily-brief-core";
import { confirmBriefOutline } from "../../../../../../../lib/brief-pipeline";
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

/** 确认大纲（仅 outline_pending 且大纲非空）→ drafting + confirm_outline 通知。 */
export async function POST(request: Request, { params }: Params) {
  const { date, topicId } = await params;
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;
  if (!isValidBriefDate(date)) return json({ error: "简报不存在" }, 404);
  if (!topicId) return json({ error: "topicId 不能为空" }, 400);

  const result = await confirmBriefOutline(env, { date, topicId, baseUrl: publicBaseUrl(env, request) });
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ selection: result.selection, notify: result.notify });
}
