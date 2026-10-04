/**
 * 结构化大纲 outline/v0.1 测试：纯函数（校验、规范化、block、Markdown）、
 * 通知负载的新字段、以及源码层的路由/存储约定。
 *
 * 所有标题、素材、路径都是杜撰的，仅用于测试。
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  OUTLINE_JSON_MAX_BYTES,
  OUTLINE_VERSION,
  checkBaseRev,
  clearFeedback,
  collectFeedbackBlocks,
  outlineBlockIds,
  outlineToMarkdown,
  resolveQuestionAnswer,
  resolveTitle,
  validateOutlineJson,
  validateRegenerateBlocks,
} from "../lib/outline-core.ts";
import { PIPELINE_NOTIFY_EVENTS, buildNotifyPayload } from "../lib/brief-pipeline-core.ts";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

/** 合法 fixture（杜撰）：3 个标题候选、4 节（1 节勾掉）、2 图（1 张锚在勾掉节）、3 问题。 */
function fixtureRaw() {
  return {
    version: "outline/v0.1",
    rev: 7,
    extraTop: "应被丢弃",
    titles: {
      options: [
        { id: "t1", text: "标题甲" },
        { id: "t2", text: "标题乙" },
        { id: "t3", text: "标题丙" },
      ],
      selected: "t2",
      custom: null,
      allowCustom: false,
    },
    corePoint: { text: "核心观点一句话。", feedback: "太笼统了" },
    opening: { kind: "hypothetical", text: "假设你早上打开编辑器。", sources: ["素材一", "素材二"] },
    sections: [
      { id: "s1", heading: "缘起", points: ["要点一", "要点二"], editable: true, feedback: "第一节再具体点" },
      { id: "s2", heading: "展开", points: ["要点三"] },
      { id: "s3", heading: "反例", points: ["要点四"], keep: false },
      { id: "s4", heading: "结论", points: ["要点五"], keep: true },
    ],
    diagrams: [
      { id: "fig-1", caption: "流程草图", anchor: "s1", mermaid: "flowchart LR\n  A --> B" },
      { id: "fig-2", caption: "被勾掉小节的图", anchor: "s3", mermaid: "flowchart LR\n  C --> D", status: "draft" },
    ],
    questions: [
      { id: "q1", text: "选哪个方向", type: "single", options: ["A", "B"], default: "A", answer: "B", custom: null, feedback: "这个问题要改" },
      { id: "q2", text: "要带哪些例子", type: "multi", options: ["例一", "例二", "例三"], default: "例一", answer: ["例一", "例二"], custom: "自填例" },
      { id: "q3", text: "还有什么补充", type: "text", options: [], default: null, answer: null, custom: null },
    ],
    materials: [{ label: "资料一", path: "/tmp/dummy-1.md" }],
    feedback: "整体再紧凑一点",
  };
}

/** 最小合法对象，便于逐项覆盖。 */
function baseRaw() {
  return {
    version: "outline/v0.1",
    titles: { options: [{ id: "t1", text: "标题甲" }], selected: null, custom: null },
    corePoint: { text: "核心" },
    opening: { kind: "real", text: "开头", sources: [] },
    sections: [{ id: "s1", heading: "一节", points: ["要点"] }],
    diagrams: [],
    questions: [],
    materials: [],
  };
}

function validFixture() {
  const result = validateOutlineJson(fixtureRaw());
  assert.equal(result.ok, true);
  return result.outline;
}

test("validateOutlineJson: fixture normalizes (defaults, multi, drops unknown, ignores rev)", () => {
  const outline = validFixture();
  assert.equal(outline.version, OUTLINE_VERSION);
  assert.equal(outline.rev, 0, "输入里的 rev 一律忽略");
  assert.equal(outline.titles.allowCustom, true, "allowCustom 规范化为 true");
  assert.equal(outline.sections[2].keep, false);
  assert.equal(outline.sections[0].keep, true, "keep 缺省为 true");
  assert.equal(outline.diagrams[0].status, "draft", "diagram status 缺省 draft");
  assert.deepEqual(outline.questions[1].default, ["例一"], "multi 的字符串 default 规范化为数组");
  assert.deepEqual(outline.questions[1].answer, ["例一", "例二"]);
  assert.equal(Object.hasOwn(outline, "extraTop"), false, "未知字段丢弃");
  assert.equal(Object.hasOwn(outline.sections[0], "editable"), false, "未知字段丢弃");
  assert.equal(outline.corePoint.feedback, "太笼统了");
  assert.equal(outline.feedback, "整体再紧凑一点");
  assert.deepEqual(outlineBlockIds(outline), [
    "titles",
    "corePoint",
    "opening",
    "s1",
    "s2",
    "s3",
    "s4",
    "fig-1",
    "fig-2",
    "q1",
    "q2",
    "q3",
    "all",
  ]);
});

