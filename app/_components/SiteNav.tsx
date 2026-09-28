"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { primaryNavItems, sectionTabs, type NavSection } from "../../lib/site-nav";

type SiteNavClusterProps = {
  role: string | null | undefined;
  section: NavSection | null;
  activeTab: string | null;
  onSelect?: (key: string, event: ReactMouseEvent<HTMLAnchorElement>) => void;
};

/**
 * 主入口 + 子 tab 的共享导航。导航数据一律来自 lib/site-nav.ts，
 * 组件内不再另写一份菜单。子 tab 用 div.section-tabs（不是 nav），
 * 避免被 globals.css 里 .global-appbar nav 的手机端底部栏规则波及。
 */
export function SiteNavCluster({ role, section, activeTab, onSelect }: SiteNavClusterProps) {
  const items = primaryNavItems(role);
  const tabs = section ? sectionTabs(section, role) : [];
  const isAdmin = role === "admin";

  return (
    <div className="global-nav-cluster">
      <nav aria-label="主导航" className={isAdmin ? "has-growth" : undefined}>
        {items.map((item) => {
          const active = item.key === section;
          return (
            <a
              key={item.key}
              className={`nav-link ${active ? "active" : ""}`}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={(event) => onSelect?.(item.key, event)}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      {tabs.length > 0 && (
        <div className="section-tabs" role="navigation" aria-label={section === "growth" ? "成长子导航" : "内容子导航"}>
          {tabs.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <a
                key={tab.key}
                className={active ? "active" : ""}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                onClick={(event) => onSelect?.(tab.key, event)}
              >
                {tab.label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
