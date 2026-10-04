// 昨日回放的纸（规范 6.7）：400×190 坐标系里所有印痕、"+N" 和日期章的终态 HTML。
// 纯 TS、只拼字符串，不碰 DOM，node 可测；seal-player 从这里 re-export，
// 回放动画和收起后的小卡（seal-yesterday-card）共用同一份内容，保证两边长得一样。
// 布局数值全部来自 REPLAY 令牌：markSize 32、left = 28 + i*44、top 36、日期章 72px 在 300,100。
import { REPLAY, streakOpacity, DRY_OPACITY } from "./seal-tokens.ts";
import type { SealKind } from "./seal-tokens.ts";
import { markSvg } from "./seal-svg.ts";
import type { SealEvent } from "./seal-moments.ts";

/** Asia/Shanghai 的 HH:mm（固定 +8 偏移，不用 Intl） */
function shanghaiTime(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 8 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const TIME_STYLE =
  "display:block;margin-top:4px;text-align:center;font-style:normal;font-family:var(--font-serif,serif);" +
  "font-size:10px;line-height:1;letter-spacing:.05em;color:var(--seal-date,#71695C);";

/** 一枚印痕 + 下面的小字。op 是目标不透明度（按 streak 浓淡） */
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
    `<div class="seal-sheet-mark" data-i="${i}" style="position:absolute;left:${28 + i * 44}px;top:36px;width:${REPLAY.markSize}px;">` +
    `<span class="seal-mark" style="display:inline-block;line-height:0;opacity:${op};transform:rotate(${rot}deg);">${svg}</span>` +
    `<i class="seal-sheet-time" style="${TIME_STYLE}">${label}</i>` +
    `</div>`
  );
}

/**
 * 纸的内容（终态）：前 8 个事件各一枚 32px 印痕带固定小角度，下面 10px --seal-date 小字
 * （页内章写 HH:mm（Asia/Shanghai），git 方章写"提交"）；多于 8 个在 28,96 写 "+N"；
 * 右下角 300,100 一枚 72px 日期章。所有定位元素带 data-i / data-plus / data-date-mark，
 * 播放器靠这些属性找动画目标。date 是 "YYYY-MM-DD"。
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

  const plus =
    events.length > REPLAY.maxMarks
      ? `<div class="seal-sheet-plus" data-plus="${events.length - REPLAY.maxMarks}" style="position:absolute;left:28px;top:96px;` +
        `font-family:var(--font-serif,serif);font-size:12px;color:var(--seal-date,#71695C);">+${events.length - REPLAY.maxMarks}</div>`
      : "";

  // 日期章直接吃 ISO 日期（markSvg 里现算当日竖排篆文）
  const dateMark = markSvg("tuoyuan", { size: REPLAY.dateSize, prefix: `${prefix}d`, date, tier: 0, dry });
  const dateCell =
    `<div class="seal-sheet-date" data-date-mark style="position:absolute;left:${REPLAY.sheetW - 100}px;top:100px;">` +
    `<span class="seal-mark" style="display:inline-block;line-height:0;opacity:${dry ? DRY_OPACITY : op};">${dateMark}</span>` +
    `</div>`;

  return cells + plus + dateCell;
}
