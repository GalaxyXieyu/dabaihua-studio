import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { htmlToMarkdown } from "../lib/article.ts";
import { collectXArticlePages } from "../lib/x-pagination.ts";
import { normalizeXPublishedAt } from "../lib/x-date.ts";
import { inferSourceCategory, isSourceCategory } from "../lib/source-category.ts";
import { localImageReferences, readMarkdownDocument } from "../scripts/backfill-wechat-markdown.mjs";
import { dailySyncDecision, describeCollectorError, describeSyncResultError, isManagedCacheDirectory, managedCacheRoot, normalizeWechatProfileName, normalizeWechatPublishTime, retryablePartialImport } from "../scripts/wechat-subscription-sync.mjs";

test("converts entity-escaped feed HTML before rendering Markdown", () => {
  const markdown = htmlToMarkdown('&lt;img src=&quot;https://cdn.example.com/cover.jpg&quot; alt=&quot;封面&quot;&gt;&lt;p&gt;&lt;strong&gt;最新文字&lt;/strong&gt;&lt;br&gt;正文&lt;/p&gt;');
  assert.match(markdown, /!\[封面\]\(https:\/\/cdn\.example\.com\/cover\.jpg\)/);
  assert.match(markdown, /\*\*最新文字\*\*/);
  assert.doesNotMatch(markdown, /<img|<p>|&lt;/);
});

test("keeps heart-knot exploration versioned and direction confirmation explicit", async () => {
  const [schema, store, sensemaking, explorationRoute, directionRoute, migration, cli] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sensemaking.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/itches/[id]/explorations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/itches/[id]/directions/[directionId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0012_slim_scarlet_spider.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/cli/topics", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /export const explorations/);
  assert.match(schema, /export const directions/);
  assert.match(schema, /status: text\("status", \{ enum: \["candidate", "confirmed", "rejected", "retired"\] \}\)\.notNull\(\)\.default\("candidate"\)/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS explorations/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS directions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `explorations`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `directions`/);
  assert.match(sensemaking, /COALESCE\(MAX\(round\), 0\) \+ 1/);
  assert.match(sensemaking, /WHERE id = \? AND itch_id = \? AND user_id = \?/);
  assert.match(sensemaking, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, 'candidate', \?, \?\)/);
  assert.match(sensemaking, /status === "confirmed" \? timestamp : null/);
  assert.match(explorationRoute, /requireSessionUser/);
  assert.match(directionRoute, /body\.action === "confirm"/);
  assert.match(cli, /topics itch confirm <id> --direction/);
  assert.match(cli, /"action": action/);
});

test("keeps leaderboard fallback avatars centered independently from nickname styles", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.equal([...page.matchAll(/className="rank-user-name"/g)].length, 2);
  assert.match(styles, /\.rank-user-name,\.rank-stats strong,\.rank-stats small \{ display:block; \}/);
  assert.doesNotMatch(styles, /\.rank-user-link span,/);
  assert.doesNotMatch(styles, /\.rank-user-link > span \{/);
});

test("ships public passage annotations, one-level replies, plaza feeds, personal history, and immersive discovery reading", async () => {
  const [page, styles, store, schema, route, migration, plazaPage] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/annotations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0009_chilly_mantis.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/annotations/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /export const annotations/);
  assert.match(schema, /export const annotationReplies/);
  assert.match(migration, /CREATE TABLE `annotations`/);
  assert.match(migration, /CREATE TABLE `annotation_replies`/);
  assert.match(store, /listItemAnnotations/);
  assert.match(store, /listAnnotationPlaza/);
  assert.match(store, /listUserAnnotations/);
  assert.match(store, /reply_to_user_id AS replyToUserId/);
  assert.match(store, /const text = String\(value \|\| ""\)\.trim\(\);/);
  assert.match(route, /requireSessionUser/);
  assert.match(route, /scope === "plaza"/);
  assert.match(route, /scope === "mine"/);
  assert.match(page, /data-annotation-block/);
  assert.match(page, /selection-annotation-action/);
  assert.match(page, /批注广场/);
  assert.match(page, /我的批注/);
  assert.match(page, /plazaSort === "latest"/);
  assert.match(page, /plazaSort === "hot"/);
  assert.match(page, /discoverImmersive/);
  assert.match(page, /返回来源列表/);
  assert.match(page, /sidebarDraft/);
  assert.equal([...page.matchAll(/onSelection=\{handleArticleSelection\}/g)].length, 2);
  assert.match(page, /登录清流阅读/);
  assert.match(styles, /reader-annotation-layout\.with-sidebar/);
  assert.match(styles, /annotation-sidebar/);
  assert.match(styles, /discover-immersive/);
  assert.match(plazaPage, /initialView="annotations"/);
});

