// 策略页共用的类型与纯函数。放在单独模块里，读/写两种渲染共用同一份数据形状。

export type ContentRouting = Record<
  string,
  { allowed: boolean | string; rule?: string; reason?: string; heat?: number }
>;

export type TitleFormulas = Record<string, string> & {
  structure?: string;
  required_two_of_three?: string[];
  blacklist?: string[];
};

export type PlatformData = {
  positioning: string;
  key_metric?: string;
  content_routing: ContentRouting;
  title_formulas: TitleFormulas;
  publish_rules?: string[];
};

export type BannedPatterns = {
  words?: string[];
  punctuation?: Record<string, string>;
  structures?: string[];
  vague_refs?: string[];
};

export type StrategyData = {
  platforms: Record<string, PlatformData>;
  topic_routing_matrix?: Record<string, Record<string, string>>;
  banned_patterns?: BannedPatterns;
  derivation_order?: string[];
  cta_templates?: Record<string, string>;
};

export type Retrospective = {
  id: number;
  date: string;
  title: string;
  problem: string;
  result: string;
  lesson: string;
  version: number;
  isActive: boolean;
};

export type VersionEntry = {
  id: number;
  version: number;
  note: string;
  isActive: number | boolean;
  createdAt: string;
};

export const TABS = ["平台路由", "标题公式", "发布规则", "复盘记录"] as const;
export type Tab = (typeof TABS)[number];

export const PLATFORM_LABELS: Record<string, string> = {
  wechat_gzh: "公众号 GZH",
  xiaohongshu: "小红书 XHS",
};

export const STATUS_CYCLE: (boolean | string)[] = [true, "conditional", false];

export const STATUS_LABEL: Record<string, string> = {
  true: "允许",
  conditional: "条件",
  false: "禁止",
};

export const STATUS_CLASS: Record<string, string> = {
  true: "",
  conditional: "conditional",
  false: "forbidden",
};

// 标题公式里除「类型 → 公式」之外的元字段。
export const TITLE_META_KEYS = new Set(["structure", "required_two_of_three", "blacklist"]);

export function platformLabel(key: string): string {
  return PLATFORM_LABELS[key] || key;
}

export function statusLabel(value: boolean | string | undefined): string {
  return STATUS_LABEL[String(value)] || "允许";
}

export function statusClass(value: boolean | string | undefined): string {
  return STATUS_CLASS[String(value)] || "";
}

export function emptyStrategyData(): StrategyData {
  return { platforms: {} };
}

export function normalizeStrategyData(initialData: unknown): StrategyData {
  try {
    if (typeof initialData === "string") return JSON.parse(initialData) as StrategyData;
    if (initialData && typeof initialData === "object") return initialData as StrategyData;
  } catch {
    /* ignore */
  }
  return emptyStrategyData();
}
