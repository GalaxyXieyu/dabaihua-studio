/**
 * 审稿页输入模式判定（纯函数，便于单测）。
 *
 * 只用「主指针」是鼠标来判桌面已经不可靠：微信 X5/XWEB、夸克等 webview
 * 会在触屏上报 hover:hover + pointer:fine，导致 390px 的手机被当成桌面，
 * 点段落无反应、原生长按选区也不稳定。
 *
 * 因此改为「默认手机，只有宽屏 + 精确指针 + 非移动 UA 才判桌面」，
 * 而每次交互再用 pointerType 单独路由，混合设备不会两条路都堵死。
 */

export type ReviewMode = "phone" | "desktop";

export type ReviewModeSignals = {
  /** 视口宽度（px）。 */
  width: number;
  /** matchMedia("(pointer: coarse)")。 */
  coarse: boolean;
  /** matchMedia("(any-pointer: coarse)")。 */
  anyCoarse: boolean;
  /** matchMedia("(hover: hover) and (pointer: fine)")。 */
  fine: boolean;
  /** navigator.maxTouchPoints。 */
  touchPoints: number;
  /** "ontouchstart" in window。 */
  hasTouchEvent: boolean;
  /** navigator.userAgent。 */
  ua: string;
};

export const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod|HarmonyOS|MicroMessenger|Quark|UCBrowser|MQQBrowser/i;

export function decideReviewMode(signals: ReviewModeSignals): ReviewMode {
  const mobileUa = MOBILE_UA.test(signals.ua || "");

  // 例外：宽屏 + 精确指针 + 非粗指针 + 非移动 UA，即便 maxTouchPoints>0
  // （触屏笔记本）也保持桌面拖选体验。
  const widePointerDesktop =
    signals.width >= 900 && signals.fine && !signals.coarse && !mobileUa;
  if (widePointerDesktop) return "desktop";

  const phone =
    signals.width < 900 ||
    signals.coarse ||
    signals.anyCoarse ||
    signals.hasTouchEvent ||
    signals.touchPoints > 0 ||
    mobileUa;
  return phone ? "phone" : "desktop";
}

export function readReviewModeSignals(win: Window): ReviewModeSignals {
  const coarse = typeof win.matchMedia === "function" && win.matchMedia("(pointer: coarse)").matches;
  const anyCoarse = typeof win.matchMedia === "function" && win.matchMedia("(any-pointer: coarse)").matches;
  const fine =
    typeof win.matchMedia === "function" &&
    win.matchMedia("(hover: hover) and (pointer: fine)").matches;
  return {
    width: win.innerWidth,
    coarse,
    anyCoarse,
    fine,
    touchPoints: win.navigator?.maxTouchPoints || 0,
    hasTouchEvent: "ontouchstart" in win,
    ua: win.navigator?.userAgent || "",
  };
}
