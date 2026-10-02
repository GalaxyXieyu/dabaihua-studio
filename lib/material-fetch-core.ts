// Pure helpers for the brief material full-text fetch. This module imports
// nothing and only uses erasable TypeScript syntax so Node's type-stripping
// test runner can load it directly.

export type FetchReason = "login" | "unreachable" | "extract";

export const FETCH_REASON_LABELS: Record<FetchReason, string> = {
  login: "需要登录或付费",
  unreachable: "网页打不开",
  extract: "正文提取失败",
};

/** 抽出的正文短于这个长度就算提取失败。 */
export const MATERIAL_TEXT_MIN_CHARS = 400;
/** 存库前截断到这个长度。 */
export const MATERIAL_TEXT_MAX_CHARS = 20_000;

const ORIGINAL_LINK_RE = /\[原文链接\]\([^)]*\)/g;
const ORIGINAL_LINK_TOKEN = "[原文链接](";
/** isSummaryOnly 中「去链接后不足这个长度就算没原文」的门槛。 */
export const SUMMARY_ONLY_MAX_CHARS = 600;

/**
 * `content_markdown` 是否只是「摘要 + [原文链接]」（或为空）。
 * 用于判断一条素材是否还缺原文。
 */
export function isSummaryOnly(input: {
  contentMarkdown: string | null;
  originalExcerpt?: string | null;
  translatedExcerpt?: string | null;
}): boolean {
  const raw = String(input.contentMarkdown ?? "");
  const stripped = raw.replace(ORIGINAL_LINK_RE, "").trim();
  if (!stripped) return true;
  const original = String(input.originalExcerpt ?? "").trim();
  const translated = String(input.translatedExcerpt ?? "").trim();
  if (original && stripped === original) return true;
  if (translated && stripped === translated) return true;
  if (raw.includes(ORIGINAL_LINK_TOKEN) && stripped.length < SUMMARY_ONLY_MAX_CHARS) return true;
  return false;
}

/**
 * 同一个素材链接匹配到多条 item 时（历史数据里末尾斜杠不同会存成两条），
 * 选一条给页面展示、也给抓取用：先要有原文的，再要抓取没失败过的，最后取 id 最小的。
 * 页面和抓取走同一个选择，抓到的正文才一定出现在页面上。
 */
export function pickMaterialRow<T extends { id: number; contentMarkdown: string | null; originalExcerpt?: string | null; translatedExcerpt?: string | null; fetchStatus?: string | null }>(rows: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const row of rows) {
    const score = (isSummaryOnly(row) ? 0 : 2) + (row.fetchStatus === "failed" ? 0 : 1);
    if (score > bestScore || (score === bestScore && best && Number(row.id) < Number(best.id))) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

/** 受保护内容 / 登录墙 / 付费墙的正文标记，大小写不敏感。 */
export const PAYWALL_MARKERS: readonly string[] = [
  "subscribe to continue",
  "subscribe to read",
  "sign in to read",
  "sign in to continue",
  "membership required",
  "登录后查看",
  "登录后阅读",
  "付费阅读",
  "开通会员",
  "购买后查看",
  "订阅后查看",
];

const PAYWALL_JSON_RE = /["']?isaccessibleforfree["']?\s*:\s*false/i;

/** HTTP 状态 → 失败原因。200 交给后续判断，返回 null。 */
export function reasonFromStatus(status: number, bodySample?: string): FetchReason | null {
  if (status === 200) return null;
  if (status === 401 || status === 402 || status === 407) return "login";
  if (status === 403) return looksPaywalled(String(bodySample ?? "")) ? "login" : "unreachable";
  if (status === 404 || status === 410 || status === 429) return "unreachable";
  if (status >= 500 && status <= 599) return "unreachable";
  // 其它非 2xx（400 / 3xx 等）按打不开处理。
  return "unreachable";
}

/** 页面 200 但内容是付费墙 / 登录墙。 */
export function looksPaywalled(html: string): boolean {
  const text = String(html ?? "").toLowerCase();
  if (PAYWALL_JSON_RE.test(text)) return true;
  return PAYWALL_MARKERS.some((marker) => text.includes(marker));
}

/** 网络层异常（超时、DNS、连接拒绝、公网校验失败、重定向过多、体积超限）→ unreachable。 */
export function reasonFromError(error: unknown): FetchReason {
  if (error instanceof Error) {
    const name = error.name;
    if (name === "TimeoutError" || name === "AbortError") return "unreachable";
  }
  return "unreachable";
}

/** 失败原因 → 面向用户的中文标签。未知值返回空字符串。 */
export function reasonLabel(reason: string | null | undefined): string {
  if (reason === "login" || reason === "unreachable" || reason === "extract") return FETCH_REASON_LABELS[reason];
  return "";
}
