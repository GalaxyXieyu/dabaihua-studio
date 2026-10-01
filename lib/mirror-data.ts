import type { MirrorData } from "./mirror";

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options?: { eager?: boolean; import?: string },
    ): Record<string, unknown>;
  }
}

const modules = import.meta.glob("../content/mirror/mirror.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

/**
 * content/mirror/mirror.json 由 `npm run mirror:build` 生成，且被 .gitignore 忽略。
 * 文件不存在时 glob 结果为空，页面显示空状态，构建不会失败。
 */
export function loadMirrorData(): MirrorData | null {
  const value = Object.values(modules)[0];
  return value ? (value as MirrorData) : null;
}
