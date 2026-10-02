import { publicHttpUrl } from "./safe-fetch.ts";

/** Normalizes a stored item URL exactly the way captureLink does. */
export function normalizeItemUrl(value: string) {
  return publicHttpUrl(String(value ?? "").trim()).toString();
}

/**
 * 一个素材 URL 在 items.url 里可能出现的写法：原样、去尾斜杠、加尾斜杠、规范化形式。
 * 历史数据里同一篇文章偶尔因为末尾斜杠存成两条，查找时要一起找。
 */
export function itemUrlVariants(url: string): string[] {
  const raw = String(url ?? "").trim();
  const variants = new Set<string>();
  if (raw) variants.add(raw);
  const noSlash = raw.replace(/\/+$/, "");
  if (noSlash) {
    variants.add(noSlash);
    variants.add(`${noSlash}/`);
  }
  try {
    variants.add(normalizeItemUrl(raw));
  } catch {
    // 无法规范化的链接忽略。
  }
  return Array.from(variants);
}
