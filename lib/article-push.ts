/**
 * article-push.ts — `dabaihua.article-push/v1` 协议的服务端实现
 *
 * 见 docs/article-push-protocol.md。本模块只做校验、hash 与写库编排，
 * 图片字节通过 ArticleAssetStore 抽象读写；不 import lib/store.ts /
 * lib/auth.ts / "cloudflare:workers"，测试可直接用 fake-d1 加载。
 */

import type { ArticleAssetStore } from "./article-assets.ts";
import type { Viewer } from "./article-access.ts";

export const PUSH_PROTOCOL = "dabaihua.article-push/v1";
export const MAX_MARKDOWN_BYTES = 1024 * 1024;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_ASSETS = 50;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

const ASSET_NAME_RE = /^images\/[a-f0-9]{12}\.(png|jpe?g|gif|webp|svg)$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ABSOLUTE_PATH_RE = /^(?:\/|~|[A-Za-z]:[\\/])/;

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export type ArticleHashAsset = { name: string; sha256: string };

export type ArticleHashInput = {
  title: string;
  status: string;
  isPublic?: boolean | null;
  date?: string | null;
  tags?: string[];
  assets?: ArticleHashAsset[];
  markdown: string;
};

export type PushAssetInput = { name: string; sha256: string; base64?: string };

export type NormalizedPushBody = {
  title: string;
  markdown: string;
  status: "draft" | "published";
  isPublic: boolean | undefined;
  tags: string[];
  date: string | undefined;
  sourcePath: string | undefined;
  protocol: string;
  contentHash: string;
  assets: PushAssetInput[];
};

export type PushError = { status: number; code: string; error: string };

export function isPushError(value: NormalizedPushBody | PushError): value is PushError {
  return typeof value === "object" && value !== null && "code" in value && "status" in value;
}

