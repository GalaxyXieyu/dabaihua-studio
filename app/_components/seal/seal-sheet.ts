// 昨日回放的纸（规范 6.7 / v3-zhuan README「昨日纸」）：居中流式小笺，
// 纸面 = 外层容器（seal-yesterday-card 或回放遮罩里的 sheet，类名 seal-sheet），
// 本函数只拼它的内层 HTML：内框 .seal-sheet-in，依次是日期章题头、一行居中小印痕
// （每枚配 HH:mm 或「提交」）和「昨日 · X枚」小注。纯 TS、只拼字符串，不碰 DOM，
// node 可测；seal-player 从这里 re-export，回放动画和收起后的小卡共用同一份内容。
// 布局 CSS 在 seal.css（.seal-sheet* 一组），页面卡和 body 上的遮罩都能吃到。
import { REPLAY, streakOpacity } from "./seal-tokens.ts";
import type { SealKind } from "./seal-tokens.ts";
import { cnCount } from "./seal-book.ts";
import { markSvg } from "./seal-svg.ts";
import type { SealEvent } from "./seal-moments.ts";

/** Asia/Shanghai 的 HH:mm（固定 +8 偏移，不用 Intl） */
function shanghaiTime(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 8 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 一枚印痕 + 下面的小字。op 是目标不透明度（按 streak 浓淡），rot 是固定小角度 */
function markCell(
  i: number,
  kind: SealKind,
  label: string,
  op: number,
  dry: boolean,
  prefix: string,
): string {
  const rot = REPLAY.rot[i % REPLAY.rot.length];
  const svg = markSvg(kind, { size: REPLAY.markSize, prefix: `${prefix}m${i}`, tier: 0, dry });
  return (
    `<div class="seal-sheet-mark" data-i="${i}">` +
    `<span class="seal-mark" style="opacity:${op};transform:rotate(${rot}deg);">${svg}</span>` +
    `<i class="seal-sheet-time">${label}</i>` +
    `</div>`
  );
}

/**
 * 纸的内层 HTML（终态）：日期章题头（88px 竖长方，data-date-mark），
 * 下面一行居中的 32px 小印痕（前 REPLAY.maxMarks 个，各带 data-i）；
 * 多出来的在该行末尾写 "+N"（data-plus）；最后「昨日 · X枚」（零枚写「昨日 · 未盖」）。
 * 播放器靠 data-i / data-plus / data-date-mark 找动画目标。date 是 "YYYY-MM-DD"。
 */
export function replaySheetHtml(input: { date: string; events: SealEvent[]; streak: number; prefix: string }): string {
  const { date, events, streak, prefix } = input;
  const shown = events.slice(0, REPLAY.maxMarks);
  const op = streakOpacity(streak);
  const dry = streak <= 0;

  const cells = shown
    .map((e, i) => {
      const isGit = e.key.startsWith("git:");
      const label = isGit ? "提交" : shanghaiTime(e.at);
      return markCell(i, e.kind, label || "", op, dry, prefix);
    })
    .join("");

  const extra = events.length - REPLAY.maxMarks;
  const plus = extra > 0 ? `<span class="seal-sheet-plus" data-plus="${extra}">+${extra}</span>` : "";

  // 日期章作题头：直接吃 ISO 日期（markSvg 里现算当日竖排篆文）
  const dateMark = markSvg("tuoyuan", { size: REPLAY.dateSize, prefix: `${prefix}d`, date, tier: 0, dry });
  const dateCell =
    `<div class="seal-sheet-date" data-date-mark>` +
    `<span class="seal-mark" style="opacity:${op};">${dateMark}</span>` +
    `</div>`;

  const cap = events.length === 0 ? "昨日 · 未盖" : `昨日 · ${cnCount(events.length)}枚`;

  return (
    `<div class="seal-sheet-in">` +
    dateCell +
    `<div class="seal-sheet-marks">${cells}${plus}</div>` +
    `<p class="seal-sheet-cap">${cap}</p>` +
    `</div>`
  );
}
