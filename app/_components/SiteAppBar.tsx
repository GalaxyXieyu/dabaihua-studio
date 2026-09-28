"use client";

/* eslint-disable @next/next/no-html-link-for-pages */
import { Waves } from "@phosphor-icons/react";
import { BRAND_NAME, BRAND_TAGLINE } from "../../lib/brand";
import { activeTabKey, sectionForPath } from "../../lib/site-nav";
import { SiteNavCluster } from "./SiteNav";

/**
 * 独立内容/成长子页共用的顶栏：品牌 + 主导航 + 子 tab。
 * 导航数据与 DeskApp 顶栏同源（lib/site-nav.ts），子页只需传入 pathname。
 */
export function SiteAppBar({ role, pathname }: { role: string | null | undefined; pathname: string }) {
  return (
    <header className="global-appbar site-appbar">
      <a className="global-brand" href="/" aria-label="前往今天">
        <span className="brand-mark"><Waves size={19} weight="bold" aria-hidden="true" /></span>
        <span><strong>{BRAND_NAME}</strong><small>{BRAND_TAGLINE}</small></span>
      </a>
      <SiteNavCluster role={role} section={sectionForPath(pathname)} activeTab={activeTabKey(pathname)} />
      <div className="site-appbar-end" />
    </header>
  );
}
