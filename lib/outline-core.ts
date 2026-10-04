// 结构化大纲 outline/v0.1 的纯函数：类型、校验/规范化、block id、Markdown 生成。
// 只依赖类型和纯逻辑，import 带 .ts 后缀，便于 node 的类型擦除测试直接加载。

/** 大纲协议版本，也是 JSON 里的 version 字段。 */
export const OUTLINE_VERSION = "outline/v0.1";
/** outline_json 的 UTF-8 字节上限（按 JSON.stringify 结果计）。 */
export const OUTLINE_JSON_MAX_BYTES = 65536;
/** 小节数量上限。 */
export const OUTLINE_MAX_SECTIONS = 12;
/** 配图数量上限。 */
export const OUTLINE_MAX_DIAGRAMS = 6;
/** 标题候选上限。 */
export const OUTLINE_MAX_TITLE_OPTIONS = 8;
/** 问题数量上限。 */
export const OUTLINE_MAX_QUESTIONS = 12;
/** 每节要点上限。 */
export const OUTLINE_MAX_POINTS_PER_SECTION = 20;
/** 素材数量上限。 */
export const OUTLINE_MAX_MATERIALS = 30;
/** 单条文本长度上限。 */
export const OUTLINE_MAX_TEXT_LENGTH = 2000;
/** mermaid 源码长度上限。 */
export const OUTLINE_MAX_MERMAID_LENGTH = 8000;
/** feedback / suggestion 长度上限。 */
export const OUTLINE_MAX_FEEDBACK_LENGTH = 500;
/** 一次重生成最多带多少块。 */
export const OUTLINE_MAX_REGENERATE_BLOCKS = 30;

export type OutlineTitleOption = { id: string; text: string };

export type OutlineTitles = {
  options: OutlineTitleOption[];
  selected: string | null;
  custom: string | null;
  allowCustom: true;
  feedback?: string;
};

export type OutlineCorePoint = { text: string; feedback?: string };

export type OutlineOpeningKind = "real" | "hypothetical";

export type OutlineOpening = {
  kind: OutlineOpeningKind;
  text: string;
  sources: string[];
  feedback?: string;
};

export type OutlineSection = {
  id: string;
  heading: string;
  points: string[];
  keep: boolean;
  feedback?: string;
};

export type OutlineDiagramStatus = "draft" | "ok" | "redo";

export type OutlineDiagram = {
  id: string;
  caption: string;
  anchor: string;
  mermaid: string;
  status: OutlineDiagramStatus;
  feedback?: string;
};

export type OutlineQuestionType = "single" | "multi" | "text";

export type OutlineQuestion = {
  id: string;
  text: string;
  type: OutlineQuestionType;
  options: string[];
  default: string | string[] | null;
  answer: string | string[] | null;
  custom: string | null;
  feedback?: string;
};

export type OutlineMaterial = { label: string; path: string };

/** 结构化大纲 outline/v0.1。rev 由服务器管理，输入里的值一律忽略。 */
export type OutlineV01 = {
  version: typeof OUTLINE_VERSION;
  rev: number;
  titles: OutlineTitles;
  corePoint: OutlineCorePoint;
  opening: OutlineOpening;
  sections: OutlineSection[];
  diagrams: OutlineDiagram[];
  questions: OutlineQuestion[];
  materials: OutlineMaterial[];
  feedback?: string;
};

export type OutlineValidation =
  | { ok: true; outline: OutlineV01 }
  | { ok: false; error: string; field?: string };

export type RegenerateBlock = { blockId: string; suggestion: string };

export type RegenerateBlocksValidation =
  | { ok: true; blocks: RegenerateBlock[] }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof json !== "string") return Number.POSITIVE_INFINITY;
  return new TextEncoder().encode(json).length;
}

function invalid(field?: string): OutlineValidation {
  return field === undefined ? { ok: false, error: "outline_json_invalid" } : { ok: false, error: "outline_json_invalid", field };
}

function feedbackResult(value: unknown, field: string): { ok: true; value?: string } | { ok: false; field: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "string") return { ok: false, field };
  if (value.trim() === "") return { ok: true };
  if (value.length > OUTLINE_MAX_FEEDBACK_LENGTH) return { ok: false, field };
  return { ok: true, value };
}