test("ships real owner and visitor profiles, profile interactions, notifications, and underline-only annotations", async () => {
  const [page, styles, store, schema, migration, profileRoute, notificationRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_dry_pride.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/notifications/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /export const profileLikes/);
  assert.match(schema, /export const profileMessages/);
  assert.match(schema, /export const notifications/);
  assert.match(migration, /CREATE TABLE `profile_likes`/);
  assert.match(migration, /CREATE TABLE `profile_messages`/);
  assert.match(migration, /CREATE TABLE `notifications`/);
  assert.match(store, /getPublicProfile/);
  assert.match(store, /toggleProfileLike/);
  assert.match(store, /createProfileMessage/);
  assert.match(store, /'annotation_reply'/);
  assert.match(store, /'profile_message'/);
  assert.match(store, /'profile_like'/);
  assert.match(profileRoute, /getSessionUser/);
  assert.match(profileRoute, /body\.action === "like"/);
  assert.match(profileRoute, /body\.action === "message"/);
  assert.match(notificationRoute, /markNotificationsRead/);
  assert.match(page, /function openProfile/);
  assert.match(page, /profileData\.isOwner/);
  assert.match(page, /global-notification/);
  assert.match(page, /收到的主页赞/);
  assert.match(page, /留言板/);
  assert.doesNotMatch(page, /查看访客视角/);
  assert.match(page, /::highlight\(reader-annotations\)\{color:inherit;background:transparent/);
  assert.doesNotMatch(page, /::highlight\(reader-annotations\)[^}]*background:oklch/);
  assert.match(styles, /\.notification-menu/);
  assert.match(styles, /\.profile-page-shell/);
  assert.match(styles, /\.profile-metrics/);
  assert.match(styles, /\.profile-message-list/);
});

test("keeps the reading workspace adjustable and annotation interactions recoverable", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /ARTICLE_PANE_WIDTH_PREFERENCE/);
  assert.match(page, /storedValue === null/);
  assert.match(page, /className="reader-resize-handle" role="separator"/);
  assert.match(page, /onPointerDown=\{startArticlePaneResize\}/);
  assert.match(page, /onKeyDown=\{resizeArticlePaneWithKeyboard\}/);
  assert.match(page, /window\.addEventListener\("pointerup", finishSelection, true\)/);
  assert.match(page, /caretPositionFromPoint/);
  assert.match(page, /onAnnotationFocus=\{\(annotation\) => focusAnnotation\(annotation, "document"\)\}/);
  assert.match(page, /annotation-card-marker/);
  assert.match(page, /annotation-reopen-button/);
  assert.match(page, /loadLinkedItem\(annotation\.itemId\)/);
  assert.match(page, /keepAnnotationPosition\(block, card\)/);
  assert.match(page, /\.reader-document img/);
  assert.match(page, /Node\.DOCUMENT_POSITION_FOLLOWING/);
  assert.match(page, /attempts < 40/);
  assert.match(page, /requestedAnnotationId\.current = null/);
  assert.match(styles, /--article-pane-width/);
  assert.match(styles, /\.reader-resize-handle/);
  assert.match(styles, /\.annotation-card\.active/);
  assert.match(styles, /\.annotation-reopen-button/);
});