test("validateOutlineJson: accepts a JSON string", () => {
  const result = validateOutlineJson(JSON.stringify(baseRaw()));
  assert.equal(result.ok, true);
  assert.equal(result.outline.sections.length, 1);
});

test("validateOutlineJson: shape errors carry field, oversize lists get their own code", () => {
  const wrongVersion = validateOutlineJson({ ...baseRaw(), version: "outline/v9" });
  assert.equal(wrongVersion.ok, false);
  assert.equal(wrongVersion.error, "outline_json_invalid");
  assert.equal(wrongVersion.field, "version");

  const badSelected = validateOutlineJson({
    ...baseRaw(),
    titles: { options: [{ id: "t1", text: "标题甲" }], selected: "t9", custom: null },
  });
  assert.equal(badSelected.ok, false);
  assert.equal(badSelected.field, "titles.selected");

  const duplicateSection = validateOutlineJson({
    ...baseRaw(),
    sections: [
      { id: "s1", heading: "一", points: [] },
      { id: "s1", heading: "二", points: [] },
    ],
  });
  assert.equal(duplicateSection.ok, false);
  assert.equal(duplicateSection.field, "sections[1].id");

  const badAnchor = validateOutlineJson({
    ...baseRaw(),
    diagrams: [{ id: "fig-1", caption: "图", anchor: "s9", mermaid: "flowchart LR\n A-->B" }],
  });
  assert.equal(badAnchor.ok, false);
  assert.equal(badAnchor.field, "diagrams[0].anchor");

  const badType = validateOutlineJson({
    ...baseRaw(),
    questions: [{ id: "q1", text: "问", type: "bogus", options: [] }],
  });
  assert.equal(badType.ok, false);
  assert.equal(badType.field, "questions[0].type");

  const tooManySections = validateOutlineJson({
    ...baseRaw(),
    sections: Array.from({ length: 13 }, (_, index) => ({ id: `s${index + 1}`, heading: "h", points: [] })),
  });
  assert.equal(tooManySections.ok, false);
  assert.equal(tooManySections.error, "too_many_sections");

  const tooManyDiagrams = validateOutlineJson({
    ...baseRaw(),
    diagrams: Array.from({ length: 7 }, (_, index) => ({
      id: `fig-${index + 1}`,
      caption: "图",
      anchor: "s1",
      mermaid: "flowchart LR\n A-->B",
    })),
  });
  assert.equal(tooManyDiagrams.ok, false);
  assert.equal(tooManyDiagrams.error, "too_many_diagrams");

  const huge = {
    ...baseRaw(),
    materials: Array.from({ length: 30 }, () => ({ label: "m".repeat(2000), path: "p".repeat(2000) })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(huge), "utf8") > OUTLINE_JSON_MAX_BYTES);
  const tooLarge = validateOutlineJson(huge);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.error, "outline_json_too_large");
});

test("checkBaseRev: missing is ok, mismatch conflicts, non-integers are bad", () => {
  assert.deepEqual(checkBaseRev(3, undefined), { ok: true });
  assert.deepEqual(checkBaseRev(3, null), { ok: true });
  assert.deepEqual(checkBaseRev(3, 3), { ok: true });
  assert.deepEqual(checkBaseRev(3, 2), { ok: false, error: "rev_conflict" });
  assert.deepEqual(checkBaseRev(0, 1), { ok: false, error: "rev_conflict" });
  assert.deepEqual(checkBaseRev(3, -1), { ok: false, error: "bad_base_rev" });
  assert.deepEqual(checkBaseRev(3, 1.5), { ok: false, error: "bad_base_rev" });
  assert.deepEqual(checkBaseRev(3, "3"), { ok: false, error: "bad_base_rev" });
});

