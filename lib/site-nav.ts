// Pure navigation configuration shared by the app shell. This module
// intentionally imports nothing so node's type-stripping test runner can load
// it directly.

export type NavSection = "today" | "content" | "growth";
export type NavItem = { key: string; label: string; href: string };
export type NavState = "collapsed" | "expanded";

/** 成长板块各页的名字，只在这里改。monogram = 收起侧栏时的单字。 */
export const GROWTH_NAMES = {
  ledger: { label: "翻翻旧账", monogram: "账" },
  career: { label: "攒点筹码", monogram: "筹" },
  mirror: { label: "照照镜子", monogram: "镜" },
} as const;

/** 内容板块的名字，只在这里改。monogram = 收起侧栏时的单字。 */
export const CONTENT_NAMES = {
  content: { label: "憋点干货", monogram: "货" },
} as const;

/** /content 一个页面里的三个视图名字，只在这里改。 */
export const CONTENT_VIEW_NAMES = {
  brief: "今日简报",
  board: "选题看板",
  articles: "文章",
} as const;

/** 收起态每个导航项显示的单字缩写，键与 NavItem.key 对齐。 */
export const NAV_MONOGRAMS: Record<string, string> = {
  today: "今",
  content: CONTENT_NAMES.content.monogram,
  reading: "读",
  strategy: "策",
  ledger: GROWTH_NAMES.ledger.monogram,
  career: GROWTH_NAMES.career.monogram,
  mirror: GROWTH_NAMES.mirror.monogram,
};

/** 取导航项的单字缩写；没有映射时退回标签首字。 */
export function navMonogram(item: NavItem): string {
  return NAV_MONOGRAMS[item.key] ?? Array.from(item.label)[0] ?? "";
}

/** Routes that stay reachable but never appear in the navigation. */
export const HIDDEN_FROM_NAV = ["/annotations", "/leaderboard"];

const TODAY_ITEM: NavItem = { key: "today", label: "今天", href: "/" };
const CONTENT_ITEM: NavItem = { key: "content", label: "内容", href: "/discover" };
const ADMIN_CONTENT_ITEM: NavItem = { key: "content", label: "内容", href: "/content" };
const GROWTH_ITEM: NavItem = { key: "growth", label: "成长", href: "/ledger" };

const READING_TAB: NavItem = { key: "reading", label: "阅读", href: "/discover" };
const CONTENT_TAB: NavItem = { key: "content", label: CONTENT_NAMES.content.label, href: "/content" };
const STRATEGY_TAB: NavItem = { key: "strategy", label: "策略", href: "/strategy" };

const GROWTH_TABS: NavItem[] = [
  { key: "ledger", label: GROWTH_NAMES.ledger.label, href: "/ledger" },
  { key: "career", label: GROWTH_NAMES.career.label, href: "/career" },
  { key: "mirror", label: GROWTH_NAMES.mirror.label, href: "/mirror" },
];

function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

function hasPrefix(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function primaryNavItems(role: string | null | undefined): NavItem[] {
  if (isAdmin(role)) return [TODAY_ITEM, ADMIN_CONTENT_ITEM, GROWTH_ITEM];
  return [TODAY_ITEM, CONTENT_ITEM];
}

export function sectionTabs(section: NavSection, role: string | null | undefined): NavItem[] {
  if (section === "content") {
    // 非管理员保持「阅读」在首位；管理员先落到「憋点干货」。
    if (!isAdmin(role)) return [READING_TAB, CONTENT_TAB, STRATEGY_TAB];
    return [CONTENT_TAB, READING_TAB, STRATEGY_TAB];
  }
  if (section === "growth") return isAdmin(role) ? GROWTH_TABS : [];
  return [];
}

export function sectionForPath(pathname: string): NavSection | null {
  if (pathname === "/") return "today";
  if (
    hasPrefix(pathname, "/reading") ||
    hasPrefix(pathname, "/discover") ||
    hasPrefix(pathname, "/content") ||
    hasPrefix(pathname, "/topics") ||
    hasPrefix(pathname, "/articles") ||
    hasPrefix(pathname, "/review") ||
    hasPrefix(pathname, "/strategy") ||
    hasPrefix(pathname, "/annotations") ||
    hasPrefix(pathname, "/leaderboard")
  ) {
    return "content";
  }
  if (
    hasPrefix(pathname, "/ledger") ||
    hasPrefix(pathname, "/weekly") ||
    hasPrefix(pathname, "/daily") ||
    hasPrefix(pathname, "/career") ||
    hasPrefix(pathname, "/mirror")
  ) {
    return "growth";
  }
  return null;
}

export function isReaderPath(pathname: string): boolean {
  return hasPrefix(pathname, "/discover") || hasPrefix(pathname, "/reading");
}

/**
 * 侧边栏收起的有效状态。阅读器默认收起，只有显式展开才会被记住；
 * 其它页面默认展开，只有显式收起才会被记住。
 * 该逻辑与 app/layout.tsx 里的防闪脚本保持一致。
 */
export function navStateFor(
  pathname: string,
  stored: string | null | undefined,
  storedReader: string | null | undefined,
): NavState {
  if (isReaderPath(pathname)) return storedReader === "expanded" ? "expanded" : "collapsed";
  return stored === "collapsed" ? "collapsed" : "expanded";
}

export function activeTabKey(pathname: string): string | null {
  if (hasPrefix(pathname, "/reading") || hasPrefix(pathname, "/discover")) return "reading";
  if (hasPrefix(pathname, "/content")) return "content";
  if (hasPrefix(pathname, "/topics")) return "content";
  if (hasPrefix(pathname, "/articles") || hasPrefix(pathname, "/review")) return "content";
  if (hasPrefix(pathname, "/strategy")) return "strategy";
  if (hasPrefix(pathname, "/ledger") || hasPrefix(pathname, "/daily") || hasPrefix(pathname, "/weekly")) return "ledger";
  if (hasPrefix(pathname, "/career")) return "career";
  if (hasPrefix(pathname, "/mirror")) return "mirror";
  return null;
}