function stringList(value: unknown, field: string, max: number): { ok: true; value: string[] } | { ok: false; field: string } {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, field };
  if (value.length > max) return { ok: false, field };
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string" || item.length > OUTLINE_MAX_TEXT_LENGTH) return { ok: false, field: `${field}[${index}]` };
    result.push(item);
  }
  return { ok: true, value: result };
}

function answerValue(
  value: unknown,
  type: OutlineQuestionType,
  field: string,
): { ok: true; value: string | string[] | null } | { ok: false; field: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (type === "multi") {
    if (typeof value === "string") return { ok: true, value: [value] };
    if (!Array.isArray(value)) return { ok: false, field };
    for (const item of value) {
      if (typeof item !== "string") return { ok: false, field };
    }
    return { ok: true, value: value.map((item) => String(item)) };
  }
  if (typeof value !== "string") return { ok: false, field };
  return { ok: true, value };
}

/**
 * 校验并规范化 outlineJson（接受对象或 JSON 字符串）。
 * 所有形状错误返回 outline_json_invalid 并带 field；数量超限返回专用错误码。
 */
export function validateOutlineJson(input: unknown): OutlineValidation {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return invalid();
    }
  }
  if (!isRecord(raw)) return invalid();
  if (byteLength(raw) > OUTLINE_JSON_MAX_BYTES) return { ok: false, error: "outline_json_too_large" };
  if (raw.version !== OUTLINE_VERSION) return invalid("version");

  // titles
  const titlesRaw = raw.titles;
  if (!isRecord(titlesRaw)) return invalid("titles");
  const optionsRaw = titlesRaw.options;
  if (!Array.isArray(optionsRaw)) return invalid("titles.options");
  if (optionsRaw.length > OUTLINE_MAX_TITLE_OPTIONS) return invalid("titles.options");
  const options: OutlineTitleOption[] = [];
  const optionIds = new Set<string>();
  for (let index = 0; index < optionsRaw.length; index += 1) {
    const option = optionsRaw[index];
    if (!isRecord(option)) return invalid(`titles.options[${index}]`);
    if (typeof option.id !== "string" || option.id.trim() === "") return invalid(`titles.options[${index}].id`);
    const optionId = option.id.trim();
    if (optionIds.has(optionId)) return invalid(`titles.options[${index}].id`);
    optionIds.add(optionId);
    if (typeof option.text !== "string" || option.text.length > OUTLINE_MAX_TEXT_LENGTH) {
      return invalid(`titles.options[${index}].text`);
    }
    options.push({ id: optionId, text: option.text });
  }
  let selected: string | null = null;
  if (titlesRaw.selected !== undefined && titlesRaw.selected !== null) {
    if (typeof titlesRaw.selected !== "string") return invalid("titles.selected");
    const selectedId = titlesRaw.selected.trim();
    if (!optionIds.has(selectedId)) return invalid("titles.selected");
    selected = selectedId;
  }
  let custom: string | null = null;
  if (titlesRaw.custom !== undefined && titlesRaw.custom !== null) {
    if (typeof titlesRaw.custom !== "string") return invalid("titles.custom");
    custom = titlesRaw.custom;
  }
  const titlesFeedback = feedbackResult(titlesRaw.feedback, "titles.feedback");
  if (!titlesFeedback.ok) return invalid(titlesFeedback.field);
  const titles: OutlineTitles = { options, selected, custom, allowCustom: true };
  if (titlesFeedback.value !== undefined) titles.feedback = titlesFeedback.value;

  // corePoint
  const corePointRaw = raw.corePoint;
  if (!isRecord(corePointRaw)) return invalid("corePoint");
  if (typeof corePointRaw.text !== "string" || corePointRaw.text.length > OUTLINE_MAX_TEXT_LENGTH) {
    return invalid("corePoint.text");
  }
  const coreFeedback = feedbackResult(corePointRaw.feedback, "corePoint.feedback");
  if (!coreFeedback.ok) return invalid(coreFeedback.field);
  const corePoint: OutlineCorePoint = { text: corePointRaw.text };
  if (coreFeedback.value !== undefined) corePoint.feedback = coreFeedback.value;

  // opening
  const openingRaw = raw.opening;
  if (!isRecord(openingRaw)) return invalid("opening");
  if (openingRaw.kind !== "real" && openingRaw.kind !== "hypothetical") return invalid("opening.kind");
  if (typeof openingRaw.text !== "string" || openingRaw.text.length > OUTLINE_MAX_TEXT_LENGTH) {
    return invalid("opening.text");
  }
  const sources = stringList(openingRaw.sources, "opening.sources", Number.POSITIVE_INFINITY);
  if (!sources.ok) return invalid(sources.field);
  const openingFeedback = feedbackResult(openingRaw.feedback, "opening.feedback");
  if (!openingFeedback.ok) return invalid(openingFeedback.field);
  const opening: OutlineOpening = { kind: openingRaw.kind, text: openingRaw.text, sources: sources.value };
  if (openingFeedback.value !== undefined) opening.feedback = openingFeedback.value;

  // sections
  const sectionsRaw = raw.sections;
  if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0) return invalid("sections");
  if (sectionsRaw.length > OUTLINE_MAX_SECTIONS) return { ok: false, error: "too_many_sections" };
  const sectionIds = new Set<string>();
  const sections: OutlineSection[] = [];
  for (let index = 0; index < sectionsRaw.length; index += 1) {
    const sectionRaw = sectionsRaw[index];
    if (!isRecord(sectionRaw)) return invalid(`sections[${index}]`);
    if (typeof sectionRaw.id !== "string" || !/^s\d+$/.test(sectionRaw.id.trim())) return invalid(`sections[${index}].id`);
    const sectionId = sectionRaw.id.trim();
    if (sectionIds.has(sectionId)) return invalid(`sections[${index}].id`);
    sectionIds.add(sectionId);
    if (typeof sectionRaw.heading !== "string" || sectionRaw.heading.length > OUTLINE_MAX_TEXT_LENGTH) {
      return invalid(`sections[${index}].heading`);
    }
    const points = stringList(sectionRaw.points, `sections[${index}].points`, OUTLINE_MAX_POINTS_PER_SECTION);
    if (!points.ok) return invalid(points.field);
    let keep = true;
    if (sectionRaw.keep !== undefined) {
      if (typeof sectionRaw.keep !== "boolean") return invalid(`sections[${index}].keep`);
      keep = sectionRaw.keep;
    }
    const sectionFeedback = feedbackResult(sectionRaw.feedback, `sections[${index}].feedback`);
    if (!sectionFeedback.ok) return invalid(sectionFeedback.field);
    const section: OutlineSection = { id: sectionId, heading: sectionRaw.heading, points: points.value, keep };
    if (sectionFeedback.value !== undefined) section.feedback = sectionFeedback.value;
    sections.push(section);
  }

  // diagrams
  const diagramsRaw = raw.diagrams === undefined ? [] : raw.diagrams;
  if (!Array.isArray(diagramsRaw)) return invalid("diagrams");
  if (diagramsRaw.length > OUTLINE_MAX_DIAGRAMS) return { ok: false, error: "too_many_diagrams" };
  const diagramIds = new Set<string>();
  const diagrams: OutlineDiagram[] = [];
  for (let index = 0; index < diagramsRaw.length; index += 1) {
    const diagramRaw = diagramsRaw[index];
    if (!isRecord(diagramRaw)) return invalid(`diagrams[${index}]`);
    if (typeof diagramRaw.id !== "string" || !/^fig-\d+$/.test(diagramRaw.id.trim())) return invalid(`diagrams[${index}].id`);
    const diagramId = diagramRaw.id.trim();
    if (diagramIds.has(diagramId)) return invalid(`diagrams[${index}].id`);
    diagramIds.add(diagramId);
    if (typeof diagramRaw.caption !== "string" || diagramRaw.caption.length > OUTLINE_MAX_TEXT_LENGTH) {
      return invalid(`diagrams[${index}].caption`);
    }
    if (typeof diagramRaw.anchor !== "string" || !sectionIds.has(diagramRaw.anchor.trim())) {
      return invalid(`diagrams[${index}].anchor`);
    }
    if (typeof diagramRaw.mermaid !== "string" || diagramRaw.mermaid.length > OUTLINE_MAX_MERMAID_LENGTH) {
      return invalid(`diagrams[${index}].mermaid`);
    }
    let status: OutlineDiagramStatus = "draft";
    if (diagramRaw.status !== undefined) {
      if (diagramRaw.status !== "draft" && diagramRaw.status !== "ok" && diagramRaw.status !== "redo") {
        return invalid(`diagrams[${index}].status`);
      }
      status = diagramRaw.status;
    }
    const diagramFeedback = feedbackResult(diagramRaw.feedback, `diagrams[${index}].feedback`);
    if (!diagramFeedback.ok) return invalid(diagramFeedback.field);
    const diagram: OutlineDiagram = {
      id: diagramId,
      caption: diagramRaw.caption,
      anchor: diagramRaw.anchor.trim(),
      mermaid: diagramRaw.mermaid,
      status,
    };
    if (diagramFeedback.value !== undefined) diagram.feedback = diagramFeedback.value;
    diagrams.push(diagram);
  }

  // questions
  const questionsRaw = raw.questions === undefined ? [] : raw.questions;
  if (!Array.isArray(questionsRaw)) return invalid("questions");
  if (questionsRaw.length > OUTLINE_MAX_QUESTIONS) return invalid("questions");
  const questionIds = new Set<string>();
  const questions: OutlineQuestion[] = [];
  for (let index = 0; index < questionsRaw.length; index += 1) {
    const questionRaw = questionsRaw[index];
    if (!isRecord(questionRaw)) return invalid(`questions[${index}]`);
    if (typeof questionRaw.id !== "string" || !/^q\d+$/.test(questionRaw.id.trim())) return invalid(`questions[${index}].id`);
    const questionId = questionRaw.id.trim();
    if (questionIds.has(questionId)) return invalid(`questions[${index}].id`);
    questionIds.add(questionId);
    if (typeof questionRaw.text !== "string" || questionRaw.text.length > OUTLINE_MAX_TEXT_LENGTH) {
      return invalid(`questions[${index}].text`);
    }
    if (questionRaw.type !== "single" && questionRaw.type !== "multi" && questionRaw.type !== "text") {
      return invalid(`questions[${index}].type`);
    }
    const questionType: OutlineQuestionType = questionRaw.type;
    const questionOptions = stringList(questionRaw.options, `questions[${index}].options`, OUTLINE_MAX_POINTS_PER_SECTION);
    if (!questionOptions.ok) return invalid(questionOptions.field);
    const questionDefault = answerValue(questionRaw.default, questionType, `questions[${index}].default`);
    if (!questionDefault.ok) return invalid(questionDefault.field);
    const questionAnswer = answerValue(questionRaw.answer, questionType, `questions[${index}].answer`);
    if (!questionAnswer.ok) return invalid(questionAnswer.field);
    let questionCustom: string | null = null;
    if (questionRaw.custom !== undefined && questionRaw.custom !== null) {
      if (typeof questionRaw.custom !== "string") return invalid(`questions[${index}].custom`);
      questionCustom = questionRaw.custom;
    }
    const questionFeedback = feedbackResult(questionRaw.feedback, `questions[${index}].feedback`);
    if (!questionFeedback.ok) return invalid(questionFeedback.field);
    const question: OutlineQuestion = {
      id: questionId,
      text: questionRaw.text,
      type: questionType,
      options: questionOptions.value,
      default: questionDefault.value,
      answer: questionAnswer.value,
      custom: questionCustom,
    };
    if (questionFeedback.value !== undefined) question.feedback = questionFeedback.value;
    questions.push(question);
  }

  // materials
  const materialsRaw = raw.materials === undefined ? [] : raw.materials;
  if (!Array.isArray(materialsRaw)) return invalid("materials");
  if (materialsRaw.length > OUTLINE_MAX_MATERIALS) return invalid("materials");
  const materials: OutlineMaterial[] = [];
  for (let index = 0; index < materialsRaw.length; index += 1) {
    const materialRaw = materialsRaw[index];
    if (!isRecord(materialRaw)) return invalid(`materials[${index}]`);
    if (typeof materialRaw.label !== "string" || materialRaw.label.length > OUTLINE_MAX_TEXT_LENGTH) {
      return invalid(`materials[${index}].label`);
    }
    if (typeof materialRaw.path !== "string" || materialRaw.path.length > OUTLINE_MAX_TEXT_LENGTH) {
      return invalid(`materials[${index}].path`);
    }
    materials.push({ label: materialRaw.label, path: materialRaw.path });
  }

  const outlineFeedback = feedbackResult(raw.feedback, "feedback");
  if (!outlineFeedback.ok) return invalid(outlineFeedback.field);

  const outline: OutlineV01 = {
    version: OUTLINE_VERSION,
    rev: 0,
    titles,
    corePoint,
    opening,
    sections,
    diagrams,
    questions,
    materials,
  };
  if (outlineFeedback.value !== undefined) outline.feedback = outlineFeedback.value;
  return { ok: true, outline };
}

