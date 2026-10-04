// 站标「超予」（v3-zhuan 第三轮定稿，二字满白文方印）：顶栏品牌位用的品牌章。
// 服务端可渲染、零 JS；24px 起自动走小号 logo-chaoyu-small（满幅、无残边）。
// 与角色章（Seal）不同，站标是静态印章，没有姿态和呼吸，永远不动画。
import { useId } from "react";
import type { CSSProperties } from "react";
import { cssId, logoSvg } from "./seal-svg.ts";

export type BrandLogoProps = {
  size: number;
  className?: string;
};

/** 站标。装饰图形（旁边总跟着 BRAND_NAME 文字），整块 aria-hidden。 */
export function BrandLogo({ size, className }: BrandLogoProps) {
  const uid = useId();
  return (
    <span
      className={className ? `brand-logo ${className}` : "brand-logo"}
      aria-hidden="true"
      style={{ width: size, height: size } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: logoSvg({ size, prefix: cssId(uid) }) }}
    />
  );
}
