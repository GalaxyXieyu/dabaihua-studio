/**
 * /api/cards 请求处理器。
 *
 * 在 node 测试里可以直接用真实 Request 调用，不依赖 cloudflare:workers。
 * 路由薄壳（app/api/cards/**）只负责 env 接线和 ensureSchema。
 */

import { can, type CardActor } from "./cards-core.ts";
import {
  CardConflictError,
  CardForbiddenError,
  CardNotFoundError,
  CardValidationError,
  confirmCard,
  createCard,
  deleteCard,
  expireCard,
  getCard,
  listCards,
  listHistory,
  rejectCard,
  restoreCard,
  supersedeCard,
  updateCard,
} from "./cards.ts";

export type CardsApiDeps = {
  db: D1Database;
  assistantToken?: string;
  resolveAdmin: (request: Request) => Promise<{ name: string } | null>;
  checkSameOrigin: (request: Request) => boolean;
};

const MAX_BODY_BYTES = 64 * 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function sameSecret(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function bearerToken(request: Request): string {
  const matched = /^Bearer\s+(.+)$/.exec((request.headers.get("authorization") || "").trim());
  return matched ? matched[1] : "";
}

async function readBody(request: Request): Promise<{ body: Record<string, unknown> } | Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "request too large" }, 400);
  if (text.trim() === "") return { body: {} };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid json" }, 400);
    return { body: parsed as Record<string, unknown> };
  } catch {
    return json({ error: "invalid json" }, 400);
  }
}

function assistantName(body: Record<string, unknown>): string {
  const addedBy = typeof body.added_by === "string" ? body.added_by.trim() : "";
  if (addedBy) return addedBy;
  const sources = Array.isArray(body.sources) ? body.sources : [];
  const first = sources[0];
  if (first && typeof first === "object") {
    const agent = (first as Record<string, unknown>).agent;
    if (typeof agent === "string" && agent.trim()) return agent.trim();
  }
  return "助手";
}

function expectedVersionOf(body: Record<string, unknown>, url: URL): number | null {
  const fromQuery = url.searchParams.get("expectedVersion");
  const raw = body.expectedVersion !== undefined ? body.expectedVersion : fromQuery;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return Number.isInteger(value) ? (value as number) : null;
}

export async function handleCardsRequest(request: Request, deps: CardsApiDeps): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "api" || parts[1] !== "cards") return json({ error: "not found" }, 404);

  const method = request.method.toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const authHeader = (request.headers.get("authorization") || "").trim();
  const hasBearer = /^Bearer\s+/.test(authHeader);

  let body: Record<string, unknown> = {};
  if (isWrite) {
    const parsed = await readBody(request);
    if (parsed instanceof Response) return parsed;
    body = parsed.body;
  }

  // 身份解析：助手 Bearer token 优先，其次 admin（topk_ key 或会话）。
  let actor: CardActor | null = null;
  const token = bearerToken(request);
  if (token && deps.assistantToken && sameSecret(token, deps.assistantToken)) {
    actor = { type: "assistant", name: assistantName(body) };
  } else {
    const admin = await deps.resolveAdmin(request);
    if (admin) actor = { type: "owner", name: admin.name || "Yu" };
  }
  if (!actor) return json({ error: "unauthorized" }, 401);

  // 会话（非 Bearer）写请求要求同源。
  if (isWrite && !hasBearer && !deps.checkSameOrigin(request)) return json({ error: "forbidden" }, 403);

  try {
    return await dispatch(request, deps, { url, method, parts, body, actor });
  } catch (error) {
    if (error instanceof CardNotFoundError) return json({ error: "not found" }, 404);
    if (error instanceof CardConflictError) return json({ error: "version conflict", current: error.current }, 409);
    if (error instanceof CardValidationError) return json({ error: "validation failed", errors: error.errors }, 400);
    if (error instanceof CardForbiddenError) return json({ error: error.message }, 403);
    console.error("cards api error", error);
    return json({ error: "internal error" }, 500);
  }
}

async function dispatch(
  request: Request,
  deps: CardsApiDeps,
  context: {
    url: URL;
    method: string;
    parts: string[];
    body: Record<string, unknown>;
    actor: CardActor;
  },
): Promise<Response> {
  const { url, method, parts, body, actor } = context;
  const rest = parts.slice(2);

  if (rest.length === 0) {
    if (method === "GET") return listAction(deps, url, actor);
    if (method === "POST") return createAction(deps, body, actor);
    return json({ error: "not found" }, 404);
  }

  const id = decodeURIComponent(rest[0]);

  if (rest.length === 1) {
    if (method === "GET") return getAction(deps, id, actor);
    if (method === "PATCH") return editAction(deps, id, body, url, actor);
    if (method === "DELETE") return deleteAction(deps, id, body, url, actor);
    return json({ error: "not found" }, 404);
  }

  if (rest.length === 2) {
    const action = rest[1];
    if (method === "GET" && action === "history") {
      if (!can(actor, "history")) return json({ error: "forbidden" }, 403);
      return json({ history: await listHistory(deps.db, id) });
    }
    if (method === "POST") {
      if (action === "supersede") return supersedeAction(deps, id, body, url, actor);
      if (action === "expire") return expireAction(deps, id, body, url, actor);
      if (action === "restore") return restoreAction(deps, id, body, url, actor);
      if (action === "confirm") return confirmAction(deps, id, body, url, actor);
      if (action === "reject") return rejectAction(deps, id, body, url, actor);
    }
    return json({ error: "not found" }, 404);
  }

  return json({ error: "not found" }, 404);
}

