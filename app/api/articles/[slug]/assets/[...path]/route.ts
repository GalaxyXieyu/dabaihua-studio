import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../../../../lib/auth";
import { canReadArticle, loadArticleAccess } from "../../../../../../lib/article-access";
import { d1ArticleAssetStore } from "../../../../../../lib/article-assets";
import { ensureSchema } from "../../../../../../lib/store";

const PATH_RE = /^images\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

type Params = { params: Promise<{ slug: string; path: string[] }> };

function notFound() {
  return new Response("Not Found", { status: 404 });
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { slug, path } = await params;
    const joined = Array.isArray(path) ? path.join("/") : String(path || "");
    if (!PATH_RE.test(joined) || joined.includes("..")) return notFound();
    await ensureSchema(env.DB);
    const access = await loadArticleAccess(env.DB, slug);
    if (!access) return notFound();
    const user = await getSessionUser(env, request);
    const viewer = user ? { id: user.id, role: user.role } : null;
    if (!canReadArticle(access, viewer)) return notFound();

    const asset = await d1ArticleAssetStore(env.DB).get(slug, joined);
    if (!asset || !CONTENT_TYPES.has(asset.contentType)) return notFound();
    const bytes = asset.bytes;
    const headers = new Headers();
    headers.set("content-type", asset.contentType);
    headers.set("cache-control", access.isPublic ? "public, max-age=86400" : "private, max-age=3600");
    headers.set("x-content-type-options", "nosniff");
    if (asset.contentType === "image/svg+xml") {
      headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
    }
    headers.set("content-length", String(bytes.byteLength));
    return new Response(bytes as unknown as BodyInit, { headers });
  } catch {
    return notFound();
  }
}
