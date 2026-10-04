/**
 * 今日简报 UI（part 2）源码约束测试。
 *
 * 只做源码/字符串层面的断言：交互行为由浏览器与接口测试覆盖。所有示例文本
 * 都是杜撰的，不包含任何真实数据。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  hasDecisionContent,
  shortMoment,
  stripDuplicateOutlineHeading,
} from "../app/content/_brief/detail-helpers.ts";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const dailyBrief = read("../app/content/_brief/DailyBrief.tsx");
const topicDetail = read("../app/content/_brief/TopicDetail.tsx");
const editor = read("../app/content/_brief/OutlineEditor.tsx");
const topicList = read("../app/content/_brief/TopicList.tsx");
const briefTypes = read("../app/content/_brief/brief-types.ts");
const contentPage = read("../app/content/page.tsx");
const board = read("../app/topics/_components/Board.tsx");

test("brief: 选/撤销/确认大纲/通知走到各自的管线接口", () => {
  // 「就写这个」立即 POST /select，不再走托盘里的二次确认。
  assert.match(dailyBrief, /"select"/);
  assert.match(dailyBrief, /topics\/\$\{topicId\}\/\$\{action\}/);
  assert.match(topicDetail, /就写这个/);

  // 撤销 → /undo；确认大纲 → /confirm-outline；重试通知 → /notify。
  assert.match(dailyBrief, /"undo"/);
  assert.match(dailyBrief, /"confirm-outline"/);
  assert.match(dailyBrief, /"notify"/);
  assert.match(topicDetail, /确认大纲/);
});

test("brief: 选托盘与「确定就写这个」已彻底移除", () => {
  const combined = `${dailyBrief}\n${topicDetail}`;
  assert.doesNotMatch(combined, /确定就写这个/);
  assert.doesNotMatch(combined, /brief-pick-submit/);
  assert.doesNotMatch(combined, /db-pick-form/);
  assert.doesNotMatch(combined, /brief-pick-scenario/);
  assert.doesNotMatch(combined, /brief-pick-answer/);
  // 「不要」的小理由托盘保留。
  assert.match(topicDetail, /brief-reject-reason/);
  assert.match(topicDetail, /brief-reject-submit/);
});

test("brief: 场景移入正文，含自定义场景与自动保存指示", () => {
  assert.match(topicDetail, /都不是，我自己说/);
  assert.match(topicDetail, /brief-scenario-option-/);
  assert.match(topicDetail, /brief-scenario-custom/);
  // 自动保存三态文案。
  assert.match(topicDetail, /保存中…/);
  assert.match(topicDetail, /已保存/);
  assert.match(topicDetail, /保存失败，重试/);
  // 自动保存走 responses 接口，并做 800ms 防抖。
  assert.match(dailyBrief, /AUTOSAVE_DEBOUNCE_MS = 800/);
  assert.match(dailyBrief, /\/responses/);
  assert.match(dailyBrief, /flushAutosave/);
});

test("brief: 来源行读取 scenarioSources / questionSources，空值不渲染", () => {
  assert.match(topicDetail, /topic\.scenarioSources/);
  assert.match(topicDetail, /topic\.questionSources/);
  assert.match(topicDetail, /来源：/);
  // 空串直接跳过，避免渲染空的「来源：」。
  assert.match(topicDetail, /\{source && \(/);
});

test("brief: 目的地条字符串齐全，含看板深链与通知三态", () => {
  assert.match(topicDetail, /已进选题看板 · 查看卡片 →/);
  assert.match(topicDetail, /已通知漱芳斋/);
  assert.match(topicDetail, /通知失败，/);
  assert.match(topicDetail, /未配置通知/);
  assert.match(topicDetail, /view=board&card=/);
  assert.match(topicDetail, /PIPELINE_LABELS/);
});

test("brief: 大纲区块与确认大纲按钮来自统一状态", () => {
  assert.match(topicDetail, /selection\.outlineMd/);
  assert.match(topicDetail, /outline_pending/);
  assert.match(topicDetail, /brief-confirm-outline/);
  assert.match(topicDetail, /MiniMarkdown/);
});

test("brief: 左列表在选中时使用统一管线标签", () => {
  assert.match(topicList, /PIPELINE_LABELS/);
  assert.match(topicList, /selections/);
  assert.match(topicList, /未处理/);
});

test("brief: 服务端一次读取当天 selections 并下传", () => {
  assert.match(contentPage, /listSelections/);
  assert.match(contentPage, /initialSelections/);
  assert.match(briefTypes, /export type BriefSelection/);
  assert.match(dailyBrief, /initialSelections/);
  assert.match(dailyBrief, /keyed|selections/);
});

test("brief: Board 读取 ?card= 深链并打开对应抽屉", () => {
  assert.match(board, /card/);
  assert.match(board, /URLSearchParams/);
  assert.match(board, /setSelected/);
  assert.match(board, /window\.location\.search/);
});

test("brief: 快捷键与深链保留，输入框不会触发 J/K/Y/N/1-5", () => {
  assert.match(dailyBrief, /lower === "y"/);
  assert.match(dailyBrief, /lower === "n"/);
  assert.match(dailyBrief, /key >= "1" && key <= "5"/);
  assert.match(dailyBrief, /tag === "input"/);
  assert.match(dailyBrief, /tag === "textarea"/);
  assert.match(dailyBrief, /params\.set\("view", "brief"\)/);
  assert.match(dailyBrief, /params\.set\("topic", topicId\)/);
});

test("brief: 详情顺序是选题头 → 目的地 → 大纲 → 决策结果 → 正文", () => {
  // 目的地条与大纲区在 header 之后、决策结果之前渲染。
  assert.match(
    topicDetail,
    /<\/header>\s*\{[^}]*DestinationStrip[\s\S]*?\{[^}]*OutlineSection[\s\S]*?\{showDecisionResult &&/,
  );
  // 目的地条不再出现在 header 之前。
  assert.doesNotMatch(topicDetail, /db-detail">\s*\{[^}]*DestinationStrip/);
});

test("brief: 操作成功后右栏回到顶部，左栏就地露出当前条目", () => {
  // 目的地条位于详情顶部，选中 / 撤销 / 确认大纲 / 重试通知成功后滚回顶部。
  assert.match(dailyBrief, /scrollDetailTop/);
  assert.match(dailyBrief, /scrollTo\(\{ top: 0 \}\)/);
  assert.match(dailyBrief, /wideScrollRef\.current\?\.scrollTo/);
  assert.match(dailyBrief, /selectNow[\s\S]*?scrollDetailTop\(\)/);
  assert.match(dailyBrief, /undoSelection[\s\S]*?scrollDetailTop\(\)/);
  assert.match(dailyBrief, /confirmOutline[\s\S]*?scrollDetailTop\(\)/);
  assert.match(dailyBrief, /retryNotify[\s\S]*?scrollDetailTop\(\)/);
  // 左栏偏移是算出来的，不用 scrollIntoView（会把整页带走）。
  assert.match(dailyBrief, /scrollTopicIntoView/);
  assert.match(dailyBrief, /closest\("\.db-left"\)/);
  assert.match(dailyBrief, /container\.scrollTop = itemBottom - container\.clientHeight/);
  assert.doesNotMatch(dailyBrief, /\.scrollIntoView\(/);
});

test("brief: 大纲首个标题若恰好是「大纲」则渲染前去重，存储不变", () => {
  assert.equal(
    stripDuplicateOutlineHeading("# 大纲\n\n一、开头\n二、结尾"),
    "一、开头\n二、结尾",
  );
  assert.equal(stripDuplicateOutlineHeading("## 大纲  \n正文"), "正文");
  assert.equal(
    stripDuplicateOutlineHeading("前面一段\n# 大纲\n正文"),
    "前面一段\n# 大纲\n正文",
  );
  assert.equal(
    stripDuplicateOutlineHeading("# 大纲：分三步\n正文"),
    "# 大纲：分三步\n正文",
  );
  assert.equal(stripDuplicateOutlineHeading("\n  \n# 大纲\n"), "");
  assert.equal(stripDuplicateOutlineHeading(""), "");
  // 只在渲染时去掉，selection.outlineMd 本身保持原样。
  assert.match(topicDetail, /stripDuplicateOutlineHeading\(selection\.outlineMd\)/);
});

test("brief: 决策结果没有内容时不渲染空条", () => {
  const empty = { scenarioText: "", answers: [], rejectReason: "" };
  assert.equal(hasDecisionContent(empty), false);
  assert.equal(hasDecisionContent({ ...empty, answers: ["", "  "] }), false);
  assert.equal(hasDecisionContent({ ...empty, scenarioText: "从通勤切入" }), true);
  assert.equal(hasDecisionContent({ ...empty, answers: ["", "因为两周"] }), true);
  assert.equal(hasDecisionContent({ ...empty, rejectReason: "太旧" }), true);
  // 区块由内容决定，不再只看 picked/rejected。
  assert.match(topicDetail, /hasDecisionContent\(state\)/);
  assert.match(topicDetail, /showDecisionResult &&/);
});

test("brief: shortMoment 带时区时换算成北京时间", () => {
  // Z 输入：UTC 07:15 → 北京时间 15:15。
  assert.equal(shortMoment("2026-10-04T07:15:00.000Z"), "10月4日 15:15");
  // ±hh:mm 偏移：+08:00 已是北京时间，原样展示。
  assert.equal(shortMoment("2026-10-03T21:10:00+08:00"), "10月3日 21:10");
  // 跨日：UTC 18:30 → 北京时间次日 02:30。
  assert.equal(shortMoment("2026-10-04T18:30:00Z"), "10月5日 02:30");
  // 不带时区的保持原来的字符串截取。
  assert.equal(shortMoment("2026-10-03T21:10:00"), "10月3日 21:10");
  assert.equal(shortMoment("2026-10-03 21:10"), "10月3日 21:10");
  // 空值与乱字符串原样返回。
  assert.equal(shortMoment(null), "");
  assert.equal(shortMoment(""), "");
  assert.equal(shortMoment("not-a-time"), "not-a-time");
  // TopicDetail（目的地条、Markdown 大纲 meta）与 OutlineEditor 头部 meta 都用它。
  assert.match(topicDetail, /import \{[^}]*shortMoment[^}]*\} from "\.\/detail-helpers"/);
  assert.doesNotMatch(topicDetail, /function shortMoment/);
  assert.match(editor, /shortMoment\(selection\.outlineAt\)/);
});
