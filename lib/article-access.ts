/**
 * article-access.ts — 文章归属与可见性
 *
 * 每篇文章属于一个账号（articles.owner_id）。公开文章所有人可读；私密文章只有
 * 所有者可读，连别的管理员也看不到（404）。本模块不 import lib/store.ts /
 * lib/auth.ts / "cloudflare:workers"，测试可直接用 fake-d1 加载。
 */

export type Viewer = { id: number; role: "user" | "admin" } | null;

export type ArticleAccessRow = { isPublic: boolean | number; ownerId: number | null };

export type ArticleAccess = {
  slug: string;
  isPublic: boolean;
  ownerId: number | null;
  source: string | null;
};

export type ArticleListItem = {
  slug: string;
  date: string | null;
  title: string | null;
  topic: string | null;
  status: string | null;
  reviewRound: number;
  isPublic: boolean;
  hasHtml: boolean;
  updatedAt: string;
};

export type ArticleListRow = ArticleListItem & { isOwner: boolean };

/** 访问类错误：路由把它映射成对应 HTTP 状态（私密文章统一 404）。 */
export class ArticleAccessError extends Error {
  status: number;

  constructor(message: string, status = 404) {
    super(message);
    this.name = "ArticleAccessError";
    this.status = status;
  }
}

export function canReadArticle(row: ArticleAccessRow, viewer: Viewer): boolean {
  if (Boolean(row.isPublic)) return true;
  return Boolean(viewer && viewer.id === row.ownerId);
}

export function isArticleOwner(row: { ownerId: number | null }, viewer: Viewer): boolean {
  return Boolean(viewer && viewer.id === row.ownerId);
}

export async function loadArticleAccess(db: D1Database, slug: string): Promise<ArticleAccess | null> {
  const row = await db
    .prepare("SELECT slug, is_public AS isPublic, owner_id AS ownerId, meta_json AS metaJson FROM articles WHERE slug = ?")
    .bind(slug)
    .first<Record<string, unknown>>();
  if (!row) return null;
  let source: string | null = null;
  try {
    const parsed = JSON.parse(String(row.metaJson || "{}"));
    if (parsed && typeof parsed === "object" && typeof (parsed as { source?: unknown }).source === "string") {
      source = String((parsed as { source: string }).source);
    }
  } catch {
    source = null;
  }
  return {
    slug: String(row.slug),
    isPublic: Boolean(row.isPublic),
    ownerId: row.ownerId === null || row.ownerId === undefined ? null : Number(row.ownerId),
    source,
  };
}

export async function listArticlesForViewer(db: D1Database, viewer: Viewer): Promise<ArticleListRow[]> {
  const viewerId = viewer ? viewer.id : -1;
  const rows = await db
    .prepare(
      `SELECT slug, date, title, topic, status, review_round AS reviewRound, is_public AS isPublic,
          owner_id AS ownerId,
          CASE WHEN article_html IS NOT NULL AND article_html != '' THEN 1 ELSE 0 END AS hasHtml,
          updated_at AS updatedAt
       FROM articles
       WHERE is_public = 1 OR owner_id = ?
       ORDER BY COALESCE(date, '') DESC, updated_at DESC, slug DESC`,
    )
    .bind(viewerId)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => {
    const ownerId = row.ownerId === null || row.ownerId === undefined ? null : Number(row.ownerId);
    return {
      slug: String(row.slug),
      date: row.date ? String(row.date) : null,
      title: row.title ? String(row.title) : null,
      topic: row.topic ? String(row.topic) : null,
      status: row.status ? String(row.status) : null,
      reviewRound: Math.max(1, Number(row.reviewRound || 1)),
      isPublic: Boolean(row.isPublic),
      hasHtml: Boolean(row.hasHtml),
      updatedAt: String(row.updatedAt || ""),
      isOwner: Boolean(viewer && viewer.id === ownerId),
    };
  });
}

export async function setArticlePublicForViewer(
  db: D1Database,
  viewer: Viewer,
  slug: string,
  isPublic: boolean,
): Promise<{ slug: string; isPublic: boolean }> {
  const row = await db
    .prepare("SELECT owner_id AS ownerId FROM articles WHERE slug = ?")
    .bind(slug)
    .first<{ ownerId: number | null }>();
  if (!row || !viewer || viewer.id !== Number(row.ownerId)) throw new ArticleAccessError("文章不存在", 404);
  if (typeof isPublic !== "boolean") throw new ArticleAccessError("公开状态不合法", 400);
  await db
    .prepare("UPDATE articles SET is_public = ?, updated_at = ? WHERE slug = ?")
    .bind(isPublic ? 1 : 0, new Date().toISOString(), slug)
    .run();
  return { slug, isPublic };
}

/** 私密文章对非所有者一律 404；公开文章任何人可读。 */
export async function requireArticleRead(db: D1Database, slug: string, viewer: Viewer): Promise<ArticleAccess> {
  const access = await loadArticleAccess(db, slug);
  if (!access || !canReadArticle(access, viewer)) throw new ArticleAccessError("文章不存在", 404);
  return access;
}
