import { getSessionUser } from "./auth";
import { getWeeklyReportHtml, isValidIsoWeek, discardBody, type WeeklyEnv } from "./weekly";

/**
 * Serves `GET|HEAD /weekly/<week>/` before the app router runs, so the
 * canonical trailing slash and redirects are fully under our control (vinext
 * may normalize trailing slashes). Returns null for any other path so the
 * worker can fall through to the vinext handler.
 *
 * `/weekly` and `/weekly/` (the index page) are intentionally left to the app
 * router.
 */

const WEEKLY_PATH_RE = /^\/weekly\/([^/]+)(\/?)$/;

function htmlResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers },
  });
}

function notFoundResponse() {
  return htmlResponse(404, "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>404 · 周报不存在</title></head><body><h1>404</h1><p>没有找到这一周的周报。</p></body></html>");
}

export async function handleWeeklyRequest(request: Request, env: WeeklyEnv): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/weekly/") || pathname === "/weekly/") return null;
  const matched = WEEKLY_PATH_RE.exec(pathname);
  if (!matched) return null;
  let week: string;
  try {
    week = decodeURIComponent(matched[1]);
  } catch {
    return notFoundResponse();
  }
  if (matched[2] !== "/") {
    // Canonical URL always carries the trailing slash.
    return new Response(null, { status: 308, headers: { location: `/weekly/${encodeURIComponent(week)}/`, "cache-control": "no-store" } });
  }
  if (!isValidIsoWeek(week)) return notFoundResponse();

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    // Drain any upload so the dev proxy does not stall on an unconsumed body.
    await discardBody(request);
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" } });
  }

  const user = await getSessionUser(env, request);
  if (!user) {
    return new Response(null, { status: 307, headers: { location: `/login?next=/weekly/${week}/`, "cache-control": "no-store" } });
  }

  const bytes = await getWeeklyReportHtml(env, week);
  if (!bytes) return notFoundResponse();

  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-length": String(bytes.byteLength),
  };
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(bytes as unknown as BodyInit, { status: 200, headers });
}