/** 大纲里所有 blockId，顺序与页面一致，"all" 在最后。 */
export function outlineBlockIds(outline: OutlineV01): string[] {
  return [
    "titles",
    "corePoint",
    "opening",
    ...outline.sections.map((section) => section.id),
    ...outline.diagrams.map((diagram) => diagram.id),
    ...outline.questions.map((question) => question.id),
    "all",
  ];
}

/** 校验「按建议重生成」的 blocks：非空、不超过 30 个、blockId 合法且不重复、建议非空且不超长。 */
export function validateRegenerateBlocks(outline: OutlineV01, blocks: unknown): RegenerateBlocksValidation {
  if (!Array.isArray(blocks) || blocks.length === 0) return { ok: false, error: "bad_blocks" };
  if (blocks.length > OUTLINE_MAX_REGENERATE_BLOCKS) return { ok: false, error: "too_many_blocks" };
  const allowed = new Set(outlineBlockIds(outline));
  const seen = new Set<string>();
  const result: RegenerateBlock[] = [];
  for (const item of blocks) {
    if (!isRecord(item)) return { ok: false, error: "bad_blocks" };
    const blockId = typeof item.blockId === "string" ? item.blockId.trim() : "";
    if (!blockId || !allowed.has(blockId)) return { ok: false, error: "bad_block_id" };
    if (seen.has(blockId)) return { ok: false, error: "duplicate_block" };
    seen.add(blockId);
    if (typeof item.suggestion !== "string") return { ok: false, error: "suggestion_required" };
    const suggestion = item.suggestion.trim();
    if (!suggestion) return { ok: false, error: "suggestion_required" };
    if (suggestion.length > OUTLINE_MAX_FEEDBACK_LENGTH) return { ok: false, error: "suggestion_too_long" };
    result.push({ blockId, suggestion });
  }
  return { ok: true, blocks: result };
}

