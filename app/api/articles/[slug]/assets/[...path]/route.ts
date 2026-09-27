import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../../../../lib/auth";
import { ensureSchema } from "../../../../../../lib/store";

const PATH_RE = /^images\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

type Params = { params: Promise<{ slug: string; path: string[] }> };

function notFound() {
  return new Response("Not Found", { status: 404 });
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return new Uint8Array(0);
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { slug, path } = await params;
    const joined = Array.isArray(path) ? path.join("/") : String(path || "");
    if (!PATH_RE.test(joined) || joined.includes("..")) return notFound();
    await ensureSchema(env.DB);
    const article = await env.DB.prepare("SELECT is_public AS isPublic FROM articles WHERE slug = ?")
      .bind(slug).first<{ isPublic: number }>();
    if (!article) return notFound();
    if (!article.isPublic) {
      const user = await getSessionUser(env, request);
      if (!user) return notFound();
    }
    const row = await env.DB.prepare("SELECT content_type AS contentType, bytes FROM article_assets WHERE slug = ? AND path = ?")
      .bind(slug, joined).first<{ contentType: string; bytes: unknown }>();
    if (!row || !CONTENT_TYPES.has(String(row.contentType))) return notFound();
    const bytes = toBytes(row.bytes);
    const headers = new Headers();
    headers.set("content-type", String(row.contentType));
    headers.set("cache-control", article.isPublic ? "public, max-age=86400" : "private, max-age=3600");
    headers.set("x-content-type-options", "nosniff");
    if (String(row.contentType) === "image/svg+xml") {
      headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
    }
    headers.set("content-length", String(bytes.byteLength));
    return new Response(bytes, { headers });
  } catch {
    return notFound();
  }
}
