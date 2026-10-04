// 印章角色（规范第 5 节静态姿态）。服务端可渲染、零 JS；客户端组件里也能用。
// 图形唯一真源是 seal-svg.ts 的 sealSvg()；姿态只靠 CSS transform（seal.css），
// 这里只负责把尺寸换算的 CSS 变量挂到外层，让位移按 size/64 缩放。
import { useId } from "react";
import type { CSSProperties } from "react";
import { cssId, sealSvg } from "./seal-svg.ts";
import { strokeFor } from "./seal-tokens.ts";
import type { SealKind, SealPose } from "./seal-tokens.ts";

export type SealProps = {
  kind: SealKind;
  size: number;
  pose?: SealPose;
  mono?: boolean;
  title?: string;
  id?: string;
  className?: string;
};

/** 一只章。默认姿态 stamped（站直）；角色本身 aria-hidden，需要读屏时由外层给文字。 */
export function Seal({ kind, size, pose, mono, title, id, className }: SealProps) {
  const uid = useId();
  return (
    <span
      className={className ? `seal-actor ${className}` : "seal-actor"}
      id={id}
      data-kind={kind}
      data-pose={pose ?? "stamped"}
      style={
        {
          "--seal-size": `${size}px`,
          "--seal-stroke": strokeFor(size),
          "--seal-px": `${size / 64}px`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <span
        className="seal-breath"
        dangerouslySetInnerHTML={{ __html: sealSvg(kind, { size, prefix: cssId(uid), mono, title }) }}
      />
    </span>
  );
}
