// Helpers for running behind an HTTPS reverse proxy / tunnel (e.g. cloudflared).
//
// Inside a Cloudflare Worker request.url is built from the Host header and the
// plaintext listener, so a tunnel that terminates TLS yields `http://<public-host>/...`
// even though the browser is on https. That causes `redirect()` to emit an http
// Location and the browser then withholds the Secure session cookie. When an
// operator opts in via DABAIHUA_TRUSTED_PROXY_HOSTS we rebuild such requests with
// the https: protocol so server-side origin checks and redirects stay consistent.

/** Lowercases a host value and strips an optional port (including `[::1]:port`). */
function normalizeHost(host: string): string {
  const value = (host || "").trim().toLowerCase();
  if (!value) return "";
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(value.slice(colon + 1))) return value.slice(0, colon);
  return value;
}

/** Parses a comma-separated DABAIHUA_TRUSTED_PROXY_HOSTS value into normalized patterns. */
export function parseHostPatterns(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((pattern) => normalizeHost(pattern))
    .filter((pattern) => pattern.length > 0);
}

/**
 * True when `host` matches one of `patterns`. Comparison is case-insensitive and
 * ignores ports. Patterns are exact hosts or leading-wildcards like `*.example.com`
 * (the wildcard requires at least one label, so it does not match the apex domain).
 */
export function matchesHostPattern(host: string, patterns: readonly string[]): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  for (const pattern of patterns) {
    const candidate = normalizeHost(pattern);
    if (!candidate) continue;
    if (candidate.startsWith("*.")) {
      const suffix = candidate.slice(1); // ".example.com"
      if (normalized.length > suffix.length && normalized.endsWith(suffix)) return true;
      continue;
    }
    if (normalized === candidate) return true;
  }
  return false;
}

/** Result of a possible forwarded-proto upgrade. */
export interface ForwardedUpgradeResult {
  request: Request;
  upgraded: boolean;
}

/**
 * Returns the https origin for `origin` when it is exactly an insecure copy of the
 * request `host` (`http://<host>`, case-insensitive, same port handling). Returns
 * null for any other origin so foreign origins still fail same-origin checks.
 */
function secureOriginForHost(origin: string | null, host: string): string | null {
  const value = (origin || "").trim();
  const requestHost = (host || "").trim().toLowerCase();
  if (!value || !requestHost) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:") return null;
  if (parsed.host.toLowerCase() !== requestHost) return null;
  parsed.protocol = "https:";
  return parsed.origin;
}

/**
 * Same as {@link upgradeForwardedRequest} but also reports whether the request was
 * rebuilt, so callers can apply https-only response handling to that path only.
 */
export function upgradeForwardedRequestWithFlag(request: Request, envValue: string | null | undefined): ForwardedUpgradeResult {
  const patterns = parseHostPatterns(envValue);
  if (patterns.length === 0) return { request, upgraded: false };
  const url = new URL(request.url);
  if (url.protocol !== "http:") return { request, upgraded: false };
  const host = request.headers.get("host") || url.host;
  if (!matchesHostPattern(host, patterns)) return { request, upgraded: false };
  const forwardedProto = (request.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  if (forwardedProto !== "https") return { request, upgraded: false };
  const upgraded = new URL(request.url);
  upgraded.protocol = "https:";
  const base = new Request(upgraded, request);
  const secureOrigin = secureOriginForHost(request.headers.get("origin"), host);
  if (!secureOrigin) return { request: base, upgraded: true };
  const headers = new Headers(base.headers);
  headers.set("origin", secureOrigin);
  return { request: new Request(base, { headers }), upgraded: true };
}

/**
 * Returns a request rebuilt with an https URL when all of the following hold:
 *   - DABAIHUA_TRUSTED_PROXY_HOSTS has at least one pattern
 *   - the request Host matches a trusted pattern
 *   - the first `x-forwarded-proto` value is `https`
 *   - the request URL protocol is currently `http:`
 * When the incoming Origin is exactly `http://<that host>` it is rewritten to https
 * as well, so proxy-rewritten origins still pass same-origin checks. Otherwise the
 * original request is returned untouched (default: no rewriting).
 */
export function upgradeForwardedRequest(request: Request, envValue: string | null | undefined): Request {
  return upgradeForwardedRequestWithFlag(request, envValue).request;
}

/**
 * Neutralizes a dev proxy's http downgrade of redirect Locations on upgraded
 * requests. wrangler's dev ProxyWorker rewrites every absolute URL in response
 * headers whose host matches the request host to its own outer origin
 * (`http://<host>`), so an emitted `https://<host>/...` would be turned back into
 * `http`. Instead, an absolute Location (`http://` or `https://`) whose host is
 * the same as the request host is converted to a relative Location
 * (`pathname+search+hash`, e.g. `/login?next=/x`); browsers resolve it against
 * the current https URL. Already-relative Locations, foreign hosts and
 * protocol-relative `//evil` values are returned untouched (status, body stream,
 * headers).
 */
export function secureRedirectResponse(response: Response, request: Request): Response {
  const location = response.headers.get("location");
  if (!location) return response;
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    // Not an absolute URL (e.g. `/login` or `//evil.com`); leave it alone.
    return response;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return response;
  const host = new URL(request.url).host;
  if (parsed.host.toLowerCase() !== host.toLowerCase()) return response;
  const rewritten = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const headers = new Headers(response.headers);
  headers.set("location", rewritten);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
