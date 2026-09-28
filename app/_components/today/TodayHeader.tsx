/* eslint-disable @next/next/no-html-link-for-pages */
import { primaryNavItems } from "../../../lib/site-nav";

/**
 * 方向 A（杂志风）「今天」页的顶栏：纸报细条 + 宋体刊名 + 主导航 + 当前账号。
 * 导航数据一律来自 lib/site-nav.ts，不在这里另写菜单。
 */
export function TodayHeader({
  role,
  account,
  initial,
}: {
  role: string | null | undefined;
  account: string;
  initial: string;
}) {
  const items = primaryNavItems(role);

  return (
    <header className="td-a-topbar">
      <a className="td-a-brand" href="/">
        大白话工作室
      </a>
      <nav className="td-a-nav" aria-label="主导航">
        {items.map((item) => {
          const current = item.key === "today";
          return (
            <a
              key={item.key}
              className={current ? "td-a-nav-link is-current" : "td-a-nav-link"}
              href={item.href}
              aria-current={current ? "page" : undefined}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <span className="td-a-account" aria-hidden="true">
        <span className="td-a-avatar">{initial}</span>
        <span className="td-a-account-name">{account}</span>
      </span>
    </header>
  );
}
