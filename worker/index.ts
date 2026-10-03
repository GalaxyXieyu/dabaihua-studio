/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { processPendingItems, promotePendingXArticles, syncDueSources } from "../lib/store";
import { handleWeeklyRequest } from "../lib/weekly-serve";
import { getSessionUser, refreshSessionCookie } from "../lib/auth";
import { legacyRedirect } from "../lib/legacy-redirects";
import { isPublicPath, loginRedirectResponse } from "../lib/login-gate";
import { secureRedirectResponse, upgradeForwardedRequestWithFlag } from "../lib/trusted-proxy";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  DABAIHUA_TRUSTED_PROXY_HOSTS?: string;
  DABAIHUA_ALLOW_REGISTER?: string;
  DABAIHUA_REGISTER_INVITE_CODE?: string;
  DABAIHUA_PUBLIC_BASE_URL?: string;
  DABAIHUA_CARDS_ASSISTANT_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const upgrade = upgradeForwardedRequestWithFlag(request, env.DABAIHUA_TRUSTED_PROXY_HOSTS);
    request = upgrade.request;
    const secure = (response: Response) => (upgrade.upgraded ? secureRedirectResponse(response, request) : response);
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return secure(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths));
    }

    if (!isPublicPath(url.pathname)) {
      const user = await getSessionUser(env, request);
      if (!user) return secure(loginRedirectResponse(url));
    }

    // 旧链接（/daily、/weekly 列表）在 worker 层重定向：vinext 下「只做 redirect 的页面」
    // 拿不到 searchParams，日期会在页面层丢失。登录门在前面已经放行，保持原顺序。
    if (request.method === "GET" || request.method === "HEAD") {
      const legacy = legacyRedirect(url);
      if (legacy) {
        return secure(new Response(null, {
          status: 302,
          headers: { location: legacy, "cache-control": "no-store" },
        }));
      }
    }

    if (url.pathname.startsWith("/weekly/")) {
      const weekly = await handleWeeklyRequest(request, env);
      if (weekly) return secure(weekly);
    }

    let response = secure(await handler.fetch(request, env, ctx));
    // 滚动续期：「记住我」会话被使用时（距上次续期超过 1 天），expires_at 推到 30 天后并重发 cookie。
    if ((request.method === "GET" || request.method === "HEAD") && !url.pathname.startsWith("/api/auth") && !response.headers.has("set-cookie")) {
      const refreshed = await refreshSessionCookie(env, request).catch(() => null);
      if (refreshed) {
        response = new Response(response.body, response);
        response.headers.append("set-cookie", refreshed);
      }
    }
    if (url.pathname === "/career" || url.pathname.startsWith("/career/") || url.pathname === "/daily" || url.pathname.startsWith("/daily/") || url.pathname === "/ledger" || url.pathname.startsWith("/ledger/") || url.pathname === "/mirror" || url.pathname.startsWith("/mirror/")) {
      const noindexed = new Response(response.body, response);
      noindexed.headers.set("x-robots-tag", "noindex, nofollow");
      noindexed.headers.set("cache-control", "private, no-store");
      return noindexed;
    }
    return response;
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      await syncDueSources(env);
      await promotePendingXArticles(env);
      await processPendingItems(env);
    })());
  },
};

export default worker;
