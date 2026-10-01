/**
 * /api/cards 的鉴权接线（route 薄壳专用，不参与 node 测试）。
 *
 * - resolveAdmin：`topk_` Bearer 或网站会话，只认 admin。
 * - checkSameOrigin：会话写请求的同源检查，捕获 AuthError 返回布尔。
 */

import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser } from "./auth";

export async function resolveAdmin(request: Request): Promise<{ name: string } | null> {
  const viaKey = await authenticateApiKey(env, request);
  if (viaKey.status === "ok") return viaKey.user.role === "admin" ? { name: "Yu" } : null;
  const user = await getSessionUser(env, request);
  if (user && user.role === "admin") return { name: "Yu" };
  return null;
}

export function checkSameOrigin(request: Request): boolean {
  try {
    assertSameOrigin(request);
    return true;
  } catch {
    return false;
  }
}
