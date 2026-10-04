// 印章 SVG 字符串的唯一真源（规范第 3 节）。
// 图形（路径、圆、矩形、椭圆、clipPath、#body/#face/#outline/#eyes、#impression/#glyph）
// 逐字照抄 svg/ 目录下的文件；只做三件事：
//   1. 不用 <style> 块和 class 选择器（同页多个 SVG 会互相污染），改成每个元素直接带 style 属性；
//   2. 颜色走 CSS 变量带回退（SVG 表现属性里不能用 var()，所以写在 style 属性里）；
//   3. 所有 id 加 prefix 前缀（规范 11.1），url(#...) 同步，防止同页重复。
// 印痕分两代：五个 kind 全部换成 v3 最终印痕（方向 A 汉印·浑厚，48x48、
// var(--seal-red,#B23A2B)），图形来自 svg/v3/stamp-mark-<stem>.svg（大尺寸，纹理 filter +
// 咬边 mask）和 -small.svg（size <= 28 时用，仅 mask），经 seal-marks-v3.ts 内联；
// tuoyuan（日章）是汉半通印（stem 为 bantong，替代椭圆印面，键名不变）。
// 带 date 的 tuoyuan 是日期章：V3_DATE_TEMPLATE（10-03 样张）打底，字形和界格
// 换成 seal-date-glyphs.ts 现算的当日竖排篆文。
// 换新刻的印：把两个定稿文件覆盖进 svg/v3/ 后运行 npm run seal:marks 重新生成即可，
// markSvg 这边不用改。角色（sealSvg / ACTORS）与印痕互不影响（tuoyuan 角色仍是椭圆印身）。
// React 组件（Seal / StampMark / StampSlot）和第 3 部分的 DOM 播放器都只用这份，
// 保证服务端 HTML、动画里换章、回放的纸上是同一份图形。
// 站标「超予」也是这份真源：V3_LOGO（logo-chaoyu 两个文件）+ logoSvg，供 BrandLogo 用。
import type { SealKind } from "./seal-tokens.ts";
import { dateGlyphD, dateGridD, dateStrokesV } from "./seal-date-glyphs.ts";
import { V3_DATE_TEMPLATE, V3_LOGO, V3_MARKS } from "./seal-marks-v3.ts";

// ---------- 样式（颜色走 CSS 变量带回退） ----------

// 印身和钮：填印身色、墨线描边
const SOLID = "fill:var(--seal-body,#FBF8F1);stroke:var(--seal-line,#1B1915);stroke-width:var(--seal-stroke,1.5);stroke-linejoin:round";
// 外轮廓：不填色、墨线
const LINE = "fill:none;stroke:var(--seal-line,#1B1915);stroke-width:var(--seal-stroke,1.5);stroke-linejoin:round;stroke-linecap:round";
// 印面（朱砂）
const FACE = "fill:var(--seal-red,#B23A2B)";
// 眼睛
const EYE = "fill:var(--seal-line,#1B1915)";
// 印文笔画：2 格，方头
const inkStyle = (dry: boolean, width = 2) =>
  `fill:none;stroke:${dry ? "var(--seal-dry,#906752)" : "var(--seal-red,#B23A2B)"};stroke-width:${width};stroke-linecap:square;stroke-linejoin:miter`;
// 连续天数纹理：纸色细线盖在最上层（规范 6.4）
const PAPER_LINE = "fill:none;stroke:var(--paper,#FBF8F1);stroke-width:1.2";

// ---------- 几何数据（照抄 svg/*.svg） ----------

type BodyEl =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: number; cy: number; r: number }
  | { tag: "rect"; x: number; y: number; w: number; h: number; rx?: number }
  | { tag: "ellipse"; cx: number; cy: number; rx: number; ry: number };

type ActorArt = {
  clip: string;            // clipPath 里的 path d（印身剪影）
  glyph: string[];         // symbol 印文的 d（占位几何路径）
  body: BodyEl[];          // #body：印身和钮
  outline: string;         // #outline 外轮廓 d
  eyes: [number, number][]; // 两眼圆心
};

