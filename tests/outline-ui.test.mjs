/**
 * 结构化大纲确认 UI（outline/v0.1）的源码层约束测试。
 *
 * 只做字符串断言：交互行为由浏览器与接口测试覆盖。所有示例文本都是杜撰的。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const topicDetail = read("../app/content/_brief/TopicDetail.tsx");
const dailyBrief = read("../app/content/_brief/DailyBrief.tsx");
const hook = read("../app/content/_brief/use-outline-draft.ts");
const editor = read("../app/content/_brief/OutlineEditor.tsx");
const mermaid = read("../app/content/_brief/MermaidDiagram.tsx");
const css = read("../app/content/_brief/outline-editor.css");
const contentPage = read("../app/content/page.tsx");
const pkg = JSON.parse(read("../package.json"));

test("outline-ui: TopicDetail 在 outline_pending + outlineJson 时用结构化编辑器，否则保留 Markdown 视图", () => {
  assert.match(topicDetail, /selection\.status === "outline_pending"/);
  assert.match(topicDetail, /selection\.outlineJson/);
  assert.match(topicDetail, /structuredOutline/);
  assert.match(topicDetail, /<OutlineEditor/);
  assert.match(topicDetail, /<OutlineSection/);
  // 只有非结构化分支才渲染旧的确认按钮组件。
  assert.match(topicDetail, /!structuredOutline/);
  assert.match(topicDetail, /onConfirmOutline/);
  // DailyBrief 传 date 与 onSelection 新 prop。
  assert.match(dailyBrief, /onSelection=\{\(next\) => applySelection\(topic\.id, next\)\}/);
  assert.match(dailyBrief, /date=\{date\}/);
});

test("outline-ui: hook 用 PUT 打 outline-draft 且带 baseRev", () => {
  assert.match(hook, /method: "PUT"/);
  assert.match(hook, /outline-draft/);
  assert.match(hook, /baseRev: revRef\.current/);
  assert.match(hook, /outlineJson: current/);
  // 串行：保存中再来改动排队，回来后再发。
  assert.match(hook, /queuedRef/);
  assert.match(hook, /savingRef/);
});

test("outline-ui: hook 处理 409 rev_conflict 与「载入最新」", () => {
  assert.match(hook, /rev_conflict/);
  assert.match(hook, /setConflict/);
  assert.match(hook, /载入最新/);
  assert.match(hook, /loadLatest/);
  // 载入最新走 GET pipeline 覆盖本地。
  assert.match(hook, /\/pipeline/);
  assert.match(hook, /reset\(data\.selection\)/);
});

test("outline-ui: regenerate-outline 与 confirm-outline 都带 outlineJson + baseRev", () => {
  assert.match(hook, /regenerate-outline/);
  assert.match(hook, /confirm-outline/);
  const outlineJsonUses = hook.match(/outlineJson: outlineRef\.current/g) ?? [];
  assert.ok(outlineJsonUses.length >= 2, "重生成与确认都要带当前 outlineJson");
  const baseRevUses = hook.match(/baseRev: revRef\.current/g) ?? [];
  assert.ok(baseRevUses.length >= 3, "PUT / 重生成 / 确认都要带 baseRev");
  // blocks 来自共享的 pendingBlocks，排除重写中的块。
  assert.match(hook, /pendingBlocks\(outlineRef\.current, locked\)/);
  assert.match(hook, /!locked\(item\.blockId\)/);
});

test("outline-ui: OutlineEditor 文案常量齐全", () => {
  for (const text of [
    "不好，重新生成",
    "按建议重生成",
    "确认大纲",
    "重写中",
    "改这里",
    "重画",
    "其他",
    "默认",
    "勾掉",
    "恢复",
    "上移",
    "下移",
    "大纲在别处更新过",
    "载入最新",
    "整份大纲",
  ]) {
    assert.ok(editor.includes(text), `缺少文案：${text}`);
  }
});

test("outline-ui: data-testid 规则齐全", () => {
  for (const id of [
    "outline-editor",
    "outline-block-",
    "outline-title-chip-",
    "outline-title-other",
    "outline-question-",
    "outline-section-",
    "outline-diagram-",
    "outline-suggest-",
    "outline-bar",
    "outline-regenerate",
    "outline-confirm",
  ]) {
    assert.ok(editor.includes(id), `缺少 data-testid：${id}`);
  }
});

test("outline-ui: 拖动排序用手柄 + 上移/下移按钮", () => {
  assert.match(editor, /draggable/);
  assert.match(editor, /DotsSixVertical/);
  assert.match(editor, /ArrowUp/);
  assert.match(editor, /ArrowDown/);
  assert.match(editor, /上移/);
  assert.match(editor, /下移/);
  assert.match(editor, /data-drop/);
});

test("outline-ui: 拖动放置目标整个 wrap（卡片 + 图），按上下半区判断", () => {
  // dragenter/dragover/drop 与 data-drop 都挂在小节包裹层上。
  const wrapOpen = editor.match(/<div\s+className="ol-section-wrap"[\s\S]*?<section/);
  assert.ok(wrapOpen, "应能找到 ol-section-wrap 开标签");
  for (const handler of ["data-drop", "onDragEnter", "onDragOver", "onDrop"]) {
    assert.ok(wrapOpen[0].includes(handler), `wrap 上应有 ${handler}`);
  }
  // 插入线画在 wrap 的上沿或下沿，而不是单个卡片。
  assert.match(css, /\.ol-section-wrap\[data-drop="before"\] \{[\s\S]*?box-shadow: 0 -2px 0 var\(--ol-gold\)/);
  assert.match(css, /\.ol-section-wrap\[data-drop="after"\] \{[\s\S]*?box-shadow: 0 2px 0 var\(--ol-gold\)/);
});

test("outline-ui: 拖动手柄靠 dragend 与 window mouseup 取消武装", () => {
  // 去掉稍快移出就取消的 onMouseLeave。
  assert.doesNotMatch(editor, /onMouseLeave=\{\(\) => drag\.onArm\(false\)\}/);
  assert.match(editor, /onDragEnd=\{drag\.onDragEnd\}/);
  assert.match(editor, /window\.addEventListener\("mouseup"/);
  assert.match(editor, /window\.removeEventListener\("mouseup"/);
});

test("outline-ui: OutlineBar 在 .db-actionbar 内，且结构化模式不显示旧确认按钮", () => {
  assert.match(topicDetail, /db-actionbar[\s\S]*?<OutlineBar/);
  // 结构化编辑器与底部栏共用同一个 hook 句柄。
  assert.match(topicDetail, /useOutlineDraft/);
  assert.match(topicDetail, /outlineDraft/);
});

test("outline-ui: MermaidDiagram 浏览器懒加载、strict，且没有顶层 from \"mermaid\"", () => {
  assert.match(mermaid, /import\("mermaid"\)/);
  assert.match(mermaid, /securityLevel: "strict"/);
  assert.match(mermaid, /startOnLoad: false/);
  assert.match(mermaid, /themeVariables/);
  assert.doesNotMatch(mermaid, /from\s+["']mermaid["']/);
});

test("outline-ui: package.json 有 mermaid 依赖，页面 import 了大纲样式", () => {
  assert.ok(pkg.dependencies?.mermaid, "package.json dependencies 里应有 mermaid");
  assert.match(contentPage, /outline-editor\.css/);
});

test("outline-ui: OutlineBar 排除重写中的块，待重生成计数/chip/按钮都用过滤后的", () => {
  // 底部栏与 hook 共用 pendingBlocks，把 locked 的块排除在待重生成之外。
  assert.match(editor, /pendingBlocks\(outline, draft\.locked\)/);
  assert.match(hook, /export function pendingBlocks/);
  // 确认按钮只在 barBusy 时禁用；有块重写中时先 window.confirm。
  assert.match(editor, /disabled=\{draft\.barBusy\}/);
  assert.match(editor, /window\.confirm\(COPY\.confirmWhileRewriting\(regenerating\)\)/);
  assert.match(editor, /还有 \$\{count\} 块在重写中/);
  // 按建议重生成在 n=0 或有块重写中时仍禁用。
  assert.match(editor, /const regenDisabled = draft\.barBusy \|\| regenerating > 0 \|\| blocks\.length === 0/);
  // 没有待重生成时显示淡色提示，不再显示「待重生成 0 条」。
  assert.match(editor, /pendingHint/);
  assert.match(css, /\.ol-bar-hint/);
});

test("outline-ui: hook 在 regenerate/confirm 前先 await 进行中的保存", () => {
  assert.match(hook, /savingPromiseRef/);
  assert.match(hook, /async function awaitPendingSave/);
  const awaits = hook.match(/await awaitPendingSave\(\)/g) ?? [];
  assert.ok(awaits.length >= 2, "重生成与确认都要先等保存结束");
});

test("outline-ui: 建议输入框在有 feedback 时常显，按钮按内容叫清除或收起", () => {
  assert.match(editor, /const showSuggest = open \|\| hasFeedback/);
  assert.match(editor, /clear: "清除"/);
  assert.match(editor, /collapse: "收起"/);
  assert.match(editor, /hasValue \? clearBlockFeedback\(draft, blockId\) : toggleSuggest\(draft, blockId\)/);
  // 重写中的块不显示「已提建议」小标，也不渲染可编辑输入框。
  assert.match(editor, /\{!locked && hasFeedback && \(/);
  assert.match(editor, /\{!locked && \(/);
});

test("outline-ui: 重写中小标醒目 + mermaid themeVariables 补全", () => {
  assert.match(css, /\.ol-badge\.is-locked::before/);
  assert.match(css, /animation: ol-pulse/);
  assert.match(css, /prefers-reduced-motion[\s\S]*?\.ol-badge\.is-locked::before[\s\S]*?animation: none/);
  for (const token of [
    "primaryColor",
    "mainBkg",
    "primaryTextColor",
    "textColor",
    "nodeBorder",
    "secondaryColor",
    "tertiaryColor",
    "edgeLabelBackground",
    "clusterBkg",
    "clusterBorder",
    "fontSize",
  ]) {
    assert.ok(mermaid.includes(token), `themeVariables 缺 ${token}`);
  }
  // 承载区底色改成 --paper。
  assert.match(css, /\.ol-mermaid \{[\s\S]*?background: var\(--paper\)/);
});

test("outline-ui: 小节卡片首行是编号 + 标题 + 操作组", () => {
  assert.match(editor, /className="ol-card-head"/);
  assert.match(editor, /className="ol-card-tools"/);
  // 卡片里不再有重复的小标题行（BlockHead 不再用于小节）。
  assert.doesNotMatch(editor, /<BlockHead blockId=\{section\.id\}/);
  assert.match(css, /\.ol-card \{[\s\S]*?padding: 12px 14px/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.ol-card-head \{[\s\S]*?grid-template-columns: auto 1fr/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.ol-card-tools \{[\s\S]*?grid-column: 1 \/ -1/);
  // 「勾掉」和「不好，重新生成」之间 12px。
  assert.match(css, /\.ol-card-tools \.ol-text-btn ~ \.ol-text-btn \{[\s\S]*?margin-left: 12px/);
});

test("outline-ui: 图「这张可以」是小切换 chip 且状态配色区分", () => {
  assert.match(editor, /ol-diagram-toggle/);
  assert.match(editor, /ol-diagram-status is-\$\{status\}/);
  assert.match(css, /\.ol-diagram-status\.is-ok[\s\S]*?var\(--ol-gold\)/);
  assert.match(css, /\.ol-diagram-status\.is-redo[\s\S]*?var\(--accent\)/);
});

test("outline-ui: 前端复用 outline-core 的纯逻辑", () => {
  assert.match(editor, /resolveQuestionAnswer/);
  assert.match(hook, /collectFeedbackBlocks/);
  assert.match(editor, /from "\.\.\/\.\.\/\.\.\/lib\/outline-core"/);
});

test("outline-ui: 新文件不含 emoji", () => {
  const emoji = /\p{Extended_Pictographic}/u;
  for (const [name, source] of [
    ["use-outline-draft.ts", hook],
    ["OutlineEditor.tsx", editor],
    ["MermaidDiagram.tsx", mermaid],
    ["outline-editor.css", css],
  ]) {
    assert.doesNotMatch(source, emoji, `${name} 不应含 emoji`);
  }
});

test("outline-ui: 样式以 .ol- 选择器为主并定义金色", () => {
  assert.match(css, /--ol-gold:\s*#BA9500/);
  assert.match(css, /\.ol-editor/);
  assert.match(css, /\.ol-card/);
  assert.match(css, /prefers-reduced-motion/);
});
