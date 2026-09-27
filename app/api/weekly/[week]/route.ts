import { env } from "cloudflare:workers";
import { authenticateApiKey } from "../../../../lib/auth";
import {
  MAX_WEEKLY_BYTES,
  PayloadTooLargeError,
  checkWeeklyUploadRate,
  deleteWeeklyReport,
  discardBody,
  getWeeklyReportMeta,
  isValidIsoWeek,
  publicBaseUrl,
  putWeeklyReport,
  readBodyWithLimit,
  recordWeeklyUpload,
} from "../../../../lib/weekly";

type Params = { params: Promise<{ week: string }> };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function unauthorized(error: string) {
  return json({ error }, 401);
}

function authError(status: "missing" | "malformed" | "invalid") {
  return unauthorized(status === "invalid" ? "invalid key" : "unauthorized");
}

/**
 * Runs a route handler and guarantees the request body is drained before the
 * response is returned whenever the handler did not read it. Wrangler's dev
 * proxy stalls the next request (or restarts the worker mid-request) when a
 * response is written while an upload is still unconsumed. `discardBody` is a
 * no-op on a body that was already read, and unexpected throws become the
 * catch-all 500 here so they cannot skip the drain either.
 */
async function withDrainedBody(
  request: Request,
  handler: (markBodyConsumed: () => void) => Promise<Response>,
): Promise<Response> {
  let consumed = false;
  const markBodyConsumed = () => {
    consumed = true;
  };
  let response: Response;
  try {
    response = await handler(markBodyConsumed);
  } catch {
    if (!consumed) await discardBody(request);
    return json({ error: "internal error" }, 500);
  }
  if (!consumed) await discardBody(request);
  return response;
}

export async function PUT(request: Request, { params }: Params) {
  return withDrainedBody(request, async (markBodyConsumed) => {
    const { week } = await params;
    if (!isValidIsoWeek(week)) return json({ error: "bad week" }, 400);

    const auth = await authenticateApiKey(env, request);
    if (auth.status !== "ok") return authError(auth.status);

    const contentType = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "text/html") return json({ error: "unsupported media type" }, 415);

    let bytes: Uint8Array;
    try {
      bytes = await readBodyWithLimit(request, MAX_WEEKLY_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return json({ error: "payload too large" }, 413);
      throw error;
    }
    markBodyConsumed();

    const existing = await getWeeklyReportMeta(env, week);
    if (existing && existing.userId !== auth.user.id && auth.user.role !== "admin") return json({ error: "forbidden" }, 403);

    if (!(await checkWeeklyUploadRate(env, auth.user.id))) return json({ error: "rate limited" }, 429);

    const result = await putWeeklyReport(env, week, auth.user.id, bytes);
    await recordWeeklyUpload(env, auth.user.id);
    const base = publicBaseUrl(env, request);
    return json(
      { url: `${base}/weekly/${week}/`, week, bytes: result.bytes, updated_at: result.updatedAt },
      result.created ? 201 : 200,
    );
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withDrainedBody(request, async () => {
    const { week } = await params;
    if (!isValidIsoWeek(week)) return json({ error: "bad week" }, 400);

    const auth = await authenticateApiKey(env, request);
    if (auth.status !== "ok") return authError(auth.status);

    const existing = await getWeeklyReportMeta(env, week);
    if (!existing) return json({ error: "not found" }, 404);
    if (existing.userId !== auth.user.id && auth.user.role !== "admin") return json({ error: "forbidden" }, 403);

    await deleteWeeklyReport(env, week);
    return json({ ok: true }, 200);
  });
}

async function methodNotAllowed(request: Request) {
  return withDrainedBody(request, async () =>
    Response.json({ error: "method not allowed" }, { status: 405, headers: { allow: "PUT, DELETE", "cache-control": "no-store" } }),
  );
}

export async function GET(request: Request) {
  return methodNotAllowed(request);
}

export async function POST(request: Request) {
  return methodNotAllowed(request);
}

export async function PATCH(request: Request) {
  return methodNotAllowed(request);
}