test("outlineToMarkdown: exact output for the fixture", () => {
  const expected = [
    "# 标题乙",
    "## 核心观点\n\n核心观点一句话。",
    "## 开头（假设场景）\n\n假设你早上打开编辑器。\n来源：素材一；素材二",
    "## 一、缘起\n\n- 要点一\n- 要点二\n\n> 图 fig-1：流程草图\n\n```mermaid\nflowchart LR\n  A --> B\n```",
    "## 二、展开\n\n- 要点三",
    "## 三、结论\n\n- 要点五",
    "## 拍板\n\n- 选哪个方向：B\n- 要带哪些例子：例一、例二、自填例\n- 还有什么补充：（未定）",
    "## 素材\n\n- 资料一：/tmp/dummy-1.md",
  ].join("\n\n");
  assert.equal(outlineToMarkdown(validFixture()), expected);
});

test("resolveTitle: selected -> custom -> first option -> none", () => {
  const withCustom = validateOutlineJson({
    ...baseRaw(),
    titles: { options: [{ id: "t1", text: "标题甲" }], selected: null, custom: "我自己写的标题" },
  });
  assert.equal(withCustom.ok, true);
  assert.equal(resolveTitle(withCustom.outline), "我自己写的标题");

  const firstFallback = validateOutlineJson(baseRaw());
  assert.equal(firstFallback.ok, true);
  assert.equal(resolveTitle(firstFallback.outline), "标题甲");

  const none = validateOutlineJson({ ...baseRaw(), titles: { options: [], selected: null, custom: null } });
  assert.equal(none.ok, true);
  assert.equal(resolveTitle(none.outline), "");
  assert.equal(outlineToMarkdown(none.outline).startsWith("# "), false, "没有标题时不输出标题行");
});

test("resolveQuestionAnswer: custom / answer / default / unset, multi joins with 、", () => {
  const answer = { id: "q1", text: "问", type: "single", options: [], default: "D", answer: "A", custom: null };
  assert.deepEqual(resolveQuestionAnswer(answer), { text: "A", isDefault: false });

  const withCustom = { ...answer, custom: "我自己答" };
  assert.deepEqual(resolveQuestionAnswer(withCustom), { text: "我自己答", isDefault: false });

  const fallback = { ...answer, answer: null };
  assert.deepEqual(resolveQuestionAnswer(fallback), { text: "D（默认）", isDefault: true });

  const unset = { ...answer, answer: null, default: null };
  assert.deepEqual(resolveQuestionAnswer(unset), { text: "（未定）", isDefault: false });

  const multi = { id: "q2", text: "问", type: "multi", options: [], default: null, answer: ["甲", "乙"], custom: "丙" };
  assert.deepEqual(resolveQuestionAnswer(multi), { text: "甲、乙、丙", isDefault: false });
});

test("validateRegenerateBlocks: legal, unknown, duplicate, empty, too long, all", () => {
  const outline = validFixture();
  assert.deepEqual(validateRegenerateBlocks(outline, [{ blockId: "s1", suggestion: "写具体点" }]), {
    ok: true,
    blocks: [{ blockId: "s1", suggestion: "写具体点" }],
  });
  assert.deepEqual(validateRegenerateBlocks(outline, [{ blockId: "all", suggestion: "整篇重来" }]), {
    ok: true,
    blocks: [{ blockId: "all", suggestion: "整篇重来" }],
  });
  assert.deepEqual(validateRegenerateBlocks(outline, [{ blockId: "nope", suggestion: "x" }]), {
    ok: false,
    error: "bad_block_id",
  });
  assert.deepEqual(
    validateRegenerateBlocks(outline, [
      { blockId: "s1", suggestion: "一" },
      { blockId: "s1", suggestion: "二" },
    ]),
    { ok: false, error: "duplicate_block" },
  );
  assert.deepEqual(validateRegenerateBlocks(outline, [{ blockId: "s1", suggestion: "   " }]), {
    ok: false,
    error: "suggestion_required",
  });
  assert.deepEqual(validateRegenerateBlocks(outline, [{ blockId: "s1", suggestion: "x".repeat(501) }]), {
    ok: false,
    error: "suggestion_too_long",
  });
  assert.equal(validateRegenerateBlocks(outline, []).ok, false);
});

test("collectFeedbackBlocks / clearFeedback: order follows block ids and originals stay intact", () => {
  const outline = validFixture();
  assert.deepEqual(collectFeedbackBlocks(outline), [
    { blockId: "corePoint", suggestion: "太笼统了" },
    { blockId: "s1", suggestion: "第一节再具体点" },
    { blockId: "q1", suggestion: "这个问题要改" },
    { blockId: "all", suggestion: "整体再紧凑一点" },
  ]);

  const cleared = clearFeedback(outline, ["corePoint", "s1", "all"]);
  assert.equal(cleared.corePoint.feedback, undefined);
  assert.equal(cleared.sections[0].feedback, undefined);
  assert.equal(cleared.feedback, undefined);
  assert.equal(cleared.questions[0].feedback, "这个问题要改");
  assert.equal(outline.corePoint.feedback, "太笼统了", "不修改入参");
});

