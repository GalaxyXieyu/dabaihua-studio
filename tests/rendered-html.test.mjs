import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { htmlToMarkdown } from "../lib/article.ts";
import { collectXArticlePages } from "../lib/x-pagination.ts";
import { normalizeXPublishedAt } from "../lib/x-date.ts";
import { inferSourceCategory, isSourceCategory } from "../lib/source-category.ts";
import { matchesHostPattern, secureRedirectResponse, upgradeForwardedRequest, upgradeForwardedRequestWithFlag } from "../lib/trusted-proxy.ts";
import { splitSentences } from "../lib/sentences.ts";
import { PayloadTooLargeError, discardBody, isValidIsoWeek, publicBaseUrl, readBodyWithLimit, shanghaiIso } from "../lib/weekly.ts";

test("converts entity-escaped feed HTML before rendering Markdown", () => {
  const markdown = htmlToMarkdown('&lt;img src=&quot;https://cdn.example.com/cover.jpg&quot; alt=&quot;封面&quot;&gt;&lt;p&gt;&lt;strong&gt;最新文字&lt;/strong&gt;&lt;br&gt;正文&lt;/p&gt;');
  assert.match(markdown, /!\[封面\]\(https:\/\/cdn\.example\.com\/cover\.jpg\)/);
  assert.match(markdown, /\*\*最新文字\*\*/);
  assert.doesNotMatch(markdown, /<img|<p>|&lt;/);
});

