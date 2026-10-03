import { ensureSchema } from "./store";
import {
  buildSessionCookie,
  isSecureHost,
  PERSISTENT_SESSION_SECONDS,
  rememberFromInput,
  SESSION_COOKIE,
  sessionLifetimeSeconds,
  shouldRefreshSession,
} from "./session-policy";

export type AuthEnv = { DB: D1Database; DABAIHUA_ALLOW_REGISTER?: string; DABAIHUA_REGISTER_INVITE_CODE?: string };
export type SessionUser = {
  id: number;
  account: string;
  nickname: string;
  bio: string;
  avatarUrl: string | null;
  role: "user" | "admin";
  createdAt: string;
};

// Cloudflare Workers Web Crypto supports PBKDF2 iteration counts up to 100,000.
const PASSWORD_ITERATIONS = 100_000;
const encoder = new TextEncoder();

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = new Uint8Array(salt).buffer;
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

/** persistent=true → Max-Age 30 天；false → 浏览器会话 cookie；token 为空表示删除。 */
function sessionCookie(request: Request, token: string, persistent = true) {
  const secure = isSecureHost(new URL(request.url).hostname);
  const maxAge = token === "" ? 0 : persistent ? PERSISTENT_SESSION_SECONDS : null;
  return buildSessionCookie({ token, secure, maxAge });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AuthError("请求来源不合法", 403);
}

export function normalizeAccount(value: string) {
  const account = value.normalize("NFKC").trim();
  if (!account || account.length > 64) throw new AuthError("账号长度应为 1–64 个字符");
  return { account, normalized: account.toLocaleLowerCase("en-US") };
}

function validateNickname(value: string) {
  const nickname = value.normalize("NFKC").trim();
  if (!nickname || nickname.length > 40) throw new AuthError("昵称长度应为 1–40 个字符");
  return nickname;
}

function validatePassword(value: string) {
  if (value.length < 8 || value.length > 128) throw new AuthError("密码长度应为 8–128 个字符");
  return value;
}

function publicUser(row: Record<string, unknown>): SessionUser {
  const id = Number(row.id);
  const avatarKey = String(row.avatarKey || "");
  const avatarVersion = avatarKey.split("/").at(-1);
  return {
    id,
    account: String(row.account || ""),
    nickname: String(row.nickname || ""),
    bio: String(row.bio || ""),
    avatarUrl: avatarKey ? `/api/profile/avatar?id=${id}&v=${encodeURIComponent(avatarVersion || avatarKey)}` : null,
    role: row.role === "admin" ? "admin" : "user",
    createdAt: String(row.createdAt || row.created_at || ""),
  };
}

async function attemptKey(request: Request, action: "login" | "register", account: string) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return sha256(`${action}|${ip}|${account}`);
}

async function checkRateLimit(env: AuthEnv, request: Request, action: "login" | "register", account: string) {
  const key = await attemptKey(request, action, account);
  const limit = action === "login" ? 5 : 8;
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE attempt_key = ? AND action = ? AND succeeded = 0 AND datetime(attempted_at) >= datetime('now', '-15 minutes')")
    .bind(key, action).first<{ count: number }>();
  if (Number(recent?.count || 0) >= limit) throw new AuthError("尝试次数过多，请 15 分钟后再试", 429);
  return key;
}

async function recordAttempt(env: AuthEnv, key: string, action: "login" | "register", succeeded: boolean) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO auth_attempts (attempt_key, action, succeeded, attempted_at) VALUES (?, ?, ?, ?)").bind(key, action, succeeded ? 1 : 0, new Date().toISOString()),
    env.DB.prepare("DELETE FROM auth_attempts WHERE datetime(attempted_at) < datetime('now', '-1 day')"),
  ]);
}

async function createSession(env: AuthEnv, userId: number, persistent = true) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(raw);
  const tokenHash = await sha256(token);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + sessionLifetimeSeconds(persistent) * 1000);
  await env.DB.prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at, last_seen_at, persistent) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(tokenHash, userId, createdAt.toISOString(), expiresAt.toISOString(), createdAt.toISOString(), persistent ? 1 : 0).run();
  return token;
}

async function apiTokenUser(env: AuthEnv, request: Request) {
  const result = await authenticateApiKey(env, request);
  return result.status === "ok" ? result.user : null;
}

export type ApiKeyAuthResult =
  | { status: "missing" | "malformed" | "invalid" }
  | { status: "ok"; user: SessionUser };

/**
 * Single implementation of the `Authorization: Bearer topk_...` scheme used by
 * every authenticated `/api/*` route. Never logs the header or the key.
 */
