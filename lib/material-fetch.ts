// Full-text fetch for brief materials. Runs inside the Worker: it reuses
// `fetchPublicText` (public-network validation, redirects, size cap, timeout)
// and `extractArticle` (Readability-style extraction + markdown).
//
// Every path returns a value; this module never throws.

import { extractArticle } from "./article.ts";
import { fetchPublicText } from "./safe-fetch.ts";
import {
  MATERIAL_TEXT_MAX_CHARS,
  MATERIAL_TEXT_MIN_CHARS,
  looksPaywalled,
  reasonFromError,
  reasonFromStatus,
  type FetchReason,
} from "./material-fetch-core.ts";

export type MaterialFetchResult = { ok: true; markdown: string; author: string } | { ok: false; reason: FetchReason };

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const README_NAMES = ["README.md", "readme.md", "README.rst", "README"];
const DEFAULT_TIMEOUT_MS = 15_000;
const PAYWALL_JSON_RE = /["']?isAccessibleForFree["']?\s*:\s*(?:false|"false")/i;
/** 正文短于这个长度又带登录 / 付费字样，按付费墙预览处理。 */
const PAYWALL_TEASER_MAX_CHARS = 1_500;

/** 抽取时漏进正文的样式 / 类名碎片（如 `[&_[data-x]]:[--gutter:0px]`）：符号占比过高的行。 */
export function isJunkLine(line: string): boolean {
  const text = line.trim();
  if (text.length < 24) return /^(loading…?|loading\.\.\.)$/i.test(text);
  // Tailwind 任意值 / CSS 变量碎片出现两次以上，基本就是漏出来的 class 属性。
  const fragments = (text.match(/\]:\[|\[&_|--[a-z][a-z0-9-]*:/g) || []).length;
  return fragments >= 2;
}

/** 去掉 markdown 图片 / 徽章 / HTML 标签、样式碎片行，折叠空白。 */
function cleanMarkdown(markdown: string): string {
  return String(markdown ?? "")
    .split(/\r?\n/)
    .filter((line) => !isJunkLine(line))
    .join("\n")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `github.com/<owner>/<repo>` 仓库首页；其它 GitHub 路径返回 null。 */
function parseGithubRepoUrl(value: string): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * GitHub 仓库没有正文页，改成按 README 文件名依次取 raw 文件
 * （与 scripts/lib/digest-fetch.mjs 的思路一致，但不能在 Worker 里 import 那个 mjs）。
 */
async function fetchGithubReadme(owner: string, repo: string, timeoutMs: number): Promise<string | null> {
  for (const name of README_NAMES) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${name}`;
    try {
      const response = await fetch(rawUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": BROWSER_UA },
      });
      if (!response.ok) continue;
      const text = cleanMarkdown(await response.text());
      if (text) return text.slice(0, MATERIAL_TEXT_MAX_CHARS);
    } catch {
      // 换下一个候选文件名。
    }
  }
  return null;
}

/** 抓取一条素材的正文；成功返回 markdown + 作者，失败返回原因。 */
export async function fetchMaterialText(url: string, options?: { timeoutMs?: number }): Promise<MaterialFetchResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const repo = parseGithubRepoUrl(url);
    if (repo) {
      const readme = await fetchGithubReadme(repo.owner, repo.repo, timeoutMs);
      if (readme === null) return { ok: false, reason: "unreachable" };
      return { ok: true, markdown: readme, author: "" };
    }

    const { response, text } = await fetchPublicText(url, {
      maxBytes: 2_000_000,
      timeoutMs,
      accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.1",
      userAgent: BROWSER_UA,
    });

    if (!response.ok) {
      // fetchPublicText 对非 2xx 返回空 body，因此这里读不到 403 错误页正文；
      // 403 一律按「打不开」处理（付费墙在 200 页面上由 looksPaywalled 判定）。
      return { ok: false, reason: reasonFromStatus(response.status) ?? "unreachable" };
    }

    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain|text\/markdown/.test(contentType)) {
      return { ok: false, reason: "extract" };
    }

    const isHtml = !contentType || /html|xhtml/.test(contentType);
    const extracted = isHtml ? extractArticle(text) : { markdown: text, author: "" };
    const markdown = cleanMarkdown(extracted.markdown);
    // 付费墙判定放在抽取之后：页面里顺带出现「Subscribe」字样很常见，
    // 只有明确标了 isAccessibleForFree:false，或者正文很短且带登录 / 付费标记时才算。
    if (PAYWALL_JSON_RE.test(text)) return { ok: false, reason: "login" };
    if (markdown.length < PAYWALL_TEASER_MAX_CHARS && looksPaywalled(text)) return { ok: false, reason: "login" };
    if (markdown.length < MATERIAL_TEXT_MIN_CHARS) return { ok: false, reason: "extract" };
    return { ok: true, markdown: markdown.slice(0, MATERIAL_TEXT_MAX_CHARS), author: String(extracted.author || "") };
  } catch (error) {
    return { ok: false, reason: reasonFromError(error) };
  }
}
