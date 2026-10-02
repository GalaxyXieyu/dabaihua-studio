"use client";

import { useEffect, useRef } from "react";

/**
 * 页面内滚动容器向下滚时收起顶栏子导航，向上滚或回到顶部时展开。
 * 只响应元素级滚动：文档级滚动时顶栏本身会随页面滚走，改高度反而会让内容跳动。
 */
export function AppBarAutoCollapse() {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = markerRef.current?.closest("header");
    if (!header) return;
    const lastTop = new WeakMap<Element, number>();
    let lockedUntil = 0;

    function setCollapsed(collapsed: boolean) {
      if (header!.hasAttribute("data-collapsed") === collapsed) return;
      header!.toggleAttribute("data-collapsed", collapsed);
      lockedUntil = performance.now() + 250;
    }

    function onScroll(event: Event) {
      const target = event.target;
      if (!(target instanceof Element) || header!.contains(target)) return;
      const top = target.scrollTop;
      const delta = top - (lastTop.get(target) ?? 0);
      lastTop.set(target, top);
      if (performance.now() < lockedUntil) return;
      if (top < 40 || delta < -4) setCollapsed(false);
      else if (top > 80 && delta > 4) setCollapsed(true);
    }

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  return <span ref={markerRef} hidden />;
}