/** 收集各块已填的 feedback（含页面侧 "all"），顺序同 outlineBlockIds。 */
export function collectFeedbackBlocks(outline: OutlineV01): RegenerateBlock[] {
  const result: RegenerateBlock[] = [];
  const push = (blockId: string, value: string | undefined) => {
    const suggestion = (value ?? "").trim();
    if (suggestion) result.push({ blockId, suggestion });
  };
  push("titles", outline.titles.feedback);
  push("corePoint", outline.corePoint.feedback);
  push("opening", outline.opening.feedback);
  for (const section of outline.sections) push(section.id, section.feedback);
  for (const diagram of outline.diagrams) push(diagram.id, diagram.feedback);
  for (const question of outline.questions) push(question.id, question.feedback);
  push("all", outline.feedback);
  return result;
}

/** 去掉指定块的 feedback，返回新对象（不修改入参）。 */
export function clearFeedback(outline: OutlineV01, blockIds: string[]): OutlineV01 {
  const targets = new Set(blockIds);
  const next: OutlineV01 = {
    ...outline,
    titles: { ...outline.titles },
    corePoint: { ...outline.corePoint },
    opening: { ...outline.opening },
    sections: outline.sections.map((section) => ({ ...section })),
    diagrams: outline.diagrams.map((diagram) => ({ ...diagram })),
    questions: outline.questions.map((question) => ({ ...question })),
    materials: outline.materials.map((material) => ({ ...material })),
  };
  if (targets.has("titles")) delete next.titles.feedback;
  if (targets.has("corePoint")) delete next.corePoint.feedback;
  if (targets.has("opening")) delete next.opening.feedback;
  for (const section of next.sections) if (targets.has(section.id)) delete section.feedback;
  for (const diagram of next.diagrams) if (targets.has(diagram.id)) delete diagram.feedback;
  for (const question of next.questions) if (targets.has(question.id)) delete question.feedback;
  if (targets.has("all")) delete next.feedback;
  return next;
}

