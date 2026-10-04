/**
 * 审稿页时间格式化 — 固定 Asia/Shanghai，SSR 与浏览器渲染一致。
 *
 * 输入是 ISO 字符串（可能带或不带时区后缀）；输出 `YYYY-MM-DD HH:mm`。
 * 解析失败时退回旧的切片行为（前 16 位、`T` 换空格）。
 */

const SHANGHAI_TIME = "Asia/Shanghai";

const formatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: SHANGHAI_TIME,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const PART_KEYS = ["year", "month", "day", "hour", "minute"] as const;

function formatLocal(date: Date): string {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if ((PART_KEYS as readonly string[]).includes(part.type)) parts[part.type] = part.value;
  }
  return [parts.year, parts.month, parts.day].map(String).join("-") + " " + `${parts.hour}:${parts.minute}`;
}

export function formatReviewTime(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 16).replace("T", " ");
  }
  return formatLocal(parsed);
}
