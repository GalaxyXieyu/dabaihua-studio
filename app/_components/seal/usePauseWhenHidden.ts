"use client";

// 规范 6.5：页面切后台（document.visibilityState === "hidden"）时给 <html> 设
// data-seal-paused，让 seal.css 暂停呼吸动画；回到前台时去掉。
// 这个监听在页面上一直要有（不止播放期间），所以单独成一个很小的 hook，
// 页面的客户端组件调用它；SealStage 的打断监听是另一回事，各自独立。
import { useEffect } from "react";

export function usePauseWhenHidden(): void {
  useEffect(() => {
    const sync = (): void => {
      const html = document.documentElement;
      if (document.visibilityState === "hidden") {
        html.setAttribute("data-seal-paused", "");
      } else {
        html.removeAttribute("data-seal-paused");
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      document.documentElement.removeAttribute("data-seal-paused");
    };
  }, []);
}
