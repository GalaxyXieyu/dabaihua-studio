/**
 * 照照镜子卡片领域核心（纯 TS，不依赖任何运行时）。
 *
 * 这里放三样东西，store / 迁移脚本 / 接口 / 测试共用：
 *   1. CARDS_SCHEMA_STATEMENTS：cards / card_revisions 的建表 DDL；
 *   2. Card / CardRevision 的 API 形状与 DB 行互转；
 *   3. SCHEMA.md 的 8 条校验规则和 id / 日期等纯函数。
 *
 * 只允许 import 同目录的纯模块，node 测试可直接 import（.ts 后缀）。
 */

export const CARD_KINDS = ["mirror"] as const;
export const CATEGORIES = ["画像", "待调整", "偏好", "方法论", "决策", "复盘结论"] as const;
export const CATEGORY_ABBR: Record<string, string> = {
  画像: "PROF",
  待调整: "ADJ",
  偏好: "PREF",
  方法论: "METH",
  决策: "DEC",
  复盘结论: "REV",
};
export const STATUSES = ["待确认", "有效", "已过期", "已推翻"] as const;
export const SCOPES = ["沟通", "内容", "职业", "工作", "工作台"] as const;
export const ID_RE = /^H-(PROF|ADJ|PREF|METH|DEC|REV)-\d{8}-\d{2,}$/;
export const OWNER_NAME = "Yu";

