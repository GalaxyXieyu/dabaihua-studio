import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../../lib/auth";
import { BRIEF_MAX_BYTES, isValidBriefDate, validateBrief } from "../../../../lib/daily-brief-core";
import { countResponses, getBrief, listResponses, upsertBrief } from "../../../../lib/daily-brief";
import { PayloadTooLargeError, publicBaseUrl, readBodyWithLimit } from "../../../../lib/weekly";

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

export async function PUT(request: Request, { params }: Params) {
  const { date } = await params;
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;
  if (!isValidBriefDate(date)) return json({ error: "invalid brief", errors: ["路径日期不合法"] }, 400);

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request, BRIEF_MAX_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: "payload too large" }, 413);
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: "invalid brief", errors: ["请求体不是合法 JSON"] }, 400);
  }

  const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!body || String(body.date ?? "").trim() !== date) {
    return json({ error: "invalid brief", errors: ["body.date 必须等于路径日期"] }, 400);
  }

  const result = validateBrief(body);
  if (!result.ok) return json({ error: "invalid brief", errors: result.errors }, 400);

  const { created } = await upsertBrief(env, result.brief, auth.user.id);
  const responsesKept = await countResponses(env, date);
  const base = publicBaseUrl(env, request);
  return json(
    {
      ok: true,
      date,
      created,
      topicCount: result.brief.topics.length,
      url: `${base}/topics/daily?date=${date}`,
      responsesKept,
    },
    200,
  );
}

export async function GET(request: Request, { params }: Params) {
  const auth = await authorize(request, false);
  if (auth instanceof Response) return auth;
  const { date } = await params;
  if (!isValidBriefDate(date)) return json({ error: "not found" }, 404);
  const stored = await getBrief(env, date);
  if (!stored) return json({ error: "not found" }, 404);
  const responses = await listResponses(env, { date });
  return json({ brief: stored.brief, responses, updatedAt: stored.updatedAt });
}
