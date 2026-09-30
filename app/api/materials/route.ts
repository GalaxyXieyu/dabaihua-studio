import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../lib/auth";
import { findItemsByUrls, importTopicMaterials } from "../../../lib/store";
import { PayloadTooLargeError, readBodyWithLimit } from "../../../lib/weekly";

const MATERIALS_MAX_BYTES = 2 * 1024 * 1024;

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

/** Imports a batch of digest materials into the 「选题素材」 source. */
export async function POST(request: Request) {
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request, MATERIALS_MAX_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: "payload too large" }, 413);
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }

  const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  if (!body || !Array.isArray(body.items)) return json({ error: "body.items 必须是数组" }, 400);
  if (body.items.length > 200) return json({ error: "单次最多导入 200 条素材" }, 400);

  try {
    const result = await importTopicMaterials(env, body.items, {
      date: typeof body.date === "string" ? body.date : undefined,
      weak: body.weak === true,
    });
    return json({ ok: true, ...result }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "素材导入失败" }, 400);
  }
}

/** `GET /api/materials?url=…&url=…` → `{ items: [{ url, id }] }` for the CLI. */
export async function GET(request: Request) {
  const auth = await authorize(request, false);
  if (auth instanceof Response) return auth;
  const urls = new URL(request.url).searchParams.getAll("url");
  if (!urls.length) return json({ items: [] });
  const found = await findItemsByUrls(env, urls);
  const items = urls
    .map((url) => ({ url, id: found.get(url) }))
    .filter((item): item is { url: string; id: number } => typeof item.id === "number");
  return json({ items });
}