/** 保存前的并发检查：baseRev 缺省不检查，否则必须等于当前 rev。 */
export function checkBaseRev(
  currentRev: number,
  baseRev: unknown,
): { ok: true } | { ok: false; error: "rev_conflict" | "bad_base_rev" } {
  if (baseRev === undefined || baseRev === null) return { ok: true };
  if (typeof baseRev !== "number" || !Number.isInteger(baseRev) || baseRev < 0) return { ok: false, error: "bad_base_rev" };
  if (baseRev !== currentRev) return { ok: false, error: "rev_conflict" };
  return { ok: true };
}

/** 选定标题：selected → custom → 第一个候选；都没有返回空串。 */
export function resolveTitle(outline: OutlineV01): string {
  const { options, selected, custom } = outline.titles;
  if (selected) {
    const found = options.find((option) => option.id === selected);
    if (found) return found.text;
  }
  if (custom && custom.trim()) return custom;
  return options.length ? options[0].text : "";
}

/**
 * 问题答案：custom 优先（multi 追加在已选项后），其次 answer，再退到 default（标注默认），
 * 都为空则「（未定）」。
 */
export function resolveQuestionAnswer(question: OutlineQuestion): { text: string; isDefault: boolean } {
  const custom = (question.custom ?? "").trim();
  const selected = Array.isArray(question.answer)
    ? question.answer.map((item) => String(item).trim()).filter(Boolean)
    : typeof question.answer === "string" && question.answer.trim()
      ? [question.answer.trim()]
      : [];
  if (custom) {
    const parts = question.type === "multi" ? [...selected, custom] : [custom];
    return { text: parts.join("、"), isDefault: false };
  }
  if (selected.length) return { text: selected.join("、"), isDefault: false };
  const fallback = Array.isArray(question.default)
    ? question.default.map((item) => String(item).trim()).filter(Boolean)
    : typeof question.default === "string" && question.default.trim()
      ? [question.default.trim()]
      : [];
  if (fallback.length) return { text: `${fallback.join("、")}（默认）`, isDefault: true };
  return { text: "（未定）", isDefault: false };
}

