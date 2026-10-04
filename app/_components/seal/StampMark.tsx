// 朱文印痕（规范第 6.4 节：连续天数浓淡与边缘档位；动效计划 5.2 的 dry 干印）。
// 服务端可渲染、零 JS。不透明度由 streakOpacity 算出，挂成 CSS 变量交给 seal.css。
import { useId } from "react";
import type { CSSProperties } from "react";
import { cssId, markSvg } from "./seal-svg.ts";
import { DRY_OPACITY, streakOpacity, tierOf } from "./seal-tokens.ts";
import type { SealKind } from "./seal-tokens.ts";

export type StampMarkProps = {
  kind: SealKind;
  size: number;
  /** 连续天数：决定浓淡与飞白档位；缺省按 1 天算 */
  streak?: number;
  /** 断更干印：用干印色 + 固定低不透明度 */
  dry?: boolean;
  /** 日期章印文（"MM·DD"，只给 tuoyuan 用） */
  date?: string;
  className?: string;
};

/** 一枚印痕。本身是装饰（印痕旁必须有文字，规范 4.1），所以内层 SVG aria-hidden。 */
export function StampMark({ kind, size, streak, dry, date, className }: StampMarkProps) {
  const uid = useId();
  const opacity = dry ? DRY_OPACITY : streakOpacity(streak ?? 1);
  const tier = tierOf(streak ?? 1);
  return (
    <span
      className={className ? `seal-mark ${className}` : "seal-mark"}
      data-kind={kind}
      style={{ "--seal-mark-opacity": opacity, width: size, height: size } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: markSvg(kind, { size, prefix: cssId(uid), tier, dry, date }) }}
    />
  );
}
