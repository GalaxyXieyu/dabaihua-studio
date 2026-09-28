// Pure navigation configuration shared by the app shell. This module
// intentionally imports nothing so node's type-stripping test runner can load
// it directly.

export type NavSection = "today" | "content" | "growth";
export type NavItem = { key: string; label: string; href: string };

/** Routes that stay reachable but never appear in the navigation. */
export const HIDDEN_FROM_NAV = ["/annotations", "/leaderboard"];

const TODAY_ITEM: NavItem = { key: "today", label: "今天", href: "/" };
const CONTENT_ITEM: NavItem = { key: "content", label: "内容", href: "/discover" };
const GROWTH_ITEM: NavItem = { key: "growth", label: "成长", href: "/career" };

const CONTENT_TABS: NavItem[] = [
  { key: "reading", label: "阅读", href: "/discover" },
  { key: "topics", label: "选题", href: "/topics" },
  { key: "articles", label: "文章", href: "/articles" },
  { key: "strategy", label: "策略", href: "/strategy" },
];

const GROWTH_TABS: NavItem[] = [
  { key: "weekly", label: "周报", href: "/weekly" },
  { key: "career", label: "职业", href: "/career" },
];

function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}

function hasPrefix(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function primaryNavItems(role: string | null | undefined): NavItem[] {
  if (isAdmin(role)) return [TODAY_ITEM, CONTENT_ITEM, GROWTH_ITEM];
  return [TODAY_ITEM, CONTENT_ITEM];
}

export function sectionTabs(section: NavSection, role: string | null | undefined): NavItem[] {
  if (section === "content") return CONTENT_TABS;
  if (section === "growth") return isAdmin(role) ? GROWTH_TABS : [];
  return [];
}

export function sectionForPath(pathname: string): NavSection | null {
  if (pathname === "/") return "today";
  if (
    hasPrefix(pathname, "/discover") ||
    hasPrefix(pathname, "/topics") ||
    hasPrefix(pathname, "/articles") ||
    hasPrefix(pathname, "/review") ||
    hasPrefix(pathname, "/strategy") ||
    hasPrefix(pathname, "/annotations") ||
    hasPrefix(pathname, "/leaderboard")
  ) {
    return "content";
  }
  if (hasPrefix(pathname, "/weekly") || hasPrefix(pathname, "/career")) return "growth";
  return null;
}

export function activeTabKey(pathname: string): string | null {
  if (hasPrefix(pathname, "/discover")) return "reading";
  if (hasPrefix(pathname, "/topics")) return "topics";
  if (hasPrefix(pathname, "/articles") || hasPrefix(pathname, "/review")) return "articles";
  if (hasPrefix(pathname, "/strategy")) return "strategy";
  if (hasPrefix(pathname, "/weekly")) return "weekly";
  if (hasPrefix(pathname, "/career")) return "career";
  return null;
}