function invalid(error: string): PushError {
  return { status: 400, code: "invalid", error };
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function decodeBase64(value: string): Uint8Array {
  const clean = String(value ?? "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function contentTypeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

/** 协议 §3 的 contentHash：sha256(hex 小写)。 */
export async function computeArticleHash(input: ArticleHashInput): Promise<string> {
  const publicValue = input.isPublic === undefined || input.isPublic === null ? "" : input.isPublic ? "true" : "false";
  const lines = [
    PUSH_PROTOCOL,
    `title:${input.title}`,
    `status:${input.status}`,
    `public:${publicValue}`,
    `date:${input.date || ""}`,
    `tags:${(input.tags || []).join("\t")}`,
  ];
  const assets = [...(input.assets || [])].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const asset of assets) lines.push(`asset:${asset.name} ${asset.sha256}`);
  lines.push("");
  lines.push(input.markdown);
  return sha256Hex(utf8Bytes(lines.join("\n")));
}

/** 协议 §3 / §6：把请求体归一成可信字段，或返回错误对象。 */
export async function validatePushBody(slug: string, json: unknown): Promise<NormalizedPushBody | PushError> {
  void slug;
  if (!json || typeof json !== "object" || Array.isArray(json)) return invalid("请求体不合法");
  const input = json as Record<string, unknown>;

  if (input.protocol !== undefined && input.protocol !== PUSH_PROTOCOL) return invalid("协议版本不支持");

  if (typeof input.title !== "string" || !input.title.trim()) return invalid("title 必填");
  const title = input.title;
  if (/[\r\n]/.test(title)) return invalid("title 不能包含换行");
  if ([...title].length > 200) return invalid("title 最多 200 个字符");

  if (typeof input.markdown !== "string") return invalid("markdown 必填");
  const markdown = input.markdown;
  if (utf8Bytes(markdown).byteLength > MAX_MARKDOWN_BYTES) return invalid("markdown 最多 1MB");

  let status: "draft" | "published" = "draft";
  if (input.status !== undefined) {
    if (input.status !== "draft" && input.status !== "published") return invalid("status 只能是 draft 或 published");
    status = input.status;
  }

  let isPublic: boolean | undefined;
  if (input.isPublic !== undefined) {
    if (typeof input.isPublic !== "boolean") return invalid("isPublic 必须是布尔值");
    isPublic = input.isPublic;
  }

  let tags: string[] = [];
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) return invalid("tags 必须是数组");
    if (input.tags.length > MAX_TAGS) return invalid(`tags 最多 ${MAX_TAGS} 个`);
    for (const tag of input.tags) {
      if (typeof tag !== "string") return invalid("tags 只能包含字符串");
      if ([...tag].length > MAX_TAG_LENGTH) return invalid(`单个 tag 最多 ${MAX_TAG_LENGTH} 个字符`);
      if (/[\n\t\r]/.test(tag)) return invalid("tags 不能包含换行或制表符");
    }
    tags = input.tags.slice() as string[];
  }

  let date: string | undefined;
  if (input.date !== undefined && input.date !== null && input.date !== "") {
    if (typeof input.date !== "string" || !DATE_RE.test(input.date)) return invalid("date 必须是 YYYY-MM-DD");
    date = input.date;
  }

  let sourcePath: string | undefined;
  if (input.sourcePath !== undefined && input.sourcePath !== null && input.sourcePath !== "") {
    if (typeof input.sourcePath !== "string") return invalid("sourcePath 不合法");
    if ([...input.sourcePath].length > 300) return invalid("sourcePath 最多 300 个字符");
    if (ABSOLUTE_PATH_RE.test(input.sourcePath)) return invalid("sourcePath 必须是相对路径");
    sourcePath = input.sourcePath;
  }

  let assets: PushAssetInput[] = [];
  if (input.assets !== undefined) {
    if (!Array.isArray(input.assets)) return invalid("assets 必须是数组");
    if (input.assets.length > MAX_ASSETS) return invalid(`assets 最多 ${MAX_ASSETS} 个`);
    const seen = new Map<string, PushAssetInput>();
    for (const raw of input.assets) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("asset 不合法");
      const asset = raw as Record<string, unknown>;
      if (typeof asset.name !== "string" || !ASSET_NAME_RE.test(asset.name)) return invalid("asset name 不合法");
      if (typeof asset.sha256 !== "string" || !SHA_RE.test(asset.sha256)) return invalid("asset sha256 不合法");
      const prefix = asset.name.slice("images/".length, "images/".length + 12);
      if (asset.sha256.slice(0, 12) !== prefix) return invalid("asset name 与 sha256 不一致");
      let base64: string | undefined;
      if (asset.base64 !== undefined && asset.base64 !== null && asset.base64 !== "") {
        if (typeof asset.base64 !== "string") return invalid("asset base64 不合法");
        let bytes: Uint8Array;
        try {
          bytes = decodeBase64(asset.base64);
        } catch {
          return invalid("asset base64 无法解码");
        }
        if (bytes.byteLength > MAX_ASSET_BYTES) return invalid("单张图片最多 2MB");
        if ((await sha256Hex(bytes)) !== asset.sha256) return invalid("asset 内容与 sha256 不一致");
        base64 = asset.base64;
      }
      if (!seen.has(asset.name)) {
        seen.set(asset.name, base64 === undefined ? { name: asset.name, sha256: asset.sha256 } : { name: asset.name, sha256: asset.sha256, base64 });
      }
    }
    assets = [...seen.values()];
  }

  const contentHash = await computeArticleHash({ title, status, isPublic, date, tags, assets, markdown });
  if (input.contentHash !== undefined && input.contentHash !== null && input.contentHash !== "") {
    if (typeof input.contentHash !== "string" || input.contentHash !== contentHash) {
      return { status: 400, code: "hash_mismatch", error: "contentHash 与内容不一致" };
    }
  }

  return { title, markdown, status, isPublic, tags, date, sourcePath, protocol: PUSH_PROTOCOL, contentHash, assets };
}

