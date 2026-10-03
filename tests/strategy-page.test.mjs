import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const page = read("../app/strategy/page.tsx");
const editor = read("../app/strategy/_components/StrategyEditor.tsx");
const documentView = read("../app/strategy/_components/StrategyDocument.tsx");
const editable = read("../app/strategy/_components/StrategyEditable.tsx");
const css = read("../app/strategy/strategy.css");

test("策略页是单栏文档，不再有左右分栏或旧侧栏", () => {
  for (const source of [page, editor, css]) {
    assert.doesNotMatch(source, /strat-aside/, "不得再引用 strat-aside");
    assert.doesNotMatch(source, /strat-layout/, "不得再引用 strat-layout");
  }
  assert.doesNotMatch(css, /\.strat-editor\s*\{[^}]*min-width/, "旧的编辑器分栏规则应删除");
  // 单栏：主容器居中，正文宽度收在阅读尺度内。
  assert.match(css, /\.strat-main\s*\{[^}]*margin:\s*0 auto/);
});

test("刊头有标题、当前版本与两个安静按钮", () => {
  assert.match(editor, /内容 · \{CONTENT_NAMES\.strategy\.label\}/);
  assert.match(editor, /<h1[^>]*className="strat-title"[^>]*>\s*\{CONTENT_NAMES\.strategy\.label\}/);
  assert.match(editor, /当前版本/);
  assert.match(editor, /版本历史/);
  assert.match(editor, /编辑/);
  assert.match(editor, /完成/);
});

test("阅读态文档不含任何输入控件，输入只在编辑组件里", () => {
  assert.doesNotMatch(documentView, /<input\b/, "阅读态不得渲染 <input>");
  assert.doesNotMatch(documentView, /<textarea\b/, "阅读态不得渲染 <textarea>");
  assert.match(editable, /<input\b/, "编辑态应提供行内输入");
  // 输入是否出现由 editing 状态决定。
  assert.match(editor, /editing\s*\?[\s\S]*?<StrategyEditable/);
  assert.match(editor, /:\s*\(?\s*<StrategyDocument/);
});

test("版本历史是带对话框语义的抽屉，支持 Escape 与遮罩关闭", () => {
  assert.match(editor, /role="dialog"/);
  assert.match(editor, /aria-modal="true"/);
  assert.match(editor, /"Escape"/, "抽屉需要处理 Escape");
  assert.match(editor, /strat-scrim/);
  assert.match(editor, /strat-drawer/);
  assert.match(editor, /historyButtonRef\.current\?\.focus\(\)/, "关闭后焦点回到触发按钮");
});

test("保存仍走 /api/strategy，请求体格式不变", () => {
  assert.match(editor, /fetch\("\/api\/strategy"/);
  assert.match(editor, /method:\s*"POST"/);
  assert.match(editor, /const content = JSON\.stringify\(data\)/);
  assert.match(editor, /body:\s*JSON\.stringify\(\{\s*content[,\s]/);
  assert.match(editor, /note:\s*versionNoteToSave/);
});

test("编辑态底部提供版本说明、保存为新版本与取消，且离开前有确认", () => {
  assert.match(editor, /版本说明/);
  assert.match(editor, /保存为新版本/);
  assert.match(editor, /window\.confirm/);
  assert.match(css, /\.strat-editbar\s*\{[^}]*position:\s*sticky/);
});

test("刊头是 flex 行，两个按钮固定在右上角", () => {
  assert.match(css, /\.strat-head-row\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.strat-head-actions\s*\{[^}]*margin-left:\s*auto/);
  // 编辑 / 完成 用 primary 稍作强调。
  assert.match(editor, /strat-btn-quiet primary/);
  assert.match(editor, /版本历史/);
});

test("排版放大到文章尺度：正文 17px、平台标题 21px、lede 18px", () => {
  assert.match(css, /\.strat-doc\s*\{[^}]*font-size:\s*17px[^}]*line-height:\s*1\.7/);
  assert.match(css, /\.strat-doc-h3\s*\{[^}]*font-size:\s*21px/);
  assert.match(css, /\.strat-doc-lede\s*\{[^}]*font-size:\s*18px/);
  assert.match(css, /\.strat-doc-route-name\s*\{[^}]*font-size:\s*17px/);
  assert.match(css, /\.strat-doc-route-rule\s*\{[^}]*font-size:\s*17px/);
});

test("手机端 meta 竖排三行且不显示分隔点，按钮单独一行右对齐", () => {
  const mobile = css.match(/@media \(max-width: 760px\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(mobile, "应有 760px 断点");
  const block = mobile[1];
  assert.match(block, /\.strat-meta\s*\{[^}]*flex-direction:\s*column/);
  assert.match(block, /\.strat-sep\s*\{\s*display:\s*none/);
  assert.match(block, /\.strat-head-actions\s*\{[^}]*justify-content:\s*flex-end/);
});

test("编辑态输入与阅读态同字号，切换不跳动", () => {
  assert.match(css, /\.strat-edit-input\s*\{[^}]*font-size:\s*17px/);
  assert.match(css, /\.strat-edit-textarea\s*\{[^}]*font-size:\s*17px/);
});

test("抽屉在桌面约 380px，手机全宽", () => {
  assert.match(css, /\.strat-drawer\s*\{[^}]*width:\s*min\(380px,\s*100vw\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.strat-drawer\s*\{[^}]*width:\s*100%/);
});
