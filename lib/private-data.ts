/**
 * lib/private-data.ts — /daily 与 /career 私密数据的 D1 存取与校验。
 *
 * 纯逻辑模块：只依赖运行时全局（crypto.subtle / TextEncoder）和 D1 抽象，
 * 不 import lib/store.ts / lib/auth.ts / "cloudflare:workers"，也不在构建期
 * glob 私密数据，方便 node 类型擦除测试直接加载。
 */

import type { DailyData } from "./daily.ts";
import type { CareerData } from "./career.ts";

export type DatasetName = "daily" | "career";

export const DATASET_LIMITS: Record<DatasetName, number> = {
  daily: 8 * 1024 * 1024,
  career: 8 * 1024 * 1024,
};

export type DailySummary = { days: number; first: string | null; last: string | null };
export type CareerSummary = { jobs: number; results: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export type DailyValidation =
  | { ok: true; data: DailyData; summary: DailySummary }
  | { ok: false; error: string };

/**
 * /daily 数据的宽松校验：只认页面真正读取的字段，不深入校验正文结构。
 */
export function validateDailyData(value: unknown): DailyValidation {
  if (!isRecord(value)) return { ok: false, error: "顶层必须是对象" };
  if (typeof value.generatedAt !== "string" || !value.generatedAt) {
    return { ok: false, error: "generatedAt 必须是非空字符串" };
  }
  if (!Array.isArray(value.days)) return { ok: false, error: "days 必须是数组" };
  if (value.days.length > 4000) return { ok: false, error: "days 不能超过 4000 条" };
  const seen = new Set<string>();
  for (let index = 0; index < value.days.length; index += 1) {
    const day = value.days[index];
    if (!isRecord(day)) return { ok: false, error: `days[${index}] 必须是对象` };
    if (typeof day.date !== "string" || !DATE_RE.test(day.date)) {
      return { ok: false, error: `days[${index}].date 必须是 YYYY-MM-DD` };
    }
    if (seen.has(day.date)) return { ok: false, error: `日期重复：${day.date}` };
    seen.add(day.date);
    if (typeof day.summary !== "string") return { ok: false, error: `days[${index}].summary 必须是字符串` };
    if (!isRecord(day.sections)) return { ok: false, error: `days[${index}].sections 必须是对象` };
    if (!Array.isArray(day.repos)) return { ok: false, error: `days[${index}].repos 必须是数组` };
    if (!Array.isArray(day.repoStats)) return { ok: false, error: `days[${index}].repoStats 必须是数组` };
    if (!isNullableNumber(day.commits)) return { ok: false, error: `days[${index}].commits 必须是数字或 null` };
    if (!isNullableNumber(day.tokensM)) return { ok: false, error: `days[${index}].tokensM 必须是数字或 null` };
  }
  const dates = value.days
    .map((day) => String((day as Record<string, unknown>).date))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    ok: true,
    data: value as unknown as DailyData,
    summary: { days: value.days.length, first: dates[0] ?? null, last: dates[dates.length - 1] ?? null },
  };
}

export type CareerValidation =
  | { ok: true; data: CareerData; summary: CareerSummary }
  | { ok: false; error: string };

/** /career 数据的宽松校验：字段集合固定，内部结构交给页面。 */
export function validateCareerData(value: unknown): CareerValidation {
  if (!isRecord(value)) return { ok: false, error: "顶层必须是对象" };
  if (value.schema_version !== 1) return { ok: false, error: "schema_version 必须是 1" };
  if (typeof value.generated_at !== "string" || !value.generated_at) {
    return { ok: false, error: "generated_at 必须是非空字符串" };
  }
  if (!isRecord(value.header)) return { ok: false, error: "header 必须是对象" };
  if (!Array.isArray(value.jobs)) return { ok: false, error: "jobs 必须是数组" };
  if (!Array.isArray(value.results)) return { ok: false, error: "results 必须是数组" };
  if (!isRecord(value.missing)) return { ok: false, error: "missing 必须是对象" };
  if (!Array.isArray(value.pending)) return { ok: false, error: "pending 必须是数组" };
  return {
    ok: true,
    data: value as unknown as CareerData,
    summary: { jobs: value.jobs.length, results: value.results.length },
  };
}

/** 存库用的规范化 JSON：JSON.stringify，不再做其他重排。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * 判断“内容有没有变”用的串：去掉每次构建都会变的生成时间（daily.generatedAt、
 * career.generated_at），这样夜里重跑但数据没变时不会改库。存库的仍是完整 JSON。
 */
