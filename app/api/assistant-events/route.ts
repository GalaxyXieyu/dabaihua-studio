// GET /api/assistant-events — 漏收 webhook 时的事件日志兜底拉取（只读）。
//
// 认证与 briefs/responses 相同：助手 token（DABAIHUA_CARDS_ASSISTANT_TOKEN，未配置
// 不启用）只读；Bearer topk_* key 或网站会话必须 admin。没有 POST：日志只能由
// sendAssistantEvent 写。响应不含 webhook URL / secret（表里也只有 target_host）。

import { env } from "cloudflare:workers";
import { authenticateApiKey, getSessionUser } from "../../../lib/auth";
import { bearerToken, sameSecret } from "../../../lib/assistant-auth";
import { listAssistantEventLog } from "../../../lib/assistant-event-log";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** 助手 token 只读；Bearer `topk_…` key 或网站会话仍需 admin。 */
async function authorizeRead(request: Request): Promise<Response | null> {
  // 助手 token（DABAIHUA_CARDS_ASSISTANT_TOKEN）：只读，未配置时不启用。
  const token = bearerToken(request);
  const assistantToken = (env.DABAIHUA_CARDS_ASSISTANT_TOKEN || "").trim();
  if (token && assistantToken && sameSecret(token, assistantToken)) return null;

  const viaKey = await authenticateApiKey(env, request);
  if (viaKey.status === "ok") {
    if (viaKey.user.role !== "admin") return json({ error: "forbidden" }, 403);
    return null;
  }
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);
  return null;
}

export async function GET(request: Request) {
  const denied = await authorizeRead(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const afterIdRaw = (url.searchParams.get("afterId") || "").trim();
  const sinceRaw = (url.searchParams.get("since") || "").trim();
  const keyRaw = (url.searchParams.get("key") || "").trim();
  const limitRaw = (url.searchParams.get("limit") || "").trim();

  let afterId = 0;
  if (afterIdRaw) {
    if (!/^\d+$/.test(afterIdRaw)) return json({ error: "invalid afterId" }, 400);
    afterId = Number(afterIdRaw);
  }
  if (sinceRaw && Number.isNaN(Date.parse(sinceRaw))) return json({ error: "invalid since" }, 400);
  let limit = 50;
  if (limitRaw) {
    if (!/^\d+$/.test(limitRaw)) return json({ error: "invalid limit" }, 400);
    limit = Number(limitRaw);
    if (limit < 1 || limit > 200) return json({ error: "invalid limit" }, 400);
  }
  const keys = keyRaw ? keyRaw.split(",").map((item) => item.trim()).filter(Boolean) : [];

  const page = await listAssistantEventLog(env.DB, {
    afterId,
    since: sinceRaw || undefined,
    keys: keys.length ? keys : undefined,
    limit,
  });
  return json(page);
}
