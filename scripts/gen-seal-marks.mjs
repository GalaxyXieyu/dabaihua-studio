#!/usr/bin/env node
// 生成 app/_components/seal/seal-marks-v3.ts：把 svg/v3/ 里的 v3 最终印痕
// （方向 A 汉印·浑厚）内联成 TS 字符串真源，供 markSvg 直接使用。
// 用法：npm run seal:marks
// 换新刻的印：把定稿的 stamp-mark-<stem>.svg（大尺寸，带纹理 filter + 咬边 mask）
// 和 stamp-mark-<stem>-small.svg（小尺寸 <= 28px，仅 mask）两个文件放进
// app/_components/seal/svg/v3/ 后重新运行本脚本即可；缺任一文件的 kind 自动跳过。
// 日期章模板取 stamp-mark-date-1003.svg（样张，字形/界格运行时现算）。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const V3_DIR = join(ROOT, "app/_components/seal/svg/v3");
const OUT_FILE = join(ROOT, "app/_components/seal/seal-marks-v3.ts");

// 五个印痕 kind 的固定顺序；只有两个文件都齐的 kind 才会进 V3_MARKS
const KINDS = ["fang", "yuan", "hulu", "tuoyuan", "yinshou"];

// kind → 文件名主干。tuoyuan（日章）第三轮改用汉半通印（竖长方，替代椭圆印面；
// SealKind 键名不变，只换印痕），文件名跟着印面叫 bantong，其余即 kind 名。
const STEMS = { fang: "fang", yuan: "yuan", hulu: "hulu", tuoyuan: "bantong", yinshou: "yinshou" };

// 日期章模板：10-03 样张；markSvg 拿它拼任意日期（字形/界格 path 现算替换）
const DATE_TEMPLATE_FILE = "stamp-mark-date-1003.svg";

/** 去掉末尾换行，其余逐字节保留 */
function stripTrailingNewline(text) {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * 纯函数：由 { kind: { large, small } }（kind 键，文件已按 STEMS 取好）和日期章模板
 * 渲染 seal-marks-v3.ts 的完整内容。测试用它和已提交文件比对，保证生成物与
 * svg/v3/ 源文件同步。
 */
export function renderSealMarksModule(files, dateTemplate) {
  const entries = KINDS.filter((kind) => files[kind]).map((kind) => {
    const { large, small } = files[kind];
    return `  ${kind}: {\n    large: ${JSON.stringify(stripTrailingNewline(large))},\n    small: ${JSON.stringify(stripTrailingNewline(small))},\n  },`;
  });
  return (
    "// 本文件由 scripts/gen-seal-marks.mjs 自动生成，勿手改。\n" +
    "// 数据源：app/_components/seal/svg/v3/stamp-mark-<stem>.svg（大尺寸，纹理 filter + 咬边 mask）\n" +
    "// 与 stamp-mark-<stem>-small.svg（小尺寸 <= 28px，仅 mask）。stem 按 STEMS 映射：\n" +
    "// tuoyuan（日章）用 bantong（汉半通印，替代椭圆印面），其余即 kind 名。\n" +
    "// 换新刻的印：覆盖 svg/v3/ 里的两个文件后运行 npm run seal:marks 重新生成。\n" +
    '// 字符串与源文件逐字节一致（仅去掉末尾换行）。\n' +
    'import type { SealKind } from "./seal-tokens.ts";\n\n' +
    "// v3 最终印痕（方向 A 汉印·浑厚）；size <= 28 用 small，其余用 large。\n" +
    "export const V3_MARKS: Partial<Record<SealKind, { large: string; small: string }>> = {\n" +
    entries.join("\n") +
    "\n};\n\n" +
    "// v3 日期章模板（stamp-mark-date-1003.svg 样张，竖长方朱文）：markSvg 里把\n" +
    "// 字形和界格两条 path 换成 seal-date-glyphs.ts 现算的当日印文。\n" +
    `export const V3_DATE_TEMPLATE: string = ${dateTemplate ? JSON.stringify(stripTrailingNewline(dateTemplate)) : ""};\n`
  );
}

function main() {
  const files = {};
  for (const kind of KINDS) {
    const stem = STEMS[kind];
    const large = join(V3_DIR, `stamp-mark-${stem}.svg`);
    const small = join(V3_DIR, `stamp-mark-${stem}-small.svg`);
    try {
      files[kind] = {
        large: readFileSync(large, "utf8"),
        small: readFileSync(small, "utf8"),
      };
    } catch {
      // 该 kind 还没刻完（两个文件缺一即跳过），保持占位几何
    }
  }
  let dateTemplate;
  try {
    dateTemplate = readFileSync(join(V3_DIR, DATE_TEMPLATE_FILE), "utf8");
  } catch {
    // 日期章模板还没刻，跳过
  }
  const missing = KINDS.filter((k) => !files[k]);
  const source = renderSealMarksModule(files, dateTemplate);
  writeFileSync(OUT_FILE, source, "utf8");
  console.log(
    `seal-marks-v3.ts: ${Object.keys(files).length}/${KINDS.length} kinds` +
      (dateTemplate ? "，日期章模板已内联" : "（无日期章模板）") +
      (missing.length ? `（跳过 ${missing.join(", ")}）` : ""),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