const ACTORS: Record<SealKind, ActorArt> = {
  fang: {
    clip: "M13 12H35Q37 12 37 14V42Q37 44 35 44H13Q11 44 11 42V14Q11 12 13 12Z",
    glyph: ["M15 15.5H33M24 15.5V32.5M13.5 32.5H34.5"],
    body: [
      { tag: "path", d: "M16 13V11Q16 9 18 9H30Q32 9 32 11V13Z" },
      { tag: "path", d: "M13 12H35Q37 12 37 14V42Q37 44 35 44H13Q11 44 11 42V14Q11 12 13 12Z" },
    ],
    outline: "M13 12H35Q37 12 37 14V42Q37 44 35 44H13Q11 44 11 42V14Q11 12 13 12Z",
    eyes: [[21, 22], [27, 22]],
  },
  yuan: {
    clip: "M10 31C10 22.5 15 18.5 24 18.5C33 18.5 38 22.5 38 31V41Q38 44 35 44H13Q10 44 10 41Z",
    glyph: ["M16.5 16H31.5V31Q31.5 33 29.5 32.5L27 31.5M19 20.5L25 23.5M18 29.5L26 25.5"],
    body: [
      { tag: "circle", cx: 24, cy: 16, r: 3.25 },
      { tag: "path", d: "M10 31C10 22.5 15 18.5 24 18.5C33 18.5 38 22.5 38 31V41Q38 44 35 44H13Q10 44 10 41Z" },
    ],
    outline: "M10 31C10 22.5 15 18.5 24 18.5C33 18.5 38 22.5 38 31V41Q38 44 35 44H13Q10 44 10 41Z",
    eyes: [[21, 27.5], [27, 27.5]],
  },
  hulu: {
    clip: "M18.52 23.5A6.5 6.5 0 1 1 29.48 23.5C28.94 24.34 30.21 25.87 30.98 26.5A11 11 0 0 1 30.32 44H17.68A11 11 0 0 1 17.02 26.5C17.79 25.87 19.06 24.34 18.52 23.5Z",
    glyph: ["M18.5 27H30V37Q30 39 28 38.5L26.5 38M24.5 22.5V29Q24 35.5 18 39"],
    body: [
      { tag: "rect", x: 23, y: 10.25, w: 2, h: 4, rx: 0.5 },
      { tag: "path", d: "M18.52 23.5A6.5 6.5 0 1 1 29.48 23.5C28.94 24.34 30.21 25.87 30.98 26.5A11 11 0 0 1 30.32 44H17.68A11 11 0 0 1 17.02 26.5C17.79 25.87 19.06 24.34 18.52 23.5Z" },
    ],
    outline: "M18.52 23.5A6.5 6.5 0 1 1 29.48 23.5C28.94 24.34 30.21 25.87 30.98 26.5A11 11 0 0 1 30.32 44H17.68A11 11 0 0 1 17.02 26.5C17.79 25.87 19.06 24.34 18.52 23.5Z",
    eyes: [[21, 20], [27, 20]],
  },
  tuoyuan: {
    clip: "M14 40C14 27.5 18 20.5 24 20.5C30 20.5 34 27.5 34 40Q34 44 30 44H18Q14 44 14 40Z",
    glyph: ["M17.5 16.5H30.5V31.5H17.5ZM17.5 24H30.5"],
    body: [
      { tag: "path", d: "M14 40C14 27.5 18 20.5 24 20.5C30 20.5 34 27.5 34 40Q34 44 30 44H18Q14 44 14 40Z" },
    ],
    outline: "M14 40C14 27.5 18 20.5 24 20.5C30 20.5 34 27.5 34 40Q34 44 30 44H18Q14 44 14 40Z",
    eyes: [[21, 28], [27, 28]],
  },
  yinshou: {
    clip: "M21 6H27Q30 6 30 9V42.5Q30 44 28.5 44H19.5Q18 44 18 42.5V9Q18 6 21 6Z",
    glyph: [
      "M17.5 10V18.5H21.5M21.5 7.5V21.5M25 7.5L24 11M24 11H30.5M29.5 11Q28.5 17.5 23.5 21M25.5 14Q27.5 19 31 21",
      "M24 24.5V26.5M17 29.5V27H31V29.5M20 30.5V40.5M20 30.5H27.5V34.5H20M20 36H28.5V40.5H20",
    ],
    body: [
      { tag: "path", d: "M21 6H27Q30 6 30 9V42.5Q30 44 28.5 44H19.5Q18 44 18 42.5V9Q18 6 21 6Z" },
    ],
    outline: "M21 6H27Q30 6 30 9V42.5Q30 44 28.5 44H19.5Q18 44 18 42.5V9Q18 6 21 6Z",
    eyes: [[21, 13.5], [27, 13.5]],
  },
};

// 连续天数纹理（规范 6.4 / demo makeMark）：印痕最上层叠纸色细线
const TIER_LINES: Record<1 | 2 | 3, string> = {
  1: "M8 20L9.5 19",
  2: "M9 30L14 25M33 12L38 9",
  3: "M9 30L15 24M33 12L39 8M30 40L36 36M8 14L12 11",
};

// ---------- 工具 ----------

/** 把 React useId 的 ":r1:" 之类转成只含 [a-zA-Z0-9_-] 的前缀 */
export function cssId(raw: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  return s || "seal";
}

/** HTML 文本转义（只用于 title 这类我们拼进字符串的文本） */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------- 角色 SVG ----------