export const CARDS_SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'mirror',
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  options_json TEXT NOT NULL DEFAULT '[]',
  supersedes_json TEXT NOT NULL DEFAULT '[]',
  owner TEXT NOT NULL DEFAULT '',
  superseded_by TEXT NOT NULL DEFAULT '',
  review_after TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  delete_reason TEXT
)`,
  "CREATE INDEX IF NOT EXISTS cards_kind_status_idx ON cards(kind, status, deleted_at)",
  "CREATE INDEX IF NOT EXISTS cards_kind_category_idx ON cards(kind, category)",
  `CREATE TABLE IF NOT EXISTS card_revisions (
  card_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  action TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (card_id, version)
)`,
];

export type CardSource = { agent: string; date: string; ref: string };

export type Card = {
  id: string;
  kind: string;
  version: number;
  category: string;
  title: string;
  body: string;
  scope: string[];
  sources: CardSource[];
  status: string;
  confirmed_by: string;
  confirmed_at: string;
  supersedes: string[];
  superseded_by: string;
  review_after: string;
  reason: string;
  added_by: string;
  options: string[];
  owner: string;
  recorded_at: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
};

export type CardRevision = {
  card_id: string;
  version: number;
  action: string;
  snapshot: Card;
  reason: string;
  actor: string;
  created_at: string;
};

export type CardValidationError = { field: string; message: string };

export const CARD_COLUMNS = [
  "id",
  "kind",
  "category",
  "title",
  "body",
  "scope_json",
  "sources_json",
  "options_json",
  "supersedes_json",
  "owner",
  "superseded_by",
  "review_after",
  "status",
  "reason",
  "version",
  "confirmed_by",
  "confirmed_at",
  "created_by",
  "updated_by",
  "recorded_at",
  "created_at",
  "updated_at",
  "deleted_at",
  "deleted_by",
  "delete_reason",
] as const;

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

/** DB 行 → API 形状。坏 JSON 当空数组，缺列当空字符串。 */
export function rowToCard(row: Record<string, unknown>): Card {
  return {
    id: asString(row.id),
    kind: asString(row.kind) || "mirror",
    version: Number(row.version ?? 1),
    category: asString(row.category),
    title: asString(row.title),
    body: asString(row.body),
    scope: parseArray(row.scope_json).map(asString).filter(Boolean),
    sources: parseArray(row.sources_json)
      .filter((source): source is Record<string, unknown> => Boolean(source) && typeof source === "object")
      .map((source) => ({ agent: asString(source.agent), date: asString(source.date), ref: asString(source.ref) })),
    status: asString(row.status),
    confirmed_by: asString(row.confirmed_by),
    confirmed_at: asString(row.confirmed_at),
    supersedes: parseArray(row.supersedes_json).map(asString).filter(Boolean),
    superseded_by: asString(row.superseded_by),
    review_after: asString(row.review_after),
    reason: asString(row.reason),
    added_by: asString(row.updated_by),
    options: parseArray(row.options_json).map(asString).filter(Boolean),
    owner: asString(row.owner),
    recorded_at: asString(row.recorded_at),
    created_by: asString(row.created_by),
    updated_by: asString(row.updated_by),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    deleted_at: row.deleted_at === null || row.deleted_at === undefined ? null : asString(row.deleted_at),
    deleted_by: row.deleted_by === null || row.deleted_by === undefined ? null : asString(row.deleted_by),
    delete_reason: row.delete_reason === null || row.delete_reason === undefined ? null : asString(row.delete_reason),
  };
}

/** API 形状 → DB 行（JSON 列序列化，deleted_* 保持 null）。 */
export function cardToRow(card: Card): Record<string, unknown> {
  return {
    id: card.id,
    kind: card.kind,
    category: card.category,
    title: card.title,
    body: card.body,
    scope_json: JSON.stringify(card.scope || []),
    sources_json: JSON.stringify(card.sources || []),
    options_json: JSON.stringify(card.options || []),
    supersedes_json: JSON.stringify(card.supersedes || []),
    owner: card.owner || "",
    superseded_by: card.superseded_by || "",
    review_after: card.review_after || "",
    status: card.status,
    reason: card.reason || "",
    version: card.version,
    confirmed_by: card.confirmed_by || "",
    confirmed_at: card.confirmed_at || "",
    created_by: card.created_by || "",
    updated_by: card.updated_by || "",
    recorded_at: card.recorded_at || "",
    created_at: card.created_at,
    updated_at: card.updated_at,
    deleted_at: card.deleted_at ?? null,
    deleted_by: card.deleted_by ?? null,
    delete_reason: card.delete_reason ?? null,
  };
}

/** 上海日期（UTC+8 手算，不依赖时区库）。 */
export function shanghaiDate(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** YYYY-MM-DD 且是真实存在的日期。 */
export function isDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** 进过正本：非「待确认」且写过 confirmed_at。 */
export function isCanonical(card: Pick<Card, "status" | "confirmed_at">): boolean {
  return card.status !== "待确认" && card.confirmed_at !== "";
}

/** 生成 H-ABBR-YYYYMMDD-NN，NN 取同前缀最大序号 +1，两位补零。 */
export function nextCardId(existingIds: string[], category: string, dateYYYYMMDD: string): string {
  const abbr = CATEGORY_ABBR[category] || "";
  const prefix = `H-${abbr}-${dateYYYYMMDD}-`;
  let maximum = 0;
  for (const id of existingIds) {
    if (typeof id !== "string" || !id.startsWith(prefix)) continue;
    const tail = id.slice(prefix.length);
    if (/^\d+$/.test(tail)) maximum = Math.max(maximum, Number(tail));
  }
  return `${prefix}${String(maximum + 1).padStart(2, "0")}`;
}

function trimString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(trimString).filter(Boolean);
  if (typeof value === "string") return value.split(/[\n,，]/).map((part) => part.trim()).filter(Boolean);
  return [];
}

function normalizeSources(value: unknown): CardSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((source): source is Record<string, unknown> => Boolean(source) && typeof source === "object")
    .map((source) => ({ agent: trimString(source.agent), date: trimString(source.date), ref: trimString(source.ref) }));
}

export type CardInput = Partial<Card> & { added_by?: string };

/** 请求体规范化：trim、数组去空、默认值补齐。scope/options 接受逗号字符串。 */
export function normalizeCardInput(body: unknown): CardInput {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return {
    id: trimString(source.id),
    kind: trimString(source.kind) || "mirror",
    version: Number.isInteger(source.version) ? Number(source.version) : undefined,
    category: trimString(source.category),
    title: trimString(source.title),
    body: trimString(source.body),
    scope: stringArray(source.scope),
    sources: normalizeSources(source.sources),
    status: trimString(source.status),
    confirmed_by: trimString(source.confirmed_by),
    confirmed_at: trimString(source.confirmed_at),
    supersedes: stringArray(source.supersedes),
    superseded_by: trimString(source.superseded_by),
    review_after: trimString(source.review_after),
    reason: trimString(source.reason),
    added_by: trimString(source.added_by),
    options: stringArray(source.options),
    owner: trimString(source.owner),
    recorded_at: trimString(source.recorded_at),
  };
}

/** SCHEMA.md 的 8 条规则。返回 { ok, errors: [{field, message}] }。 */
export function validateCard(
  card: unknown,
  ctx: { knownIds: Set<string> } = { knownIds: new Set() },
): { ok: boolean; errors: CardValidationError[] } {
  const errors: CardValidationError[] = [];
  const push = (field: string, message: string) => errors.push({ field, message });
  const value = (card && typeof card === "object" ? card : {}) as Record<string, unknown>;
  const knownIds = ctx?.knownIds || new Set<string>();

  // 1. id 格式 + 前缀与 category 对应；version 是 ≥1 整数。
  const id = value.id;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    push("id", "id 格式必须是 H-类别缩写-YYYYMMDD-序号");
  } else {
    const matched = /^H-([A-Z]+)-/.exec(id);
    const abbr = matched ? matched[1] : "";
    if (CATEGORY_ABBR[asString(value.category)] !== abbr) push("id", "id 前缀与 category 不符");
  }
  const version = value.version;
  if (!Number.isInteger(version) || (version as number) < 1) push("version", "version 必须是从 1 开始的整数");

  // 2. title / body / added_by 非空；sources 非空且每项完整。
  if (trimString(value.title) === "") push("title", "title 不能为空");
  if (trimString(value.body) === "") push("body", "body 不能为空");
  if (trimString(value.added_by) === "") push("added_by", "added_by 不能为空");
  const sources = value.sources;
  if (!Array.isArray(sources) || sources.length === 0) {
    push("sources", "sources 必须是非空数组");
  } else {
    sources.forEach((source, index) => {
      if (!source || typeof source !== "object") {
        push(`sources[${index}]`, "每一项必须是对象");
        return;
      }
      const item = source as Record<string, unknown>;
      if (trimString(item.agent) === "") push(`sources[${index}].agent`, "agent 不能为空");
      if (!isDate(item.date)) push(`sources[${index}].date`, "date 必须是 YYYY-MM-DD");
      if (trimString(item.ref) === "") push(`sources[${index}].ref`, "ref 不能为空");
    });
  }

  // 3. category / status / scope / kind / options / owner。
  if (!CATEGORIES.includes(asString(value.category) as (typeof CATEGORIES)[number])) {
    push("category", "category 取值必须是 6 类之一");
  }
  if (!STATUSES.includes(asString(value.status) as (typeof STATUSES)[number])) {
    push("status", "status 取值必须是 4 种状态之一");
  }
  const scope = value.scope;
  if (!Array.isArray(scope)) {
    push("scope", "scope 必须是数组");
  } else {
    for (const item of scope) {
      if (!SCOPES.includes(item as (typeof SCOPES)[number])) push("scope", `scope 取值非法：${String(item)}`);
    }
  }
  if (!CARD_KINDS.includes(asString(value.kind) as (typeof CARD_KINDS)[number])) {
    push("kind", "kind 取值非法");
  }
  const options = value.options;
  if (options !== undefined && options !== null && !Array.isArray(options)) {
    push("options", "options 必须是数组");
  } else if (Array.isArray(options)) {
    for (const option of options) {
      if (typeof option !== "string") push("options", "options 每一项必须是字符串");
    }
  }
  if (value.owner !== undefined && value.owner !== null && typeof value.owner !== "string") {
    push("owner", "owner 必须是字符串");
  }

  // 4. 收件箱就是待确认：待确认的卡不能有 confirmed_by / confirmed_at。
  if (value.status === "待确认" && (trimString(value.confirmed_by) !== "" || trimString(value.confirmed_at) !== "")) {
    push("confirmed_by", "待确认的卡不能有 confirmed_by / confirmed_at");
  }

  // 5. 有效必须有 confirmed_by 和 confirmed_at。
  if (value.status === "有效") {
    if (trimString(value.confirmed_by) === "") push("confirmed_by", "状态为「有效」时必须写 confirmed_by");
    if (!isDate(value.confirmed_at)) push("confirmed_at", "状态为「有效」时 confirmed_at 必须是 YYYY-MM-DD");
  }

  // 6. 进过正本（confirmed_at 非空）的「已推翻」必须有 superseded_by。
  if (value.status === "已推翻" && trimString(value.confirmed_at) !== "" && trimString(value.superseded_by) === "") {
    push("superseded_by", "「已推翻」的条目必须写 superseded_by");
  }

  // 7. supersedes 指向存在的 id，且不能指向自己。
  const supersedes = value.supersedes;
  if (supersedes !== undefined && supersedes !== null) {
    if (!Array.isArray(supersedes)) {
      push("supersedes", "supersedes 必须是数组");
    } else {
      for (const target of supersedes) {
        if (typeof target !== "string" || !knownIds.has(target)) {
          push("supersedes", `supersedes 指向不存在的 id：${String(target)}`);
        } else if (target === id) {
          push("supersedes", "supersedes 不能指向自己");
        }
      }
    }
  }

  // 8. review_after / recorded_at / confirmed_at 非空必须是日期。
  for (const field of ["review_after", "recorded_at", "confirmed_at"] as const) {
    const fieldValue = value[field];
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== "" && !isDate(fieldValue)) {
      push(field, `${field} 必须是 YYYY-MM-DD`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** 历史条上一行小字，页面和 CLI 共用。 */
export function revisionSummary(rev: CardRevision): string {
  switch (rev.action) {
    case "add":
      return rev.snapshot.status === "待确认" ? `${rev.actor} 提出，待确认` : `${rev.actor} 新增`;
    case "confirm":
      return `${rev.actor} 确认，生效`;
    case "reject":
      return `${rev.actor} 不要了`;
    case "edit":
      return rev.reason ? rev.reason : `${rev.actor} 修改`;
    case "supersede":
      return rev.snapshot.status === "已推翻" ? `被 ${rev.snapshot.superseded_by} 取代` : `${rev.actor} 替换旧卡`;
    case "expire":
      return `${rev.actor} 标记过期`;
    case "delete":
      return `${rev.actor} 删除`;
    case "restore":
      return `${rev.actor} 恢复`;
    default:
      return `${rev.actor} 修改`;
  }
}

export type CardActor = { type: "owner" | "assistant"; name: string };

const OWNER_ACTIONS = new Set(["list", "get", "history", "create", "edit", "supersede", "expire", "delete", "restore", "confirm", "reject"]);
const ASSISTANT_ACTIONS = new Set(["list", "get", "history", "create"]);

/** 权限表：owner 全允许，assistant 只能读和新增待确认。 */
export function can(actor: CardActor | null | undefined, action: string): boolean {
  if (!actor) return false;
  if (actor.type === "owner") return OWNER_ACTIONS.has(action);
  if (actor.type === "assistant") return ASSISTANT_ACTIONS.has(action);
  return false;
}