const SECTION_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

/** 从结构化大纲生成 Markdown（确定性纯函数，供服务器在确认/写回时覆盖 outline_md）。 */
export function outlineToMarkdown(outline: OutlineV01): string {
  const blocks: string[] = [];

  const title = resolveTitle(outline).trim();
  if (title) blocks.push(`# ${title}`);

  blocks.push(`## 核心观点\n\n${outline.corePoint.text}`);

  const openingLabel = outline.opening.kind === "real" ? "真实场景" : "假设场景";
  let opening = `## 开头（${openingLabel}）\n\n${outline.opening.text}`;
  const sources = outline.opening.sources.map((source) => source.trim()).filter(Boolean);
  if (sources.length) opening += `\n来源：${sources.join("；")}`;
  blocks.push(opening);

  let sectionIndex = 0;
  for (const section of outline.sections) {
    if (!section.keep) continue;
    sectionIndex += 1;
    const numeral = SECTION_NUMERALS[sectionIndex - 1] ?? String(sectionIndex);
    let body = `## ${numeral}、${section.heading}`;
    const points = section.points.map((point) => point.trim()).filter(Boolean);
    if (points.length) body += `\n\n${points.map((point) => `- ${point}`).join("\n")}`;
    for (const diagram of outline.diagrams) {
      if (diagram.anchor !== section.id) continue;
      body += `\n\n> 图 ${diagram.id}：${diagram.caption}\n\n\`\`\`mermaid\n${diagram.mermaid}\n\`\`\``;
    }
    blocks.push(body);
  }

  if (outline.questions.length) {
    const lines = outline.questions.map((question) => `- ${question.text}：${resolveQuestionAnswer(question).text}`);
    blocks.push(`## 拍板\n\n${lines.join("\n")}`);
  }

  if (outline.materials.length) {
    const lines = outline.materials.map((material) => `- ${material.label}：${material.path}`);
    blocks.push(`## 素材\n\n${lines.join("\n")}`);
  }

  return blocks.join("\n\n");
}
