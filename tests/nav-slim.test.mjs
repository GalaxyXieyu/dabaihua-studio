import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** 取出指定 media query 的完整花括号块，用来确认变量写在正确的作用域里。 */
function mediaBlock(css, header) {
  const start = css.indexOf(header);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open, index + 1);
    }
  }
  return css.slice(open);
}

test("slims the global app bar to one 48px row on desktop", () => {
  const css = read("../app/globals.css");
  assert.match(css, /:root \{[^}]*--appbar-height:48px/);
  assert.doesNotMatch(css, /--appbar-height:93px/);
  assert.doesNotMatch(css, /data-collapsed/);
  // 子 tab 回到第一行居中，不再单独占第二行。
  assert.match(css, /\.section-tabs \{ grid-column:2; grid-row:1;/);
  assert.match(css, /\.section-tabs \{[^}]*overflow-x:auto/);
});

test("keeps a 36px scrolling sub-tab row below the mobile top bar", () => {
  const css = read("../app/globals.css");
  const mobile = mediaBlock(css, "@media (max-width:640px)");
  assert.match(mobile, /--appbar-height:84px/);
  assert.match(css, /\.section-tabs a \{ min-height:36px/);
});

test("removes the app bar auto-collapse entirely", () => {
  assert.equal(existsSync(new URL("../app/_components/AppBarAutoCollapse.tsx", import.meta.url)), false);
  const deskApp = read("../app/_components/DeskApp.tsx");
  const siteAppBar = read("../app/_components/SiteAppBar.tsx");
  assert.doesNotMatch(deskApp, /AppBarAutoCollapse/);
  assert.doesNotMatch(siteAppBar, /AppBarAutoCollapse/);
  assert.match(siteAppBar, /has-subnav/);
});

test("turns the reader column headers into single 40px rows", () => {
  const deskApp = read("../app/_components/DeskApp.tsx");
  const css = read("../app/globals.css");
  assert.doesNotMatch(deskApp, /筛选与管理订阅/);
  assert.doesNotMatch(deskApp, /正在浏览/);
  assert.match(deskApp, /reader-toolbar-label/);
  assert.match(css, /@container/);
  assert.match(css, /\.reader-toolbar \{ position:sticky;[^}]*height:40px/);
  assert.match(css, /\.article-pane-header \{ min-height:40px;/);
  assert.match(css, /\.brand-block \{ height:40px;/);
});
