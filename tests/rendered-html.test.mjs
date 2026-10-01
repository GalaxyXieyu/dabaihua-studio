import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { htmlToMarkdown } from "../lib/article.ts";
import { compareToPrevious, firstSentence, formatFullDate, formatNumber, formatSigned, markdownPlainText, monthCells, monthWeeks, nearestReportInMonth, parseResultCards, previewText, resultCardScale, selectDay, trendPoints, trendWindowLength, weekdayOf } from "../lib/daily.ts";
import { shapeResponse, summarizeResponses, validateBrief } from "../lib/daily-brief-core.ts";
import { isPublicPath, loginRedirectLocation, loginRedirectResponse } from "../lib/login-gate.ts";
import { HIDDEN_FROM_NAV, activeTabKey, primaryNavItems, sectionForPath, sectionTabs } from "../lib/site-nav.ts";
import { dateLabel, digestReason, isPendingArticle, isPendingTopicDraft, isoWeekOf, missingLine, shanghaiDate } from "../lib/today-core.ts";
import { collectXArticlePages } from "../lib/x-pagination.ts";
import { normalizeXPublishedAt } from "../lib/x-date.ts";
import { inferSourceCategory, isSourceCategory } from "../lib/source-category.ts";
import { matchesHostPattern, secureRedirectResponse, upgradeForwardedRequest, upgradeForwardedRequestWithFlag } from "../lib/trusted-proxy.ts";
import { splitSentences } from "../lib/sentences.ts";
import { mergeWeakMaterial } from "../lib/topic-material-merge.ts";
import { decideReviewMode } from "../app/_components/review-mode.ts";
import { PayloadTooLargeError, discardBody, isValidIsoWeek, publicBaseUrl, readBodyWithLimit, shanghaiIso } from "../lib/weekly.ts";
import { parseDigestMarkdown, stripBodyHeader } from "../scripts/lib/topic-materials.mjs";

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

