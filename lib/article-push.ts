/**
 * article-push.ts — `dabaihua.article-push/v1` 协议的服务端实现
 *
 * 见 docs/article-push-protocol.md。本模块只做校验、hash 与写库编排，
 * 图片字节通过 ArticleAssetStore 抽象读写；不 import lib/store.ts /
 * lib/auth.ts / "cloudflare:workers"，测试可直接用 fake-d1 加载。
 */

import type { ArticleAssetStore } from "./article-assets.ts";
import type { Viewer } from "./article-access.ts";
import { sanitizeArticleHtml } from "./html-sanitize.ts";

export const PUSH_PROTOCOL = "dabaihua.article-push/v1";
export const MAX_MARKDOWN_BYTES = 1024 * 1024;
export const MAX_HTML_BYTES = 1024 * 1024;
export const MAX_QA_REPORT_BYTES = 256 * 1024;
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_ASSETS = 50;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_COVERS = 3;

const STAGE_NAMES = ["drafted", "revised", "rewritten", "typeset"] as const;
const COVER_ROLES = ["21x9", "1x1", "cover"] as const;

const ASSET_NAME_RE = /^images\/[a-f0-9]{12}\.(png|jpe?g|gif|webp|svg)$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BRIEF_TOPIC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
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
export type ArticleHashStage = { name: string; round?: number | null };
export type ArticleHashCover = { role: string; path: string };

export type ArticleHashInput = {
  title: string;
  status: string;
  isPublic?: boolean | null;
  date?: string | null;
  tags?: string[];
  assets?: ArticleHashAsset[];
  markdown: string;
  articleHtml?: string;
  qaReport?: string;
  boardTopicId?: number;
  brief?: { date: string; topicId: string };
  stage?: ArticleHashStage;
  covers?: ArticleHashCover[];
};

export type PushStage = { name: string; round?: number };
export type PushCover = { role: string; path: string };

export type PushAssetInput = { name: string; sha256: string; base64?: string };

export type NormalizedPushBody = {
  title: string;
  markdown: string;
  status: "draft" | "published";
  isPublic: boolean | undefined;
  tags: string[];
  date: string | undefined;
  sourcePath: string | undefined;
  articleHtml: string | undefined;
  qaReport: string | undefined;
  boardTopicId: number | undefined;
  brief: { date: string; topicId: string } | undefined;
  stage: PushStage | undefined;
  covers: PushCover[] | undefined;
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

function pushError(status: number, code: string, error: string): PushError {
  return { status, code, error };
}

/** 协议约定：undefined / null / "" 都视为没给。 */
function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
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

/** 协议 §3 的 contentHash：sha256(hex 小写)。可选扩展字段只在给出时追加固定行（见协议 §3）。 */
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
  // 可选字段按固定顺序插在 tags 与 asset 之间；没给就不加行，旧客户端的 hash 不变。
  if (input.boardTopicId !== undefined && input.boardTopicId !== null) lines.push(`board:${input.boardTopicId}`);
  if (input.brief) lines.push(`brief:${input.brief.date}\t${input.brief.topicId}`);
  if (input.articleHtml) lines.push(`html:${await sha256Hex(utf8Bytes(input.articleHtml))}`);
  if (input.qaReport) lines.push(`qa:${await sha256Hex(utf8Bytes(input.qaReport))}`);
  // 阶段与封面扩展行：跟在 board/brief/html/qa 扩展行之后、asset 之前，只在给出时追加。
  if (input.stage) lines.push(`stage:${input.stage.name}:${input.stage.round ?? ""}`);
  const covers = [...(input.covers || [])].sort((left, right) =>
    left.role < right.role ? -1 : left.role > right.role ? 1 : 0,
  );
  for (const cover of covers) lines.push(`cover:${cover.role}:${cover.path}`);
  const assets = [...(input.assets || [])].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  for (const asset of assets) lines.push(`asset:${asset.name} ${asset.sha256}`);
  lines.push("");
  lines.push(input.markdown);
  return sha256Hex(utf8Bytes(lines.join("\n")));
}

