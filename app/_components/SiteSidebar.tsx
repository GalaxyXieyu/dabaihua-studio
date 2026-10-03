"use client";

import { useEffect, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import {
  isReaderPath,
  navMonogram,
  navStateFor,
  primaryNavItems,
  sectionTabs,
  type NavItem,
  type NavSection,
} from "../../lib/site-nav";

type SiteSidebarNavProps = {
  role: string | null | undefined;
  section: NavSection | null;
  activeTab: string | null;
  context?: "reader" | "default";
  onSelect?: (key: string, event: ReactMouseEvent<HTMLAnchorElement>) => void;
};

const NAV_STATE_EVENT = "dbh-nav-state";

function subscribeNavState(onStoreChange: () => void) {
  window.addEventListener(NAV_STATE_EVENT, onStoreChange);
  return () => window.removeEventListener(NAV_STATE_EVENT, onStoreChange);
}

function navStateSnapshot() {
  return document.documentElement.dataset.nav === "collapsed";
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式或存储被禁用时忽略 */
  }
}

/**
 * 桌面端（>=761px）的左侧导航栏。手机端完全隐藏，仍由 SiteNavCluster 负责。
 * 收起态由 html[data-nav] 驱动，判定逻辑与 layout.tsx 的防闪脚本同源。
 */
export function SiteSidebarNav({ role, section, activeTab, context = "default", onSelect }: SiteSidebarNavProps) {
  const collapsed = useSyncExternalStore(subscribeNavState, navStateSnapshot, () => false);

  // 阅读器（/discover、/reading 或 DeskApp 的 discover 视图）用独立存储键，默认收起。
  function isReader() {
    if (context === "reader") return true;
    if (typeof window === "undefined") return false;
    return isReaderPath(window.location.pathname);
  }

  // context 变化（DeskApp 切换视图）时重新应用当前路径对应的有效状态。
  useEffect(() => {
    const next = navStateFor(window.location.pathname, readStored("dbh-nav"), readStored("dbh-nav-reader"));
    document.documentElement.dataset.nav = next;
    window.dispatchEvent(new Event(NAV_STATE_EVENT));
  }, [context]);

  function toggle() {
    const current = document.documentElement.dataset.nav === "collapsed" ? "collapsed" : "expanded";
    const next = current === "collapsed" ? "expanded" : "collapsed";
    document.documentElement.dataset.nav = next;
    persistStored(isReader() ? "dbh-nav-reader" : "dbh-nav", next);
    window.dispatchEvent(new Event(NAV_STATE_EVENT));
  }

  const primaries = primaryNavItems(role);
  const todayItem = primaries.find((item) => item.key === "today");
  const contentItem = primaries.find((item) => item.key === "content");
  const growthItem = primaries.find((item) => item.key === "growth");
  const contentTabs = sectionTabs("content", role);
  const growthTabs = sectionTabs("growth", role);

  function renderItem(item: NavItem, active: boolean) {
    return (
      <a
        key={item.key}
        className={`nav-sidebar-item ${active ? "active" : ""}`}
        href={item.href}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? "page" : undefined}
        onClick={(event) => onSelect?.(item.key, event)}
      >
        <span className="nav-sidebar-monogram" aria-hidden="true">{navMonogram(item)}</span>
        <span className="nav-sidebar-label">{item.label}</span>
      </a>
    );
  }

  function renderGroup(label: string, groupSection: NavSection, href: string, tabs: NavItem[]) {
    const active = section === groupSection;
    return (
      <div className={`nav-sidebar-group ${active ? "is-active" : ""}`}>
        <a
          className="nav-sidebar-group-label"
          href={href}
          title={label}
          aria-label={label}
          onClick={(event) => onSelect?.(groupSection, event)}
        >
          {label}
        </a>
        <span className="nav-sidebar-group-rule" aria-hidden="true" />
        {tabs.map((tab) => renderItem(tab, tab.key === activeTab))}
      </div>
    );
  }

  return (
    <nav className="nav-sidebar" aria-label="侧边导航">
      <span className="nav-sidebar-rule" aria-hidden="true" />
      {todayItem ? renderItem(todayItem, section === "today") : null}
      {contentItem && contentTabs.length > 0 ? renderGroup("内容", "content", contentItem.href, contentTabs) : null}
      {growthItem && growthTabs.length > 0 ? renderGroup("成长", "growth", growthItem.href, growthTabs) : null}
      <button
        className="nav-sidebar-toggle"
        type="button"
        aria-label={collapsed ? "展开导航" : "收起导航"}
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <CaretLeft className="nav-sidebar-toggle-collapse" size={14} weight="bold" aria-hidden="true" />
        <CaretRight className="nav-sidebar-toggle-expand" size={14} weight="bold" aria-hidden="true" />
      </button>
    </nav>
  );
}
