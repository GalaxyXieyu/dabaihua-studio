import { CONTENT_NAMES, CONTENT_VIEW_NAMES } from "../../../lib/site-nav";

export type ContentView = "brief" | "board" | "articles";

export type ContentCounts = { brief: number; board: number; articles: number };

const CONTENT_VIEWS: readonly { key: ContentView; href: string }[] = [
  { key: "brief", href: "/content?view=brief" },
  { key: "board", href: "/content?view=board" },
  { key: "articles", href: "/content?view=articles" },
];

/**
 * 内容页的细切换条：页面名 + 三个（非管理员两个）视图链接。
 * 它就是页面头部，视图区不再另出 H1。
 */
export function ContentSwitchBar({
  view,
  isAdmin,
  counts,
}: {
  view: ContentView;
  isAdmin: boolean;
  counts: ContentCounts;
}) {
  const views = isAdmin ? CONTENT_VIEWS : CONTENT_VIEWS.filter((item) => item.key !== "brief");

  return (
    <nav className="ct-switchbar" aria-label="内容视图">
      <h1 className="ct-switchbar-title">{CONTENT_NAMES.content.label}</h1>
      <div className="ct-switchbar-tabs">
        {views.map((item) => {
          const active = item.key === view;
          return (
            <a
              key={item.key}
              className={`ct-switch${active ? " is-active" : ""}`}
              href={item.href}
              aria-current={active ? "page" : undefined}
            >
              {CONTENT_VIEW_NAMES[item.key]}
              <span className="ct-switch-count">{counts[item.key]}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