/**
 * 角色章。几何照抄 svg/<kind>.svg：
 * #body（印身和钮）→ #face（印面朱砂，clip 到印身剪影）→ #outline（外轮廓压住色块交界）→ #eyes。
 * 印文 symbol 也保留（占位路径，等定稿书法后替换）。
 * mono=true 是单色版：印身透明，线和印面同色 var(--seal-red)，用于印刷、刻章、贴纸。
 */
export function sealSvg(
  kind: SealKind,
  opts: { size: number; prefix: string; mono?: boolean; title?: string },
): string {
  const a = ACTORS[kind];
  const p = cssId(opts.prefix);
  const mono = opts.mono ?? false;
  const solid = mono
    ? "fill:transparent;stroke:var(--seal-red,#B23A2B);stroke-width:var(--seal-stroke,1.5);stroke-linejoin:round"
    : SOLID;
  const line = mono
    ? "fill:none;stroke:var(--seal-red,#B23A2B);stroke-width:var(--seal-stroke,1.5);stroke-linejoin:round;stroke-linecap:round"
    : LINE;
  const eye = mono ? "fill:var(--seal-red,#B23A2B)" : EYE;
  const s = opts.size;

  const body = a.body
    .map((el) => {
      if (el.tag === "path") return `<path style="${solid}" d="${el.d}"/>`;
      if (el.tag === "circle") return `<circle style="${solid}" cx="${el.cx}" cy="${el.cy}" r="${el.r}"/>`;
      if (el.tag === "ellipse") return `<ellipse style="${solid}" cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}"/>`;
      return `<rect style="${solid}" x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}"${el.rx !== undefined ? ` rx="${el.rx}"` : ""}/>`;
    })
    .join("");

  const eyes = a.eyes.map(([cx, cy]) => `<circle class="seal-eye" style="${eye}" cx="${cx}" cy="${cy}" r="1.5"/>`).join("");

  // symbol 里的印文：只作占位与测试对照，不被 use 引用，但保留 id 命名以防将来定稿替换
  const glyphPaths = a.glyph.map((d) => `<path d="${d}"/>`).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${s}" height="${s}" aria-hidden="true" focusable="false" class="seal-svg">` +
    (opts.title ? `<title>${esc(opts.title)}</title>` : "") +
    `<defs><clipPath id="${p}-${kind}-clip"><path d="${a.clip}"/></clipPath>` +
    `<symbol id="${p}-${kind}-glyph" viewBox="0 0 48 48"><g style="${inkStyle(false)}">${glyphPaths}</g></symbol></defs>` +
    `<g id="${p}-body">${body}</g>` +
    `<g id="${p}-face" class="seal-face" clip-path="url(#${p}-${kind}-clip)"><rect style="${FACE}" x="0" y="37" width="48" height="11"/></g>` +
    `<path id="${p}-outline" style="${line}" d="${a.outline}"/>` +
    `<g id="${p}-eyes">${eyes}</g>` +
    `</svg>`
  );
}

// ---------- 印痕 SVG ----------

/** v3 印痕开头的原样 <svg> 标签（gen-seal-marks 只做逐字节内联） */
const V3_OPEN_TAG_RE = /^<svg[^>]*>/;

/** 给 v3 印痕字符串里的所有 id 加前缀，并同步 url(#...) 引用 */
function prefixV3Ids(svg: string, p: string): string {
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  let out = svg;
  for (const id of ids) {
    out = out.replaceAll(`id="${id}"`, `id="${p}-${id}"`).replaceAll(`url(#${id})`, `url(#${p}-${id})`);
  }
  return out;
}

/**
 * v3 最终印痕（方向 A 汉印·浑厚）。图形逐字节来自 seal-marks-v3.ts；这里只做：
 * id 前缀、补 width/height/focusable/title、干印换色、tier>=1 叠纸色细线。
 */
function markSvgV3(
  art: { large: string; small: string },
  opts: { size: number; prefix: string; tier?: 0 | 1 | 2 | 3; dry?: boolean; title?: string },
): string {
  // 小尺寸用干净版（无 filter，只留咬边 mask）；size <= 28 的阈值来自设计规范
  return finishV3Mark(opts.size <= 28 ? art.small : art.large, opts);
}

/**
 * v3 印痕收尾（大/小两版共用）：id 前缀、开标签补尺寸/可访问性属性、title、
 * 干印换色、tier>=1 叠纸色细线。图形本身逐字节来自 seal-marks-v3.ts。
 */
