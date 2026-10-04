import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../../lib/auth";
import { bearerToken, sameSecret } from "../../../../lib/assistant-auth";
import { getLatestBriefDate, listResponses, type ResponseQuery } from "../../../../lib/daily-brief";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

type Actor = { kind: "user"; user: SessionUser } | { kind: "assistant" };

/** 助手 token 只读；Bearer `topk_…` key 或网站会话仍需 admin。 */
async function authorize(request: Request, write: boolean): Promise<Actor | Response> {
  // 助手 token（DABAIHUA_CARDS_ASSISTANT_TOKEN）：只读，未配置时不启用。
  if (!write) {
    const token = bearerToken(request);
    const assistantToken = (env.DABAIHUA_CARDS_ASSISTANT_TOKEN || "").trim();
    if (token && assistantToken && sameSecret(token, assistantToken)) {
      return { kind: "assistant" };
    }
  }
  const viaKey = await authenticateApiKey(env, request);
  if (viaKey.status === "ok") {
    if (viaKey.user.role !== "admin") return json({ error: "forbidden" }, 403);
    return { kind: "user", user: viaKey.user };
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
  return { kind: "user", user };
}

export async function GET(request: Request) {
  const auth = await authorize(request, false);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const date = (url.searchParams.get("date") || "").trim();
  const since = (url.searchParams.get("since") || "").trim();
  let query: ResponseQuery;
  let latestDate: string | null = null;
  if (date) {
    query = { date };
  } else if (since) {
    query = { since };
  } else {
    // Resolve the latest date up front so the echoed query says which day
    // `latest` pointed at (null when no brief exists yet).
    latestDate = await getLatestBriefDate(env);
    query = { latest: true };
  }

  const responses = await listResponses(env, query);
  const picks = responses.filter((response) => response.decision === "pick");
  return json({
    query: date ? { date } : since ? { since } : { latest: true, date: latestDate },
    generatedAt: new Date().toISOString(),
    responses,
    picks,
  });
}
