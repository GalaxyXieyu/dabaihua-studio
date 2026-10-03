import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  CONTENT_NAMES,
  CONTENT_VIEW_NAMES,
  NAV_MONOGRAMS,
  activeTabKey,
  primaryNavItems,
  sectionForPath,
  sectionTabs,
} from "../lib/site-nav.ts";
import { legacyRedirect } from "../lib/legacy-redirects.ts";

const at = (value) => new URL(value, "https://studio.example");
const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("legacy /topics/daily, /topics and /articles redirect into /content", () => {
  assert.equal(
    legacyRedirect(at("/topics/daily?date=2026-10-02&topic=kb-3")),
    "/content?view=brief&date=2026-10-02&topic=kb-3",
  );
  assert.equal(legacyRedirect(at("/topics/daily?date=bad")), "/content?view=brief");
  assert.equal(legacyRedirect(at("/topics/daily?topic=bad%20id")), "/content?view=brief");
  assert.equal(legacyRedirect(at("/topics/daily?date=2026-10-02&topic=.!")), "/content?view=brief&date=2026-10-02");
  assert.equal(legacyRedirect(at("/topics")), "/content?view=board");
  assert.equal(legacyRedirect(at("/topics/")), "/content?view=board");
  assert.equal(legacyRedirect(at("/articles")), "/content?view=articles");
  assert.equal(legacyRedirect(at("/articles/2026-09-27-llm-eval")), null);
  assert.equal(legacyRedirect(at("/review/5")), null);
});

test("content section tabs keep the page name and put 阅读 first for non-admins", () => {
  const admin = sectionTabs("content", "admin");
  assert.deepEqual(admin.map((item) => item.href), ["/content", "/discover", "/strategy"]);
  assert.deepEqual(admin.map((item) => item.label), ["憋点干货", "阅读", "策略"]);
  assert.equal(admin[0].key, "content");
  assert.equal(admin[0].label, CONTENT_NAMES.content.label);

  const user = sectionTabs("content", "user");
  assert.deepEqual(user.map((item) => item.href), ["/discover", "/content", "/strategy"]);
  assert.deepEqual(user.map((item) => item.label), ["阅读", "憋点干货", "策略"]);

  assert.equal(primaryNavItems("admin").find((item) => item.key === "content")?.href, "/content");
  assert.equal(primaryNavItems("user").find((item) => item.key === "content")?.href, "/discover");
});

test("the old topics, articles and review routes all light the content tab", () => {
  for (const pathname of ["/content", "/content/", "/topics", "/topics/daily", "/articles/x", "/review/5"]) {
    assert.equal(sectionForPath(pathname), "content", pathname);
    assert.equal(activeTabKey(pathname), "content", pathname);
  }
  assert.equal(NAV_MONOGRAMS.content, "货");
  assert.equal(NAV_MONOGRAMS.content, CONTENT_NAMES.content.monogram);
  assert.deepEqual(Object.keys(CONTENT_VIEW_NAMES), ["brief", "board", "articles"]);
});

test("content page defaults admins to the brief and everyone else to the board", async () => {
  const page = await read("../app/content/page.tsx");
  assert.match(page, /isAdmin \? "brief" : "board"/);
  assert.match(page, /if \(!isAdmin && view === "brief"\) view = "board"/);
  assert.match(page, /getLatestBriefDate/);
  assert.match(page, /listArticlesForViewer/);
  assert.match(page, /<SiteAppBar user=\{user\} pathname="\/content" \/>/);
  assert.match(page, /<ContentSwitchBar/);
  assert.match(page, /redirect\("\/login\?next=\/content"\)/);
});

test("brief builds /content?view=brief URLs for date and topic changes", async () => {
  const brief = await read("../app/content/_brief/DailyBrief.tsx");
  assert.match(brief, /`\/content\?view=brief&date=\$\{older\.date\}`/);
  assert.match(brief, /`\/content\?view=brief&date=\$\{newer\.date\}`/);
  assert.match(brief, /window\.location\.assign\(`\/content\?view=brief&date=\$\{next\}`\)/);
  assert.match(brief, /params\.set\("view", "brief"\)/);
  assert.doesNotMatch(brief, /\/topics\/daily/);
});

test("articles view renders in normal page flow with breathing room above the first row", async () => {
  const [page, articles] = await Promise.all([
    read("../app/content/page.tsx"),
    read("../app/articles/articles.css"),
  ]);
  // 文章视图不再用 fixed inset-0：否则会躲到左侧栏下面。
  assert.doesNotMatch(page, /fixed inset-0/);
  assert.match(page, /className="art-a art-a-view"/);
  // 切换条与第一行文章之间留 ~20px。
  assert.match(articles, /\.art-a-list\s*\{[^}]*padding:\s*20px 20px 64px/s);
});

test("board filter row sits ~16px under the switch bar", async () => {
  const topics = await read("../app/topics/topics.css");
  assert.match(topics, /\.tp-main\s*\{[^}]*padding:\s*16px 20px 64px/s);
  assert.match(topics, /\.tp-main \{ padding: 16px 32px 80px; \}/);
  assert.match(topics, /\.tp-filters\s*\{[^}]*margin:\s*0 0 22px/s);
});

test("switch bar keeps a stable height and hides its label on mobile", async () => {
  const css = await read("../app/content/content.css");
  const bar = css.match(/\.ct-switchbar\s*\{[\s\S]*?\n\}/);
  assert.ok(bar, "expected a .ct-switchbar rule");
  const height = Number(bar[0].match(/height:\s*(\d+)px/)?.[1]);
  assert.ok(height > 0 && height <= 40, `switch bar height should be <=40px, got ${height}`);
  const mobile = css.match(/@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\n\}/);
  assert.ok(mobile, "expected a max-width:760px block in content.css");
  assert.match(mobile[0], /\.ct-switchbar-title/);
  // 用视觉隐藏而不是 display:none，手机端仍保留可访问的 h1。
  assert.match(mobile[0], /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(mobile[0], /display:\s*none/);
});

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

test("only lib/site-nav.ts names the content page", async () => {
  const files = await collectSourceFiles(new URL("../app/", import.meta.url));
  assert.ok(files.length > 0, "expected to scan app source files");
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /憋点干货/, `unexpected hard-coded name in ${file.pathname}`);
  }
  const nav = await read("../lib/site-nav.ts");
  assert.match(nav, /憋点干货/);
});