/** 阶段徽标文案（docs/assistant-events-design.md §4.2）。round 仅在文案里用到时生效。 */
export function stageLabel(name: string, round?: number | null): string {
  if (name === "drafted") return "初稿完成";
  if (name === "revised") return `已按第 ${round ?? ""} 轮改完`;
  if (name === "rewritten") return `已按第 ${round ?? ""} 轮重写`;
  if (round === undefined || round === null) return "排版完成，待审";
  return `已按第 ${round} 轮改完排版`;
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
  if (given(input.sourcePath)) {
    if (typeof input.sourcePath !== "string") return invalid("sourcePath 不合法");
    if ([...input.sourcePath].length > 300) return invalid("sourcePath 最多 300 个字符");
    if (ABSOLUTE_PATH_RE.test(input.sourcePath)) return invalid("sourcePath 必须是相对路径");
    sourcePath = input.sourcePath;
  }

  let articleHtml: string | undefined;
  if (given(input.articleHtml)) {
    if (typeof input.articleHtml !== "string") return invalid("articleHtml 必须是字符串");
    if (utf8Bytes(input.articleHtml).byteLength > MAX_HTML_BYTES) return invalid("articleHtml 最多 1MB");
    articleHtml = input.articleHtml;
  }

  let qaReport: string | undefined;
  if (given(input.qaReport)) {
    if (typeof input.qaReport !== "string") return invalid("qaReport 必须是字符串");
    if (utf8Bytes(input.qaReport).byteLength > MAX_QA_REPORT_BYTES) return invalid("qaReport 最多 256KB");
    qaReport = input.qaReport;
  }

  let boardTopicId: number | undefined;
  if (given(input.boardTopicId)) {
    if (typeof input.boardTopicId !== "number" || !Number.isSafeInteger(input.boardTopicId) || input.boardTopicId <= 0) {
      return invalid("boardTopicId 必须是正整数");
    }
    boardTopicId = input.boardTopicId;
  }

  let brief: { date: string; topicId: string } | undefined;
  if (given(input.brief)) {
    if (typeof input.brief !== "object" || Array.isArray(input.brief)) return invalid("brief 不合法");
    const rawBrief = input.brief as Record<string, unknown>;
    if (typeof rawBrief.date !== "string" || !DATE_RE.test(rawBrief.date)) return invalid("brief.date 必须是 YYYY-MM-DD");
    if (typeof rawBrief.topicId !== "string" || !BRIEF_TOPIC_ID_RE.test(rawBrief.topicId)) return invalid("brief.topicId 不合法");
    brief = { date: rawBrief.date, topicId: rawBrief.topicId };
  }

  let stage: PushStage | undefined;
  if (given(input.stage)) {
    if (typeof input.stage !== "object" || Array.isArray(input.stage)) return pushError(422, "invalid_stage", "stage 不合法");
    const rawStage = input.stage as Record<string, unknown>;
    const name = String(rawStage.name ?? "");
    if (!STAGE_NAMES.includes(name as (typeof STAGE_NAMES)[number])) {
      return pushError(422, "invalid_stage", "stage.name 只能是 drafted、revised、rewritten 或 typeset");
    }
    let round: number | undefined;
    if (rawStage.round !== undefined && rawStage.round !== null && rawStage.round !== "") {
      if (typeof rawStage.round !== "number" || !Number.isSafeInteger(rawStage.round) || rawStage.round <= 0) {
        return pushError(422, "invalid_stage", "stage.round 必须是正整数");
      }
      round = rawStage.round;
    }
    if ((name === "revised" || name === "rewritten") && round === undefined) {
      return pushError(422, "invalid_stage", `stage ${name} 必须带 round`);
    }
    stage = round === undefined ? { name } : { name, round };
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

  let covers: PushCover[] | undefined;
  if (input.covers !== undefined && input.covers !== null) {
    if (!Array.isArray(input.covers)) return pushError(422, "invalid_covers", "covers 必须是数组");
    if (input.covers.length > MAX_COVERS) return pushError(422, "invalid_covers", `covers 最多 ${MAX_COVERS} 条`);
    const seenRoles = new Set<string>();
    const assetNames = new Set(assets.map((asset) => asset.name));
    const list: PushCover[] = [];
    for (const raw of input.covers) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return pushError(422, "invalid_covers", "cover 不合法");
      const cover = raw as Record<string, unknown>;
      const role = String(cover.role ?? "");
      if (!COVER_ROLES.includes(role as (typeof COVER_ROLES)[number])) {
        return pushError(422, "invalid_covers", "cover role 只能是 21x9、1x1 或 cover");
      }
      if (seenRoles.has(role)) return pushError(422, "invalid_covers", "cover role 不能重复");
      if (typeof cover.path !== "string" || !assetNames.has(cover.path)) {
        return pushError(422, "invalid_covers", "cover path 必须是本次 assets 里的图片");
      }
      seenRoles.add(role);
      list.push({ role, path: cover.path });
    }
    covers = list;
  }

  const contentHash = await computeArticleHash({
    title,
    status,
    isPublic,
    date,
    tags,
    assets,
    markdown,
    articleHtml,
    qaReport,
    boardTopicId,
    brief,
    stage,
    covers,
  });
  if (input.contentHash !== undefined && input.contentHash !== null && input.contentHash !== "") {
    if (typeof input.contentHash !== "string" || input.contentHash !== contentHash) {
      return { status: 400, code: "hash_mismatch", error: "contentHash 与内容不一致" };
    }
  }

  return { title, markdown, status, isPublic, tags, date, sourcePath, articleHtml, qaReport, boardTopicId, brief, stage, covers, protocol: PUSH_PROTOCOL, contentHash, assets };
}

