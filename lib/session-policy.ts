/**
 * 登录会话的时长与续期规则（纯函数，测试可直接 import）。
 *
 * - 勾选「记住我」：持久 cookie（Max-Age 30 天），服务端 expires_at 也是 30 天；
 *   之后每次使用时，如果距上次续期已超过 1 天，就把 expires_at 推到「现在 + 30 天」并重发 cookie，
 *   所以经常用的人不会被要求重新登录。
 * - 不勾选：浏览器会话 cookie（不带 Max-Age，关浏览器即失效），服务端 12 小时后过期，不续期。
 */

export const SESSION_COOKIE = "rss_ai_session";
export const PERSISTENT_SESSION_SECONDS = 60 * 60 * 24 * 30;
export const BROWSER_SESSION_SECONDS = 60 * 60 * 12;
export const REFRESH_AFTER_SECONDS = 60 * 60 * 24;

export function sessionLifetimeSeconds(persistent: boolean): number {
  return persistent ? PERSISTENT_SESSION_SECONDS : BROWSER_SESSION_SECONDS;
}

/** 登录请求里的 remember：没传按勾选处理（老客户端、CLI 保持 30 天）。 */
export function rememberFromInput(value: unknown): boolean {
  return !(value === false || value === "false" || value === 0 || value === "0" || value === "off");
}

/**
 * 是否该续期：只续持久会话；expires_at 距离「现在 + 30 天」超过 1 天（即上次续期/登录已过 1 天）才续，
 * 避免每个请求都写库。已过期的不续。
 */
export function shouldRefreshSession(input: { persistent: boolean; expiresAt: string; now: Date }): boolean {
  if (!input.persistent) return false;
  const expires = Date.parse(input.expiresAt);
  if (!Number.isFinite(expires)) return false;
  const now = input.now.getTime();
  if (expires <= now) return false;
  return now + PERSISTENT_SESSION_SECONDS * 1000 - expires >= REFRESH_AFTER_SECONDS * 1000;
}

/**
 * Set-Cookie 值。maxAge 为 null 时是浏览器会话 cookie（不写 Max-Age）；0 表示删除。
 */
export function buildSessionCookie(input: { token: string; secure: boolean; maxAge: number | null }): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(input.token)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (input.maxAge !== null) parts.push(`Max-Age=${input.maxAge}`);
  if (input.secure) parts.push("Secure");
  return parts.join("; ");
}

export function isSecureHost(hostname: string): boolean {
  return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1";
}
