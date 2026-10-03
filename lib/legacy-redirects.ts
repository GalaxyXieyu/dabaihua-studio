// 旧链接到新板块的重定向表。
// 这个模块刻意不 import 任何东西，这样 node 的类型剥离测试可以直接加载它。
// 后续要接入更多旧路由时，只需往 LEGACY_ROUTES 里加一条规则即可。

interface LegacyRoute {
  /** 精确命中的路径列表（含可选的尾斜杠），不做前缀匹配。 */
  paths: readonly string[];
  /** 目标 path + query，例如 `/ledger?view=day`。 */
  target: string;
  /** 是否把合法的 `date` 查询参数以 `&date=YYYY-MM-DD` 形式透传。 */
  keepDate: boolean;
  /** 是否把合法的 `topic` 查询参数以 `&topic=<id>` 形式透传。 */
  keepTopic?: boolean;
}

const LEGACY_ROUTES: readonly LegacyRoute[] = [
  { paths: ["/daily", "/daily/"], target: "/ledger?view=day", keepDate: true },
  { paths: ["/weekly", "/weekly/"], target: "/ledger?view=week", keepDate: true },
  { paths: ["/topics/daily", "/topics/daily/"], target: "/content?view=brief", keepDate: true, keepTopic: true },
  { paths: ["/topics", "/topics/"], target: "/content?view=board", keepDate: false },
  { paths: ["/articles", "/articles/"], target: "/content?view=articles", keepDate: false },
];

/** `YYYY-MM-DD` 形式且必须是真实存在的日历日（拒绝 2026-02-30 之类）。 */
function isDateString(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** 简报选题 id：只允许安全 slug 字符，避免把任意 query 透传到新页面。 */
function isTopicId(value: string | null): value is string {
  return Boolean(value) && /^[A-Za-z0-9_-]{1,40}$/.test(value as string);
}

/**
 * 命中旧链接时返回目标 path+query（例如 `/ledger?view=day&date=2026-09-30`），
 * 否则返回 null。worker 在登录校验之后、页面处理之前调用它。
 */
export function legacyRedirect(url: URL): string | null {
  for (const route of LEGACY_ROUTES) {
    if (!route.paths.includes(url.pathname)) continue;
    const params: string[] = [];
    const date = url.searchParams.get("date");
    if (route.keepDate && isDateString(date)) params.push(`date=${date}`);
    const topic = url.searchParams.get("topic");
    if (route.keepTopic && isTopicId(topic)) params.push(`topic=${topic}`);
    return params.length ? `${route.target}&${params.join("&")}` : route.target;
  }
  return null;
}
