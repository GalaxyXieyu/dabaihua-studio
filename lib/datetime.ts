/**
 * datetime.ts — 服务端与浏览器共用的固定时区时间格式化。
 *
 * 客户端组件里的 `toLocaleString()` 会按运行环境时区渲染，SSR（Cloudflare
 * Worker，UTC）与浏览器（用户本地时区）结果不同，触发 React 水合文本不一致。
 * 这里统一用 Asia/Shanghai，保证两端输出一致；纯模块，可被客户端组件引入。
 */

const SHANGHAI_DATE_TIME = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `2026-09-28T06:30:00Z` → `2026/09/28 14:30`；非法值原样返回。 */
export function formatShanghaiDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return SHANGHAI_DATE_TIME.format(date);
}
