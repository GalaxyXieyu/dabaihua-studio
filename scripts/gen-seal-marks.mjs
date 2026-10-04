#!/usr/bin/env node
// 生成 app/_components/seal/seal-marks-v3.ts：把 svg/v3/ 里的 v3 最终印痕
// （方向 A 汉印·浑厚）内联成 TS 字符串真源，供 markSvg 直接使用。
// 用法：npm run seal:marks
// 换新刻的印：把定稿的 stamp-mark-<kind>.svg（大尺寸，带纹理 filter + 咬边 mask）
// 和 stamp-mark-<kind>-small.svg（小尺寸 <= 28px，仅 mask）两个文件放进
// app/_components/seal/svg/v3/ 后重新运行本脚本即可；缺任一文件的 kind 自动跳过。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const V3_DIR = join(ROOT, "app/_components/seal/svg/v3");
const OUT_FILE = join(ROOT, "app/_components/seal/seal-marks-v3.ts");

// 五个印痕 kind 的固定顺序；只有两个文件都齐的 kind 才会进 V3_MARKS
const KINDS = ["fang", "yuan", "hulu", "tuoyuan", "yinshou"];

/** 去掉末尾换行，其余逐字节保留 */
function stripTrailingNewline(text) {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * 纯函数：由 { kind: { large, small } } 渲染 seal-marks-v3.ts 的完整内容。
 * 测试用它和已提交文件比对，保证生成物与 svg/v3/ 源文件同步。
 */
export function renderSealMarksModule(files) {
  const entries = KINDS.filter((kind) => files[kind]).map((kind) => {
    const { large, small } = files[kind];
    return `  ${kind}: {\n    large: ${JSON.stringify(stripTrailingNewline(large))},\n    small: ${JSON.stringify(stripTrailingNewline(small))},\n  },`;
  });
  return (
    "// 本文件由 scripts/gen-seal-marks.mjs 自动生成，勿手改。\n" +
    "// 数据源：app/_components/seal/svg/v3/stamp-mark-<kind>.svg（大尺寸，纹理 filter + 咬边 mask）\n" +
    "// 与 stamp-mark-<kind>-small.svg（小尺寸 <= 28px，仅 mask）。\n" +
    "// 换新刻的印：覆盖 svg/v3/ 里的两个文件后运行 npm run seal:marks 重新生成。\n" +
    '// 字符串与源文件逐字节一致（仅去掉末尾换行）。\n' +
    'import type { SealKind } from "./seal-tokens.ts";\n\n' +
    "// v3 最终印痕（方向 A 汉印·浑厚）；size <= 28 用 small，其余用 large。\n" +
    "export const V3_MARKS: Partial<Record<SealKind, { large: string; small: string }>> = {\n" +
    entries.join("\n") +
    "\n};\n"
  );
}

function main() {
  const files = {};
  for (const kind of KINDS) {
    const large = join(V3_DIR, `stamp-mark-${kind}.svg`);
    const small = join(V3_DIR, `stamp-mark-${kind}-small.svg`);
    try {
      files[kind] = {
        large: readFileSync(large, "utf8"),
        small: readFileSync(small, "utf8"),
      };
    } catch {
      // 该 kind 还没刻完（两个文件缺一即跳过），保持占位几何
    }
  }
  const missing = KINDS.filter((k) => !files[k]);
  const source = renderSealMarksModule(files);
  writeFileSync(OUT_FILE, source, "utf8");
  console.log(
    `seal-marks-v3.ts: ${Object.keys(files).length}/${KINDS.length} kinds` +
      (missing.length ? `（跳过 ${missing.join(", ")}）` : ""),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