async function listAction(deps: CardsApiDeps, url: URL, actor: CardActor): Promise<Response> {
  if (!can(actor, "list")) return json({ error: "forbidden" }, 403);
  const cards = await listCards(deps.db, {
    kind: url.searchParams.get("kind") || "mirror",
    category: url.searchParams.get("category") || undefined,
    status: url.searchParams.get("status") || undefined,
    deleted: url.searchParams.get("deleted") === "1",
  });
  return json({ cards });
}

async function getAction(deps: CardsApiDeps, id: string, actor: CardActor): Promise<Response> {
  if (!can(actor, "get")) return json({ error: "forbidden" }, 403);
  const card = await getCard(deps.db, id);
  if (!card) return json({ error: "not found" }, 404);
  return json({ card, revisions: await listHistory(deps.db, id) });
}

async function createAction(deps: CardsApiDeps, body: Record<string, unknown>, actor: CardActor): Promise<Response> {
  if (!can(actor, "create")) return json({ error: "forbidden" }, 403);
  if (actor.type === "assistant") {
    const requested = typeof body.status === "string" ? body.status.trim() : "";
    if (requested && requested !== "待确认") return json({ error: "助手只能新增待确认的卡" }, 403);
  }
  const result = await createCard(deps.db, body as never, actor);
  return json(result, 201);
}

async function editAction(
  deps: CardsApiDeps,
  id: string,
  body: Record<string, unknown>,
  url: URL,
  actor: CardActor,
): Promise<Response> {
  if (!can(actor, "edit")) return json({ error: "forbidden" }, 403);
  const expectedVersion = expectedVersionOf(body, url);
  if (expectedVersion === null) return json({ error: "expectedVersion 必填" }, 400);
  return json(await updateCard(deps.db, id, body as never, expectedVersion, actor));
}

async function supersedeAction(
  deps: CardsApiDeps,
  id: string,
  body: Record<string, unknown>,
  url: URL,
  actor: CardActor,
): Promise<Response> {
  if (!can(actor, "supersede")) return json({ error: "forbidden" }, 403);
  const expectedVersion = expectedVersionOf(body, url);
  if (expectedVersion === null) return json({ error: "expectedVersion 必填" }, 400);
  return json(await supersedeCard(deps.db, id, body as never, expectedVersion, actor), 201);
}

async function expireAction(
  deps: CardsApiDeps,
  id: string,
  body: Record<string, unknown>,
  url: URL,
  actor: CardActor,
): Promise<Response> {
  if (!can(actor, "expire")) return json({ error: "forbidden" }, 403);
  const expectedVersion = expectedVersionOf(body, url);
  if (expectedVersion === null) return json({ error: "expectedVersion 必填" }, 400);
  const reason = typeof body.reason === "string" ? body.reason : "";
  return json(await expireCard(deps.db, id, expectedVersion, reason, actor));
}

async function deleteAction(
  deps: CardsApiDeps,
  id: string,
  body: Record<string, unknown>,
  url: URL,
  actor: CardActor,
): Promise<Response> {
  if (!can(actor, "delete")) return json({ error: "forbidden" }, 403);
  const expectedVersion = expectedVersionOf(body, url);
  if (expectedVersion === null) return json({ error: "expectedVersion 必填" }, 400);
  const reason = typeof body.reason === "string" ? body.reason : "";
  return json(await deleteCard(deps.db, id, expectedVersion, reason, actor));
}

async function restoreAction(
  deps: CardsApiDeps,
  id: string,
  body: Record<string, unknown>,
  url: URL,
  actor: CardActor,
): Promise<Response> {
  if (!can(actor, "restore")) return json({ error: "forbidden" }, 403);
  const expectedVersion = expectedVersionOf(body, url);
  if (expectedVersion === null) return json({ error: "expectedVersion 必填" }, 400);
  return json(await restoreCard(deps.db, id, expectedVersion, actor));
}

async function confirmAction(
  deps: CardsApiDeps,
  id: string,
  body: Record<string, unknown>,
  url: URL,
  actor: CardActor,
): Promise<Response> {
  if (!can(actor, "confirm")) return json({ error: "forbidden" }, 403);
  const expectedVersion = expectedVersionOf(body, url);
  if (expectedVersion === null) return json({ error: "expectedVersion 必填" }, 400);
  return json(await confirmCard(deps.db, id, expectedVersion, actor));
}

async function rejectAction(
  deps: CardsApiDeps,
  id: string,
  body: Record<string, unknown>,
  url: URL,
  actor: CardActor,
): Promise<Response> {
  if (!can(actor, "reject")) return json({ error: "forbidden" }, 403);
  const expectedVersion = expectedVersionOf(body, url);
  if (expectedVersion === null) return json({ error: "expectedVersion 必填" }, 400);
  const reason = typeof body.reason === "string" ? body.reason : "";
  return json(await rejectCard(deps.db, id, expectedVersion, reason, actor));
}
