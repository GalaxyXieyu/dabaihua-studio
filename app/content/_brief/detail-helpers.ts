import type { ResponseState } from "./brief-types";

/** 与 mini-markdown 的标题规则一致：# 到 ###### 后跟空白。 */
const DUPLICATE_OUTLINE_HEADING = /^#{1,6}\s+大纲\s*$/;

/**
 * 大纲 markdown 的第一行若本身就是「# 大纲」这样的标题，渲染时去掉这一行：
 * 区块已经带了「大纲」标题，重复出现会像笔误。返回值只用于渲染，
 * 存储的 `outlineMd` 保持原样。
 */
export function stripDuplicateOutlineHeading(markdown: string): string {
  const normalized = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let first = 0;
  while (first < lines.length && !lines[first].trim()) first += 1;
  if (first >= lines.length) return normalized;
  if (!DUPLICATE_OUTLINE_HEADING.test(lines[first].trim())) return normalized;
  lines.splice(first, 1);
  // 去掉标题行后可能留下一个空行，渲染前顺手清掉。
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  return lines.join("\n");
}

/**
 * 决策结果区块是否有可展示内容：选了场景、回答了问题或写了不要的理由。
 * 三者都空时区块不应该渲染成一条空条。
 */
export function hasDecisionContent(
  state: Pick<ResponseState, "scenarioText" | "answers" | "rejectReason">,
): boolean {
  if (String(state.scenarioText ?? "").trim()) return true;
  const answers = Array.isArray(state.answers) ? state.answers : [];
  if (answers.some((answer) => String(answer ?? "").trim())) return true;
  if (String(state.rejectReason ?? "").trim()) return true;
  return false;
}
