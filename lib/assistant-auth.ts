/**
 * assistant-auth.ts — 助手 Bearer token 的公共小工具
 *
 * 助手 token 是 `DABAIHUA_CARDS_ASSISTANT_TOKEN`（卡片、简报管线与文章推送共用）。
 * bearerToken / sameSecret 与简报管线路由里的实现保持一致：恒定时间比较，
 * 避免按字符提前返回泄漏 token。
 */

export function bearerToken(request: Request): string {
  const matched = /^Bearer\s+(.+)$/.exec((request.headers.get("authorization") || "").trim());
  return matched ? matched[1] : "";
}

/** 恒定时间比较，避免按字符提前返回泄漏 token。 */
export function sameSecret(left: string, right: string): boolean {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
