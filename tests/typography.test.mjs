import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

/** 取出第一条匹配选择器的规则体（本项目 CSS 为扁平写法，无嵌套）。 */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `未找到规则 ${selector}`);
  return match[1];
}

/** 从规则体里读取某个声明值。 */
function decl(rule, property) {
  const match = rule.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return match ? match[1].trim() : null;
}

test("阅读详情 H1 收小到 24–28px，行高 1.3", () => {
  const css = read("../app/globals.css");
  const h1 = ruleBody(css, ".reader-document > header h1");
  const size = Number.parseFloat(decl(h1, "font-size"));
  assert.ok(Number.isFinite(size), "未找到标题字号");
  assert.ok(size >= 24 && size <= 28, `标题字号 ${size}px 不在 24–28px`);
  assert.equal(decl(h1, "line-height"), "1.3");
});

test("阅读正文 17–18px / 行高 1.75，段落间距 0.8em", () => {
  const css = read("../app/globals.css");
  const body = ruleBody(css, ".markdown-article");
  const size = Number.parseFloat(decl(body, "font-size"));
  assert.ok(size >= 17 && size <= 18, `正文字号 ${size}px 不在 17–18px`);
  assert.equal(decl(body, "line-height"), "1.75");
  const paragraph = ruleBody(css, ".markdown-article p");
  assert.equal(decl(paragraph, "margin"), "0 0 .8em");
});

test("简报详情标题不超过 24px", () => {
  const css = read("../app/content/_brief/daily-brief.css");
  const sizes = [...css.matchAll(/\.db-detail-title\s*\{([^}]*)\}/g)]
    .map((match) => Number.parseFloat(decl(match[1], "font-size")))
    .filter((value) => Number.isFinite(value));
  assert.ok(sizes.length > 0, "未找到 .db-detail-title 字号");
  assert.ok(Math.max(...sizes) <= 24, `最大字号 ${Math.max(...sizes)}px 超过 24px`);
});

test("文章正文首段顶边距归零，双线到正文不再留大段空白", () => {
  const css = read("../app/_components/article-reviewer.css");
  const first = ruleBody(css, ".ar-a-body p:first-child");
  assert.match(decl(first, "margin-top"), /^0(\s*!important)?$/);
});

test("简报详情小节标题收到 15px", () => {
  const css = read("../app/content/_brief/daily-brief.css");
  const heading = ruleBody(css, ".db-section-title");
  assert.equal(Number.parseFloat(decl(heading, "font-size")), 15);
});

test("侧栏收起按钮移到顶部，不再用 margin:auto 顶到底部", () => {
  const css = read("../app/globals.css");
  assert.doesNotMatch(css, /margin:auto auto 8px/, "收起按钮不应再被推到底部");
  const toggle = ruleBody(css, ".nav-sidebar-toggle");
  assert.equal(decl(toggle, "position"), "absolute");
  assert.ok(decl(toggle, "top"), "展开态按钮应贴顶定位");
  const collapsed = ruleBody(css, 'html[data-nav="collapsed"] .nav-sidebar-toggle');
  assert.equal(decl(collapsed, "margin"), "0");
  assert.ok(decl(collapsed, "top"), "收起态按钮应贴顶定位");
});