export async function authenticateApiKey(env: AuthEnv, request: Request): Promise<ApiKeyAuthResult> {
  const header = request.headers.get("authorization") || "";
  if (!header.trim()) return { status: "missing" };
  const matched = /^Bearer\s+(topk_[a-f0-9]{32,64})$/.exec(header);
  if (!matched) return { status: "malformed" };
  await ensureSchema(env.DB);
  const tokenHash = await sha256(matched[1]);
  const row = await env.DB.prepare("SELECT u.id, u.account, u.nickname, u.bio, u.avatar_key AS avatarKey, u.role, u.created_at AS createdAt FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?")
    .bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return { status: "invalid" };
  await env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), tokenHash).run();
  return { status: "ok", user: publicUser(row) };
}

export async function createApiToken(env: AuthEnv, userId: number, name: string) {
  await ensureSchema(env.DB);
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = "topk_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const cleanName = (name || "cli").trim().slice(0, 40) || "cli";
  const createdAt = new Date().toISOString();
  const result = await env.DB.prepare("INSERT INTO api_tokens (user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(userId, cleanName, await sha256(token), createdAt).run();
  return { id: Number(result.meta.last_row_id), name: cleanName, token, createdAt };
}

export async function listApiTokens(env: AuthEnv, userId: number) {
  await ensureSchema(env.DB);
  const rows = await env.DB.prepare("SELECT id, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM api_tokens WHERE user_id = ? ORDER BY id").bind(userId).all();
  return rows.results;
}

export async function revokeApiToken(env: AuthEnv, userId: number, id: number) {
  await ensureSchema(env.DB);
  await env.DB.prepare("DELETE FROM api_tokens WHERE user_id = ? AND id = ?").bind(userId, id).run();
}

export async function getSessionUser(env: AuthEnv, request: Request) {
  const viaToken = await apiTokenUser(env, request);
  if (viaToken) return viaToken;
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  await ensureSchema(env.DB);
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare("SELECT u.id, u.account, u.nickname, u.bio, u.avatar_key AS avatarKey, u.role, u.created_at AS createdAt FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')")
    .bind(tokenHash).first<Record<string, unknown>>();
  if (!row) return null;
  await env.DB.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").bind(new Date().toISOString(), tokenHash).run();
  return publicUser(row);
}

/**
 * 滚动续期：持久会话距上次续期超过 1 天时，把 expires_at 推到「现在 + 30 天」，
 * 并返回要重发的 Set-Cookie；不需要续期（或没有有效会话）时返回 null。
 * 由 worker 在页面导航请求上调用。
 */
export async function refreshSessionCookie(env: AuthEnv, request: Request): Promise<string | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  await ensureSchema(env.DB);
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare("SELECT expires_at AS expiresAt, persistent FROM auth_sessions WHERE token_hash = ?")
    .bind(tokenHash).first<{ expiresAt: string; persistent: number }>();
  if (!row) return null;
  const now = new Date();
  if (!shouldRefreshSession({ persistent: Number(row.persistent) !== 0, expiresAt: String(row.expiresAt), now })) return null;
  const expiresAt = new Date(now.getTime() + PERSISTENT_SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare("UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ? AND datetime(expires_at) > datetime('now')")
    .bind(expiresAt, tokenHash).run();
  return sessionCookie(request, token, true);
}

export async function requireSessionUser(env: AuthEnv, request: Request) {
  const user = await getSessionUser(env, request);
  if (!user) throw new AuthError("请先登录后再继续", 401);
  return user;
}

export async function registerUser(env: AuthEnv, request: Request, input: { account?: string; password?: string; confirmPassword?: string; nickname?: string; inviteCode?: string }) {
  assertSameOrigin(request);
  const allowRegister = (env.DABAIHUA_ALLOW_REGISTER || "").trim().toLowerCase();
  if (["0", "false", "no", "off", "closed"].includes(allowRegister)) throw new AuthError("注册已关闭，请联系管理员", 403);
  const inviteCode = (env.DABAIHUA_REGISTER_INVITE_CODE || "").trim();
  if (inviteCode && !constantTimeEqual((input.inviteCode || "").trim(), inviteCode)) throw new AuthError("邀请码不正确", 403);
  await ensureSchema(env.DB);
  const { account, normalized } = normalizeAccount(input.account || "");
  const password = validatePassword(input.password || "");
  if (password !== input.confirmPassword) throw new AuthError("两次输入的密码不一致");
  const nickname = validateNickname(input.nickname || "");
  const key = await checkRateLimit(env, request, "register", normalized);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE account_normalized = ?").bind(normalized).first();
  if (existing) {
    await recordAttempt(env, key, "register", false);
    throw new AuthError("这个账号已经被注册", 409);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePasswordHash(password, salt);
  const timestamp = new Date().toISOString();
  try {
    const inserted = await env.DB.prepare("INSERT INTO users (account, account_normalized, password_hash, password_salt, password_iterations, nickname, bio, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', 'user', ?, ?)")
      .bind(account, normalized, passwordHash, bytesToBase64Url(salt), PASSWORD_ITERATIONS, nickname, timestamp, timestamp).run();
    const userId = Number(inserted.meta.last_row_id);
    const token = await createSession(env, userId);
    await recordAttempt(env, key, "register", true);
    const user = await env.DB.prepare("SELECT id, account, nickname, bio, avatar_key AS avatarKey, role, created_at AS createdAt FROM users WHERE id = ?").bind(userId).first<Record<string, unknown>>();
    if (!user) throw new AuthError("注册失败，请稍后再试", 500);
    return { user: publicUser(user), cookie: sessionCookie(request, token) };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    await recordAttempt(env, key, "register", false);
    if (String(error).toLowerCase().includes("unique")) throw new AuthError("这个账号已经被注册", 409);
    throw error;
  }
}

export async function loginUser(env: AuthEnv, request: Request, input: { account?: string; password?: string; remember?: unknown }) {
  assertSameOrigin(request);
  await ensureSchema(env.DB);
  const { normalized } = normalizeAccount(input.account || "");
  const password = input.password || "";
  const key = await checkRateLimit(env, request, "login", normalized);
  const row = await env.DB.prepare("SELECT id, account, nickname, bio, avatar_key AS avatarKey, role, created_at AS createdAt, password_hash AS passwordHash, password_salt AS passwordSalt, password_iterations AS passwordIterations FROM users WHERE account_normalized = ?")
    .bind(normalized).first<Record<string, unknown>>();
  let valid = false;
  if (row) {
    const derived = await derivePasswordHash(password, base64UrlToBytes(String(row.passwordSalt)), Number(row.passwordIterations || PASSWORD_ITERATIONS));
    valid = constantTimeEqual(derived, String(row.passwordHash));
  }
  await recordAttempt(env, key, "login", valid);
  if (!row || !valid) throw new AuthError("账号或密码不正确", 401);
  const persistent = rememberFromInput(input.remember);
  const token = await createSession(env, Number(row.id), persistent);
  return { user: publicUser(row), cookie: sessionCookie(request, token, persistent) };
}

export async function logoutUser(env: AuthEnv, request: Request) {
  assertSameOrigin(request);
  await ensureSchema(env.DB);
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return sessionCookie(request, "");
}

export async function updateProfile(env: AuthEnv, request: Request, input: { nickname?: string; bio?: string }) {
  assertSameOrigin(request);
  const user = await requireSessionUser(env, request);
  const nickname = validateNickname(input.nickname || "");
  const bio = (input.bio || "").normalize("NFKC").trim();
  if (bio.length > 300) throw new AuthError("个人简介最多 300 个字符");
  await env.DB.prepare("UPDATE users SET nickname = ?, bio = ?, updated_at = ? WHERE id = ?").bind(nickname, bio, new Date().toISOString(), user.id).run();
  return { ...user, nickname, bio };
}

export async function changePassword(env: AuthEnv, request: Request, input: { currentPassword?: string; newPassword?: string; confirmPassword?: string }) {
  assertSameOrigin(request);
  const user = await requireSessionUser(env, request);
  const nextPassword = validatePassword(input.newPassword || "");
  if (nextPassword !== input.confirmPassword) throw new AuthError("两次输入的新密码不一致");
  const row = await env.DB.prepare("SELECT password_hash AS passwordHash, password_salt AS passwordSalt, password_iterations AS passwordIterations FROM users WHERE id = ?")
    .bind(user.id).first<Record<string, unknown>>();
  if (!row) throw new AuthError("账号不存在", 404);
  const currentHash = await derivePasswordHash(input.currentPassword || "", base64UrlToBytes(String(row.passwordSalt)), Number(row.passwordIterations || PASSWORD_ITERATIONS));
  if (!constantTimeEqual(currentHash, String(row.passwordHash))) throw new AuthError("当前密码不正确", 401);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePasswordHash(nextPassword, salt);
  const current = await env.DB.prepare("SELECT persistent FROM auth_sessions WHERE token_hash = ?")
    .bind(await sha256(cookieValue(request, SESSION_COOKIE))).first<{ persistent: number }>();
  const persistent = current ? Number(current.persistent) !== 0 : true;
  const token = await createSession(env, user.id, persistent);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?").bind(passwordHash, bytesToBase64Url(salt), PASSWORD_ITERATIONS, new Date().toISOString(), user.id),
    env.DB.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND token_hash <> ?").bind(user.id, await sha256(token)),
  ]);
  return { user, cookie: sessionCookie(request, token, persistent) };
}

export function authErrorResponse(error: unknown, fallback = "操作失败") {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  // 领域错误（如 ArticleAccessError）自带 HTTP status 时按它返回。
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status < 600) {
      return Response.json({ error: error instanceof Error ? error.message : fallback }, { status });
    }
  }
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status: 400 });
}