const TOPIC = {
  id: "kb-7",
  date: "2026-10-06",
  type: "新闻题",
  label: "新闻主选题",
  title: "一个大标题",
  oneLiner: "一句话说清",
  detail: "更详细的背景",
  scenarios: [],
  questions: [],
};

function payloadInput(overrides = {}) {
  return {
    event: "select",
    eventId: "event-x",
    sentAt: "2026-10-06T10:00:00+08:00",
    topic: TOPIC,
    status: "selected",
    boardTopicId: null,
    baseUrl: "https://example.com",
    ...overrides,
  };
}

test("buildNotifyPayload: regenerate_outline carries blocks/outlineJson/baseRev", () => {
  const outline = validFixture();
  const blocks = [{ blockId: "s1", suggestion: "写具体点" }];
  const payload = buildNotifyPayload(
    payloadInput({
      event: "regenerate_outline",
      status: "outline_pending",
      outline: "# 大纲",
      outlineJson: outline,
      baseRev: 4,
      blocks,
    }),
  );
  assert.equal(payload.event, "regenerate_outline");
  assert.deepEqual(payload.blocks, blocks);
  assert.deepEqual(payload.outlineJson, outline);
  assert.equal(payload.baseRev, 4);
  assert.equal(payload.outline, "# 大纲");
  assert.deepEqual(payload.status, { code: "outline_pending", label: "大纲待确认" });
});

test("buildNotifyPayload: confirm_outline adds outlineJson/baseRev, select/cancel stay clean", () => {
  const outline = validFixture();
  const confirm = buildNotifyPayload(
    payloadInput({ event: "confirm_outline", status: "drafting", outline: "# 大纲", outlineJson: outline, baseRev: 2 }),
  );
  assert.deepEqual(confirm.outlineJson, outline);
  assert.equal(confirm.baseRev, 2);
  assert.equal(Object.hasOwn(confirm, "blocks"), false);

  for (const event of ["select", "cancel"]) {
    const payload = buildNotifyPayload(payloadInput({ event }));
    assert.equal(Object.hasOwn(payload, "outlineJson"), false, `${event} 不带 outlineJson`);
    assert.equal(Object.hasOwn(payload, "baseRev"), false, `${event} 不带 baseRev`);
    assert.equal(Object.hasOwn(payload, "blocks"), false, `${event} 不带 blocks`);
  }
});

test("events: exactly four codes in order", () => {
  assert.deepEqual([...PIPELINE_NOTIFY_EVENTS], ["select", "confirm_outline", "cancel", "regenerate_outline"]);
});

test("source checks: routes, conditional update and schema columns", () => {
  const pipeline = read("../app/api/briefs/[date]/topics/[topicId]/pipeline/route.ts");
  assert.match(pipeline, /body\.outlineJson/);
  assert.match(pipeline, /body\.baseRev/);
  assert.match(pipeline, /updateBriefPipeline/);

  for (const path of [
    "../app/api/briefs/[date]/topics/[topicId]/outline-draft/route.ts",
    "../app/api/briefs/[date]/topics/[topicId]/regenerate-outline/route.ts",
  ]) {
    const route = read(path);
    assert.match(route, /authenticateApiKey/);
    assert.match(route, /assertSameOrigin/);
    assert.doesNotMatch(route, /DABAIHUA_CARDS_ASSISTANT_TOKEN/, "Yu 侧接口不认助手 token");
  }

  const domain = read("../lib/brief-pipeline.ts");
  // toView 里解析出的 outlineJson.rev 必须等于该行的 outline_rev，和 outlineRev / baseRev 一致。
  assert.match(domain, /outlineJson\.rev = outlineRev/);
  assert.match(domain, /outline_rev = outline_rev \+ 1/);
  assert.match(domain, /outline_rev = \?/);
  assert.match(domain, /rev_conflict/);
  assert.match(domain, /outline_regen_json/);

  for (const path of ["../lib/store.ts", "../db/schema.ts", "../drizzle/0023_outline_structured.sql"]) {
    const source = read(path);
    assert.match(source, /outline_json/);
    assert.match(source, /outline_rev/);
    assert.match(source, /outline_regen_json/);
  }
});
