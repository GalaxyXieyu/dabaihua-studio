/**
 * 「记住我（30 天）」与会话滚动续期：纯规则 + 登录页 / worker 的静态约束。
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BROWSER_SESSION_SECONDS,
  PERSISTENT_SESSION_SECONDS,
  REFRESH_AFTER_SECONDS,
  buildSessionCookie,
  isSecureHost,
  rememberFromInput,
  sessionLifetimeSeconds,
  shouldRefreshSession,
} from "../lib/session-policy.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-03T02:00:00.000Z");
const iso = (ms) => new Date(now.getTime() + ms).toISOString();

test("session lifetimes: remember = 30 days, browser session = 12 hours", () => {
  assert.equal(PERSISTENT_SESSION_SECONDS, 2592000);
  assert.equal(BROWSER_SESSION_SECONDS, 43200);
  assert.equal(REFRESH_AFTER_SECONDS, 86400);
  assert.equal(sessionLifetimeSeconds(true), 2592000);
  assert.equal(sessionLifetimeSeconds(false), 43200);
});

test("remember defaults to true when absent (CLI and old clients keep 30 days)", () => {
  assert.equal(rememberFromInput(undefined), true);
  assert.equal(rememberFromInput(null), true);
  assert.equal(rememberFromInput(true), true);
  assert.equal(rememberFromInput("on"), true);
  assert.equal(rememberFromInput(false), false);
  assert.equal(rememberFromInput("false"), false);
  assert.equal(rememberFromInput(0), false);
  assert.equal(rememberFromInput("off"), false);
});

test("persistent cookie carries Max-Age=2592000, browser cookie has no Max-Age", () => {
  const persistent = buildSessionCookie({ token: "abc", secure: true, maxAge: PERSISTENT_SESSION_SECONDS });
  assert.equal(persistent, "rss_ai_session=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure");
  const browser = buildSessionCookie({ token: "abc", secure: true, maxAge: null });
  assert.equal(browser, "rss_ai_session=abc; Path=/; HttpOnly; SameSite=Lax; Secure");
  assert.doesNotMatch(browser, /Max-Age|Expires/i);
  const cleared = buildSessionCookie({ token: "", secure: false, maxAge: 0 });
  assert.equal(cleared, "rss_ai_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  assert.equal(isSecureHost("localhost"), false);
  assert.equal(isSecureHost("127.0.0.1"), false);
  assert.equal(isSecureHost("superme.example"), true);
});

test("rolling refresh only after ~1 day, only for persistent, never for expired", () => {
  // 刚登录：expires_at = now + 30d → 不续
  assert.equal(shouldRefreshSession({ persistent: true, expiresAt: iso(30 * DAY), now }), false);
  // 23 小时前登录 → 不续
  assert.equal(shouldRefreshSession({ persistent: true, expiresAt: iso(30 * DAY - 23 * 3600 * 1000), now }), false);
  // 正好 1 天、2 天、20 天前 → 续
  assert.equal(shouldRefreshSession({ persistent: true, expiresAt: iso(29 * DAY), now }), true);
  assert.equal(shouldRefreshSession({ persistent: true, expiresAt: iso(28 * DAY), now }), true);
  assert.equal(shouldRefreshSession({ persistent: true, expiresAt: iso(10 * DAY), now }), true);
  // 浏览器会话不续
  assert.equal(shouldRefreshSession({ persistent: false, expiresAt: iso(60 * 1000), now }), false);
  // 过期的不复活
  assert.equal(shouldRefreshSession({ persistent: true, expiresAt: iso(-1000), now }), false);
  assert.equal(shouldRefreshSession({ persistent: true, expiresAt: "garbage", now }), false);
  // 旧会话（SQLite datetime 文本也能解析）
  assert.equal(shouldRefreshSession({ persistent: true, expiresAt: "2026-10-20T00:00:00.000Z", now }), true);
});

test("login page: remember checkbox ticked by default, sends remember, keeps password-save attributes", async () => {
  const page = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(page, /useState\(true\)/);
  assert.match(page, /type="checkbox"/);
  assert.match(page, /name="remember"/);
  assert.match(page, /checked=\{remember\}/);
  assert.match(page, /记住我（30 天）/);
  assert.match(page, /JSON\.stringify\(\{ action: "login", account, password, remember \}\)/);
  // 680765c：浏览器保存密码
  assert.match(page, /name="username"/);
  assert.match(page, /autoComplete="username"/);
  assert.match(page, /name="password"/);
  assert.match(page, /autoComplete="current-password"/);
  assert.match(page, /<form method="post"/);
  assert.match(page, /PasswordCredential/);
  assert.match(page, /navigator\.credentials\.store/);
  // 微信内置浏览器提示
  assert.match(page, /MicroMessenger/);
  const css = await readFile(new URL("../app/login/login.css", import.meta.url), "utf8");
  assert.match(css, /\.login-a-remember/);
  assert.match(css, /\.login-a-check:checked/);
  assert.match(css, /\.login-a-wechat/);
});

test("server: sessions record persistence, worker rolls persistent sessions", async () => {
  const auth = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /INSERT INTO auth_sessions \(token_hash, user_id, created_at, expires_at, last_seen_at, persistent\)/);
  assert.match(auth, /rememberFromInput\(input\.remember\)/);
  assert.match(auth, /export async function refreshSessionCookie/);
  assert.match(auth, /UPDATE auth_sessions SET expires_at = \?/);
  const store = await readFile(new URL("../lib/store.ts", import.meta.url), "utf8");
  assert.match(store, /ALTER TABLE auth_sessions ADD COLUMN persistent INTEGER NOT NULL DEFAULT 1/);
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /refreshSessionCookie\(env, request\)/);
  assert.match(worker, /headers\.append\("set-cookie", refreshed\)/);
  const route = await readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
  assert.match(route, /remember\?: unknown/);
  const migration = await readFile(new URL("../drizzle/0021_session_persistent.sql", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE `auth_sessions` ADD `persistent` integer DEFAULT 1 NOT NULL/);
});
