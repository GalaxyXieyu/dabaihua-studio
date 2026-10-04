import type { ResponseState } from "./brief-types";

/**
 * `2026-10-03T21:10:00+08:00` → `10月3日 21:10`。
 * 带 `Z` 或 `±hh:mm` 偏移的时间先换算成 Asia/Shanghai（固定 +8，不依赖运行环境时区）
 * 再格式化；不带时区的保持原来的截取逻辑；解析不了原样返回。
 */
export function shortMoment(value: string | null): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute, timezone] = match;
  if (!timezone) {
    // 没有时区信息：保持原来的字符串截取，不假设任何时区。
    return `${Number(month)}月${Number(day)}日 ${hour}:${minute}`;
  }
  const offsetMinutes =
    timezone === "Z"
      ? 0
      : (timezone[0] === "+" ? 1 : -1) * (Number(timezone.slice(1, 3)) * 60 + Number(timezone.slice(4, 6)));
  const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) - offsetMinutes * 60000;
  const beijing = new Date(utcMs + 8 * 60 * 60000);
  const beijingHour = String(beijing.getUTCHours()).padStart(2, "0");
  const beijingMinute = String(beijing.getUTCMinutes()).padStart(2, "0");
  return `${beijing.getUTCMonth() + 1}月${beijing.getUTCDate()}日 ${beijingHour}:${beijingMinute}`;
}

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
