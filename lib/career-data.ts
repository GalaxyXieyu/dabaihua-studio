import type { CareerData } from "./career";

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options?: { eager?: boolean; import?: string },
    ): Record<string, unknown>;
  }
}

const modules = import.meta.glob("../content/career/career.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export function loadCareerData(): CareerData | null {
  const value = Object.values(modules)[0];
  return value ? (value as CareerData) : null;
}
