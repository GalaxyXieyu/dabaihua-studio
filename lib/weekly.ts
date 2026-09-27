/**
 * Weekly report hosting (topics daily publish).
 *
 * Reports are opaque, self-contained HTML documents keyed by ISO week. The
 * bytes live in D1 as chunked BLOBs (a single 5 MB value would hit D1's
 * per-value/statement limits), with a monotonically increasing `version`
 * counter so readers always see either the previous or the new document,
 * never a half-written one.
 */

export type WeeklyEnv = { DB: D1Database; DABAIHUA_PUBLIC_BASE_URL?: string };

// Imported lazily so the pure helpers in this module stay loadable by Node's
// type-stripping test runner without pulling in the whole store graph.
async function ensureWeeklySchema(env: WeeklyEnv) {
  const { ensureSchema } = await import("./store");
  await ensureSchema(env.DB);
}

/** Maximum accepted report size (the client also enforces this). */
export const MAX_WEEKLY_BYTES = 5 * 1024 * 1024;
/** D1 has per-value size limits, so split the body into <= 512 KiB chunks. */
export const WEEKLY_CHUNK_BYTES = 512 * 1024;
/** Keep the last N versions of a week's chunks (older ones are pruned). */
export const WEEKLY_KEEP_VERSIONS = 5;
/** Uploads allowed per account per rolling window. */
export const WEEKLY_UPLOAD_LIMIT = 10;
export const WEEKLY_UPLOAD_WINDOW_MS = 60 * 1000;

const WEEK_RE = /^\d{4}-W\d{2}$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Thrown by readBodyWithLimit when a request body exceeds the limit. */
export class PayloadTooLargeError extends Error {
  constructor() {
    super("payload too large");
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Upper bound on how much of an otherwise-unconsumed request body we are
 * willing to drain. Draining keeps Cloudflare's dev proxy from stalling the
 * next request (or restarting the worker) when a response is written while the
 * upload is still in flight, but a client must not be able to pin the worker
 * with an endless stream.
 */
export const DISCARD_BODY_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Reads and discards bytes from `reader` until the stream ends or `maxBytes`
 * is exceeded, then cancels the reader. Errors from locked, consumed, cancelled
 * or errored streams are swallowed.
 */
async function drainReader(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number): Promise<void> {
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return;
      }
    }
  } catch {
    // Nothing left to drain (stream already consumed, cancelled or aborted).
  }
}

/**
 * Reads and discards any remaining request body so a response can be returned
 * without leaving an unconsumed upload on the connection. Calling this on an
 * already-consumed body is a no-op, and every error is swallowed.
 */
export async function discardBody(request: Request, maxBytes: number = DISCARD_BODY_MAX_BYTES): Promise<void> {
  const body = request.body;
  if (!body) return;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    // The stream is locked or already consumed: nothing to discard.
    return;
  }
  await drainReader(reader, maxBytes);
}

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Number of ISO-8601 weeks in a calendar year: 52 or 53. A year has 53 weeks
 * iff January 1 is a Thursday, or it is a leap year and January 1 is a
 * Wednesday.
 */
export function isoWeeksInYear(year: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const weekday = jan1.getUTCDay(); // 0 = Sunday .. 4 = Thursday
  return weekday === 4 || (isLeapYear(year) && weekday === 3) ? 53 : 52;
}

/** `true` for a syntactically valid ISO week that actually exists. */
export function isValidIsoWeek(week: string): boolean {
  if (!WEEK_RE.test(week)) return false;
  const year = Number(week.slice(0, 4));
  const number = Number(week.slice(6));
  return number >= 1 && number <= isoWeeksInYear(year);
}

/**
 * ISO-8601 timestamp with a fixed +08:00 offset (Asia/Shanghai has had no DST
 * since 1991), e.g. `2026-09-28T00:41:12+08:00`.
 */