export function contentHashSource(name: DatasetName, value: unknown): string {
  if (!isRecord(value)) return canonicalJson(value);
  const copy: Record<string, unknown> = { ...value };
  if (name === "daily") delete copy.generatedAt;
  else delete copy.generated_at;
  return canonicalJson(copy);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type DatasetPutResult = { status: number; body: Record<string, unknown> };

export type DatasetPutInput = {
  db: D1Database;
  name: string;
  rawBody: string;
  actor: string;
  now: string;
};

/**
 * PUT 的纯编排：校验 → sha256 → 未变化则不动库，否则 upsert。
 * 调用方只负责认证与读取请求体。
 */
export async function handleDatasetPut({ db, name, rawBody, actor, now }: DatasetPutInput): Promise<DatasetPutResult> {
  if (name !== "daily" && name !== "career") {
    return { status: 404, body: { error: "unknown dataset", code: "unknown_dataset" } };
  }
  const limit = DATASET_LIMITS[name];
  const rawBytes = new TextEncoder().encode(rawBody).byteLength;
  if (rawBytes > limit) return { status: 413, body: { error: "too large", code: "too_large" } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid json", code: "invalid_json" } };
  }

  const validated = name === "daily" ? validateDailyData(parsed) : validateCareerData(parsed);
  if (!validated.ok) return { status: 422, body: { error: validated.error, code: "invalid_data" } };

  const canonical = canonicalJson(validated.data);
  const sha256 = await sha256Hex(contentHashSource(name, validated.data));
  const bytes = new TextEncoder().encode(canonical).byteLength;
  const generatedAt = name === "daily"
    ? (validated.data as DailyData).generatedAt
    : (validated.data as CareerData).generated_at;

  const existing = await db
    .prepare("SELECT sha256, uploaded_at AS uploadedAt FROM private_datasets WHERE name = ?")
    .bind(name)
    .first<{ sha256: string; uploadedAt: string }>();
  if (existing && existing.sha256 === sha256) {
    return {
      status: 200,
      body: { status: "unchanged", name, sha256, bytes, generatedAt, summary: validated.summary, uploadedAt: existing.uploadedAt },
    };
  }

  await db
    .prepare(
      "INSERT INTO private_datasets (name, json, sha256, bytes, generated_at, summary_json, uploaded_at, uploaded_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(name) DO UPDATE SET json = excluded.json, sha256 = excluded.sha256, bytes = excluded.bytes, " +
        "generated_at = excluded.generated_at, summary_json = excluded.summary_json, uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by",
    )
    .bind(name, canonical, sha256, bytes, generatedAt, JSON.stringify(validated.summary), now, actor)
    .run();

  return {
    status: 200,
    body: { status: "updated", name, sha256, bytes, generatedAt, summary: validated.summary, uploadedAt: now },
  };
}

export type DatasetMeta = {
  name: string;
  sha256: string;
  bytes: number;
  generatedAt: string | null;
  summary: Record<string, unknown>;
  uploadedAt: string;
  uploadedBy: string | null;
};

/** GET 用的元数据，不含 payload 本体。 */
export async function readDatasetMeta(db: D1Database, name: string): Promise<DatasetMeta | null> {
  const row = await db
    .prepare(
      "SELECT name, sha256, bytes, generated_at AS generatedAt, summary_json AS summaryJson, uploaded_at AS uploadedAt, uploaded_by AS uploadedBy " +
        "FROM private_datasets WHERE name = ?",
    )
    .bind(name)
    .first<Record<string, unknown>>();
  if (!row) return null;
  let summary: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.summaryJson || "{}"));
    if (isRecord(parsed)) summary = parsed;
  } catch {
    summary = {};
  }
  return {
    name: String(row.name),
    sha256: String(row.sha256),
    bytes: Number(row.bytes),
    generatedAt: row.generatedAt == null ? null : String(row.generatedAt),
    summary,
    uploadedAt: String(row.uploadedAt),
    uploadedBy: row.uploadedBy == null ? null : String(row.uploadedBy),
  };
}

/** 页面用：读出 payload 并 JSON.parse；不存在或损坏时返回 null。 */
export async function loadDataset<T>(db: D1Database, name: DatasetName): Promise<T | null> {
  let row: { json: string } | null = null;
  try {
    row = await db
      .prepare("SELECT json FROM private_datasets WHERE name = ?")
      .bind(name)
      .first<{ json: string }>();
  } catch {
    // 新部署还没跑过 ensureSchema（表不存在）时按“没有数据”处理，不让页面 500。
    return null;
  }
  if (!row || typeof row.json !== "string") return null;
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export type DatasetAuthUser = { account: string; role: "user" | "admin" } | null;

export type DatasetAuthInput = {
  importToken?: string;
  providedToken?: string;
  apiKeyUser: DatasetAuthUser;
  sessionUser: DatasetAuthUser;
  sameOrigin: boolean;
  method: string;
};

export type DatasetAuthDecision =
  | { ok: true; actor: string }
  | { ok: false; status: number; code: string; error: string };

const FORBIDDEN: DatasetAuthDecision = { ok: false, status: 403, code: "forbidden", error: "forbidden" };
const UNAUTHORIZED: DatasetAuthDecision = { ok: false, status: 401, code: "unauthorized", error: "unauthorized" };

/**
 * 纯鉴权判定：导入 token → admin API key → admin 会话（PUT 需同源）。
 * 任何非 admin 的已认证身份一律 403；没有凭证 401。
 * 注意：这里没有 localhost 旁路，写私密数据不接受本地免鉴权。
 */
export function decideDatasetAuth(input: DatasetAuthInput): DatasetAuthDecision {
  const expected = input.importToken || "";
  const provided = input.providedToken || "";
  if (provided && expected && constantTimeEqual(provided, expected)) {
    return { ok: true, actor: "import-token" };
  }
  if (provided) return UNAUTHORIZED;

  if (input.apiKeyUser) {
    return input.apiKeyUser.role === "admin" ? { ok: true, actor: input.apiKeyUser.account } : FORBIDDEN;
  }

  if (input.sessionUser) {
    if (input.sessionUser.role !== "admin") return FORBIDDEN;
    if (input.method.toUpperCase() === "PUT" && !input.sameOrigin) return FORBIDDEN;
    return { ok: true, actor: input.sessionUser.account };
  }

  return UNAUTHORIZED;
}
