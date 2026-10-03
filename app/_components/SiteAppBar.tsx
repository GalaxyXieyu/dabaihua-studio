/* eslint-disable @next/next/no-html-link-for-pages */
import type { SessionUser } from "../../lib/auth";
import { BRAND_NAME } from "../../lib/brand";
import { activeTabKey, isReaderPath, sectionForPath, sectionTabs } from "../../lib/site-nav";
import { SiteNavCluster } from "./SiteNav";
import { SiteSidebarNav } from "./SiteSidebar";
import { SiteUserMenu } from "./SiteUserMenu";

/**
 * 独立内容/成长子页共用的顶栏：品牌 + 主导航 + 子 tab + 账号区。
 * 导航数据与 DeskApp 顶栏同源（lib/site-nav.ts），子页只需传入 pathname 与 user。
 * 桌面端由 CSS 把整个顶栏转成固定左侧栏，手机端保持原顶栏。
 */
export function SiteAppBar({ user, pathname }: { user: SessionUser | null; pathname: string }) {
  const section = sectionForPath(pathname);
  const tabs = section ? sectionTabs(section, user?.role) : [];

  return (
    <header className={`global-appbar site-appbar ${tabs.length > 0 ? "has-subnav" : ""}`}>
      <a className="global-brand" href="/" aria-label="前往今天">
        {BRAND_NAME}
      </a>
      <SiteNavCluster role={user?.role} section={section} activeTab={activeTabKey(pathname)} />
      <SiteSidebarNav
        role={user?.role}
        section={section}
        activeTab={activeTabKey(pathname)}
        context={isReaderPath(pathname) ? "reader" : "default"}
      />
      {user ? <SiteUserMenu user={user} /> : null}
    </header>
  );
}