export function shanghaiIso(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

/**
 * Reads a request body enforcing a hard byte cap. Rejects early when the
 * declared Content-Length already exceeds the limit, and otherwise counts
 * bytes as they stream in so a client cannot exhaust memory by lying about
 * its length.
 */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = (request.headers.get("content-length") || "").trim();
  if (/^\d+$/.test(declared) && Number(declared) > maxBytes) throw new PayloadTooLargeError();
  const body = request.body;
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Keep draining the rest of the stream (bounded) instead of cancelling
      // immediately, so the dev proxy can release the connection, then reject.
      await drainReader(reader, DISCARD_BODY_MAX_BYTES);
      throw new PayloadTooLargeError();
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

/** Canonical public base URL: explicit env override, else the request origin. */
export function publicBaseUrl(env: { DABAIHUA_PUBLIC_BASE_URL?: string }, request: Request): string {
  const configured = (env.DABAIHUA_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

/** Splits stored bytes into <= `size` chunks (always at least one chunk). */
export function splitChunks(bytes: Uint8Array, size: number = WEEKLY_CHUNK_BYTES): Uint8Array[] {
  if (bytes.byteLength === 0) return [bytes];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size) {
    chunks.push(bytes.slice(offset, Math.min(offset + size, bytes.byteLength)));
  }
  return chunks;
}

/** D1 BLOBs may arrive as number[] / ArrayBuffer / Uint8Array. */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return new Uint8Array(0);
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type WeeklyReportMeta = {
  week: string;
  userId: number;
  bytes: number;
  sha256: string;
  chunkCount: number;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  nickname?: string;
};

function mapReport(row: Record<string, unknown>): WeeklyReportMeta {
  return {
    week: String(row.week || ""),
    userId: Number(row.userId || 0),
    bytes: Number(row.bytes || 0),
    sha256: String(row.sha256 || ""),
    chunkCount: Number(row.chunkCount || 0),
    currentVersion: Number(row.currentVersion || 0),
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || ""),
    nickname: row.nickname === undefined || row.nickname === null ? undefined : String(row.nickname),
  };
}

const REPORT_SELECT = "SELECT w.week AS week, w.user_id AS userId, w.bytes AS bytes, w.content_sha256 AS sha256, w.chunk_count AS chunkCount, w.current_version AS currentVersion, w.created_at AS createdAt, w.updated_at AS updatedAt, COALESCE(u.nickname, '') AS nickname FROM weekly_reports w LEFT JOIN users u ON u.id = w.user_id";

export async function getWeeklyReportMeta(env: WeeklyEnv, week: string): Promise<WeeklyReportMeta | null> {
  await ensureWeeklySchema(env);
  const row = await env.DB.prepare(`${REPORT_SELECT} WHERE w.week = ?`).bind(week).first<Record<string, unknown>>();
  return row ? mapReport(row) : null;
}

/** Lists reports newest ISO week first; pass a userId to scope to one account. */
export async function listWeeklyReports(env: WeeklyEnv, userId?: number): Promise<WeeklyReportMeta[]> {
  await ensureWeeklySchema(env);
  const statement = userId === undefined
    ? env.DB.prepare(`${REPORT_SELECT} ORDER BY w.week DESC`)
    : env.DB.prepare(`${REPORT_SELECT} WHERE w.user_id = ? ORDER BY w.week DESC`).bind(userId);
  const rows = await statement.all<Record<string, unknown>>();
  return rows.results.map(mapReport);
}

/** Returns the current version's bytes, or null when absent/incomplete. */
export async function getWeeklyReportHtml(env: WeeklyEnv, week: string): Promise<Uint8Array | null> {
  await ensureWeeklySchema(env);
  const meta = await env.DB.prepare("SELECT id, bytes, current_version AS currentVersion FROM weekly_reports WHERE week = ?")
    .bind(week).first<{ id: number; bytes: number; currentVersion: number }>();
  if (!meta || Number(meta.currentVersion) < 1) return null;
  const rows = await env.DB.prepare("SELECT data FROM weekly_report_chunks WHERE report_id = ? AND version = ? ORDER BY idx")
    .bind(meta.id, Number(meta.currentVersion)).all<{ data: unknown }>();
  if (rows.results.length === 0) return null;
  const parts = rows.results.map((row) => toBytes(row.data));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total !== Number(meta.bytes)) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

async function insertChunks(env: WeeklyEnv, reportId: number, version: number, chunks: Uint8Array[]) {
  const statements = chunks.map((chunk, idx) =>
    env.DB.prepare("INSERT INTO weekly_report_chunks (report_id, version, idx, data) VALUES (?, ?, ?, ?)").bind(reportId, version, idx, chunk),
  );
  if (statements.length > 0) await env.DB.batch(statements);
}

export type WeeklyPutResult = {
  created: boolean;
  bytes: number;
  sha256: string;
  chunkCount: number;
  updatedAt: string;
};

/**
 * Publishes (or overwrites) one week's report. New chunks are written under
 * `version + 1` before the pointer is flipped, and versions older than the
 * last `WEEKLY_KEEP_VERSIONS` are pruned afterwards.
 */
export async function putWeeklyReport(env: WeeklyEnv, week: string, userId: number, bytes: Uint8Array): Promise<WeeklyPutResult> {
  await ensureWeeklySchema(env);
  const sha256 = await sha256HexBytes(bytes);
  const chunks = splitChunks(bytes);
  const timestamp = shanghaiIso();
  const existing = await env.DB.prepare("SELECT id, current_version AS currentVersion FROM weekly_reports WHERE week = ?")
    .bind(week).first<{ id: number; currentVersion: number }>();
  let reportId: number;
  let version: number;
  let created: boolean;
  if (existing) {
    created = false;
    reportId = Number(existing.id);
    version = Number(existing.currentVersion || 0) + 1;
    await insertChunks(env, reportId, version, chunks);
    await env.DB.batch([
      env.DB.prepare("UPDATE weekly_reports SET bytes = ?, content_sha256 = ?, chunk_count = ?, current_version = ?, updated_at = ? WHERE id = ?")
        .bind(bytes.byteLength, sha256, chunks.length, version, timestamp, reportId),
      env.DB.prepare("DELETE FROM weekly_report_chunks WHERE report_id = ? AND version <= ?")
        .bind(reportId, version - WEEKLY_KEEP_VERSIONS),
    ]);
  } else {
    created = true;
    const inserted = await env.DB.prepare("INSERT INTO weekly_reports (week, user_id, bytes, content_sha256, chunk_count, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
      .bind(week, userId, bytes.byteLength, sha256, chunks.length, timestamp, timestamp).run();
    reportId = Number(inserted.meta.last_row_id);
    version = 1;
    await insertChunks(env, reportId, version, chunks);
    await env.DB.prepare("UPDATE weekly_reports SET current_version = ?, updated_at = ? WHERE id = ?")
      .bind(version, timestamp, reportId).run();
  }
  return { created, bytes: bytes.byteLength, sha256, chunkCount: chunks.length, updatedAt: timestamp };
}

export async function deleteWeeklyReport(env: WeeklyEnv, week: string): Promise<boolean> {
  await ensureWeeklySchema(env);
  const row = await env.DB.prepare("SELECT id FROM weekly_reports WHERE week = ?").bind(week).first<{ id: number }>();
  if (!row) return false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM weekly_report_chunks WHERE report_id = ?").bind(row.id),
    env.DB.prepare("DELETE FROM weekly_reports WHERE id = ?").bind(row.id),
  ]);
  return true;
}

/** `true` while the account is under the rolling upload cap. */
export async function checkWeeklyUploadRate(env: WeeklyEnv, userId: number): Promise<boolean> {
  await ensureWeeklySchema(env);
  const cutoff = new Date(Date.now() - WEEKLY_UPLOAD_WINDOW_MS).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM weekly_upload_log WHERE user_id = ? AND at >= ?")
    .bind(userId, cutoff).first<{ count: number }>();
  return Number(row?.count || 0) < WEEKLY_UPLOAD_LIMIT;
}

/** Records one accepted upload and prunes log rows older than an hour. */
export async function recordWeeklyUpload(env: WeeklyEnv, userId: number): Promise<void> {
  await ensureWeeklySchema(env);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO weekly_upload_log (user_id, at) VALUES (?, ?)").bind(userId, new Date().toISOString()),
    env.DB.prepare("DELETE FROM weekly_upload_log WHERE datetime(at) < datetime('now', '-1 hour')"),
  ]);
}