test("splits sentences for the touch reviewer with offsets into the original text", () => {
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences("   \n  "), []);
  assert.deepEqual(splitSentences("一句话没有标点"), [{ text: "一句话没有标点", start: 0, end: 7 }]);

  assert.deepEqual(splitSentences("今天很好。明天更好！"), [
    { text: "今天很好。", start: 0, end: 5 },
    { text: "明天更好！", start: 5, end: 10 },
  ]);

  assert.deepEqual(splitSentences('He said "Go!" then left.'), [
    { text: 'He said "Go!"', start: 0, end: 13 },
    { text: "then left.", start: 14, end: 24 },
  ]);

  assert.deepEqual(splitSentences("甲；乙。丙"), [
    { text: "甲；乙。", start: 0, end: 4 },
    { text: "丙", start: 4, end: 5 },
  ]);

  assert.deepEqual(splitSentences("真的吗？」好"), [
    { text: "真的吗？」", start: 0, end: 5 },
    { text: "好", start: 5, end: 6 },
  ]);

  assert.deepEqual(splitSentences("什么?! 好。"), [
    { text: "什么?!", start: 0, end: 4 },
    { text: "好。", start: 5, end: 7 },
  ]);

  assert.deepEqual(splitSentences("  \n。 "), [{ text: "。", start: 3, end: 4 }]);
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
  assert.match(page, /登录\$\{BRAND_NAME\}/);
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
  assert.match(worker, /upgradeForwardedRequestWithFlag/);
  assert.match(worker, /secureRedirectResponse/);
  assert.match(worker, /upgrade\.upgraded/);
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

test("defines the Dabaihua Studio shell", async () => {
  const [page, layout, discoverPage, brand] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/discover/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/brand.ts", import.meta.url), "utf8"),
  ]);
  assert.match(brand, /BRAND_NAME = "大白话工作室"/);
  assert.match(brand, /BRAND_TITLE = `\$\{BRAND_NAME\} · RSS \/ X \/ 公众号`/);
  assert.match(layout, /BRAND_TITLE/);
  assert.match(page, /\{BRAND_NAME\}/);
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
  const [page, store, feed, xReader, worker, packageJson, aiRoute, ideaRoute, sourceRoute, sourceAvatarRoute, itemRoute, importQueueRoute, viteConfig] = await Promise.all([
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
  assert.match(page, /通常 1 分钟内开始识别/);
  assert.match(page, /2500/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /正在识别公众号作者/);
  assert.match(page, /正在补齐/);
  assert.match(page, /已加入左侧/);
  assert.match(worker, /scheduled/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("ships topic drafts through the pi editing pipeline", async () => {
  const [store, topics, route, draft] = await Promise.all([
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/topics.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/topics/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/draft-article.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(store, /"draft_markdown"/);
  assert.match(store, /"draft_updated_at"/);
  assert.match(topics, /export async function getTopic/);
  assert.match(topics, /hasDraft/);
  assert.match(route, /export async function GET/);
  assert.match(draft, /validateLinks/);
  assert.match(draft, /stdio: \["ignore"/);
});

test("ships the mobile topic review page with persisted annotations and decisions", async () => {
  const [store, schema, migration, route, reviews, page, topicCard] = await Promise.all([
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0013_topic_reviews.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/topics/[id]/reviews/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/reviews.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/review/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/_components/TopicCard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(store, /CREATE TABLE IF NOT EXISTS topic_reviews/);
  assert.match(store, /"review_status"/);
  assert.match(schema, /export const topicReviews/);
  assert.match(migration, /topic_reviews/);
  assert.match(route, /requireSessionUser/);
  assert.match(route, /"reject"/);
  assert.match(reviews, /打回必须填写意见/);
  assert.doesNotMatch(reviews, /SET status/);
  assert.match(page, /redirect\(/);
  assert.match(page, /\/login\?next=/);
  assert.match(topicCard, /\/review\//);
});

test("parses review markdown into safe blocks and inline tokens", async () => {
  const { parseMarkdownBlocks, parseInline } = await import("../lib/review-markdown.ts");

  const blocks = parseMarkdownBlocks("# 标题\n\n正文一段\n\n- 甲\n- 乙\n\n1. 一\n2. 二\n\n> 引用\n\n```js\nconst x = 1;\n```\n\n---");
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[0].text, "标题");
  assert.equal(blocks[0].index, 0);
  const paragraph = blocks.find((block) => block.type === "paragraph");
  assert.equal(paragraph.text, "正文一段");
  const unordered = blocks.find((block) => block.type === "list" && !block.ordered);
  assert.deepEqual(unordered.items, ["甲", "乙"]);
  const ordered = blocks.find((block) => block.type === "list" && block.ordered);
  assert.deepEqual(ordered.items, ["一", "二"]);
  const quote = blocks.find((block) => block.type === "blockquote");
  assert.equal(quote.text, "引用");
  const code = blocks.find((block) => block.type === "code");
  assert.equal(code.text, "const x = 1;");
  assert.equal(blocks.at(-1).type, "hr");

  assert.deepEqual(parseInline("**重点**"), [{ type: "bold", value: "重点" }]);
  assert.deepEqual(parseInline("[官网](https://example.com)"), [{ type: "link", value: "官网", href: "https://example.com" }]);
  const unsafe = parseInline("[点我](javascript:alert(1))");
  assert.equal(unsafe.some((token) => token.type === "link"), false);
});

test("ships a draft-box-only WeChat publish pipeline and reworks drafts from review feedback", async () => {
  const [publish, store, draft] = await Promise.all([
    readFile(new URL("../scripts/publish-draft.mjs", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/draft-article.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(publish, /gzh_article_publish/);
  assert.match(publish, /publish_article/);
  assert.match(publish, /freepublish/);
  assert.match(publish, /群发/);
  assert.match(publish, /process\.env\.DABAIHUA_WENYAN_API_KEY/);
  assert.match(publish, /--upload/);
  assert.match(publish, /stdio: \["ignore"/);
  assert.doesNotMatch(publish, /"message\/mass/);
  assert.doesNotMatch(publish, /freepublish\/submit/);
  assert.match(store, /publish_status/);
  assert.match(draft, /review-feedback\.md/);
  assert.match(draft, /resolved = 1/);
});

test("sanitizes trusted-pipeline gzh html conservatively", async () => {
  const { sanitizeArticleHtml } = await import("../lib/html-sanitize.ts");
  const html = [
    '<p onclick="steal()">hi</p>',
    "<script>alert(1)</script>",
    '<style>.x{color:red}</style>',
    '<a href="javascript:alert(1)">bad</a>',
    '<a href="vbscript:evil">also bad</a>',
    '<img src="images/cover.png">',
    '<img src="./images/cover-2.jpg">',
    '<a href="https://example.com/post">ok</a>',
  ].join("");
  const clean = sanitizeArticleHtml(html, { assetBase: "/api/articles/demo/assets" });
  assert.doesNotMatch(clean, /<script|<style/i);
  assert.doesNotMatch(clean, /onclick/i);
  assert.doesNotMatch(clean, /javascript:|vbscript:/i);
  assert.match(clean, /src="\/api\/articles\/demo\/assets\/images\/cover\.png"/);
  assert.match(clean, /src="\/api\/articles\/demo\/assets\/images\/cover-2\.jpg"/);
  assert.match(clean, /target="_blank"/);
  assert.match(clean, /rel="noopener noreferrer"/);
  assert.equal(sanitizeArticleHtml('<img src="data:image/png;base64,AAAA">'), '<img src="data:image/png;base64,AAAA">');
  assert.doesNotMatch(sanitizeArticleHtml('<img src="data:text/html;base64,AAAA">'), /data:text/);
  assert.doesNotMatch(sanitizeArticleHtml('<iframe src="https://evil.example"></iframe>'), /iframe/i);
});

test("renders markdown as a gzh html fragment with inline styles", async () => {
  const { renderMarkdownAsGzhHtml } = await import("../lib/gzh-markdown.ts");
  const html = renderMarkdownAsGzhHtml("# 标题\n\n正文一段，**加粗**。\n\n## 章节标题\n\n- 甲\n- 乙\n\n> 引用金句\n\n![封面](images/cover.png)\n\n[官网](https://example.com)", { assetBase: "/api/articles/demo/assets" });
  assert.match(html, /^<section style="/);
  assert.match(html, /#DC2626/);
  assert.doesNotMatch(html, /class=/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /\/api\/articles\/demo\/assets\/images\/cover\.png/);
  assert.match(html, /max-width:100%/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /<strong>/);
  const escaped = renderMarkdownAsGzhHtml("<script>alert(1)</script>");
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
});

test("keeps the article review backend, asset route, and sync script wired to the shared spec", async () => {
  const [store, schema, migration, domain, assetsRoute, articlesRoute, submitRoute, sync, packageJson, serveProd, draft] = await Promise.all([
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0014_article_review.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/article-review.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/articles/[slug]/assets/[...path]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/articles/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/review/[type]/[id]/submit/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sync-articles.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/serve-prod.sh", import.meta.url), "utf8"),
    readFile(new URL("../scripts/draft-article.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(store, /CREATE TABLE IF NOT EXISTS articles/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS article_assets/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS article_versions/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS review_marks/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS review_rounds/);
  assert.match(store, /SCHEMA_VERSION = "2026-08-03\.6"/);
  assert.match(schema, /export const articles/);
  assert.match(schema, /export const articleAssets/);
  assert.match(schema, /export const articleVersions/);
  assert.match(schema, /export const reviewMarks/);
  assert.match(schema, /export const reviewRounds/);
  assert.match(schema, /blob\("bytes", \{ mode: "buffer" \}\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `articles`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `review_marks`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `review_rounds`/);
  assert.match(domain, /export function buildFeedback/);
  assert.match(domain, /export async function submitReview/);
  assert.match(domain, /export async function listMarks/);
  assert.match(domain, /changes_requested/);
  assert.match(domain, /dabaihua\.review-feedback\/v1/);
  assert.match(assetsRoute, /\^images/);
  assert.match(assetsRoute, /includes\("\.\."\)/);
  assert.match(assetsRoute, /image\/svg\+xml/);
  assert.match(assetsRoute, /content-security-policy/);
  assert.doesNotMatch(assetsRoute, /node:fs|readFile/);
  assert.match(articlesRoute, /getSessionUser/);
  assert.match(submitRoute, /assertSameOrigin/);
  assert.match(submitRoute, /requireSessionUser/);
  assert.match(sync, /resolveD1Path/);
  assert.match(sync, /PRAGMA busy_timeout = 5000/);
  assert.match(sync, /lstatSync/);
  assert.match(sync, /review-feedback-\$\{row\.round\}\.json/);
  assert.match(sync, /review-feedback-\$\{row\.round\}\.md/);
  assert.match(sync, /exported_at IS NULL/);
  assert.match(sync, /topic-\$\{row\.targetId\}/);
  assert.match(sync, /SIGINT/);
  assert.match(packageJson, /"articles:sync": "node scripts\/sync-articles\.mjs"/);
  assert.match(packageJson, /"articles:watch": "node scripts\/sync-articles\.mjs --watch"/);
  assert.match(serveProd, /articles-watch\.pid/);
  assert.match(serveProd, /articles-watch\.log/);
  assert.match(serveProd, /start_watcher/);
  assert.match(serveProd, /stop_watcher/);
  assert.match(draft, /review_rounds/);
  assert.match(draft, /写得好/);
});

test("ships the phone-first article reviewer with range marks and verdict actions", async () => {
  const [reviewer, articlePage, articlesList, reviewPage, topicsPage] = await Promise.all([
    readFile(new URL("../app/_components/ArticleReviewer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/articles/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/articles/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/review/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(reviewer, /"use client"/);
  assert.match(reviewer, /selectionchange/);
  assert.match(reviewer, /pointer: coarse/);
  assert.match(reviewer, /ontouchstart/);
  assert.match(reviewer, /maxTouchPoints/);
  assert.match(reviewer, /userSelect: "none"/);
  assert.match(reviewer, /WebkitTouchCallout/);
  assert.match(reviewer, /splitSentences/);
  assert.match(reviewer, /data-testid="mark-action-bar"/);
  assert.match(reviewer, /data-testid="mark-good"/);
  assert.match(reviewer, /data-testid="mark-change"/);
  assert.match(reviewer, /data-testid="mark-cancel"/);
  assert.match(reviewer, /data-testid="mark-sentence-prev"/);
  assert.match(reviewer, /data-testid="mark-sentence-next"/);
  assert.match(reviewer, /data-testid="mark-sentence-whole"/);
  assert.match(reviewer, /data-testid="mark-sentence-label"/);
  assert.match(reviewer, /data-testid="mark-pending-text"/);
  assert.match(reviewer, /data-testid="mark-comment"/);
  assert.match(reviewer, /data-testid="mark-save"/);
  assert.match(reviewer, /data-testid="marks-list-button"/);
  assert.match(reviewer, /点一下段落即可标记/);
  assert.match(reviewer, /选中正文即可标记/);
  assert.match(reviewer, /prefix/);
  assert.match(reviewer, /suffix/);
  assert.match(reviewer, /exact/);
  assert.match(reviewer, /data-mark-id/);
  assert.match(reviewer, /`\$\{base\}\/marks`/);
  assert.match(reviewer, /\/api\/review\//);
  assert.match(reviewer, /dangerouslySetInnerHTML/);
  assert.match(reviewer, /env\(safe-area-inset-bottom\)/);
  // Highlights are injected by mutating the rendered article, so the touch
  // scope must keep container text offsets (not a detached DOM node) and the
  // dangerouslySetInnerHTML object must stay referentially stable across
  // re-renders or React resets the article and wipes every <mark>.
  assert.match(reviewer, /const articleHtml = useMemo\(\(\) => \(\{ __html: html \}\), \[html\]\)/);
  assert.match(reviewer, /dangerouslySetInnerHTML=\{articleHtml\}/);
  assert.match(reviewer, /blockStart/);
  assert.match(reviewer, /blockEnd/);
  assert.match(reviewer, /rangeFromOffsets\(container, start, end\)/);
  assert.doesNotMatch(reviewer, /touchScope\.block\b/);
  assert.doesNotMatch(reviewer, /rangeFromOffsets\(touchScope\.block/);

  assert.match(articlePage, /redirect\(`\/login\?next=\/articles\//);
  assert.match(articlePage, /getArticle/);
  assert.match(articlePage, /ArticleHeaderActions/);

  assert.match(articlesList, /listArticles/);
  assert.match(articlesList, /getSessionUser/);

  assert.match(reviewPage, /ArticleReviewer/);
  assert.match(reviewPage, /redirect\(/);
  assert.match(topicsPage, /\/articles/);
});

test("matches trusted proxy host patterns with exact names and leading wildcards", () => {
  assert.equal(matchesHostPattern("abc.trycloudflare.com", ["*.trycloudflare.com"]), true);
  assert.equal(matchesHostPattern("ABC.TryCloudflare.com", ["*.trycloudflare.com"]), true);
  assert.equal(matchesHostPattern("abc.trycloudflare.com:443", ["*.trycloudflare.com"]), true);
  assert.equal(matchesHostPattern("trycloudflare.com", ["*.trycloudflare.com"]), false);
  assert.equal(matchesHostPattern("evil-trycloudflare.com", ["*.trycloudflare.com"]), false);
  assert.equal(matchesHostPattern("example.com", ["example.com"]), true);
  assert.equal(matchesHostPattern("Example.com:8443", ["example.com"]), true);
  assert.equal(matchesHostPattern("sub.example.com", ["example.com"]), false);
  assert.equal(matchesHostPattern("example.com", []), false);
  assert.equal(matchesHostPattern("example.com", ["other.com", "example.com"]), true);
});

test("upgrades forwarded https requests on trusted hosts and leaves everything else alone", async () => {
  const request = new Request("http://abc.trycloudflare.com/articles/1?x=1", {
    headers: { host: "abc.trycloudflare.com", "x-forwarded-proto": "https" },
  });
  const upgraded = upgradeForwardedRequest(request, "*.trycloudflare.com");
  assert.equal(upgraded.url, "https://abc.trycloudflare.com/articles/1?x=1");
  assert.equal(upgraded.method, "GET");

  assert.equal(upgradeForwardedRequest(request, undefined).url, "http://abc.trycloudflare.com/articles/1?x=1");
  assert.equal(upgradeForwardedRequest(request, "example.com").url, "http://abc.trycloudflare.com/articles/1?x=1");

  const alreadySecure = new Request("https://abc.trycloudflare.com/");
  assert.equal(upgradeForwardedRequest(alreadySecure, "*.trycloudflare.com").url, "https://abc.trycloudflare.com/");

  const noForwardedProto = new Request("http://abc.trycloudflare.com/", { headers: { host: "abc.trycloudflare.com" } });
  assert.equal(upgradeForwardedRequest(noForwardedProto, "*.trycloudflare.com").url, "http://abc.trycloudflare.com/");

  const forwardedHttp = new Request("http://abc.trycloudflare.com/", {
    headers: { host: "abc.trycloudflare.com", "x-forwarded-proto": "http" },
  });
  assert.equal(upgradeForwardedRequest(forwardedHttp, "*.trycloudflare.com").url, "http://abc.trycloudflare.com/");

  const post = new Request("http://abc.trycloudflare.com/api/auth", {
    method: "POST",
    headers: { host: "abc.trycloudflare.com", "x-forwarded-proto": "https, http" },
    body: "payload",
  });
  const upgradedPost = upgradeForwardedRequest(post, "*.trycloudflare.com");
  assert.equal(upgradedPost.url, "https://abc.trycloudflare.com/api/auth");
  assert.equal(upgradedPost.method, "POST");
  assert.equal(await upgradedPost.text(), "payload");
});

test("rewrites proxy-injected insecure origins only when they match the trusted host", async () => {
  const withOrigin = (origin) => new Request("http://abc.trycloudflare.com/login?next=/today", {
    method: "POST",
    headers: { host: "abc.trycloudflare.com", "x-forwarded-proto": "https", origin, "content-type": "application/json" },
    body: "{}",
  });

  const matching = upgradeForwardedRequestWithFlag(withOrigin("http://abc.trycloudflare.com"), "*.trycloudflare.com");
  assert.equal(matching.upgraded, true);
  assert.equal(matching.request.url, "https://abc.trycloudflare.com/login?next=/today");
  assert.equal(matching.request.headers.get("origin"), "https://abc.trycloudflare.com");
  assert.equal(matching.request.headers.get("content-type"), "application/json");
  assert.equal(await matching.request.text(), "{}");

  const uppercase = upgradeForwardedRequest(withOrigin("HTTP://ABC.TryCloudflare.com"), "*.trycloudflare.com");
  assert.equal(uppercase.headers.get("origin"), "https://abc.trycloudflare.com");

  const foreign = upgradeForwardedRequest(withOrigin("http://evil.example"), "*.trycloudflare.com");
  assert.equal(foreign.headers.get("origin"), "http://evil.example");

  const secureOrigin = upgradeForwardedRequest(withOrigin("https://abc.trycloudflare.com"), "*.trycloudflare.com");
  assert.equal(secureOrigin.headers.get("origin"), "https://abc.trycloudflare.com");

  const notUpgraded = upgradeForwardedRequestWithFlag(withOrigin("http://abc.trycloudflare.com"), undefined);
  assert.equal(notUpgraded.upgraded, false);
  assert.equal(notUpgraded.request.headers.get("origin"), "http://abc.trycloudflare.com");
});

test("rewrites same-host absolute redirect Locations to relative on upgraded responses and leaves others alone", async () => {
  const request = new Request("https://abc.trycloudflare.com/login", { headers: { host: "abc.trycloudflare.com" } });

  const absolute = secureRedirectResponse(new Response(null, { status: 302, headers: { location: "http://abc.trycloudflare.com/login?next=/today" } }), request);
  assert.equal(absolute.status, 302);
  assert.equal(absolute.headers.get("location"), "/login?next=/today");

  const bareHost = secureRedirectResponse(new Response(null, { status: 307, headers: { location: "http://abc.trycloudflare.com" } }), request);
  assert.equal(bareHost.status, 307);
  assert.equal(bareHost.headers.get("location"), "/");

  const foreign = secureRedirectResponse(new Response(null, { status: 302, headers: { location: "http://evil.example/login" } }), request);
  assert.equal(foreign.headers.get("location"), "http://evil.example/login");

  const alreadySecure = secureRedirectResponse(new Response(null, { status: 302, headers: { location: "https://abc.trycloudflare.com/login" } }), request);
  assert.equal(alreadySecure.headers.get("location"), "/login");

  const relative = secureRedirectResponse(new Response(null, { status: 303, headers: { location: "/login?next=/today" } }), request);
  assert.equal(relative.headers.get("location"), "/login?next=/today");

  const protocolRelative = secureRedirectResponse(new Response(null, { status: 302, headers: { location: "//evil.com/login" } }), request);
  assert.equal(protocolRelative.headers.get("location"), "//evil.com/login");

  const plain = secureRedirectResponse(new Response("ok", { status: 200 }), request);
  assert.equal(plain.status, 200);
  assert.equal(await plain.text(), "ok");

  const streamed = secureRedirectResponse(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("body")); controller.close(); } }), { status: 302, headers: { location: "http://abc.trycloudflare.com/x" } }), request);
  assert.equal(await streamed.text(), "body");
  assert.equal(streamed.headers.get("location"), "/x");
});

test("gates registration behind DABAIHUA_ALLOW_REGISTER and an optional invite code", async () => {
  const [auth, route, page] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(auth, /DABAIHUA_ALLOW_REGISTER/);
  assert.match(auth, /DABAIHUA_REGISTER_INVITE_CODE/);
  assert.match(auth, /注册已关闭，请联系管理员/);
  assert.match(auth, /邀请码不正确/);
  assert.match(route, /inviteCode\?: string/);
  assert.match(page, /inviteCode: authInviteCode/);
});

test("ships the Aries deploy helpers and the publish-review CLI", async () => {
  const [script, packageJson, runServer, runWatch, service, watchService] = await Promise.all([
    readFile(new URL("../scripts/publish-review.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../deploy/aries/run-server.sh", import.meta.url), "utf8"),
    readFile(new URL("../deploy/aries/run-articles-watch.sh", import.meta.url), "utf8"),
    readFile(new URL("../deploy/aries/dabaihua-studio.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/aries/dabaihua-articles-watch.service", import.meta.url), "utf8"),
  ]);

  assert.match(script, /SLUG_RE = \/\^\[A-Za-z0-9\]\[A-Za-z0-9\._-\]\{0,120\}\$\//);
  assert.match(script, /--filter/);
  assert.match(script, /P review-feedback-\*/);
  assert.match(script, /PUBLISH_REVIEW_REMOTE_ARTICLES/);
  assert.match(script, /miniflare-D1DatabaseObject/);
  assert.match(script, /sync-articles\.mjs --once --slug/);
  assert.doesNotMatch(script, /exec\(|execSync|shell: true/);

  const pkg = JSON.parse(packageJson);
  assert.equal(pkg.scripts["publish-review"], "node scripts/publish-review.mjs");

  assert.match(runServer, /--persist-to/);
  assert.match(runServer, /3210/);
  assert.match(runServer, /set -euo pipefail/);
  assert.match(runWatch, /ARTICLES_DIR/);
  assert.match(runWatch, /FEEDBACK_DIR/);
  assert.match(runWatch, /miniflare-D1DatabaseObject/);
  assert.match(runWatch, /sync-articles\.mjs --watch/);

  assert.match(service, /User=ubuntu/);
  assert.match(service, /WorkingDirectory=\/home\/ubuntu\/dabaihua-studio/);
  assert.match(service, /EnvironmentFile=\/home\/ubuntu\/dabaihua-data\/prod\.env/);
  assert.match(service, /ExecStart=\/bin\/bash deploy\/aries\/run-server\.sh/);
  assert.match(service, /Restart=always/);
  assert.match(watchService, /ExecStart=\/bin\/bash deploy\/aries\/run-articles-watch\.sh/);
  assert.match(watchService, /Wants=network-online\.target dabaihua-studio\.service/);
  assert.match(watchService, /After=network-online\.target dabaihua-studio\.service/);
  assert.doesNotMatch(watchService, /PartOf=/);
});

test("validates ISO week labels and Shanghai timestamps", () => {
  assert.equal(isValidIsoWeek("2026-W39"), true);
  // 2026-01-01 is a Thursday, so (unlike the task text's parenthetical) 2026 has 53 ISO weeks.
  assert.equal(isValidIsoWeek("2026-W53"), true);
  assert.equal(isValidIsoWeek("2020-W53"), true);
  assert.equal(isValidIsoWeek("2015-W53"), true);
  assert.equal(isValidIsoWeek("2025-W53"), false);
  assert.equal(isValidIsoWeek("2026-W00"), false);
  assert.equal(isValidIsoWeek("2026-W99"), false);
  assert.equal(isValidIsoWeek("2026-39"), false);
  assert.equal(isValidIsoWeek("26-W39"), false);
  assert.equal(isValidIsoWeek("2026-W3"), false);
  assert.equal(isValidIsoWeek("2026-w39"), false);
  assert.equal(isValidIsoWeek(""), false);

  assert.equal(shanghaiIso(new Date("2026-09-27T16:41:12Z")), "2026-09-28T00:41:12+08:00");
  assert.equal(shanghaiIso(new Date("2026-01-01T00:00:00.500Z")), "2026-01-01T08:00:00+08:00");
});

test("enforces the weekly upload byte limit while streaming", async () => {
  const streamOf = (parts) => new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } });
  const under = new Request("https://example.com/api/weekly/2026-W39", {
    method: "PUT",
    body: streamOf([new Uint8Array(1024), new Uint8Array(1024)]),
    duplex: "half",
  });
  assert.equal(under.headers.get("content-length"), null);
  const bytes = await readBodyWithLimit(under, 2048);
  assert.equal(bytes.byteLength, 2048);

  const over = new Request("https://example.com/api/weekly/2026-W39", {
    method: "PUT",
    body: streamOf([new Uint8Array(1024), new Uint8Array(1024), new Uint8Array(1)]),
    duplex: "half",
  });
  assert.equal(over.headers.get("content-length"), null);
  await assert.rejects(() => readBodyWithLimit(over, 2048), (error) => error instanceof PayloadTooLargeError);

  const declared = new Request("https://example.com/api/weekly/2026-W39", {
    method: "PUT",
    headers: { "content-length": "999999" },
    body: "tiny",
  });
  await assert.rejects(() => readBodyWithLimit(declared, 100), (error) => error instanceof PayloadTooLargeError);

  assert.equal(publicBaseUrl({ DABAIHUA_PUBLIC_BASE_URL: "https://topic.aigalaxy.top/" }, under), "https://topic.aigalaxy.top");
  assert.equal(publicBaseUrl({}, under), "https://example.com");
});

test("drains rejected weekly uploads and discards streamed request bodies", async () => {
  // Over-limit uploads keep draining the remaining stream instead of
  // cancelling it immediately, so the dev proxy can release the connection.
  let overCancelled = false;
  const over = new Request("https://example.com/api/weekly/2026-W39", {
    method: "PUT",
    body: new ReadableStream({
      start(controller) {
        for (let i = 0; i < 4; i += 1) controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
      cancel() {
        overCancelled = true;
      },
    }),
    duplex: "half",
  });
  await assert.rejects(() => readBodyWithLimit(over, 2048), (error) => error instanceof PayloadTooLargeError);
  assert.equal(overCancelled, false);

  // discardBody drains a streamed body a handler would otherwise leave
  // unconsumed, and is a safe no-op when called again.
  const request = new Request("https://example.com/api/weekly/2026-W39", {
    method: "PUT",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      },
    }),
    duplex: "half",
  });
  await discardBody(request);
  await discardBody(request);

  // The cap cancels the reader instead of draining a hostile endless upload.
  let capped = false;
  const huge = new Request("https://example.com/api/weekly/2026-W39", {
    method: "PUT",
    body: new ReadableStream({
      start(controller) {
        for (let i = 0; i < 16; i += 1) controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        capped = true;
      },
    }),
    duplex: "half",
  });
  await discardBody(huge, 4096);
  assert.equal(capped, true);
});

test("serves weekly reports under login with a tight CSP", async () => {
  const [serve, worker, collectionRoute, itemRoute, page, authorize, migration, drizzleSchema, journal] = await Promise.all([
    readFile(new URL("../lib/weekly-serve.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/weekly/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/weekly/[week]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/weekly/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0015_weekly_reports.sql", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ]);

  assert.match(serve, /\/login\?next=\/weekly\//);
  assert.match(serve, /encodeURIComponent\(week\)/);
  assert.match(serve, /default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:/);
  assert.match(serve, /private, no-store/);
  assert.match(serve, /x-robots-tag/i);
  assert.match(serve, /x-content-type-options/i);
  assert.match(serve, /referrer-policy/i);
  assert.match(worker, /handleWeeklyRequest/);
  assert.match(worker, /secure\(weekly\)/);

  assert.match(collectionRoute, /listWeeklyReports/);
  assert.match(itemRoute, /readBodyWithLimit/);
  assert.match(itemRoute, /isValidIsoWeek/);
  assert.match(itemRoute, /payload too large/);
  assert.match(itemRoute, /rate limited/);
  assert.match(itemRoute, /forbidden/);
  assert.match(itemRoute, /unsupported media type/);

  assert.match(authorize, /export async function authenticateApiKey/);
  assert.match(authorize, /topk_\[a-f0-9\]\{32,64\}/);
  assert.match(page, /topics daily publish weekly.html --week 2026-W39/);
  assert.match(page, /redirect\("\/login\?next=\/weekly"\)/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS `weekly_reports`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `weekly_report_chunks`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `weekly_upload_log`/);
  assert.match(drizzleSchema, /export const weeklyReports/);
  assert.match(drizzleSchema, /export const weeklyReportChunks/);
  assert.match(drizzleSchema, /export const weeklyUploadLog/);
  assert.match(journal, /0015_weekly_reports/);
});
