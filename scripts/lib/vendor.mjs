/**
 * vendor.mjs — 厂商识别与每日厂商上限。
 *
 * digest 和 scripts/topic-kb 共用：按 URL host 判断素材属于哪家厂商，
 * 以及按厂商给列表做每日上限裁剪。这里不联网、不读密钥，纯函数。
 */

export const VENDOR_CAP = Number(process.env.DIGEST_VENDOR_CAP || 2);

// 二级后缀：命中时取域名最后三段（如 example.com.cn），否则取最后两段。
const SECOND_LEVEL_SUFFIXES = new Set([
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "co.kr", "com.hk", "com.tw", "com.sg", "co.in", "com.br",
]);

function mainDomain(host) {
  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 3 && SECOND_LEVEL_SUFFIXES.has(parts.slice(-2).join("."))) {
    return parts.slice(-3).join(".");
  }
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return host;
}

/**
 * 按 URL host 判断厂商，先匹配先用；URL 不合法时退回 source。
 * GitHub / Hugging Face / Substack 这类平台按账号或子域细分，避免把不同公司算成一家。
 */
export function vendorOf(url, source = "") {
  if (!url) return source || "";
  let parsed;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    return source || "";
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const seg = parsed.pathname.split("/").filter(Boolean);

  if (host === "databricks.com" || host.endsWith(".databricks.com")) return "Databricks";
  if (host === "aws.amazon.com" || host.endsWith(".aws.amazon.com")) return "AWS";
  if (host === "cloudflare.com" || host.endsWith(".cloudflare.com")) return "Cloudflare";
  if (host === "huggingface.co" || host.endsWith(".huggingface.co")) {
    if (host === "huggingface.co" && seg[0] === "blog" && seg[1]) return `Hugging Face/${seg[1]}`;
    return "Hugging Face";
  }
  if (host === "github.com" || host.endsWith(".github.com")) {
    return seg[0] ? `GitHub/${seg[0]}` : "GitHub";
  }
  if (host === "github.blog" || host.endsWith(".github.blog")) return "GitHub";
  if (host === "simonwillison.net" || host.endsWith(".simonwillison.net")) return "Simon Willison";
  if (
    host === "anthropic.com" || host.endsWith(".anthropic.com") ||
    host === "claude.com" || host.endsWith(".claude.com")
  ) return "Anthropic";
  if (host === "openai.com" || host.endsWith(".openai.com")) return "OpenAI";
  if (host === "google.com" || host.endsWith(".google.com") || host.endsWith(".google")) return "Google";
  if (host === "microsoft.com" || host.endsWith(".microsoft.com")) return "Microsoft";
  if (host.endsWith(".substack.com")) return `Substack/${host.split(".")[0]}`;
  if (host.endsWith(".ghost.io")) return `${host.split(".")[0]}.ghost.io`;
  if (host === "news.ycombinator.com") return "Hacker News";

  return mainDomain(host);
}

/**
 * 按原顺序保留列表，每个厂商最多 cap 条；厂商为空字符串的不受限。
 * 返回 { kept, dropped: [{ item, vendor }] }，dropped 用于写日志。
 */
export function capByVendor(list, getVendor, cap = VENDOR_CAP) {
  const counts = new Map();
  const kept = [];
  const dropped = [];
  for (const item of list) {
    const vendor = getVendor(item) || "";
    if (!vendor) {
      kept.push(item);
      continue;
    }
    const used = counts.get(vendor) || 0;
    if (used >= cap) {
      dropped.push({ item, vendor });
      continue;
    }
    counts.set(vendor, used + 1);
    kept.push(item);
  }
  return { kept, dropped };
}
