/**
 * article-assets.ts — 文章图片资产的存储接口
 *
 * 协议只认 `images/<sha256 前 12 位>.<ext>` 这种路径写法，正文与协议都不关心
 * 底层存在 D1、R2 还是对象存储。`d1ArticleAssetStore` 是当前的 D1 实现。
 *
 * 本模块不 import lib/store.ts / lib/auth.ts / "cloudflare:workers"，测试可以用
 * node:sqlite + tests/helpers/fake-d1.mjs 直接加载。
 */

export type ArticleAssetMeta = { path: string; sha256: string; size: number; contentType: string };
export type ArticleAssetBytes = { bytes: Uint8Array; contentType: string; sha256: string };
export type ArticleAssetPut = { path: string; bytes: Uint8Array; contentType: string; sha256: string };

export interface ArticleAssetStore {
  list(slug: string): Promise<ArticleAssetMeta[]>;
  get(slug: string, path: string): Promise<ArticleAssetBytes | null>;
  put(slug: string, asset: ArticleAssetPut): Promise<void>;
  remove(slug: string, paths: string[]): Promise<number>;
  urlFor(slug: string, path: string): string;
}

/** D1 BLOB 在不同运行时里可能是 Uint8Array / ArrayBuffer / number[]。 */
export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return new Uint8Array(0);
}

export function d1ArticleAssetStore(db: D1Database): ArticleAssetStore {
  return {
    async list(slug) {
      const rows = await db
        .prepare("SELECT path, sha256, size, content_type AS contentType FROM article_assets WHERE slug = ? ORDER BY path")
        .bind(slug)
        .all<Record<string, unknown>>();
      return rows.results.map((row) => ({
        path: String(row.path),
        sha256: String(row.sha256),
        size: Number(row.size || 0),
        contentType: String(row.contentType || ""),
      }));
    },

    async get(slug, path) {
      const row = await db
        .prepare("SELECT content_type AS contentType, bytes, sha256 FROM article_assets WHERE slug = ? AND path = ?")
        .bind(slug, path)
        .first<Record<string, unknown>>();
      if (!row) return null;
      return {
        bytes: toBytes(row.bytes),
        contentType: String(row.contentType || ""),
        sha256: String(row.sha256 || ""),
      };
    },

    async put(slug, asset) {
      await db
        .prepare(
          `INSERT INTO article_assets (slug, path, content_type, bytes, size, sha256, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug, path) DO UPDATE SET content_type = excluded.content_type, bytes = excluded.bytes,
             size = excluded.size, sha256 = excluded.sha256, updated_at = excluded.updated_at`,
        )
        .bind(slug, asset.path, asset.contentType, asset.bytes, asset.bytes.byteLength, asset.sha256, new Date().toISOString())
        .run();
    },

    async remove(slug, paths) {
      if (!paths.length) return 0;
      const placeholders = paths.map(() => "?").join(", ");
      const result = await db
        .prepare(`DELETE FROM article_assets WHERE slug = ? AND path IN (${placeholders})`)
        .bind(slug, ...paths)
        .run();
      return Number(result.meta.changes || 0);
    },

    urlFor(slug, path) {
      return `/api/articles/${slug}/assets/${path}`;
    },
  };
}
