// 印位：一条记录旁边留给章的地方（规范第 5 节）。
// state 只描述静态呈现，动画状态切换由第 3 部分的播放器改 data-state 完成：
//   unknown  服务端初始：印痕和虚线都不显示，等客户端判断，避免闪一下
//   pending  虚线空印位（--line 色 1px dashed）
//   stamped  印痕显示到目标不透明度
//   blank    空白日用，什么都不显示
import type { CSSProperties } from "react";
import { StampMark } from "./StampMark.tsx";
import type { SealKind } from "./seal-tokens.ts";

export type StampSlotState = "unknown" | "pending" | "stamped" | "blank";

export type StampSlotProps = {
  /** 印位 DOM id：盖章动画要把印痕落到这里，用 seal-moments 的 slotId(key) 生成 */
  targetId: string;
  state: StampSlotState;
  kind: SealKind;
  size: number;
  streak?: number;
  dry?: boolean;
  /** 读屏标签（规范 11.2：印痕旁必须有文字，或给印位 aria-label） */
  label: string;
};

export function StampSlot({ targetId, state, kind, size, streak, dry, label }: StampSlotProps) {
  return (
    <span
      className="seal-slot"
      id={targetId}
      data-state={state}
      role="img"
      aria-label={label}
      style={{ width: size, height: size } as CSSProperties}
    >
      <StampMark kind={kind} size={size} streak={streak} dry={dry} />
    </span>
  );
}