test("decides the reviewer input mode without trusting an over-eager pointer:fine", () => {
  const mode = (overrides) => decideReviewMode({
    width: 390,
    coarse: false,
    anyCoarse: false,
    fine: false,
    touchPoints: 0,
    hasTouchEvent: false,
    ua: "",
    ...overrides,
  });

  // iPhone Safari / Android Chrome: coarse pointer, narrow viewport.
  assert.equal(mode({ width: 390, coarse: true, anyCoarse: true, hasTouchEvent: true, touchPoints: 5, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1" }), "phone");
  assert.equal(mode({ width: 412, coarse: true, ua: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" }), "phone");
  // WeChat X5 / Quark lie about hover:hover + pointer:fine on touch at 393px.
  assert.equal(mode({ width: 393, coarse: false, fine: true, anyCoarse: true, touchPoints: 5, ua: "Mozilla/5.0 (Linux; Android 13) MicroMessenger/8.0.49" }), "phone");
  assert.equal(mode({ width: 393, coarse: false, fine: true, touchPoints: 5, ua: "Mozilla/5.0 (Linux; Android 12) Quark/6.0" }), "phone");
  // Small desktop browser without touch still uses the phone layout.
  assert.equal(mode({ width: 800 }), "phone");
  // A real desktop mouse is the only path to desktop mode...
  assert.equal(mode({ width: 1440, fine: true, coarse: false }), "desktop");
  // ...including touch-screen laptops that report maxTouchPoints but use a mouse.
  assert.equal(mode({ width: 1440, fine: true, coarse: false, touchPoints: 10, ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15" }), "desktop");
  // An iPad in landscape is still a tablet, not a desktop.
  assert.equal(mode({ width: 1024, coarse: true, ua: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1" }), "phone");
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.equal([...page.matchAll(/className="rank-user-name"/g)].length, 2);
  assert.match(styles, /\.rank-user-name,\.rank-stats strong,\.rank-stats small \{ display:block; \}/);
  assert.doesNotMatch(styles, /\.rank-user-link span,/);
  assert.doesNotMatch(styles, /\.rank-user-link > span \{/);
});

test("ships public passage annotations, one-level replies, plaza feeds, personal history, and immersive discovery reading", async () => {
  const [page, styles, store, schema, route, migration, plazaPage] = await Promise.all([
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
  assert.doesNotMatch(page, /登录\$\{BRAND_NAME\}/);
  assert.match(styles, /reader-annotation-layout\.with-sidebar/);
  assert.match(styles, /annotation-sidebar/);
  assert.match(styles, /discover-immersive/);
  assert.match(plazaPage, /initialView="annotations"/);
});

test("ships real owner and visitor profiles, profile interactions, notifications, and underline-only annotations", async () => {
  const [page, styles, store, schema, migration, profileRoute, notificationRoute] = await Promise.all([
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
  assert.match(page, /<SiteNavCluster/);
  assert.match(page, /className="brand-block source-context-header"/);
  assert.match(page, /immersiveTodayReading/);
  assert.doesNotMatch(page, /账号已经创建并自动登录/);
  assert.doesNotMatch(page, /auth-feedback error/);
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
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
  assert.match(store, /SCHEMA_VERSION = "2026-09-30\.1"/);
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

test("ships the phone-first article reviewer that adapts to desktop and range marks and verdict actions", async () => {
  const [reviewer, articlePage, articlesList, reviewPage, topicsPage, styles, reviewMode] = await Promise.all([
    readFile(new URL("../app/_components/ArticleReviewer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/articles/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/articles/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/review/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/review-mode.ts", import.meta.url), "utf8"),
  ]);

  assert.match(reviewer, /"use client"/);
  assert.match(reviewer, /selectionchange/);
  // Mode detection lives in a pure, unit-tested module: the component routes
  // touch/pen to the block-tap flow and only mouse drags to range selection,
  // so a webview that fakes pointer:fine can no longer block marking.
  assert.match(reviewer, /decideReviewMode/);
  assert.match(reviewer, /readReviewModeSignals/);
  assert.match(reviewer, /pointerType/);
  assert.match(reviewMode, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(reviewMode, /\(pointer: coarse\)/);
  assert.match(reviewMode, /any-pointer: coarse/);
  assert.match(reviewMode, /ontouchstart/);
  assert.match(reviewMode, /maxTouchPoints/);
  assert.match(reviewMode, /MicroMessenger/);
  assert.match(reviewer, /userSelect: "none"/);
  assert.match(reviewer, /WebkitTouchCallout/);
  assert.match(reviewer, /splitSentences/);
  assert.match(reviewer, /data-testid="mark-action-bar"/);
  assert.match(reviewer, /data-testid="mark-popover"/);
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
  assert.match(reviewer, /data-testid="mark-submit-reason"/);
  assert.match(reviewer, /data-testid="marks-list-button"/);
  // Desktop layout is a Tailwind v4 custom variant keyed off the primary
  // pointer + viewport width, so there is no JS layout flash.
  assert.match(styles, /@custom-variant desk \(@media \(min-width: 900px\) and \(hover: hover\) and \(pointer: fine\)\);/);
  assert.match(reviewer, /desk:max-w-\[760px\]/);
  assert.match(reviewer, /desk:px-12 desk:py-10/);
  assert.match(reviewPage, /desk:max-w-\[760px\]/);
  assert.match(reviewer, /点一下段落即可标记/);
  assert.match(reviewer, /选中文字即可标记/);
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
  assert.match(topicsPage, /SiteAppBar/);
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
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(auth, /DABAIHUA_ALLOW_REGISTER/);
  assert.match(auth, /DABAIHUA_REGISTER_INVITE_CODE/);
  assert.match(auth, /注册已关闭，请联系管理员/);
  assert.match(auth, /邀请码不正确/);
  assert.match(route, /inviteCode\?: string/);
  assert.doesNotMatch(page, /inviteCode: authInviteCode/);
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
  assert.match(serve, /if \(user\.role !== "admin"\) return notFoundResponse\(\)/);
  assert.match(page, /if \(user\.role !== "admin"\) notFound\(\)/);

  assert.match(migration, /CREATE TABLE IF NOT EXISTS `weekly_reports`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `weekly_report_chunks`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `weekly_upload_log`/);
  assert.match(drizzleSchema, /export const weeklyReports/);
  assert.match(drizzleSchema, /export const weeklyReportChunks/);
  assert.match(drizzleSchema, /export const weeklyUploadLog/);
  assert.match(journal, /0015_weekly_reports/);
});

test("links the admin-only growth workspace from the main navigation", async () => {
  const [page, siteNav, css] = await Promise.all([
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/SiteNav.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<SiteNavCluster/);
  assert.doesNotMatch(page, /onClick=\{\(\) => navigate\("annotations"\)\}/);
  assert.doesNotMatch(page, /onClick=\{\(\) => navigate\("leaderboard"\)\}/);
  assert.match(siteNav, /primaryNavItems\(/);
  assert.match(siteNav, /sectionTabs\(/);
  assert.match(siteNav, /className="section-tabs"/);
  assert.doesNotMatch(siteNav, /@phosphor-icons\/react/);
  assert.match(css, /\.global-appbar nav \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.global-appbar nav\.has-growth \{ grid-template-columns:repeat\(3, minmax\(0, 1fr\)\); \}/);
});

test("gates the admin-only career page and keeps raw result fields out of the data", async () => {
  const [page, worker, lib, careerData, gitignore] = await Promise.all([
    readFile(new URL("../app/career/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/career.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/career-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
  ]);

  assert.match(page, /redirect\("\/login\?next=\/career"\)/);
  assert.match(page, /if \(user\.role !== "admin"\) notFound\(\)/);
  assert.match(page, /robots:\s*\{ index: false, follow: false \}/);
  assert.match(page, /loadCareerData\(\)/);
  assert.match(page, /还没有数据/);
  assert.doesNotMatch(page, /from "\.\.\/\.\.\/content\/career\/career\.json"/);
  assert.match(careerData, /import\.meta\.glob\(/);
  assert.match(careerData, /content\/career\/career\.json/);
  assert.match(gitignore, /\/content\/career\/career\.json/);
  assert.match(worker, /url\.pathname === "\/career" \|\| url\.pathname\.startsWith\("\/career\/"\)/);
  assert.match(worker, /new Response\(response\.body, response\)/);
  assert.match(worker, /"x-robots-tag", "noindex, nofollow"/);
  assert.match(worker, /"cache-control", "private, no-store"/);
  assert.match(lib, /export function formatShanghai/);
  assert.match(page, /result_with_outcome_numbers/);
  assert.match(page, /条有结果数字/);
  assert.match(page, /table_result/);
  assert.match(page, /unlisted/);
  assert.match(page, /未归类，默认按过程算/);

  // Private keys must never appear anywhere in the generated data. The raw file
  // is private and only deployed over rsync, so skip these checks on a fresh clone.
  const rawPath = new URL("../content/career/career.json", import.meta.url);
  if (existsSync(rawPath)) {
    const raw = await readFile(rawPath, "utf8");
    assert.doesNotMatch(raw, /"(evidence|security_id)"\s*:/);
    const data = JSON.parse(raw);
    for (const result of data.results) {
      if (result.public === true) continue;
      for (const key of ["what", "problem", "decision", "influence", "evidence"]) {
        assert.equal(key in result, false, `non-public result ${result.id} must not expose ${key}`);
      }
    }
  }
});

test("gates the admin-only daily page and keeps the private feed out of git", async () => {
  const [page, worker, dailyData, gitignore, packageJson, trend, css] = await Promise.all([
    readFile(new URL("../app/daily/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/daily-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/daily/_components/DailyTrend.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/daily/daily.css", import.meta.url), "utf8"),
  ]);

  // 未登录跳登录页；已登录非管理员 404。
  assert.match(page, /redirect\("\/login\?next=\/daily"\)/);
  assert.match(page, /if \(user\.role !== "admin"\) notFound\(\)/);
  assert.match(page, /robots:\s*\{ index: false, follow: false \}/);
  assert.match(page, /loadDailyData\(\)/);
  assert.match(page, /还没有日报数据/);
  assert.match(page, /<SiteAppBar user=\{user\} pathname="\/daily" \/>/);
  // 日期选择走 URL 参数，默认最新一天。
  assert.match(page, /Promise<\{ date\?: string \}>/);
  assert.match(page, /selectDay\(days, requested\)/);
  assert.match(page, /\?date=/);
  // 页面只读汇总后的 json，不直接读仓库外的日报目录。
  assert.doesNotMatch(page, /workspace\/(daily|career)/);

  assert.match(dailyData, /import\.meta\.glob\(/);
  assert.match(dailyData, /content\/daily\/daily\.json/);
  assert.match(trend, /"use client"/);
  assert.match(trend, /<svg/);
  assert.match(trend, /<polyline/);
  // viewBox 跟随容器实测宽度，手机上 11px 文字不再被缩小。
  assert.match(trend, /ResizeObserver/);
  assert.match(trend, /viewBox=\{`0 0 \$\{W\} \$\{H\}`\}/);
  // token 线有独立右轴和数据点；悬停柱子用深色，和选中的朱红区分开。
  assert.match(trend, /is-token/);
  assert.match(trend, /daily-a-line-dot/);
  assert.match(css, /\.daily-a-bar\.is-selected \{[^}]*fill: var\(--accent\)/);
  assert.match(css, /\.daily-a-bar\.is-hover \{[^}]*fill: var\(--ink\)/);
  // 没有日报的日子也要显示日期数字。
  assert.match(page, /className="daily-a-calendar-cell is-empty"/);
  assert.match(page, /daily-a-calendar-count/);
  assert.match(css, /\.daily-a-calendar-cell\.is-selected \{[^}]*background: var\(--ink\)/);
  // Markdown 列表有符号，行内代码不断行拆框。
  assert.match(css, /\.daily-a \.db-md-list\.is-unordered \{[^}]*list-style: disc/);
  assert.match(css, /\.daily-a \.db-md-list\.is-ordered \{[^}]*list-style: decimal/);
  assert.match(css, /box-decoration-break: clone/);
  // 结果数字卡片 + 折叠预览 + 宽屏两栏。
  assert.match(page, /parseResultCards/);
  assert.match(page, /daily-a-result-grid/);
  assert.match(page, /daily-a-fold-preview/);
  // 卡片列数跟卡片数走，长数值整组同字号缩小且不换行，单张卡片不撑满整行。
  assert.doesNotMatch(page, /is-long/);
  assert.match(page, /resultCardScale/);
  assert.match(page, /data-count/);
  assert.match(page, /excludeValues/);
  assert.match(css, /\.daily-a-result-value \{[^}]*white-space: nowrap/);
  assert.match(css, /--result-value-size: clamp\(15px, 4\.6vw, 30px\)/);
  assert.match(css, /font-size: calc\(var\(--result-value-size\) \* var\(--result-scale, 1\)\)/);
  // 三张时第一张占满手机一行，平板/桌面按卡片数取列。
  assert.match(css, /\.daily-a-result-grid\[data-count="3"\] \.daily-a-result-card:first-child/);
  assert.match(css, /grid-template-columns: repeat\(var\(--result-cols\), minmax\(0, 1fr\)\)/);
  assert.match(css, /\.daily-a-result-grid\[data-count="4"\] \{[^}]*--result-cols: 4/);
  // 网格不再用底色填充，避免多出来的格子看起来像占位块。
  assert.match(css, /\.daily-a-result-grid \{[^}]*border-top: 1px solid var\(--line\)/);
  assert.doesNotMatch(css, /\.daily-a-result-grid \{[^}]*background: var\(--line\)/);
  // 卡片下的列表用细线分隔，不用圆点；短横跟首行垂直居中、用弱化色。
  assert.match(page, /daily-a-results-rest/);
  assert.match(css, /\.daily-a-results-rest \.db-md > \.db-md-list > li/);
  assert.match(css, /\.daily-a-results-rest \.db-md > \.db-md-list > li::before[^}]*translateY\(-50%\)/);
  assert.match(css, /\.daily-a-results-rest \.db-md > \.db-md-list > li::before[^}]*background: var\(--muted\)/);
  // 手机端按仓库：数字不小于 12px，放到条形下方一行。
  assert.match(page, /daily-a-repo-track is-commits/);
  assert.match(css, /\.daily-a-repo-nums \{[^}]*font-size: 12px/);
  assert.match(css, /\.daily-a-repo-track\.is-commits \{[^}]*grid-area: commits/);
  // 桌面「按仓库」默认只显示前 5 个，其余收进「展开其余 N 个」。
  assert.match(page, /REPO_VISIBLE_COUNT = 5/);
  assert.match(page, /展开其余 \{hiddenRepos\.length\} 个/);
  assert.match(css, /\.daily-a-repos-more\[open\] \.daily-a-caret/);
  assert.match(css, /\.daily-a-repos-rest \{[^}]*display: grid/);
  // 手机端收起没有日报的空周，桌面保持完整月历。
  assert.match(page, /monthWeeks/);
  assert.match(page, /daily-a-calendar-week/);
  assert.match(css, /\.daily-a-calendar-week \{[^}]*display: contents/);
  assert.match(css, /\.daily-a-calendar-week\.is-collapsed \{[^}]*display: none/);
  assert.match(css, /max-width: 1180px/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.daily-a-tooltip \{[^}]*z-index: 5/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(css, /\.daily-a/);
  // 涨跌持平三色能区分，持平不加粗。
  assert.match(css, /--daily-up:/);
  assert.match(css, /\.daily-a-metric-delta\.is-up \{[^}]*color: var\(--daily-up\)/);
  assert.match(css, /\.daily-a-metric-delta\.is-down \{[^}]*color: var\(--danger\)/);
  assert.match(css, /\.daily-a-metric-delta\.is-flat \{[^}]*font-weight: 500/);
  // 趋势图不再固定 30 格，日报少时撑开；柱子最小 6px。
  assert.doesNotMatch(trend, /SLOTS/);
  assert.match(trend, /Math\.max\(6, column \* 0\.54\)/);
  assert.match(page, /trendHeading/);
  // 折叠块共用一个容器，只用一条细线。
  assert.match(css, /\.daily-a-folds \{[^}]*border-top: 1px solid var\(--line\)/);
  assert.doesNotMatch(css, /\.daily-a-fold:first-child/);
  assert.match(page, /markdownPlainText\([^)]*\)\.length < FOLD_MIN_LENGTH/);
  assert.match(page, /previewText\(/);
  // 「做了什么」预览固定一行，超出省略。
  assert.match(css, /\.daily-a-what-preview,[^}]*white-space: nowrap/);
  assert.match(css, /\.daily-a-what-preview,[^}]*text-overflow: ellipsis/);
  // 桌面「结果数字」和折叠块并排两栏，半栏里长数值卡片改回两列。
  assert.match(page, /daily-a-pair/);
  assert.match(css, /\.daily-a-pair \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.daily-a-pair > \.daily-a-pair-col:only-child \{[^}]*grid-column: 1 \/ -1/);
  assert.match(css, /\.daily-a-pair \.daily-a-result-grid\[data-count="3"\]/);
  // 宽屏月历进右侧窄栏；手机仍收起空周。
  assert.match(page, /daily-a-rail/);
  assert.match(css, /\.daily-a-body \{[^}]*grid-template-columns: minmax\(0, 1fr\) 300px/);
  assert.match(css, /@media \(min-width: 1200px\)/);
  // 两栏 + 展开跨栏，不留大空洞。
  assert.match(css, /align-items: start/);
  assert.match(css, /\.daily-a-what\[open\] \{[^}]*grid-column: 1 \/ -1/);
  // 日历撑满内容区，不再被 760px 卡住。
  assert.doesNotMatch(css, /max-width: 760px/);
  assert.match(gitignore, /\/content\/daily\//);
  assert.match(packageJson, /"daily:build": "node scripts\/build-daily\.mjs"/);
  assert.match(worker, /url\.pathname === "\/daily" \|\| url\.pathname\.startsWith\("\/daily\/"\)/);
});

test("summarizes sample daily markdown and git commits for /daily", async () => {
  const { parseFrontMatter, parseDailyMarkdown, summarizeCommitRepos, buildDailyData } = await import("../scripts/build-daily.mjs");
  const fixturesDir = new URL("../tests/fixtures/", import.meta.url);
  const dailyDir = fileURLToPath(new URL("daily/", fixturesDir));
  const gitDailyDir = fileURLToPath(new URL("git-daily/", fixturesDir));

  const text = await readFile(new URL("daily/2026-03-01.md", fixturesDir), "utf8");
  const { fields } = parseFrontMatter(text);
  assert.equal(fields.date, "2026-03-01");
  assert.equal(fields.tokens_m, "128.5");

  const day = parseDailyMarkdown(text, "2026-03-01.md");
  assert.equal(day.date, "2026-03-01");
  assert.equal(day.weekday, "周日");
  assert.equal(day.commits, 7);
  assert.deepEqual(day.repos, ["alpha-app", "beta-svc"]);
  assert.equal(day.tokensM, 128.5);
  assert.equal(day.sections.what.length, 2);
  assert.equal(day.sections.what[0].title, "1. 同步链路重做（上午）");
  assert.match(day.sections.what[0].body, /按游标续传/);
  assert.match(day.sections.blockers, /回退后改成追加写/);
  assert.match(day.sections.results, /\+820/);
  assert.match(day.sections.leading, /带小张/);
  assert.match(day.sections.unfinished, /灰度开关还没接完/);

  // 缺失的小节是 null，tokens_m 允许为 null。
  const sparse = parseDailyMarkdown(await readFile(new URL("daily/2026-03-02.md", fixturesDir), "utf8"), "2026-03-02.md");
  assert.equal(sparse.tokensM, null);
  assert.equal(sparse.sections.blockers, null);
  assert.equal(sparse.sections.leading, null);
  assert.equal(sparse.sections.unfinished, null);

  // git 明细只算非噪声提交。
  const gitJson = JSON.parse(await readFile(new URL("git-daily/2026-03-01.json", fixturesDir), "utf8"));
  const repos = summarizeCommitRepos(gitJson);
  assert.deepEqual(repos, [
    { repo: "alpha-app", commits: 5, additions: 800, deletions: 120 },
    { repo: "beta-svc", commits: 2, additions: 20, deletions: 14 },
  ]);

  // git-daily/2 把提交放在 `git.commits`，也要能算；`bump` 仍计入，stash/merge 不算。
  const gitJsonV2 = JSON.parse(await readFile(new URL("git-daily/2026-03-03.json", fixturesDir), "utf8"));
  assert.deepEqual(summarizeCommitRepos(gitJsonV2), [
    { repo: "gamma-web", commits: 3, additions: 152, deletions: 17 },
    { repo: "delta-api", commits: 1, additions: 20, deletions: 4 },
  ]);

  // 整体汇总：跳过 *.partial 和 backup-* 目录，按日期升序。
  const data = buildDailyData({ dailyDir, gitDailyDir });
  assert.deepEqual(data.days.map((item) => item.date), ["2026-03-01", "2026-03-02"]);
  assert.equal(data.days[0].repoStats.length, 2);
  assert.equal(data.days[1].tokensM, null);
  assert.equal(data.days[1].repoStats[0].commits, 3);
});

test("formats daily dates, deltas, previews and the monthly calendar", () => {
  assert.equal(weekdayOf("2026-03-01"), "周日");
  assert.equal(formatFullDate("2026-03-01"), "2026 年 3 月 1 日");
  assert.deepEqual(compareToPrevious(10, 7), { text: "↑3", direction: "up" });
  assert.deepEqual(compareToPrevious(7, 10), { text: "↓3", direction: "down" });
  assert.deepEqual(compareToPrevious(7, 7), { text: "持平", direction: "flat" });
  assert.equal(compareToPrevious(7, null), null);
  assert.equal(compareToPrevious(null, 7), null);
  assert.deepEqual(compareToPrevious(10.5, 10, 1), { text: "↑0.5", direction: "up" });

  assert.equal(firstSentence("- **第一句。**第二句。"), "第一句。");
  assert.equal(firstSentence("只有一句没有标点"), "只有一句没有标点");
  assert.equal(firstSentence("   "), "");

  // 数字统一加千分位，单位小数位保留。
  assert.equal(formatNumber(2734), "2,734");
  assert.equal(formatNumber(325.8, 1), "325.8");
  assert.equal(formatNumber(11342), "11,342");
  assert.equal(formatSigned(2734), "+2,734");
  assert.equal(formatSigned(-2734), "−2,734");
  assert.equal(formatSigned(0), "0");

  // 预览取正文前约 40 个字；Markdown 记号先去掉。
  assert.equal(markdownPlainText("- **第一句。**`code` 第二句。"), "第一句。code 第二句。");
  assert.equal(previewText("短句"), "短句");
  assert.equal(previewText("一二三四五六七八九十", 4), "一二三四…");

  // 截断不能落在英文单词、路径或数字中间，长度尽量保持在 30–44 字。
  const wordCut = previewText(`更新说明：${"x".repeat(26)} supercalifragilistic`);
  assert.ok(wordCut.endsWith("…"));
  assert.ok(wordCut.length >= 30 && wordCut.length <= 44, wordCut);
  assert.ok(!wordCut.includes("super"), wordCut);
  const pathCut = previewText("自绘更新进度窗（56b10a1c，0.0.29）和安装器共用 exe/resources");
  assert.ok(!/resour…$/.test(pathCut), pathCut);
  assert.ok(pathCut.endsWith("/…") || pathCut.endsWith("…"), pathCut);
  // 中文优先断在标点或空格，不把路径/英文单词切一半。
  assert.equal(pathCut, "自绘更新进度窗（56b10a1c，0.0.29）和安装器共用…");
  const hardCut = previewText("这是一个没有标点也没有空格的很长的中文句子用来测试兜底截断的行为看看能不能在三十六字左右停下");
  assert.ok(hardCut.length <= 38, hardCut);
  assert.ok(!hardCut.includes(" "), hardCut);
  // 千分位/小数点/时间里的数字不拆开。
  assert.equal(previewText("金额 11,342 元，实际 3.14 倍，时间 23:33 完成。", 20).includes("11,…"), false);

  const days = [
    { date: "2026-03-01", weekday: "周日", summary: "", commits: 7, repos: [], tokensM: 128.5, sections: { overview: null, what: [], blockers: null, results: null, leading: null, unfinished: null }, repoStats: [] },
    { date: "2026-03-02", weekday: "周一", summary: "", commits: 3, repos: [], tokensM: null, sections: { overview: null, what: [], blockers: null, results: null, leading: null, unfinished: null }, repoStats: [] },
    { date: "2026-04-05", weekday: "周日", summary: "", commits: 9, repos: [], tokensM: 50, sections: { overview: null, what: [], blockers: null, results: null, leading: null, unfinished: null }, repoStats: [] },
  ];
  assert.equal(selectDay(days, "2026-03-02").date, "2026-03-02");
  assert.equal(selectDay(days, "2026-03-09").date, "2026-04-05");
  assert.equal(selectDay([], "2026-03-02"), null);

  const points = trendPoints(days, "2026-03-02");
  // 日报不足 7 天：只画有日报的那几天，不铺空白日期位。
  assert.equal(points.length, 2);
  assert.deepEqual(points.map((point) => point.date), ["2026-03-01", "2026-03-02"]);
  assert.equal(points[0].tokensM, 128.5);
  assert.equal(points[1].tokensM, null);
  const sparseAll = trendPoints(days, "2026-04-05");
  assert.deepEqual(sparseAll.map((point) => point.date), ["2026-03-01", "2026-03-02", "2026-04-05"]);

  // 够 7 天后回落到连续窗口：缺日报的日子补 0 / null。
  const manyDays = Array.from({ length: 9 }, (_, index) => ({
    ...days[0],
    date: `2026-06-${String(index + 1).padStart(2, "0")}`,
    commits: index + 1,
    tokensM: index + 10,
  }));
  assert.equal(trendWindowLength(manyDays, "2026-06-09"), 9);
  const densePoints = trendPoints(manyDays, "2026-06-09");
  assert.equal(densePoints.length, 9);
  assert.equal(densePoints[0].date, "2026-06-01");
  assert.equal(densePoints.at(-1).date, "2026-06-09");
  const withGap = trendPoints(manyDays.filter((day) => day.date !== "2026-06-05"), "2026-06-09");
  assert.equal(withGap.length, 9);
  const gapDay = withGap.find((point) => point.date === "2026-06-05");
  assert.equal(gapDay.commits, 0);
  assert.equal(gapDay.tokensM, null);

  // 日报跨度超过 30 天时最近 30 天封顶。
  assert.equal(trendWindowLength(days, "2026-04-05"), 30);

  const cells = monthCells(days, "2026-03-02");
  assert.equal(cells.length, 6 + 31); // 周一开头，2026-03-01 是周日
  assert.equal(cells[6].date, "2026-03-01");
  assert.equal(cells[6].day.date, "2026-03-01");
  assert.equal(cells[7].date, "2026-03-02");
  assert.equal(cells[7].day.date, "2026-03-02");
  assert.equal(cells[8].date, "2026-03-03");
  assert.equal(cells[8].day, null);

  // 按周切分：只有含日报的周和当前周需要保留，其余手机端整行收起。
  const september = [
    { ...days[0], date: "2026-09-28", commits: 55, tokensM: 752 },
    { ...days[0], date: "2026-09-29", commits: 51, tokensM: 806 },
    { ...days[0], date: "2026-09-30", commits: 18, tokensM: 325.8 },
  ];
  const weeks = monthWeeks(september, "2026-09-30");
  assert.ok(weeks.every((week) => week.cells.length >= 1 && week.cells.length <= 7));
  assert.ok(weeks.some((week) => week.hasReport && week.isCurrent));
  assert.ok(weeks.some((week) => !week.hasReport && !week.isCurrent));
  assert.equal(nearestReportInMonth(days, "2026-03-02", 1), "2026-04-05");
  assert.equal(nearestReportInMonth(days, "2026-03-02", -1), null);
});

test("turns result numbers into a few total cards and falls back to a list", () => {
  const { cards, rest } = parseResultCards([
    "- 提交：topics-daily 统计 22 个（不含合并提交），+11,342 / −525 行。",
    "  - ai-native 16 个，+10,119 / −282。其中 2 个是 23:27 的 stash 备份（054b98a6、43fc5192），另有 2 个是同一改动在两个分支各提交一次（docReader 修复、忽略打包产物）。",
    "- 去掉 stash 和重复后，实际改动 18 个提交，+3,957 / −520 行。",
    "- AI token：325.80M，按 API 列表价估算 $312.55（不是实际花费，截至 23:33）。Cursor 281.05M，Codex 34.55M，CodeBuddy 10.19M，Mac mini 上的 pi 0。前一天是 858.84M。",
    "- 滴答：今天完成 3 项：",
    "  - Windows 端测试（08:39）",
    "  - 权限开通（08:39）",
    "- 自动化覆盖率 82%：本周把核心链路上线。",
    "- 今天没有数字可填。",
  ].join("\n"));

  // 只保留「提交数、改动行、token 总量、花费」四类总量，每类最多一张、最多 4 张。
  assert.equal(cards.length, 4);
  const commits = cards.find((card) => card.unit === "个");
  assert.equal(commits.value, "22");
  assert.match(commits.label, /提交：topics-daily 统计/);
  const lines = cards.find((card) => card.unit === "行");
  assert.equal(lines.value, "+11,342 / −525");
  assert.equal(lines.label, "改动行");
  const tokens = cards.find((card) => card.value === "325.80");
  assert.equal(tokens.unit, "M");
  assert.equal(tokens.label, "AI token");
  const cost = cards.find((card) => card.value === "$312.55");
  assert.equal(cost.unit, "");
  assert.match(cost.label, /按 API 列表价估算/);

  // 工具拆分的 token、重复口径的提交/行数、对比说明都落到卡片下的列表。
  assert.doesNotMatch(rest, /325\.80M/);
  assert.match(rest, /Cursor 281\.05M/);
  assert.match(rest, /CodeBuddy 10\.19M/);
  assert.match(rest, /前一天是 858\.84M/);
  assert.match(rest, /ai-native/);
  assert.match(rest, /去掉 stash/);
  assert.match(rest, /Windows 端测试/);
  assert.match(rest, /今天没有数字可填/);
  assert.match(rest, /滴答/);
  assert.doesNotMatch(rest, /提交：topics-daily/);

  // 和顶部大数字完全相同的数值（18 vs 顶部 18、325.80M vs 顶部 325.8）不再重复做卡片。
  const deduped = parseResultCards("- 提交 18 个。\n- AI token：325.80M。", { excludeValues: [18, 325.8] });
  assert.deepEqual(deduped.cards, []);
  assert.match(deduped.rest, /提交 18 个/);
  assert.match(deduped.rest, /325\.80M/);

  // 单位保留原样；数字补千分位。
  const unit = parseResultCards("- 峰值 325.80M，按列表价估算。");
  assert.equal(unit.cards[0].value, "325.80");
  assert.equal(unit.cards[0].unit, "M");
  assert.equal(unit.cards[0].label, "峰值");
  assert.match(unit.rest, /按列表价估算/);
  const grouped = parseResultCards("- 新增 11342 行代码。");
  assert.equal(grouped.cards[0].value, "11,342");
  assert.equal(grouped.cards[0].unit, "行");
  assert.equal(grouped.cards[0].label, "新增代码");

  // 说明超过 80 字的条目退回普通列表。
  const long = parseResultCards(`- ${"说明很".repeat(45)} 12 个。`);
  assert.deepEqual(long.cards, []);
  assert.match(long.rest, /12 个/);

  // 完全没有列表时原样返回。
  const plain = parseResultCards("普通一段话");
  assert.deepEqual(plain.cards, []);
  assert.equal(plain.rest, "普通一段话");

  // 结果卡片整组共用一个缩放：短数值不缩放，长数值整体缩小。
  assert.equal(resultCardScale([{ value: "22", unit: "个", label: "x" }]), 1);
  const longCards = [
    { value: "22", unit: "个", label: "x" },
    { value: "+11,342 / −525", unit: "行", label: "y" },
    { value: "$312.55", unit: "", label: "z" },
  ];
  const sharedScale = resultCardScale(longCards);
  assert.ok(sharedScale <= 1 && sharedScale >= 0.55);
  const huge = resultCardScale([{ value: "+11,342,222 / −5,525,333", unit: "行", label: "x" }]);
  assert.ok(huge < sharedScale);
});

test("classifies public paths for the site-wide login gate", () => {
  for (const pathname of [
    "/login",
    "/login/",
    "/login/reset",
    "/api",
    "/api/",
    "/api/feed",
    "/_vinext/image",
    "/assets/app.css",
    "/cli/topics",
    "/favicon.svg",
    "/favicon.ico",
    "/og-community.png",
    "/og-community.svg",
    "/robots.txt",
    "/file.svg",
    "/globe.svg",
    "/window.svg",
  ]) {
    assert.equal(isPublicPath(pathname), true, `${pathname} should be public`);
  }

  for (const pathname of [
    "/",
    "/discover",
    "/topics",
    "/articles",
    "/articles/hello",
    "/review/1",
    "/strategy",
    "/annotations",
    "/leaderboard",
    "/profile",
    "/weekly",
    "/weekly/2026-W39/",
    "/daily",
    "/career",
    "/loginx",
    "/apix",
  ]) {
    assert.equal(isPublicPath(pathname), false, `${pathname} should require login`);
  }
});

test("builds no-store login redirects that preserve path and query", () => {
  assert.equal(loginRedirectLocation(new URL("https://studio.example/career")), "/login?next=/career");
  assert.equal(
    loginRedirectLocation(new URL("https://studio.example/discover?item=3&x=1")),
    "/login?next=/discover%3Fitem%3D3%26x%3D1",
  );
  assert.equal(loginRedirectLocation("/weekly/2026-W39/"), "/login?next=/weekly/2026-W39/");

  const response = loginRedirectResponse(new URL("https://studio.example/career"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/login?next=/career");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("runs the login gate in the worker before serving weekly reports", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /isPublicPath\(url\.pathname\)/);
  assert.match(worker, /loginRedirectResponse\(url\)/);
  const gate = worker.indexOf("isPublicPath(url.pathname)");
  const weekly = worker.indexOf("handleWeeklyRequest(request");
  assert.ok(gate >= 0 && weekly >= 0 && gate < weekly, "the login gate must run before handleWeeklyRequest");
});

test("configures primary navigation by role", () => {
  const admin = primaryNavItems("admin");
  assert.deepEqual(admin.map((item) => item.label), ["今天", "内容", "成长"]);
  assert.deepEqual(admin.map((item) => item.href), ["/", "/topics/daily", "/career"]);
  assert.equal(admin.find((item) => item.key === "content")?.href, "/topics/daily");

  for (const role of ["user", null, undefined]) {
    const items = primaryNavItems(role);
    assert.deepEqual(items.map((item) => item.label), ["今天", "内容"]);
    assert.equal(items.find((item) => item.key === "content")?.href, "/discover");
    assert.equal(JSON.stringify(items).includes("成长"), false);
  }

  for (const items of [primaryNavItems("admin"), primaryNavItems("user")]) {
    const serialized = JSON.stringify(items);
    assert.equal(serialized.includes("批注广场"), false);
    assert.equal(serialized.includes("排行榜"), false);
  }
});

test("configures section tabs by section and role", () => {
  assert.deepEqual(sectionTabs("content", "user").map((item) => item.label), ["阅读", "选题", "文章", "策略"]);
  assert.deepEqual(sectionTabs("content", "admin").map((item) => item.href), ["/topics/daily", "/discover", "/topics", "/articles", "/strategy"]);
  assert.deepEqual(sectionTabs("content", "admin").map((item) => item.label), ["选题简报", "阅读", "选题", "文章", "策略"]);
  assert.equal(JSON.stringify(sectionTabs("content", "user")).includes("/topics/daily"), false);
  assert.deepEqual(sectionTabs("growth", "admin").map((item) => item.label), ["周报", "日报", "职业"]);
  assert.deepEqual(sectionTabs("growth", "user"), []);
  assert.deepEqual(sectionTabs("growth", null), []);
  assert.deepEqual(sectionTabs("today", "admin"), []);
});

test("maps paths to navigation sections and active tabs", () => {
  assert.equal(sectionForPath("/"), "today");
  for (const pathname of ["/reading", "/discover", "/topics", "/topics/daily", "/articles", "/articles/hello", "/review/1", "/strategy", "/annotations", "/leaderboard"]) {
    assert.equal(sectionForPath(pathname), "content", `${pathname} should be content`);
  }
  for (const pathname of ["/weekly", "/weekly/2026-W39/", "/daily", "/career"]) {
    assert.equal(sectionForPath(pathname), "growth", `${pathname} should be growth`);
  }
  for (const pathname of ["/profile", "/login"]) {
    assert.equal(sectionForPath(pathname), null, `${pathname} should have no section`);
  }

  assert.equal(activeTabKey("/reading"), "reading");
  assert.equal(activeTabKey("/discover"), "reading");
  assert.equal(activeTabKey("/topics"), "topics");
  assert.equal(activeTabKey("/topics/daily"), "brief");
  assert.equal(activeTabKey("/articles/hello"), "articles");
  assert.equal(activeTabKey("/review/1"), "articles");
  assert.equal(activeTabKey("/strategy"), "strategy");
  assert.equal(activeTabKey("/weekly/2026-W39/"), "weekly");
  assert.equal(activeTabKey("/daily"), "daily");
  assert.equal(activeTabKey("/career"), "career");
  assert.equal(activeTabKey("/profile"), null);

  assert.deepEqual(HIDDEN_FROM_NAV, ["/annotations", "/leaderboard"]);
});

test("mounts the shared site app bar on every content and growth subpage", async () => {
  const [appBar, userMenu, topics, strategy, articles, weekly, daily, career, articleDetail, review, styles] = await Promise.all([
    readFile(new URL("../app/_components/SiteAppBar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/SiteUserMenu.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/strategy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/articles/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/weekly/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/daily/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/career/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/articles/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/review/[id]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(appBar, /sectionForPath\(/);
  assert.match(appBar, /activeTabKey\(/);
  assert.match(appBar, /<SiteUserMenu/);
  assert.match(appBar, /has-subnav/);
  assert.match(userMenu, /"use client"/);
  assert.match(userMenu, /\/api\/notifications/);
  assert.match(userMenu, /action: "logout"/);
  assert.match(userMenu, /href="\/profile"/);
  assert.match(styles, /\.site-appbar \{ position:sticky; top:0; \}/);
  assert.match(styles, /\.global-appbar\.has-subnav \{ --appbar-height:93px; \}/);
  assert.match(styles, /\.reader-workspace\.has-subnav \{ --appbar-height:93px; \}/);

  const pages = [
    [topics, "/topics"],
    [strategy, "/strategy"],
    [articles, "/articles"],
    [weekly, "/weekly"],
    [daily, "/daily"],
    [career, "/career"],
  ];
  for (const [page, pathname] of pages) {
    assert.match(page, /<SiteAppBar/);
    assert.match(page, new RegExp(`pathname="${pathname}"`));
    assert.doesNotMatch(page, /← 选题看板/);
  }

  // 文章详情与审稿页也挂站点顶栏，并带 has-action-bar（手机端隐藏底部主导航）。
  assert.match(articleDetail, /<SiteAppBar/);
  assert.match(articleDetail, /pathname=\{`\/articles\/\$\{slug\}`\}/);
  assert.match(articleDetail, /has-action-bar/);
  assert.match(review, /<SiteAppBar/);
  assert.match(review, /pathname=\{`\/review\/\$\{id\}`\}/);
  assert.match(review, /has-action-bar/);
  assert.match(styles, /body:has\(\.has-action-bar\) \.global-appbar nav/);

  // topics and strategy had no session lookup before; both must add the same
  // login defence as the other subpages.
  for (const page of [topics, strategy]) {
    assert.match(page, /getSessionUser/);
    assert.match(page, /redirect\("\/login\?next=/);
  }
});

test("builds the admin-only today page from real in-app signals and keeps /reading reachable", async () => {
  // Pure helpers (node type-stripping imports the module directly).
  assert.equal(shanghaiDate(new Date("2026-09-27T17:30:00Z")), "2026-09-28");
  assert.equal(shanghaiDate(new Date("2026-09-27T15:59:00Z")), "2026-09-27");
  assert.equal(isoWeekOf("2026-09-28"), "2026-W40");
  assert.equal(isoWeekOf("2026-01-01"), "2026-W01");
  assert.equal(isoWeekOf("2027-01-01"), "2026-W53");
  assert.equal(isoWeekOf("2024-12-30"), "2025-W01");
  assert.equal(digestReason("2026-09-28"), "daily-ai-digest:2026-09-28");
  assert.equal(dateLabel("2026-09-28"), "9 月 28 日 · 周一");
  assert.equal(dateLabel("2026-10-04"), "10 月 4 日 · 周日");
  assert.equal(isPendingTopicDraft({ draftMarkdown: "正文", reviewStatus: null }), true);
  assert.equal(isPendingTopicDraft({ draftMarkdown: "正文", reviewStatus: "" }), true);
  assert.equal(isPendingTopicDraft({ draftMarkdown: "正文", reviewStatus: "pending" }), true);
  assert.equal(isPendingTopicDraft({ draftMarkdown: "   ", reviewStatus: "pending" }), false);
  assert.equal(isPendingTopicDraft({ draftMarkdown: "正文", reviewStatus: "approved" }), false);
  assert.equal(isPendingArticle(null), true);
  assert.equal(isPendingArticle(""), true);
  assert.equal(isPendingArticle("draft"), true);
  assert.equal(isPendingArticle("approved"), false);
  assert.equal(isPendingArticle("published"), false);
  assert.equal(isPendingArticle("changes-requested"), false);
  assert.equal(missingLine({ display_title: "有标题", skills: [], metric: "GMV", unit: "元" }), "有标题：缺「GMV」，单位 元");
  assert.equal(missingLine({ display_title: null, skills: ["Agent", "RAG"], metric: "覆盖率", unit: "%" }), "未公开标题的成果（技能：Agent、RAG）：缺「覆盖率」，单位 %");
  assert.equal(missingLine({ display_title: null, skills: [], metric: "时长", unit: "分钟" }), "未公开标题的成果：缺「时长」，单位 分钟");

  const [todayPage, todayLib, readingPage, deskApp, siteNav] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/today.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/reading/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/site-nav.ts", import.meta.url), "utf8"),
  ]);

  // Server component with a plain, decoration-free list of today's five rows.
  assert.doesNotMatch(todayPage, /"use client"/);
  assert.match(todayPage, /<SiteAppBar/);
  assert.doesNotMatch(todayPage, /TodayHeader/);
  assert.doesNotMatch(todayPage, /第 \$\{/);
  assert.doesNotMatch(todayPage, /issueNumber|dayOfYear/);
  assert.match(todayPage, /getTodayData\(/);
  assert.match(todayPage, /redirect\("\/login\?next=\/"\)/);
  for (const row of ["待审稿件", "待挑选题", "每日 AI 简报", "缺数字", "本周周报"]) {
    assert.match(todayPage, new RegExp(row));
  }
  for (const empty of ["没有待审稿件", "没有待挑选题", "没有 AI 简报", "没有缺数字的成果", "还没有周报"]) {
    assert.match(todayPage, new RegExp(empty));
  }
  assert.match(todayPage, /isAdmin && data\.missing/);
  assert.match(todayPage, /还没有职业数据/);
  assert.match(todayPage, /isAdmin && data\.weekly/);
  assert.match(todayPage, /→/);
  assert.match(todayPage, /dateLabel\(/);
  assert.match(todayPage, /tabular-nums/);
  const emojiPattern = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  assert.doesNotMatch("→", emojiPattern);
  assert.doesNotMatch(todayPage, emojiPattern);
  assert.doesNotMatch(todayPage, /rounded-/);
  assert.doesNotMatch(todayPage, /shadow/);
  assert.doesNotMatch(todayPage, /gradient/);

  // The data layer reads the real tables and the bundled career data.
  assert.match(todayLib, /daily-ai-digest:/);
  assert.match(todayLib, /review_status/);
  assert.match(todayLib, /loadCareerData\(/);
  assert.doesNotMatch(todayLib, /from "\.\.\/content\/career\/career\.json"/);
  assert.match(todayLib, /listWeeklyReports/);

  // The old home page (today's reading) now lives at /reading.
  assert.match(readingPage, /initialView="today"/);
  assert.match(deskApp, /next === "today" \? "\/reading"/);
  assert.match(deskApp, /onClick=\{\(\) => navigate\("today"\)\}/);
  assert.doesNotMatch(deskApp, /data\.user!/);
  assert.equal(sectionForPath("/reading"), "content");
  assert.equal(activeTabKey("/reading"), "reading");
  assert.match(siteNav, /hasPrefix\(pathname, "\/reading"\)/);
});

test("keeps the retired visitor auth screens out of the desk app", async () => {
  const page = await readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /openAuth\(/);
  assert.doesNotMatch(page, /submitAuth/);
  assert.doesNotMatch(page, /registrationSuccess/);
  assert.doesNotMatch(page, /登录后，开始你的今日阅读/);
  assert.doesNotMatch(page, /global-login/);
  assert.match(page, /goToLogin/);
  assert.match(page, /\/login\?next=/);
});

const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

async function collectSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, root);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(url)));
    else if (/\.(tsx?|css)$/.test(entry.name)) files.push(url);
  }
  return files;
}

test("keeps emoji out of app and lib sources", async () => {
  // 排版符号不在 emoji 范围内，不应误伤。
  assert.doesNotMatch("→ ← · — 「」 ／", EMOJI_PATTERN);

  const appFiles = await collectSourceFiles(new URL("../app/", import.meta.url));
  assert.ok(appFiles.length > 0, "expected to scan app source files");
  for (const file of appFiles) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, EMOJI_PATTERN, `unexpected emoji in ${file.pathname}`);
  }

  const libFiles = await collectSourceFiles(new URL("../lib/", import.meta.url));
  assert.ok(libFiles.length > 0, "expected to scan lib source files");
  for (const file of libFiles) {
    const source = await readFile(file, "utf8");
    if (file.pathname.endsWith("/lib/topics.ts")) {
      // 只允许小红书评论模板里的这一处 👇，出现次数与现在一致。
      const hits = source.match(/👇/gu) ?? [];
      assert.equal(hits.length, 1, "lib/topics.ts should keep exactly one 👇");
      assert.doesNotMatch(source.replace(/👇/gu, ""), EMOJI_PATTERN, "lib/topics.ts may only contain 👇");
      continue;
    }
    assert.doesNotMatch(source, EMOJI_PATTERN, `unexpected emoji in ${file.pathname}`);
  }
});

test("validates, normalizes and shapes daily briefs", async () => {
  const samplePath = "/workspace/projects/daily-topics/2026-09-30-topics.json";
  if (existsSync(samplePath)) {
    const sample = JSON.parse(await readFile(samplePath, "utf8"));
    const result = validateBrief(sample);
    assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"));
    if (result.ok) {
      assert.equal(result.brief.topics.length, 7);
      assert.equal(result.brief.date, "2026-09-30");
      assert.equal(result.brief.topics[0].type, "新闻题");
      for (const topic of result.brief.topics) {
        for (const material of topic.materials) {
          if (material.url) assert.match(material.url, /^https?:\/\//);
          for (const link of material.links) assert.match(link.url, /^https?:\/\//);
        }
      }
    }
  }

  const base = {
    version: 1,
    date: "2026-09-30",
    topics: [
      { id: "land-1", type: "落地题", title: "标题" },
      { id: "land-2", type: "新闻题", title: "标题 2", questions: ["问一", "问二"] },
    ],
  };
  const normalized = validateBrief(base);
  assert.equal(normalized.ok, true);
  if (normalized.ok) {
    assert.equal(normalized.brief.intro, "");
    assert.equal(normalized.brief.recommendation, null);
    assert.equal(normalized.brief.topics[0].oneLiner, "");
    assert.deepEqual(normalized.brief.topics[0].materials, []);
    assert.deepEqual(normalized.brief.topics[1].questions, ["问一", "问二"]);
  }

  const bad = (input) => {
    const result = validateBrief(input);
    assert.equal(result.ok, false);
    return result.ok ? [] : result.errors.join("\n");
  };
  assert.match(bad({ ...base, date: "2026-13-40" }), /date 不是合法日期/);
  assert.match(bad({ ...base, topics: [] }), /topics 必填且至少 1 个选题/);
  assert.match(bad({ ...base, version: 2 }), /version 只能是 1/);
  assert.match(bad({ ...base, topics: [{ id: "a", type: "落地题", title: "x" }, { id: "a", type: "落地题", title: "y" }] }), /topics\[1\]\.id 与前面的选题重复/);
  assert.match(bad({ ...base, topics: [{ id: "a", type: "主题", title: "x" }] }), /topics\[0\]\.type 只能是 落地题 或 新闻题/);
  assert.match(bad({ ...base, topics: [{ id: "a", type: "落地题", title: "" }] }), /topics\[0\]\.title 不能为空/);
  assert.match(bad({ ...base, topics: [{ id: "bad id!", type: "落地题", title: "x" }] }), /topics\[0\]\.id/);
  assert.match(bad({ ...base, recommendation: { topicId: "nope", reason: "" } }), /recommendation\.topicId 指向不存在的选题/);
  assert.match(bad({ ...base, topics: [{ id: "a", type: "落地题", title: "x", materials: [{ url: "ftp://x" }] }] }), /topics\[0\]\.materials\[0\]\.url 只允许 http 或 https/);
});

test("shapes brief replies with question pairing and missing-topic flags", () => {
  const brief = {
    version: 1,
    date: "2026-09-30",
    title: "",
    intro: "",
    recommendation: null,
    topics: [{
      id: "land-1",
      type: "落地题",
      label: "",
      title: "题目",
      oneLiner: "",
      detail: "",
      scenarios: ["场景 A", "场景 B"],
      questions: ["问一", "问二"],
      materials: [],
      note: "",
    }],
    notes: "",
    sources: [],
  };
  const row = {
    date: "2026-09-30",
    topicId: "land-1",
    rating: 4,
    ratingComment: "不错",
    decision: "pick",
    scenarioIndex: 1,
    scenarioText: "场景 B",
    answersJson: JSON.stringify(["答一", "答二"]),
    rejectReason: "",
    createdAt: "t0",
    updatedAt: "t1",
    account: "xieyu",
    nickname: "Yu",
  };
  const shaped = shapeResponse(row, brief);
  assert.equal(shaped.topicTitle, "题目");
  assert.equal(shaped.topicMissing, false);
  assert.deepEqual(shaped.answers, [{ question: "问一", answer: "答一" }, { question: "问二", answer: "答二" }]);
  assert.deepEqual(shaped.scenario, { index: 1, text: "场景 B" });
  assert.equal(shaped.user.account, "xieyu");
  assert.equal(shaped.decision, "pick");

  const missing = shapeResponse({ ...row, topicId: "gone" }, brief);
  assert.equal(missing.topicMissing, true);
  assert.equal(missing.topicTitle, "");
  assert.deepEqual(missing.answers, [{ question: "", answer: "答一" }, { question: "", answer: "答二" }]);

  const fallbackScenario = shapeResponse({ ...row, scenarioText: "" }, brief);
  assert.deepEqual(fallbackScenario.scenario, { index: 1, text: "场景 B" });

  assert.deepEqual(
    summarizeResponses([
      { rating: 5, decision: null },
      { rating: null, decision: "pick" },
      { rating: null, decision: "reject" },
      { rating: null, decision: null, ratingComment: "" },
    ], 7),
    { pick: 1, reject: 1, rated: 1, total: 7 },
  );
});

test("ships the daily brief storage, API, page and CLI", async () => {
  const [schema, store, migration, journal, domain, core, listRoute, dateRoute, responseRoute, readRoute, cli, apiLib, packageJson, page, component, css, nav, todayLib, topicsPage] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0016_daily_briefs.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/daily-brief.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/daily-brief-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/briefs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/briefs/[date]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/briefs/[date]/responses/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/briefs/responses/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/brief.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lib/dabaihua-api.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/daily/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/daily/_components/DailyBrief.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/daily/daily-brief.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/site-nav.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/today.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /export const dailyBriefs/);
  assert.match(schema, /export const dailyBriefResponses/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS daily_briefs/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS daily_brief_responses/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `daily_briefs`/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS `daily_brief_responses`/);
  assert.match(journal, /0016_daily_briefs/);

  assert.match(domain, /export async function upsertBrief/);
  assert.match(domain, /export async function getBrief/);
  assert.match(domain, /export async function listBriefDates/);
  assert.match(domain, /export async function getLatestBriefDate/);
  assert.match(domain, /export async function upsertResponse/);
  assert.match(domain, /export async function listResponses/);

  // Re-importing a day only ever updates the document: replies are kept.
  const upsertStart = domain.indexOf("export async function upsertBrief");
  const upsertEnd = domain.indexOf("export async function getBrief", upsertStart);
  const upsertBody = domain.slice(upsertStart, upsertEnd);
  assert.doesNotMatch(upsertBody, /DELETE FROM daily_brief_responses/);
  assert.match(upsertBody, /UPDATE daily_briefs SET data_json/);

  for (const route of [listRoute, dateRoute, responseRoute, readRoute]) {
    assert.match(route, /authenticateApiKey/);
    assert.match(route, /getSessionUser/);
    assert.match(route, /role !== "admin"/);
    assert.match(route, /cache-control/);
  }
  assert.match(dateRoute, /readBodyWithLimit/);
  assert.match(dateRoute, /PayloadTooLargeError/);
  assert.match(dateRoute, /publicBaseUrl/);
  assert.match(responseRoute, /assertSameOrigin/);

  assert.match(core, /export function validateBrief/);
  assert.match(core, /export function shapeResponse/);

  assert.match(nav, /选题简报/);
  assert.match(nav, /activeTabKey/);
  assert.match(topicsPage, /每日选题简报/);

  const pkg = JSON.parse(packageJson);
  assert.equal(pkg.scripts.brief, "node scripts/brief.mjs");
  assert.match(cli, /from ".\/lib\/dabaihua-api.mjs"/);
  assert.match(apiLib, /DABAIHUA_API_KEY/);
  assert.match(apiLib, /DABAIHUA_BASE_URL/);
  assert.match(apiLib, /topics-cli/);
  assert.match(cli, /请设置 DABAIHUA_API_KEY 或先运行 topics login/);
  assert.doesNotMatch(cli, /process\.stdout\.write\([^)]*token/i);
  assert.doesNotMatch(apiLib, /process\.stdout\.write\([^)]*token/i);

  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(page, /role !== "admin"/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /SiteAppBar/);
  assert.match(todayLib, /loadTodayBrief/);
  assert.match(todayLib, /daily_briefs/);
  assert.match(todayLib, /catch \{\s*return null;\s*\}/s);

  assert.match(component, /const STARS = \[1, 2, 3, 4, 5\]/);
  for (const testid of [
    "brief-card", "brief-recommended", "brief-toggle", "brief-section-scenarios",
    "brief-section-questions", "brief-section-materials", "brief-star-",
    "brief-rating-comment", "brief-pick", "brief-pick-scenario-", "brief-pick-answer-",
    "brief-pick-submit", "brief-reject", "brief-reject-reason", "brief-reject-submit",
    "brief-status", "brief-undo", "brief-date-select", "brief-prev", "brief-next",
  ]) {
    assert.match(component, new RegExp(testid));
  }
  assert.match(component, /target="_blank"/);
  assert.match(component, /rel="noopener noreferrer"/);
  assert.match(css, /max-width: 760px/);
  assert.match(css, /@media \(min-width: 900px\)/);
});

test("parses digest markdown into importable topic materials", async () => {
  const file = "/workspace/projects/daily-topics/2026-09-30.md";
  if (!existsSync(file)) return; // Fixture lives on the box; skip elsewhere.
  const text = await readFile(file, "utf8");
  const { items, references } = parseDigestMarkdown(text);
  assert.ok(items.length >= 8, `expected at least 8 digest items, got ${items.length}`);
  for (const item of items) {
    assert.ok(item.url.startsWith("http"), item.url);
    assert.ok(item.title);
    assert.ok(item.origin, `${item.title} is missing origin`);
  }
  assert.equal(items[0].title, "MCP Agent 校验要给「来源」打分，而不只是核对事实");
  assert.ok(references.length >= 3);

  const synthetic = [
    "## 今日干货",
    "",
    "### 1. 一条干货标题",
    "",
    "未能读取原文",
    "",
    "- 原文：[Original Title](https://example.com/a)",
    "- 来源：Example · 2026-09-30",
    "- 标签：Agent",
    "",
    "## 推荐选题",
    "",
    "- **依据素材**：",
    "  - [另一篇](https://example.com/b)",
    "",
  ].join("\n");
  const parsed = parseDigestMarkdown(synthetic);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].summary, "");
  assert.equal(parsed.items[0].url, "https://example.com/a");
  assert.equal(parsed.items[0].origin, "Example");
  assert.deepEqual(parsed.references, [{ title: "另一篇", url: "https://example.com/b" }]);
});

test("strips the body cache header before pushing content", () => {
  const raw = "URL: https://example.com/a\nFETCHED: 2026-09-30T00:00:00.000Z\n\n正文第一段\n正文第二段\n";
  assert.equal(stripBodyHeader(raw), "正文第一段\n正文第二段");
  assert.equal(stripBodyHeader("没有头部\n直接正文"), "没有头部\n直接正文");
});

test("weak topic materials only fill empty fields and never overwrite stored values", () => {
  const stored = {
    title: "真正的原文标题",
    translatedTitle: "已有的中文标题",
    originalExcerpt: "已有的原摘要",
    translatedExcerpt: "已有的中文摘要",
    contentMarkdown: "已有的正文",
    author: "Example",
    publishedAt: "2026-09-30T00:00:00.000Z",
  };
  const weak = {
    title: "真正的原文标题。",
    translatedTitle: "摘要第一句顶替的中文标题",
    originalExcerpt: "摘要第一句",
    translatedExcerpt: "摘要第一句",
    contentMarkdown: "更长的正文",
    author: "other.example.com",
    publishedAt: "2026-01-01T00:00:00.000Z",
  };
  assert.deepEqual(mergeWeakMaterial(stored, weak), stored);

  const blank = {
    title: "",
    translatedTitle: null,
    originalExcerpt: "  ",
    translatedExcerpt: null,
    contentMarkdown: "",
    author: null,
    publishedAt: null,
  };
  assert.deepEqual(mergeWeakMaterial(blank, weak), weak);
});

test("ships an admin-only topic materials import API and pushes digest materials", async () => {
  const [route, store, digest, materialsCli, component, brief] = await Promise.all([
    readFile(new URL("../app/api/materials/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/daily-ai-digest.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/materials.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/topics/daily/_components/DailyBrief.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/daily-brief.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /authenticateApiKey/);
  assert.match(route, /role !== "admin"/);
  assert.match(route, /importTopicMaterials/);
  assert.match(route, /weak: body\.weak === true/);
  assert.match(route, /findItemsByUrls/);
  assert.match(route, /readBodyWithLimit/);
  assert.match(route, /cache-control/);
  assert.match(store, /export async function importTopicMaterials/);
  assert.match(store, /mergeWeakMaterial/);
  assert.match(store, /input\.weak/);
  assert.match(store, /ensureDigestSource/);
  assert.match(store, /digest:\/\/topic-materials/);
  assert.match(brief, /weak: true/);
  assert.match(materialsCli, /weak: true/);
  assert.match(digest, /--no-push/);
  assert.match(digest, /DIGEST_PUSH_MATERIALS/);
  assert.match(digest, /pushDate\(date, outDir/);
  assert.match(materialsCli, /push-all/);
  assert.match(component, /brief-material-reader-link/);
  assert.match(component, /在阅读中打开/);
});

test("renders the digest 选题素材 source without an avatar proxy or management controls", async () => {
  const [deskApp, avatarRoute] = await Promise.all([
    readFile(new URL("../app/_components/DeskApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/source-avatar/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(deskApp, /"rss" \| "wechat" \| "x" \| "digest"/);
  assert.match(deskApp, /选题素材/);
  assert.match(deskApp, /随每日选题更新/);
  // Only rss / x go through the avatar proxy; digest falls back to an initial.
  assert.match(deskApp, /source\.kind === "rss" \|\| source\.kind === "x"\) return `\/api\/source-avatar/);
  assert.match(avatarRoute, /status: 404/);
});
