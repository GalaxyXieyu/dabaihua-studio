/**
 * /api/<name>/data 的共享请求处理器。
 *
 * 路由薄壳只负责把 env 接进来；认证判定放在纯函数
 * `lib/private-data.ts` 的 decideDatasetAuth 里，便于测试。
 * 注意：这里刻意不复用 app/api/_access.ts 的 requireImportAccess，
 * 因为它带 localhost 免鉴权旁路，不适合写私密数据。
 */

import { assertSameOrigin, authenticateApiKey, getSessionUser } from "./auth.ts";
import { ensureSchema } from "./store.ts";
import {
  DATASET_LIMITS,
  decideDatasetAuth,
  handleDatasetPut,
  readDatasetMeta,
  type DatasetName,
  type DatasetAuthUser,
} from "./private-data.ts";

type DatasetApiEnv = { DB: D1Database; IMPORT_TOKEN?: string };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/**
 * 提前拒绝时把没读的请求体丢掉。本地/Aries 上跑的是 wrangler dev（workerd），
 * 带着大请求体被拒的请求如果不消费 body，下一个请求会卡住几十秒。
 */
async function discardBody(request: Request, limit: number) {
  try {
    if (!request.body) return;
    // cancel() 在 workerd 里不够：连接上的剩余字节仍会挡住下一个请求，所以读完再丢；
    // 声明超过上限（或没声明长度）的只 cancel，不替对方读大包。
    const declared = Number(request.headers.get("content-length") || "NaN");
    if (Number.isFinite(declared) && declared <= limit) await request.arrayBuffer();
    else await request.body.cancel();
  } catch {
    // ignore
  }
}

function sameOrigin(request: Request): boolean {
  try {
    assertSameOrigin(request);
    return true;
  } catch {
    return false;
  }
}

export async function handleDatasetRequest(request: Request, env: DatasetApiEnv, name: DatasetName): Promise<Response> {
  await ensureSchema(env.DB);
  const method = request.method.toUpperCase();

  const viaKey = await authenticateApiKey(env, request);
  const apiKeyUser: DatasetAuthUser = viaKey.status === "ok"
    ? { account: viaKey.user.account, role: viaKey.user.role }
    : null;
  let sessionUser: DatasetAuthUser = null;
  if (!apiKeyUser) {
    const user = await getSessionUser(env, request);
    if (user) sessionUser = { account: user.account, role: user.role };
  }

  const decision = decideDatasetAuth({
    importToken: env.IMPORT_TOKEN,
    providedToken: request.headers.get("x-import-token") || "",
    apiKeyUser,
    sessionUser,
    sameOrigin: sameOrigin(request),
    method,
  });
  if (!decision.ok) {
    await discardBody(request, DATASET_LIMITS[name]);
    return json({ error: decision.error, code: decision.code }, decision.status);
  }

  if (method === "GET") {
    const meta = await readDatasetMeta(env.DB, name);
    if (!meta) return json({ error: "not_found", code: "not_found" }, 404);
    return json(meta, 200);
  }
  if (method !== "PUT") {
    await discardBody(request, DATASET_LIMITS[name]);
    return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405);
  }

  const limit = DATASET_LIMITS[name];
  const declared = request.headers.get("content-length") || "";
  if (/^\d+$/.test(declared) && Number(declared) > limit) {
    await discardBody(request, DATASET_LIMITS[name]);
    return json({ error: "too large", code: "too_large" }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > limit) {
    return json({ error: "too large", code: "too_large" }, 413);
  }

  const result = await handleDatasetPut({ db: env.DB, name, rawBody, actor: decision.actor, now: new Date().toISOString() });
  return json(result.body, result.status);
}
