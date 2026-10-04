// Pure login-gate helpers for the worker. This module intentionally imports
// nothing so node's type-stripping test runner can load it directly.

const PUBLIC_PREFIXES = ["/_vinext/", "/assets/", "/cli/"];

const PUBLIC_EXACT = new Set([
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/og-community.png",
  "/og-community.svg",
  "/robots.txt",
  "/file.svg",
  "/globe.svg",
  "/window.svg",
]);

function hasPrefix(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Paths that are served without a session. Everything else requires login. */
export function isPublicPath(pathname: string): boolean {
  if (hasPrefix(pathname, "/login")) return true;
  if (hasPrefix(pathname, "/api")) return true;
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

function toPathAndSearch(value: URL | string): string {
  if (value instanceof URL) return `${value.pathname}${value.search}`;
  const parsed = new URL(value, "http://localhost");
  return `${parsed.pathname}${parsed.search}`;
}

/** Builds the `/login?next=...` target, keeping slashes readable. */
export function loginRedirectLocation(value: URL | string): string {
  const encoded = encodeURIComponent(toPathAndSearch(value)).replace(/%2F/gi, "/");
  return `/login?next=${encoded}`;
}

/** 307 redirect that sends an unauthenticated visitor to the login page. */
export function loginRedirectResponse(value: URL | string): Response {
  return new Response(null, {
    status: 307,
    headers: {
      location: loginRedirectLocation(value),
      "cache-control": "no-store",
    },
  });
}
