// 印谱叶的印位格（规范 v3-zhuan「印谱式版面」）：行均衡、每行居中的半列网格。
// 桌面 / 手机两种断点各算一份 bookLayout，格位写进 CSS 变量，seal.css 按断点切换。
// 印位 id（StampSlot targetId）由调用方传事件自带的 slotId，整页恰好出现一次，
// 盖章动画按 id 查印位，所以超出的枚数直接不渲染（不另画副本）。

import type { CSSProperties } from "react";
import { StampSlot } from "./StampSlot.tsx";
import type { StampSlotState } from "./StampSlot.tsx";
import type { SealKind } from "./seal-tokens.ts";
import { BOOK, bookLayout, opticalScale } from "./seal-book.ts";

export type SealBookItem = {
  key: string;
  kind: SealKind;
  targetId: string;
  state: StampSlotState;
  /** 读屏标签（StampSlot 的 aria-label） */
  label: string;
  /** 释文：提交 / 阅读 / 审稿 / 照镜 / 盖章 */
  caption: string;
  /** 日期（中文：十月三日） */
  date: string;
};

export type SealBookGridProps = {
  items: SealBookItem[];
  streak?: number;
  dry?: boolean;
  className?: string;
  /** 印位要不要写 DOM id（规范 10.1）：今天页收起行的小印位和印谱叶共用 targetId，
 *  展开时才由格子持有 id，收起时格子不写（默认 true，旧账日视图不变） */
  withIds?: boolean;
};

export function SealBookGrid({ items, streak, dry, className, withIds = true }: SealBookGridProps) {
  const n = items.length;
  if (n === 0) return null;

  // 桌面最多 12 枚、手机最多 9 枚：超出的不渲染（另有 N 枚在下面说明）
  const shown = items.slice(0, BOOK.desktop.max);
  const desktop = bookLayout(shown.length, BOOK.desktop.perRow);
  const phone = bookLayout(Math.min(n, BOOK.phone.max), BOOK.phone.perRow);
  // 只有一枚时放大，像单页孤品（两个断点都只剩这一枚）
  const scale = n === 1 ? BOOK.singleScale : 1;

  const gridStyle = {
    "--d-cols": `repeat(${desktop.cols}, minmax(0, ${BOOK.desktop.cap / 2}px))`,
    "--m-cols": `repeat(${phone.cols}, minmax(0, ${BOOK.phone.cap / 2}px))`,
  } as CSSProperties;

  return (
    <>
      <ol
        className={className ? `seal-book-grid ${className}` : "seal-book-grid"}
        style={gridStyle}
      >
        {shown.map((item, i) => {
          const d = desktop.cells[i];
          const m = i < BOOK.phone.max ? phone.cells[i] : undefined;
          const size = Math.round(BOOK.desktop.imp * opticalScale(item.kind) * scale);
          const cellStyle = {
            "--d-col": d.col,
            "--d-row": d.row,
            ...(m ? { "--m-col": m.col, "--m-row": m.row } : {}),
          } as CSSProperties;
          return (
            <li
              key={item.key}
              className="seal-book-cell"
              data-d-first={d.first || undefined}
              data-m-first={m?.first || undefined}
              data-m-hide={i >= BOOK.phone.max || undefined}
              style={cellStyle}
            >
              <span className="seal-book-imp">
                <StampSlot
                  targetId={withIds ? item.targetId : undefined}
                  state={item.state}
                  kind={item.kind}
                  size={size}
                  streak={streak}
                  dry={dry}
                  label={item.label}
                />
              </span>
              <span className="seal-book-cap">{item.caption}</span>
              <span className="seal-book-date">{item.date}</span>
            </li>
          );
        })}
      </ol>
      {n > BOOK.desktop.max || n > BOOK.phone.max ? (
        <p className="seal-book-more">
          {n > BOOK.desktop.max && (
            <span className="seal-book-more-d">另有 {n - BOOK.desktop.max} 枚</span>
          )}
          {n > BOOK.phone.max && (
            <span className="seal-book-more-m">另有 {n - BOOK.phone.max} 枚</span>
          )}
        </p>
      ) : null}
    </>
  );
}
