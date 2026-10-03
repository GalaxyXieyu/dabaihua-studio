import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NAV_MONOGRAMS, navMonogram, navStateFor, sectionTabs } from "../lib/site-nav.ts";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("navStateFor: 阅读器默认收起，只有显式展开才记住", () => {
  assert.equal(navStateFor("/discover", null, null), "collapsed");
  assert.equal(navStateFor("/discover", "expanded", null), "collapsed");
  assert.equal(navStateFor("/reading", "collapsed", null), "collapsed");
  assert.equal(navStateFor("/discover", null, "expanded"), "expanded");
  assert.equal(navStateFor("/reading/abc", "collapsed", "expanded"), "expanded");
});

test("navStateFor: 普通页面默认展开，只有显式收起才记住", () => {
  assert.equal(navStateFor("/", null, null), "expanded");
  assert.equal(navStateFor("/topics", "expanded", null), "expanded");
  assert.equal(navStateFor("/topics/daily", null, "collapsed"), "expanded");
  assert.equal(navStateFor("/", "collapsed", "expanded"), "collapsed");
  assert.equal(navStateFor("/weekly", "collapsed", null), "collapsed");
});

test("NAV_MONOGRAMS: 覆盖今天与全部 content / growth 子项且为单字", () => {
  const items = [
    { key: "today", label: "今天" },
    ...sectionTabs("content", "admin"),
    ...sectionTabs("growth", "admin"),
  ];
  for (const item of items) {
    const monogram = NAV_MONOGRAMS[item.key];
    assert.equal(typeof monogram, "string", `缺少 ${item.key} 的单字映射`);
    assert.equal(Array.from(monogram).length, 1, `${item.key} 的单字映射必须是单字`);
    assert.equal(navMonogram(item), monogram);
  }
  // 没有映射时退回标签首字。
  assert.equal(navMonogram({ key: "unknown", label: "自定义", href: "/x" }), "自");
});

test("layout.tsx 在 <head> 内联防闪脚本，并同时覆盖两套存储键", () => {
  const layout = read("../app/layout.tsx");
  assert.match(layout, /dangerouslySetInnerHTML/);
  assert.match(layout, /dataset\.nav/);
  assert.match(layout, /dbh-nav/);
  assert.match(layout, /dbh-nav-reader/);
  assert.match(layout, /suppressHydrationWarning/);
});

test("SiteAppBar 与 DeskApp 顶栏都渲染 SiteSidebarNav", () => {
  const siteAppBar = read("../app/_components/SiteAppBar.tsx");
  const deskApp = read("../app/_components/DeskApp.tsx");
  assert.match(siteAppBar, /<SiteSidebarNav/);
  assert.match(deskApp, /<SiteSidebarNav/);
  assert.match(siteAppBar, /from "\.\/SiteSidebar"/);
  assert.match(deskApp, /from "\.\/SiteSidebar"/);
});

test("globals.css 定义侧栏宽度与收起态", () => {
  const css = read("../app/globals.css");
  assert.match(css, /:root \{[^}]*--nav-w:200px/);
  assert.match(css, /html\[data-nav="collapsed"\] \{ --nav-w:56px; \}/);
  assert.match(css, /\.global-appbar nav\.nav-sidebar \{ display:none; \}/);
  assert.match(css, /body:has\(\.global-appbar\) \{ padding-left:var\(--nav-w\)/);
});