function shanghaiDate(now: string): string {
  const shifted = new Date(new Date(now).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** 助手 token 推送时必填的 assistant 名字：非空、≤ 20 字、不含换行。 */
export function parseAssistantName(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = (body as Record<string, unknown>).assistant;
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name) return null;
  if ([...name].length > 20) return null;
  if (/[\r\n]/.test(name)) return null;
  return name;
}

/** 助手推送的归属账号：优先 ARTICLES_OWNER_ACCOUNT，回退最早的管理员，都没有返回 null。 */
export async function resolveArticlesOwnerId(db: D1Database, ownerAccount?: string): Promise<number | null> {
  try {
    const account = String(ownerAccount ?? "").trim();
    if (account) {
      const normalized = account.normalize("NFKC").trim().toLocaleLowerCase("en-US");
      const row = await db.prepare("SELECT id FROM users WHERE account_normalized = ?").bind(normalized).first<Record<string, unknown>>();
      if (row) return Number(row.id);
    }
    const admin = await db
      .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
      .first<Record<string, unknown>>();
    return admin ? Number(admin.id) : null;
  } catch {
    return null;
  }
}

export type ArticlePutDeps = {
  db: D1Database;
  assets: ArticleAssetStore;
  viewer: Viewer;
  slug: string;
  body: unknown;
  now: string;
  /** 有值 = 助手 token 请求，viewer 是解析出的文章归属账号。 */
  assistant?: string;
};

export type ArticlePutResult = { status: number; json: Record<string, unknown> };

/**
 * 协议 §5 / §6 的写库编排。返回 {status, json}；调用方（路由）只负责认证与
 * 请求体读取。绝不改动 article_versions / review_marks / review_rounds。
 */
export async function handleArticlePut(deps: ArticlePutDeps): Promise<ArticlePutResult> {
  const { db, assets, viewer, slug, body, now } = deps;
  const assistant = typeof deps.assistant === "string" && deps.assistant.trim() ? deps.assistant : undefined;
  if (!viewer) return { status: 401, json: { error: "请先登录后再继续", code: "unauthorized" } };

  const normalized = await validatePushBody(slug, body);
  if (isPushError(normalized)) return { status: normalized.status, json: { error: normalized.error, code: normalized.code } };

  // 助手只能推草稿：发布、公开永远由 Yu 自己决定。
  if (assistant && (normalized.status === "published" || normalized.isPublic === true)) {
    return { status: 403, json: { error: "助手只能推送草稿，发布由 Yu 决定", code: "assistant_draft_only" } };
  }

  const existing = await db
    .prepare(
      "SELECT owner_id AS ownerId, meta_json AS metaJson, content_hash AS contentHash, is_public AS isPublic, date, status, review_round AS reviewRound FROM articles WHERE slug = ?",
    )
    .bind(slug)
    .first<Record<string, unknown>>();

  // 旧 meta（每次推送整体重建，stageHistory 要跨推送带过去）。
  let existingMeta: Record<string, unknown> = {};
  if (existing && existing.metaJson) {
    try {
      const parsed = JSON.parse(String(existing.metaJson));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existingMeta = parsed as Record<string, unknown>;
    } catch {
      existingMeta = {};
    }
  }

  if (existing) {
    if (Number(existing.ownerId) !== viewer.id) {
      return { status: 409, json: { error: "这个 slug 已被其他账号使用", code: "slug_taken" } };
    }
    let source: string | null = null;
    if (typeof existingMeta.source === "string") source = existingMeta.source;
    if (source !== "push") {
      return { status: 409, json: { error: "这个 slug 由服务器目录导入管理", code: "slug_managed" } };
    }
    // 非草稿状态的文章助手不能覆盖（changes-requested 除外：Yu 要求修改后助手要能重推修订稿）。
    // 这一条要在 unchanged 短路之前判断：内容即使没变，锁定的文章仍然是 409。
    if (assistant) {
      const existingStatus = existing.status === null || existing.status === undefined ? "" : String(existing.status);
      // 审稿通过（approved）后只放行 --stage typeset 的排版推送，状态保持 approved。
      const approvedTypeset = existingStatus === "approved" && normalized.stage?.name === "typeset";
      if (existingStatus !== "draft" && existingStatus !== "changes-requested" && !approvedTypeset) {
        return {
          status: 409,
          json: { error: `这篇文章已被改为「${existingStatus}」，助手不能覆盖`, code: "article_locked", status: existingStatus },
        };
      }
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
  // 带轮次的阶段要求那一轮已经提交过审稿（articles.review_round 在提交后变成下一轮）。
  // 放在 unchanged 短路之后：重推幂等请求不受影响。
  if (normalized.stage && normalized.stage.round !== undefined) {
    const round = normalized.stage.round;
    const reviewRound = existing ? Number(existing.reviewRound || 0) : 0;
    if (!(reviewRound > round)) {
      return { status: 422, json: { error: `第 ${round} 轮还没有提交审稿`, code: "round_not_reviewed" } };
    }
  }
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

  const date = normalized.date || (existing && existing.date ? String(existing.date) : null) || shanghaiDate(now);

  let isPublic: boolean;
  if (assistant) {
    // 助手不能改公开状态：新文章私密，已有文章保持原值。
    isPublic = existing ? Boolean(existing.isPublic) : false;
  } else if (normalized.isPublic !== undefined) isPublic = normalized.isPublic;
  else if (normalized.status === "published") isPublic = true;
  else if (existing) isPublic = Boolean(existing.isPublic);
  else isPublic = false;

  // 助手推送一律回到 draft，唯一例外：approved + --stage typeset 的排版放行，状态保持 approved。
  const approvedTypeset = Boolean(
    assistant && existing && String(existing.status ?? "") === "approved" && normalized.stage?.name === "typeset",
  );
  const status = !assistant ? normalized.status : approvedTypeset ? "approved" : "draft";
  // articleHtml 存清洗后的版本；相对 images/<sha12>.<ext> 保持相对，渲染时再映射到 assets 地址。
  const articleHtml = normalized.articleHtml === undefined ? null : sanitizeArticleHtml(normalized.articleHtml, { assetBase: "" });
  const qaReport = normalized.qaReport === undefined ? null : normalized.qaReport;
  const meta: Record<string, unknown> = {
    source: "push",
    protocol: PUSH_PROTOCOL,
    tags: normalized.tags,
    sourcePath: normalized.sourcePath ?? null,
    pushedAt: now,
    pushedBy: assistant ? "assistant" : "owner",
  };
  if (normalized.brief) meta.brief = normalized.brief;
  if (normalized.boardTopicId !== undefined) meta.boardTopicId = normalized.boardTopicId;
  if (assistant) meta.assistant = assistant;
  // 阶段写回：本次带 stage 就写 meta.stage 并追加历史；没带也把旧历史带过去（meta 每次重建）。
  const oldStageHistory = Array.isArray(existingMeta.stageHistory)
    ? (existingMeta.stageHistory as unknown[]).filter((entry) => entry && typeof entry === "object")
    : [];
  if (normalized.stage) {
    const entry = {
      name: normalized.stage.name,
      round: normalized.stage.round ?? null,
      label: stageLabel(normalized.stage.name, normalized.stage.round),
      assistant: assistant || null,
      at: now,
    };
    meta.stage = entry;
    meta.stageHistory = [...oldStageHistory, entry].slice(-20);
  } else if (oldStageHistory.length) {
    meta.stageHistory = oldStageHistory;
  }
  // 封面跟着内容走：本次带 covers 才写 meta.covers，没带就清掉旧的。
  if (normalized.covers) meta.covers = normalized.covers;
  const metaJson = JSON.stringify(meta);

  if (existing) {
    await db
      .prepare(
        `UPDATE articles SET date = ?, title = ?, status = ?, meta_json = ?, draft_md = NULL, final_md = ?,
           qa_report = ?, article_html = ?, content_hash = ?, is_public = ?, topic_id = COALESCE(?, topic_id),
           synced_at = ?, updated_at = ?
         WHERE slug = ?`,
      )
      .bind(
        date,
        normalized.title,
        status,
        metaJson,
        normalized.markdown,
        qaReport,
        articleHtml,
        normalized.contentHash,
        isPublic ? 1 : 0,
        normalized.boardTopicId ?? null,
        now,
        now,
        slug,
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO articles (slug, date, title, topic, status, meta_json, draft_md, final_md, qa_report, article_html,
           content_hash, review_round, is_public, topic_id, owner_id, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        slug,
        date,
        normalized.title,
        status,
        metaJson,
        normalized.markdown,
        qaReport,
        articleHtml,
        normalized.contentHash,
        isPublic ? 1 : 0,
        normalized.boardTopicId ?? null,
        viewer.id,
        now,
        now,
        now,
      )
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