function finishV3Mark(
  art: string,
  opts: { size: number; prefix: string; tier?: 0 | 1 | 2 | 3; dry?: boolean; title?: string },
): string {
  const p = cssId(opts.prefix);
  const dry = opts.dry ?? false;
  const tier = opts.tier ?? 0;
  const s = opts.size;

  let out = prefixV3Ids(art, p);

  // 开标签补上运行时尺寸和可访问性属性，title 插在开标签后面
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${s}" height="${s}"` +
    ` aria-hidden="true" focusable="false" class="seal-mark-svg">`;
  out = out.replace(V3_OPEN_TAG_RE, open + (opts.title ? `<title>${esc(opts.title)}</title>` : ""));

  // 干印换色：v3 印泥色写在 style 里，直接整体替换
  if (dry) out = out.replaceAll("var(--seal-red,#B23A2B)", "var(--seal-dry,#906752)");

  // 连续天数纹理：叠在最上层（规范 6.4）
  const tierLine = tier >= 1 ? `<path style="${PAPER_LINE}" d="${TIER_LINES[tier as 1 | 2 | 3]}"/>` : "";
  if (tierLine) out = out.replace(/<\/svg>$/, `${tierLine}</svg>`);

  return out;
}

/** 把模板里指定笔画宽度的 <g> 组内的那条 path d 换成现算值（日期章的字形 / 界格） */
function replaceGroupPathD(svg: string, strokeStyle: string, d: string): string {
  const re = new RegExp(`(<g style="[^"]*${strokeStyle}[^"]*"><path d=")[^"]*("/></g>)`);
  return svg.replace(re, (all, pre: string, post: string) => pre + d + post);
}

/**
 * 站标「超予」（二字满白文方印，v3-zhuan 第三轮定稿）。图形逐字节来自 seal-marks-v3.ts
 * 内联的 logo-chaoyu 两个文件：size <= 40 用小号（满幅、无残边；顶栏 24–32px 都走它），
 * 其余用大号（带残边和肌理）。id 前缀、尺寸/title 的收尾与 v3 印痕同一套（finishV3Mark）。
 */
export function logoSvg(opts: { size: number; prefix: string; title?: string }): string {
  return finishV3Mark(opts.size <= 40 ? V3_LOGO.small : V3_LOGO.large, opts);
}

/**
 * v3 日期章（竖长方朱文，自上而下：月组、横界格、日组）。V3_DATE_TEMPLATE 是
 * 10-03 样张，这里把字形和界格两条 path 换成 seal-date-glyphs.ts 现算的当日印文；
 * size <= 28 时去掉纹理 filter 和咬边（干净小版，同其他 v3 印痕的小号规则）。
 * date 是 ISO 日期 "YYYY-MM-DD"；不合式时退到一月一日，保证印面有字。
 */
function dateMarkSvgV3(
  opts: { size: number; prefix: string; tier?: 0 | 1 | 2 | 3; dry?: boolean; date: string; title?: string },
): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(opts.date);
  const month = m ? Number(m[2]) : 1;
  const day = m ? Number(m[3]) : 1;

  let art = V3_DATE_TEMPLATE;
  // 界格组（0.9）和字形组（1.35）各只有一条 path；边框组（1.9）不动
  const { gridY } = dateStrokesV(month, day);
  art = replaceGroupPathD(art, "stroke-width:0.9;stroke-linecap:butt", dateGridD(gridY));
  art = replaceGroupPathD(art, "stroke-width:1.35", dateGlyphD(month, day));

  if (opts.size <= 28) {
    art = art
      .replace(/<filter\b[\s\S]*?<\/filter>/, "")
      .replace(/ filter="url\(#[^)]*\)"/, "")
      .replace(/<g fill="#000">[\s\S]*?<\/g>/, '<g fill="#000"></g>');
  }

  return finishV3Mark(art, opts);
}

/**
 * 朱文印痕。五个 kind 全走 v3 定稿印痕（seal-marks-v3.ts 内联的 svg/v3/ 文件）：
 * tuoyuan 带 date 时是日期章（dateMarkSvgV3 现算印文）；其余（含无 date 的
 * tuoyuan 半通印）直接用 V3_MARKS[kind]，date 对它们无意义、忽略。
 * dry=true 用干印色 var(--seal-dry)；tier>=1 时在最上层叠纸色细线（飞白/破边）。
 */
export function markSvg(
  kind: SealKind,
  opts: { size: number; prefix: string; tier?: 0 | 1 | 2 | 3; dry?: boolean; date?: string; title?: string },
): string {
  if (kind === "tuoyuan" && opts.date) return dateMarkSvgV3({ ...opts, date: opts.date });
  const v3 = V3_MARKS[kind];
  if (v3) return markSvgV3(v3, opts);
  // 五个 kind 都已定稿，正常到不了这里；重刻中缺文件时给一句可排查的错
  throw new Error(`markSvg: ${kind} 还没有 v3 印痕，先跑 npm run seal:marks`);
}