function shanghaiDate(now: string): string {
  const shifted = new Date(new Date(now).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export type ArticlePutDeps = {
  db: D1Database;
  assets: ArticleAssetStore;
  viewer: Viewer;
  slug: string;
  body: unknown;
  now: string;
};

export type ArticlePutResult = { status: number; json: Record<string, unknown> };

/**
 * 协议 §5 / §6 的写库编排。返回 {status, json}；调用方（路由）只负责认证与
 * 请求体读取。绝不改动 article_versions / review_marks / review_rounds。
 */
export async function handleArticlePut(deps: ArticlePutDeps): Promise<ArticlePutResult> {
  const { db, assets, viewer, slug, body, now } = deps;
  if (!viewer) return { status: 401, json: { error: "请先登录后再继续", code: "unauthorized" } };

  const normalized = await validatePushBody(slug, body);
  if (isPushError(normalized)) return { status: normalized.status, json: { error: normalized.error, code: normalized.code } };

  const existing = await db
    .prepare(
      "SELECT owner_id AS ownerId, meta_json AS metaJson, content_hash AS contentHash, is_public AS isPublic, date FROM articles WHERE slug = ?",
    )
    .bind(slug)
    .first<Record<string, unknown>>();

  if (existing) {
    if (Number(existing.ownerId) !== viewer.id) {
      return { status: 409, json: { error: "这个 slug 已被其他账号使用", code: "slug_taken" } };
    }
    let source: string | null = null;
    try {
      const parsed = JSON.parse(String(existing.metaJson || "{}"));
      source = parsed && typeof parsed === "object" ? ((parsed as { source?: unknown }).source as string | null) : null;
    } catch {
      source = null;
    }
    if (source !== "push") {
      return { status: 409, json: { error: "这个 slug 由服务器目录导入管理", code: "slug_managed" } };
    }
    if (existing.contentHash && String(existing.contentHash) === normalized.contentHash) {
      return {
        status: 200,
        json: {
          ok: true,
          result: "unchanged",
          slug,
          url: `/articles/${slug}`,
          contentHash: normalized.contentHash,
          isPublic: Boolean(existing.isPublic),
          assets: { stored: 0, reused: normalized.assets.length, removed: 0 },
        },
      };
    }
  }

  const existingAssets = await assets.list(slug);
  const existingByPath = new Map(existingAssets.map((asset) => [asset.path, asset.sha256]));
  const requestedNames = new Set(normalized.assets.map((asset) => asset.name));
  const missingAssets: string[] = [];
  for (const asset of normalized.assets) {
    if (asset.base64 !== undefined) continue;
    if (existingByPath.get(asset.name) !== asset.sha256) missingAssets.push(asset.name);
  }
  if (missingAssets.length) {
    return { status: 422, json: { error: "缺少图片数据", code: "missing_assets", missingAssets } };
  }

  let isPublic: boolean;
  if (normalized.isPublic !== undefined) isPublic = normalized.isPublic;
  else if (normalized.status === "published") isPublic = true;
  else if (existing) isPublic = Boolean(existing.isPublic);
  else isPublic = false;

  const date = normalized.date || (existing && existing.date ? String(existing.date) : null) || shanghaiDate(now);
  const metaJson = JSON.stringify({
    source: "push",
    protocol: PUSH_PROTOCOL,
    tags: normalized.tags,
    sourcePath: normalized.sourcePath ?? null,
    pushedAt: now,
  });

  if (existing) {
    await db
      .prepare(
        `UPDATE articles SET date = ?, title = ?, status = ?, meta_json = ?, draft_md = NULL, final_md = ?,
           qa_report = NULL, article_html = NULL, content_hash = ?, is_public = ?, synced_at = ?, updated_at = ?
         WHERE slug = ?`,
      )
      .bind(date, normalized.title, normalized.status, metaJson, normalized.markdown, normalized.contentHash, isPublic ? 1 : 0, now, now, slug)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO articles (slug, date, title, topic, status, meta_json, draft_md, final_md, qa_report, article_html,
           content_hash, review_round, is_public, topic_id, owner_id, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, NULL, NULL, ?, 1, ?, NULL, ?, ?, ?, ?)`,
      )
      .bind(slug, date, normalized.title, normalized.status, metaJson, normalized.markdown, normalized.contentHash, isPublic ? 1 : 0, viewer.id, now, now, now)
      .run();
  }

  let stored = 0;
  let reused = 0;
  for (const asset of normalized.assets) {
    if (asset.base64 !== undefined && existingByPath.get(asset.name) !== asset.sha256) {
      await assets.put(slug, {
        path: asset.name,
        bytes: decodeBase64(asset.base64),
        contentType: contentTypeFor(asset.name),
        sha256: asset.sha256,
      });
      stored += 1;
    } else {
      reused += 1;
    }
  }
  const stale = existingAssets.map((asset) => asset.path).filter((path) => !requestedNames.has(path));
  const removed = stale.length ? await assets.remove(slug, stale) : 0;

  return {
    status: existing ? 200 : 201,
    json: {
      ok: true,
      result: existing ? "updated" : "created",
      slug,
      url: `/articles/${slug}`,
      contentHash: normalized.contentHash,
      isPublic,
      assets: { stored, reused, removed },
    },
  };
}
