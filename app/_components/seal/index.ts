// 印章静态组件的统一出口（服务端安全的部分）。
// SealStage / useSealQueue 等客户端部分在后面的阶段单独 dynamic import，不从这里导出。
export { Seal } from "./Seal.tsx";
export type { SealProps } from "./Seal.tsx";
export { StampMark } from "./StampMark.tsx";
export type { StampMarkProps } from "./StampMark.tsx";
export { StampSlot } from "./StampSlot.tsx";
export type { StampSlotProps, StampSlotState } from "./StampSlot.tsx";
export { cssId, markSvg, sealSvg } from "./seal-svg.ts";
export { strokeFor, streakOpacity, tierOf, DRY_OPACITY } from "./seal-tokens.ts";
export type { SealKind, SealPose } from "./seal-tokens.ts";