test("keeps source controls and profile sections on consistent visual grids", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.ok(page.indexOf("收录新来源") < page.indexOf("source-section-title"), "the primary source action should appear before the long source list");
  assert.match(page, /className="source-count"/);
  assert.match(page, /取消关注/);
  assert.match(page, /删除来源/);
  assert.match(page, /profile-content-stack/);
  assert.doesNotMatch(page, /profile-content-sheet/);
  assert.match(page, /followedSources\.slice\(0, 8\)/);
  assert.match(styles, /\.reader-workspace\.sources-collapsed \{ grid-template-columns:56px/);
  assert.match(styles, /\.sources-collapsed \.source-filter \.source-avatar \{ width:30px; height:30px;/);
  assert.match(styles, /\.sources-collapsed \.source-pane \.brand-copy,\.sources-collapsed \.source-copy,\.sources-collapsed \.source-count,\.sources-collapsed \.source-filter > em \{ display:none; \}/);
  assert.match(styles, /\.sources-collapsed \.add-source-button \{ width:36px; min-height:36px; margin:0 auto;/);
  assert.match(styles, /\.sources-collapsed \.source-row-primary \{ min-height:30px; grid-template-columns:30px; gap:0; \}/);
  assert.match(styles, /\.profile-section-title \{ display:inline-flex; align-items:baseline; gap:6px;/);
  assert.match(styles, /\.profile-annotation-list \{[^}]*align-items:start/);
  assert.match(styles, /\.profile-source-more\[open\] > summary \{ order:2;/);
  assert.match(styles, /\.profile-annotation-list \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.profile-source-list \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.article-pane-header \{[^}]*align-items:center/);
  assert.match(styles, /\.article-pane-context \{[^}]*align-items:center/);
  assert.match(styles, /\.article-pane-count \{[^}]*align-items:center/);
});

test("keeps lightweight routes off the reading-data path and progressively renders discovery", async () => {
  const [page, styles, store, auth, dashboardRoute, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  const dashboardStart = store.indexOf("export async function dashboard");
  const dashboardEnd = store.indexOf("export async function addSource", dashboardStart);
  const dashboardBody = store.slice(dashboardStart, dashboardEnd);
  const sessionStart = auth.indexOf("export async function getSessionUser");
  const sessionEnd = auth.indexOf("export async function requireSessionUser", sessionStart);
  const sessionBody = auth.slice(sessionStart, sessionEnd);

  assert.match(store, /const schemaReady = new WeakMap/);
  assert.match(store, /SELECT value FROM app_meta WHERE key = 'schema_version'/);
  assert.doesNotMatch(dashboardBody, /promotePendingXArticles/);
  assert.match(worker, /await promotePendingXArticles\(env\)/);
  assert.ok(sessionBody.indexOf("cookieValue") < sessionBody.indexOf("ensureSchema"), "anonymous session checks must avoid schema maintenance");
  assert.match(dashboardRoute, /needsReadingData/);
  assert.match(dashboardRoute, /itemsLoaded: false/);
  assert.match(page, /\/api\/dashboard\?view=\$\{initialView\}/);
  assert.match(page, /const ARTICLE_BATCH_SIZE = 60/);
  assert.match(page, /renderedItems\.map/);
  assert.doesNotMatch(page, /visibleItems\.map/);
  assert.match(page, /inert=\{mobileViewport && !mobileSourcePaneOpen/);
  assert.match(styles, /content-visibility:auto/);
  assert.match(styles, /max-width:1179px/);
  assert.match(styles, /mobile-sources-open/);
});

test("background reading heartbeats never mark an article read or replace the active article", async () => {
  const [page, store] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
  ]);
  const clientHeartbeat = page.match(/useEffect\(\(\) => \{\n    if \(!heartbeatItemId[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || "";
  const serverHeartbeat = store.match(/export async function recordReadingHeartbeat[\s\S]*?\n}\n\nexport async function leaderboard/)?.[0] || "";
  const manualMarkRead = page.match(/async function markSelectedRead\(\)[\s\S]*?\n  }\n\n  async function advanceToday/)?.[0] || "";

  assert.ok(clientHeartbeat, "client heartbeat effect should exist");
  assert.ok(serverHeartbeat, "server heartbeat function should exist");
  assert.ok(manualMarkRead, "manual mark-read action should exist");
  assert.doesNotMatch(clientHeartbeat, /setData|setSourceItems|setNotice|setSelectedItemId|setTodayItemId/);
  assert.doesNotMatch(serverHeartbeat, /markItemRead/);
  assert.match(manualMarkRead, /setSelectedItemId\(selectedItem\.id\)/);
  assert.match(page, /const effectiveItemId = selectedItemId && currentItems\.some\(\(item\) => item\.id === selectedItemId\) \? selectedItemId : null/);
  assert.doesNotMatch(page, /selectedItemId : visibleItems\[0\]\?\.id/);
  assert.doesNotMatch(page, /有效阅读满 10 秒的文章会自动移动到这里/);
});

test("normalizes WeChat publication time from Asia Shanghai", () => {
  assert.equal(normalizeWechatPublishTime("2026-07-14 17:47:40"), "2026-07-14T09:47:40.000Z");
  assert.equal(normalizeWechatPublishTime(""), undefined);
});

test("waits until 09:30 Shanghai time and catches up after a late login", () => {
  assert.deepEqual(dailySyncDecision(new Date("2026-07-16T01:29:59.000Z"), "2026-07-15\n"), {
    today: "2026-07-16",
    shouldRun: false,
    reason: "before-window",
  });
  assert.deepEqual(dailySyncDecision(new Date("2026-07-16T01:30:00.000Z"), "2026-07-15\n"), {
    today: "2026-07-16",
    shouldRun: true,
    reason: "ready",
  });
  assert.equal(dailySyncDecision(new Date("2026-07-16T04:00:00.000Z"), "2026-07-15").shouldRun, true);
  assert.deepEqual(dailySyncDecision(new Date("2026-07-16T04:00:00.000Z"), "2026-07-16\n"), {
    today: "2026-07-16",
    shouldRun: false,
    reason: "completed",
  });
});

test("treats expired WeChat sessions and empty sync results as failures", () => {
  assert.equal(describeCollectorError({ base_resp: { ret: 200003, err_msg: "invalid session" } }), "invalid session");
  assert.equal(describeSyncResultError({ ok: true, fetched_count: 0 }), "公众号没有返回任何文章，登录态可能已失效");
  assert.equal(describeSyncResultError({ ok: true, fetched_count: 20 }), "");
});

test("uses curl and a browser User-Agent for the WeChat exporter edge", () => {
  const wrapper = fileURLToPath(new URL("../scripts/wechat-exporter-browser.py", import.meta.url));
  const result = spawnSync("python3", [wrapper, "--probe-transport"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.transport, "curl");
  assert.match(payload.user_agent, /^Mozilla\/5\.0/);
  assert.doesNotMatch(payload.user_agent, /^Moore-WeChat-Exporter\//);
});

test("keeps the public-account nickname separate from article author and follow UI", () => {
  assert.equal(normalizeWechatProfileName(" 摸鱼小李 ", "⮕点击关注"), "摸鱼小李");
  assert.equal(normalizeWechatProfileName("⮕点击关注", "摸鱼小李"), "摸鱼小李");
  assert.equal(normalizeWechatProfileName("36氪", "剡沛"), "36氪");
  assert.equal(normalizeWechatProfileName("⮕点击关注"), "");
  assert.equal(normalizeWechatProfileName("unknown-account"), "");
});

test("keeps a partial WeChat import pending until its history is complete", () => {
  assert.deepEqual(retryablePartialImport({ resultName: "AI沃茨", itemCount: 1 }, "invalid session"), {
    status: "pending",
    stage: "retrying",
    resultName: "AI沃茨",
    itemCount: 1,
    error: "invalid session",
  });
});

test("rejects broken X epoch dates and falls back to reliable publication time", () => {
  const now = Date.parse("2026-07-15T00:00:00.000Z");
  assert.equal(
    normalizeXPublishedAt(["1970-01-01T00:00:00.000Z", "Sun May 25 01:14:39 +0000 2026"], "2058718355138158777", now),
    "2026-05-25T01:14:39.000Z",
  );
  assert.equal(normalizeXPublishedAt([1_780_189_200], "", now), "2026-05-31T01:00:00.000Z");
  assert.equal(normalizeXPublishedAt([0], "2058718355138158777", now)?.slice(0, 10), "2026-05-25");
  assert.equal(normalizeXPublishedAt(["not-a-date"], "", now), null);
});

test("paginates X articles until the promised 20 unique entries are collected", async () => {
  const cursors = [];
  const statuses = await collectXArticlePages(async (cursor) => {
    cursors.push(cursor);
    if (!cursor) {
      return {
        results: Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1), url: `https://x.com/example/status/${index + 1}` })),
        cursor: { bottom: "next-page" },
      };
    }
    return {
      results: Array.from({ length: 14 }, (_, index) => ({ id: String(index + 12), url: `https://x.com/example/status/${index + 12}` })),
      cursor: { bottom: "last-page" },
    };
  });

  assert.deepEqual(cursors, ["", "next-page"]);
  assert.equal(statuses.length, 20);
  assert.deepEqual(statuses.map((status) => status.id), Array.from({ length: 20 }, (_, index) => String(index + 1)));
});

test("only treats hidden collector-owned directories as disposable cache", () => {
  assert.equal(isManagedCacheDirectory(path.join(managedCacheRoot, "one-import")), true);
  assert.equal(isManagedCacheDirectory(managedCacheRoot), false);
  assert.equal(isManagedCacheDirectory(path.join(process.env.HOME || "/tmp", "Downloads", "wechat-articles")), false);
});

test("keeps downloaded WeChat body and discovers local images for upload", () => {
  const downloaded = `---\nauthor: "示例作者"\nsource_url: "https://example.com/article"\n---\n\n第一段正文。\n\n![image](../images/006/001.png)\n\n第二段正文。`;
  const parsed = readMarkdownDocument(downloaded);
  assert.equal(parsed.metadata.author, "示例作者");
  assert.equal(parsed.contentMarkdown, "第一段正文。\n\n![image](../images/006/001.png)\n\n第二段正文。");
  assert.deepEqual(localImageReferences(parsed.contentMarkdown), [{ full: "![image](../images/006/001.png)", alt: "image", relativePath: "006/001.png" }]);
});

test("classifies existing sources into the six fixed navigation categories", () => {
  assert.equal(inferSourceCategory("OpenAI", ["GPT-5.6 is available"]), "ai");
  assert.equal(inferSourceCategory("G1en", ["波动率仍然很大", "7月财报季展望"]), "investment");
  assert.equal(inferSourceCategory("36氪", ["腾讯重仓一个 IPO"]), "business");
  assert.equal(inferSourceCategory("游戏葡萄", ["新作正式发行"]), "gaming");
  assert.equal(inferSourceCategory("阮一峰的网络日志", ["本周开源项目"]), "technology");
  assert.equal(inferSourceCategory("人人都是产品经理", ["用户体验与增长"]), "product");
  assert.equal(isSourceCategory("other"), false);
});

test("ships secure accounts, personal state, source follows, contributors, and daily leaderboards", async () => {
  const [auth, store, schema, migration, avatarMigration, followMigration, page, styles, avatarRoute, sourceRoute, readingRoute, leaderboardRoute] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_pretty_justice.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_yummy_norrin_radd.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0008_complete_proemial_gods.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/profile/avatar/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sources/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reading/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/leaderboard/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(auth, /PBKDF2/);
  assert.match(auth, /PASSWORD_ITERATIONS = 100_000/);
  assert.doesNotMatch(auth, /PASSWORD_ITERATIONS = 210_000/);
  assert.match(auth, /value\.normalize\("NFKC"\)\.trim\(\)/);
  assert.match(auth, /toLocaleLowerCase\("en-US"\)/);
  assert.match(auth, /password_salt/);
  assert.match(auth, /HttpOnly; SameSite=Lax/);
  assert.match(auth, /DELETE FROM auth_sessions WHERE user_id = \? AND token_hash <> \?/);
  assert.doesNotMatch(auth, /INSERT INTO users[^\n]*password[^\n]*\.bind\([^\n]*password,/);
  assert.match(schema, /accountNormalized:[\s\S]*unique\(\)/);
  assert.match(schema, /role:[\s\S]*enum: \["user", "admin"\]/);
  assert.match(schema, /avatarUrl: text\("avatar_url"\)/);
  assert.match(schema, /category: text\("category", \{ enum: \["ai", "investment", "gaming", "technology", "business", "product"\] \}\)/);
  assert.match(schema, /userSourceFollows/);
  assert.match(followMigration, /CREATE TABLE `user_source_follows`/);
  assert.match(followMigration, /INSERT OR IGNORE INTO `user_source_follows`/);
  assert.match(avatarMigration, /ALTER TABLE `sources` ADD `avatar_url` text/);
  assert.ok(migration.indexOf("CREATE TABLE `users`") < migration.indexOf("CREATE TABLE `auth_sessions`"), "users must exist before session foreign keys");
  assert.doesNotMatch(migration, /ADD `stage`|ADD `result_name`|ADD `item_count`/);
  assert.match(store, /user_item_states/);
  assert.match(store, /daily_reading_activity/);
  assert.match(store, /contributor_user_id/);
  assert.match(store, /setSourceFollowing/);
  assert.doesNotMatch(store, /SELECT u\.id, s\.id, \? FROM users u CROSS JOIN sources s/);
  assert.match(store, /legacy_source_follow_seed_cleanup_v1/);
  assert.match(store, /WHERE f\.user_id = \? ORDER BY f\.created_at DESC, s\.id DESC LIMIT 24/);
  assert.match(store, /\.bind\(profileUserId\)\.all\(\)/);
  assert.match(store, /CASE WHEN usf\.user_id IS NULL THEN 0 ELSE 1 END AS isFollowed/);
  assert.match(store, /backfillSourceCategories/);
  assert.match(store, /COALESCE\(u.nickname, '站点收录'\)/);
  assert.match(store, /elapsed >= 5 && elapsed <= 35/);
  assert.match(store, /Math\.min\(elapsed, 20\)/);
  assert.match(store, /Asia\/Shanghai/);
  assert.match(store, /ORDER BY readCount DESC, readSeconds DESC, u.created_at ASC/);
  assert.match(store, /ORDER BY contributionCount DESC, firstContributionAt ASC, u.created_at ASC/);
  assert.match(store, /LEFT JOIN sources s ON s\.contributor_user_id = u\.id GROUP BY u\.id ORDER BY contributionCount/);
  assert.doesNotMatch(store, /s\.contributor_user_id = u\.id AND date\(s\.created_at/);
  assert.match(sourceRoute, /requireSessionUser/);
  assert.match(sourceRoute, /assertSourceContributor/);
  assert.match(sourceRoute, /body\.action === "follow"/);
  assert.match(readingRoute, /requireSessionUser/);
  assert.match(leaderboardRoute, /export async function GET/);
  assert.match(avatarRoute, /2 \* 1024 \* 1024/);
  assert.match(avatarRoute, /hasValidSignature/);
  assert.match(avatarRoute, /cache-control", "no-store, max-age=0"/);
  assert.match(avatarRoute, /encodeURIComponent\(key\.split\("\/"\)\.at\(-1\) \|\| key\)/);
  assert.match(auth, /avatarKey\.split\("\/"\)\.at\(-1\)/);
  assert.match(store, /avatarKey\.split\("\/"\)\.at\(-1\)/);
  assert.match(page, /source-entry-contributor/);
  assert.match(page, /source\.contributorNickname/);
  assert.match(page, /function SourceAvatar/);
  assert.match(page, /referrerPolicy="no-referrer"/);
  assert.match(styles, /source-row-primary \{[^}]*grid-template-columns:40px minmax\(0,1fr\) auto/);
  assert.match(styles, /\.reader-workspace \{[^}]*grid-template-columns:280px var\(--article-pane-width\) minmax\(560px,1fr\)/);
  assert.match(styles, /\.user-menu\.global-user-menu \{[^}]*right:0[^}]*top:calc\(100% \+ 8px\)[^}]*width:168px/);
  assert.match(styles, /\.global-appbar \{[^}]*z-index:var\(--z-appbar\)/);
  assert.match(styles, /\.article-pane-header \{[^}]*padding:10px 16px[^}]*align-items:center/);
  assert.match(styles, /\.article-status-tabs \{[^}]*margin:8px 16px[^}]*padding:4px/);
  assert.match(styles, /\.user-menu button \{[^}]*white-space:nowrap/);
  assert.match(styles, /\.article-pane-header h1 \{[^}]*text-overflow:ellipsis/);
  assert.match(styles, /\.article-pane-context > button \{[^}]*white-space:nowrap/);
  assert.match(page, /阅读榜/);
  assert.match(page, /贡献榜/);
  assert.match(page, /className="global-appbar"/);
  assert.match(page, /aria-label="主导航"/);
  assert.match(page, /className="brand-block source-context-header"/);
  assert.match(page, /immersiveTodayReading/);
  assert.match(page, /账号已经创建并自动登录/);
  assert.match(page, /auth-feedback error/);
  assert.doesNotMatch(page, /aria-label="未读"|article-row-foot/);
  assert.match(page, /className="read-status"/);
  assert.match(page, /已读<\/span>/);
  assert.match(page, /article-status-tabs/);
  assert.match(page, /按分类筛选来源/);
  assert.match(page, /source-category-choice/);
  assert.match(page, /articleStatus === "read"/);
  assert.match(page, /在文章中点击「标记已读」后，文章会出现在这里/);
  assert.doesNotMatch(page, /已完成有效阅读，这篇文章已移入「已读」/);
  assert.match(page, /阅读文章/);
  assert.match(page, /阅读时间/);
  assert.match(page, /贡献来源/);
  assert.match(page, /leaderboardMetric === "reading" && <div className="segmented"/);
  assert.match(page, /leaderboardMetric === "contribution" \? "全站累计"/);
  assert.match(page, /size="leaderboard"/);
  assert.match(page, /function RankMarker/);
  assert.match(page, /position <= 3 \? "podium"/);
  assert.doesNotMatch(page, /🥇|🥈|🥉/);
  assert.doesNotMatch(page, /有效阅读已达到 10 秒/);
  assert.match(styles, /\.rank-stats \{[^}]*grid-template-columns:112px 136px/);
  assert.match(styles, /\.rank-stats > span \{[^}]*align-items:center[^}]*text-align:center/);
  assert.match(styles, /\.rank-stats strong \{[^}]*font-variant-numeric:tabular-nums[^}]*text-align:center/);
  assert.match(styles, /\.user-avatar\.leaderboard \{[^}]*width:58px[^}]*height:58px/);
  assert.match(page, /TOAST_DURATION_MS = 4_000/);
  assert.match(page, /window\.setTimeout\(\(\) => setNotice\(""\), TOAST_DURATION_MS\)/);
  assert.match(page, /await verifyImageCanRender\(result\.avatarUrl\)/);
  assert.match(page, /上传成功，头像已更新/);
  assert.match(page, /avatar-feedback/);
  assert.match(store, /LIMIT 500/);
  assert.match(page, /window\.setInterval\(heartbeat, 15_000\)/);
  assert.match(page, /window\.setInterval\(refreshToday, TODAY_REFRESH_INTERVAL_MS\)/);
  assert.match(page, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(page, /const hasNewUnread = dashboard\.items\.some/);
  assert.match(page, /Date\.now\(\) - lastActivityAt\.current > 60_000/);
  assert.match(page, /const heartbeatItemId = selectedItem\?\.id \|\| null/);
  assert.match(page, /post<\{ activeSeconds: number \}>\("\/api\/reading"/);
  assert.doesNotMatch(page, /\[data\.user, selectedItem, view\]/);
});

test("defines the Qingliu Reader shell", async () => {
  const [page, layout, discoverPage] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/discover/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /const title = "清流阅读 · RSS \/ X \/ 公众号"/i);
  assert.match(page, /清流阅读/);
  assert.match(page, /今天，他们为你更新了/);
  assert.match(page, /开始今日阅读/);
  assert.match(page, /发现来源/);
  assert.match(page, /收录新来源/);
  assert.match(discoverPage, /initialView="discover"/);
  assert.match(page, /initialView = "today"/);
  assert.match(page, /MarkdownArticle/);
  assert.match(page, /function articleBlocks/);
  assert.match(page, /markdownImage\.test\(line\)/);
  assert.match(page, /\\\/wechat-media\\\//);
  assert.doesNotMatch(page, /target="_blank"[^>]*><h[23]>/);
  assert.doesNotMatch(`${page}${layout}`, /信号站|每天十分钟|免费订阅/);
});

test("ships unified subscriptions, daily sync, translation, reading, and idea workflows", async () => {
  const [page, store, feed, xReader, worker, packageJson, aiRoute, ideaRoute, sourceRoute, sourceAvatarRoute, itemRoute, importQueueRoute, wechatSync, browserFetch, backfill, wechatLaunchAgent, viteConfig] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/feed.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/x.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ideas/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sources/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/source-avatar/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/items/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/import-queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/wechat-subscription-sync.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sites-browser-fetch.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/backfill-wechat-markdown.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/com.personal-intel-desk.wechat-sync.plist", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /\/api\/sources/);
  assert.match(page, /\/api\/items/);
  assert.match(aiRoute, /processPendingItems/);
  assert.match(ideaRoute, /generateIdea/);
  assert.match(store, /parseFeed/);
  assert.match(store, /processPendingItems/);
  assert.match(store, /importWechatArticles/);
  assert.match(store, /result_name AS resultName/);
  assert.match(store, /stage, result_name AS resultName, item_count AS itemCount[\s\S]*status = 'pending'/);
  assert.match(store, /stage TEXT NOT NULL DEFAULT 'queued'/);
  assert.match(store, /requestId/);
  assert.match(store, /getItemDetail/);
  assert.match(store, /normalized !== stored[\s\S]*UPDATE items SET content_markdown/);
  assert.match(store, /listSourceItems/);
  assert.match(store, /COUNT\(\*\).*AS itemCount/);
  assert.match(store, /SELECT COUNT\(\*\) AS totalItems FROM items/);
  assert.match(store, /totalItems: Number\(totalRow\?\.totalItems/);
  assert.match(store, /content_markdown/);
  assert.match(store, /ON CONFLICT\(url\) DO UPDATE/);
  assert.match(store, /resolveFeed/);
  assert.match(store, /saveFeedEntries/);
  assert.match(store, /kind === "rss"[\s\S]*content_markdown = COALESCE/);
  assert.match(store, /addSubscription/);
  assert.match(store, /addXSource/);
  assert.match(store, /readXArticles/);
  assert.match(store, /syncSourcesByKind/);
  assert.match(store, /kind = \?/);
  assert.match(store, /promotePendingXArticles/);
  assert.match(feed, /discoverFeedLinks/);
  assert.match(sourceRoute, /addSubscription/);
  assert.match(sourceRoute, /deleteSource/);
  assert.match(sourceAvatarRoute, /readXProfile/);
  assert.match(sourceAvatarRoute, /favicon\.ico/);
  assert.match(sourceAvatarRoute, /max-age=86400/);
  assert.match(itemRoute, /sourceId/);
  assert.match(itemRoute, /listSourceItems/);
  assert.match(itemRoute, /body\.avatarUrl \?\? ""/);
  assert.match(importQueueRoute, /pendingWechatSubscriptions/);
  assert.match(importQueueRoute, /requireImportAccess/);
  assert.match(importQueueRoute, /resultName/);
  assert.match(browserFetch, /BROWSER_FETCH_TIMEOUT_MS = 90_000/);
  assert.match(browserFetch, /浏览器采集桥请求超时/);
  assert.match(wechatSync, /parsed\.ok === false/);
  assert.match(wechatSync, /baseResponse\.ret/);
  assert.match(wechatSync, /fetched_count/);
  assert.match(wechatSync, /errors\.push\(`\$\{accountName\}: \$\{message\}`\)/);
  assert.match(wechatSync, /if \(!result\.ok\) process\.exitCode = 1/);
  assert.match(wechatSync, /avatarUrl: String\(account\.avatar_url/);
  assert.match(wechatSync, /if \(failed === 0\)[\s\S]*writeFile\(stateFile/);
  assert.match(wechatSync, /pending = \{[\s\S]*读取公众号导入队列失败/);
  assert.match(wechatSync, /Number\(task\.itemCount\) > 0 && task\.resultName/);
  assert.match(wechatSync, /if \(partialImport\)[\s\S]*retryablePartialImport/);
  assert.match(wechatSync, /status: "pending"[\s\S]*stage: "retrying"/);
  assert.doesNotMatch(page, /网络有波动，正在自动重试/);
  assert.match(page, /历史文章会在后续同步中继续补齐/);
  assert.match(importQueueRoute, /itemCount/);
  assert.match(page, /立即同步/);
  assert.match(page, /首次导入最近 20 篇/);
  assert.match(page, /粘贴作者主页、公众号文章或博客地址/);
  assert.doesNotMatch(page, /接入队列|还没接通/);
  assert.match(page, /X 文章已保存/);
  assert.match(page, /codeFence/);
  assert.match(xReader, /api\.fxtwitter\.com/);
  assert.match(xReader, /articleMarkdown/);
  assert.match(xReader, /xProfileAddress/);
  assert.match(xReader, /api\.fxtwitter\.com\/2\/profile\/\$\{encodeURIComponent\(safeUsername\)\}\/articles\?count=20/);
  assert.doesNotMatch(xReader, /nitter\.net|xcancel\.com|nitter\.catsarch\.com/);
  assert.doesNotMatch(xReader, /feed\.xml\?count=20/);
  assert.match(store, /if \(!existing\) await deleteSource\(env, source\.id\)/);
  assert.match(store, /kind === "link"[\s\S]*source_id IS NULL/);
  assert.match(store, /kind = 'x_article'/);
  assert.match(store, /DELETE FROM items WHERE source_id = \? AND kind = 'link'/);
  assert.doesNotMatch(store, /免费 X RSS 桥/);
  assert.match(importQueueRoute, /sync-all/);
  assert.match(importQueueRoute, /sync-due/);
  assert.match(viteConfig, /\*\/15 \* \* \* \*/);
  assert.match(worker, /syncDueSources/);
  assert.match(store, /sync_interval_minutes/);
  assert.match(store, /CASE kind WHEN 'x' THEN 60 ELSE 1440 END/);
  assert.match(sourceRoute, /set-interval/);
  assert.match(page, /X 默认每小时更新，其他默认每天更新/);
  assert.match(page, /source\.itemCount/);
  assert.match(page, /data\.sources\.length/);
  assert.match(page, /todayEstimatedMinutes/);
  assert.match(page, /todayAvatarStack|today-avatar-stack/);
  assert.match(page, /\/api\/items\?sourceId=/);
  assert.doesNotMatch(page, /sourceCounts/);
  assert.match(wechatSync, /exporter-account-by-url/);
  assert.match(wechatSync, /extract_account_clues/);
  assert.match(wechatSync, /await importDownloaded\(submitted\.outputDir/);
  assert.match(wechatSync, /reportTask\(task, "reading"\)/);
  assert.match(wechatSync, /reportTask\(task, "importing"/);
  assert.match(wechatSync, /reportTask\(task, "history"/);
  assert.match(wechatSync, /stage: "completed"/);
  assert.match(wechatSync, /`request-\$\{Number\(requestId\)/);
  assert.match(wechatSync, /--output-dir", requestCache/);
  assert.match(wechatSync, /isManagedCacheDirectory/);
  assert.match(wechatSync, /await rm\(directory, \{ recursive: true, force: true \}\)/);
  assert.ok(wechatSync.indexOf("if (backfill.status !== 0)") < wechatSync.indexOf("await cleanupImportedCache(outputDir)"), "cache cleanup must happen only after upload succeeds");
  assert.match(wechatSync, /exporter-sync/);
  assert.ok(wechatSync.indexOf("await importDownloaded(submitted.outputDir") < wechatSync.indexOf("syncExporterAccount(account.id)"), "submitted WeChat article must be imported before history sync");
  assert.doesNotMatch(wechatSync, /--no-assets/);
  assert.match(wechatSync, /"20"/);
  assert.match(wechatSync, /api\/import-queue/);
  assert.match(backfill, /--account-name/);
  assert.match(page, /通常 1 分钟内开始识别/);
  assert.match(page, /2500/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /正在识别公众号作者/);
  assert.match(page, /正在补齐/);
  assert.match(page, /已加入左侧/);
  assert.match(wechatLaunchAgent, /<integer>60<\/integer>/);
  assert.match(backfill, /readMarkdownDocument/);
  assert.match(backfill, /articleHash/);
  assert.match(worker, /scheduled/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
