// 旧链接到新板块的重定向表。
// 这个模块刻意不 import 任何东西，这样 node 的类型剥离测试可以直接加载它。
// 后续要接入 /topics 等旧路由时，只需往 LEGACY_ROUTES 里加一条规则即可。

interface LegacyRoute {
  /** 精确命中的路径列表（含可选的尾斜杠），不做前缀匹配。 */
  paths: readonly string[];
  /** 目标 path + query，例如 `/ledger?view=day`。 */
  target: string;
  /** 是否把合法的 `date` 查询参数以 `&date=YYYY-MM-DD` 形式透传。 */
  keepDate: boolean;
}

const LEGACY_ROUTES: readonly LegacyRoute[] = [
  { paths: ["/daily", "/daily/"], target: "/ledger?view=day", keepDate: true },
  { paths: ["/weekly", "/weekly/"], target: "/ledger?view=week", keepDate: true },
];

/** `YYYY-MM-DD` 形式且必须是真实存在的日历日（拒绝 2026-02-30 之类）。 */
function isDateString(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/**
 * 命中旧链接时返回目标 path+query（例如 `/ledger?view=day&date=2026-09-30`），
 * 否则返回 null。worker 在登录校验之后、页面处理之前调用它。
 */
export function legacyRedirect(url: URL): string | null {
  for (const route of LEGACY_ROUTES) {
    if (!route.paths.includes(url.pathname)) continue;
    const date = url.searchParams.get("date");
    if (route.keepDate && isDateString(date)) return `${route.target}&date=${date}`;
    return route.target;
  }
  return null;
}
