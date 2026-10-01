/**
 * 照照镜子卡片服务层。
 *
 * 只依赖 cards-core.ts，不 import cloudflare:workers / store.ts，node 测试可直跑。
 * 所有写操作都在一个 db.batch([...]) 里（D1 batch 是事务）：先 INSERT 一条
 * card_revisions（历史只增不改，且带 `WHERE EXISTS (… version = expected)` 守卫），
 * 再用 `WHERE id = ? AND version = ?expected` 做乐观锁更新主表。版本已被别人改过时
 * 守卫让整批什么都不写、UPDATE 0 行 → 转成 CardConflictError（409）；万一两条
 * 都写到同一个 version，card_revisions 主键冲突也会让整批回滚。
 */

import {
  CATEGORIES,
  OWNER_NAME,
  cardToRow,
  isDate,
  nextCardId,
  normalizeCardInput,
  rowToCard,
  shanghaiDate,
  validateCard,
  type Card,
  type CardInput,
  type CardRevision,
  type CardValidationError as CardValidationIssue,
  type CardActor,
} from "./cards-core.ts";

type Db = D1Database;

export class CardNotFoundError extends Error {
  status = 404;
  id: string;
  constructor(id: string) {
    super(`找不到卡片：${id}`);
    this.name = "CardNotFoundError";
    this.id = id;
  }
}

export class CardConflictError extends Error {
  status = 409;
  current: Card | null;
  constructor(current: Card | null) {
    super("version conflict");
    this.name = "CardConflictError";
    this.current = current;
  }
}

export class CardValidationError extends Error {
  status = 400;
  errors: CardValidationIssue[];
  constructor(errors: CardValidationIssue[]) {
    super(errors[0]?.message || "validation failed");
    this.name = "CardValidationError";
    this.errors = errors;
  }
}

export class CardForbiddenError extends Error {
  status = 403;
  constructor(message = "forbidden") {
    super(message);
    this.name = "CardForbiddenError";
  }
}

const nowIso = () => new Date().toISOString();
const today = () => shanghaiDate();
const compactDate = (date: string) => date.replace(/-/g, "");

function isConstraintError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || error || "");
  return /UNIQUE|constraint|PRIMARY KEY/i.test(message);
}

function has(object: unknown, key: string): boolean {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key) && (object as Record<string, unknown>)[key] !== undefined;
}

/**
 * 追加一条历史。给了 guardVersion 时只在主表当前仍是这个版本时才插入：
 * 版本已被别人改过 → 不插历史、主表 UPDATE 也是 0 行 → 转成 409，不会留下孤立历史。
 */
type Guard = { id: string; version: number };

function revisionStatement(db: Db, revision: CardRevision, guard?: Guard) {
  const values = [revision.card_id, revision.version, revision.action, JSON.stringify(revision.snapshot), revision.reason || "", revision.actor, revision.created_at];
  if (!guard) {
    return db
      .prepare("INSERT INTO card_revisions (card_id, version, action, snapshot_json, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(...values);
  }
  return db
    .prepare("INSERT INTO card_revisions (card_id, version, action, snapshot_json, reason, actor, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM cards WHERE id = ? AND version = ?)")
    .bind(...values, guard.id, guard.version);
}

/** 新卡 INSERT；给了 guard 时只在 guard 指向的卡仍是那个版本时才插入（supersede 用，保证整批要么全写要么全不写）。 */
function cardInsertStatement(db: Db, card: Card, guard?: Guard) {
  const row = cardToRow(card);
  const columns = Object.keys(row);
  const values = columns.map((column) => row[column]);
  if (!guard) {
    return db
      .prepare(`INSERT INTO cards (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .bind(...values);
  }
  return db
    .prepare(`INSERT INTO cards (${columns.join(", ")}) SELECT ${columns.map(() => "?").join(", ")} WHERE EXISTS (SELECT 1 FROM cards WHERE id = ? AND version = ?)`)
    .bind(...values, guard.id, guard.version);
}

function cardUpdateStatement(db: Db, card: Card, expectedVersion: number) {
  const row = cardToRow(card);
  const columns = Object.keys(row).filter((column) => column !== "id");
  return db
    .prepare(`UPDATE cards SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ? AND version = ?`)
    .bind(...columns.map((column) => row[column]), card.id, expectedVersion);
}

export function revisionFromRow(row: Record<string, unknown>): CardRevision {
  let snapshot: Card;
  try {
    snapshot = JSON.parse(String(row.snapshot_json ?? "{}")) as Card;
  } catch {
    snapshot = rowToCard({});
  }
  return {
    card_id: String(row.card_id ?? ""),
    version: Number(row.version ?? 0),
    action: String(row.action ?? ""),
    snapshot,
    reason: String(row.reason ?? ""),
    actor: String(row.actor ?? ""),
    created_at: String(row.created_at ?? ""),
  };
}

async function allIds(db: Db): Promise<string[]> {
  const rows = await db.prepare("SELECT id FROM cards").all<{ id: string }>();
  return (rows.results || []).map((row) => String(row.id));
}

export async function getCard(db: Db, id: string): Promise<Card | null> {
  const row = await db.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return row ? rowToCard(row) : null;
}

export async function listCards(
  db: Db,
  options: { kind?: string; category?: string; status?: string; deleted?: boolean } = {},
): Promise<Card[]> {
  const kind = options.kind || "mirror";
  const clauses = ["kind = ?"];
  const params: unknown[] = [kind];
  if (options.deleted === true) {
    clauses.push("deleted_at IS NOT NULL");
  } else {
    clauses.push("deleted_at IS NULL");
  }
  if (options.category) {
    clauses.push("category = ?");
    params.push(options.category);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  const order = options.deleted === true
    ? "ORDER BY deleted_at DESC, id"
    : `ORDER BY CASE category ${CATEGORIES.map((category, index) => `WHEN '${category}' THEN ${index}`).join(" ")} ELSE 99 END, created_at ASC, id ASC`;
  const rows = await db.prepare(`SELECT * FROM cards WHERE ${clauses.join(" AND ")} ${order}`).bind(...params).all<Record<string, unknown>>();
  return (rows.results || []).map(rowToCard);
}

export async function listHistory(db: Db, id: string): Promise<CardRevision[]> {
  const rows = await db
    .prepare("SELECT * FROM card_revisions WHERE card_id = ? ORDER BY version ASC")
    .bind(id)
    .all<Record<string, unknown>>();
  return (rows.results || []).map(revisionFromRow);
}

export async function listAllHistory(db: Db, kind = "mirror"): Promise<Map<string, CardRevision[]>> {
  const rows = await db.prepare("SELECT * FROM card_revisions ORDER BY card_id ASC, version ASC").all<Record<string, unknown>>();
  const result = new Map<string, CardRevision[]>();
  for (const row of rows.results || []) {
    const revision = revisionFromRow(row);
    if (kind && revision.snapshot.kind !== kind) continue;
    const bucket = result.get(revision.card_id);
    if (bucket) bucket.push(revision);
    else result.set(revision.card_id, [revision]);
  }
  return result;
}

/** 提交一次版本写入：revision 在前，主表乐观锁更新在后。 */
async function commitVersion(
  db: Db,
  next: Card,
  action: string,
  revisionReason: string,
  expectedVersion: number,
  actor: CardActor,
): Promise<CardRevision> {
  const revision: CardRevision = {
    card_id: next.id,
    version: next.version,
    action,
    snapshot: next,
    reason: revisionReason || "",
    actor: actor.name,
    created_at: next.updated_at,
  };
  try {
    const results = await db.batch([revisionStatement(db, revision, { id: next.id, version: expectedVersion }), cardUpdateStatement(db, next, expectedVersion)]);
    const last = results?.[results.length - 1] as { meta?: { changes?: number } } | undefined;
    if (!last || Number(last.meta?.changes ?? 0) === 0) throw new CardConflictError(await getCard(db, next.id));
  } catch (error) {
    if (error instanceof CardConflictError) throw error;
    if (isConstraintError(error)) throw new CardConflictError(await getCard(db, next.id));
    throw error;
  }
  return revision;
}

export async function createCard(db: Db, input: CardInput, actor: CardActor): Promise<{ card: Card; revisions: CardRevision[] }> {
  const normalized = normalizeCardInput(input);
  const writeDate = today();
  const timestamp = nowIso();

  let status = normalized.status || "";
  if (actor.type === "assistant") {
    status = "待确认";
  } else if (!["有效", "待确认"].includes(status)) {
    status = "有效";
  }

  const sourceDate = normalized.sources?.[0]?.date;
  const idDate = isDate(sourceDate) ? compactDate(sourceDate as string) : compactDate(writeDate);

  const base: Card = {
    id: "",
    kind: normalized.kind || "mirror",
    version: 1,
    category: normalized.category || "",
    title: normalized.title || "",
    body: normalized.body || "",
    scope: normalized.scope || [],
    sources: normalized.sources || [],
    status,
    confirmed_by: status === "有效" ? OWNER_NAME : "",
    confirmed_at: status === "有效" ? writeDate : "",
    supersedes: normalized.supersedes || [],
    superseded_by: "",
    review_after: normalized.review_after || "",
    reason: normalized.reason || "",
    added_by: actor.name,
    options: normalized.options || [],
    owner: normalized.owner || "",
    recorded_at: writeDate,
    created_by: actor.name,
    updated_by: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ids = await allIds(db);
    // id 一律由服务端生成，不接受客户端指定。
    const card: Card = { ...base, id: nextCardId(ids, base.category, idDate) };
    const validation = validateCard(card, { knownIds: new Set(ids) });
    if (!validation.ok) throw new CardValidationError(validation.errors);
    const revision: CardRevision = {
      card_id: card.id,
      version: 1,
      action: "add",
      snapshot: card,
      reason: card.reason,
      actor: actor.name,
      created_at: timestamp,
    };
    try {
      await db.batch([revisionStatement(db, revision), cardInsertStatement(db, card)]);
      return { card, revisions: [revision] };
    } catch (error) {
      // 并发下同一天同类别可能算出同一个 id，重算一次。
      if (attempt === 0 && isConstraintError(error)) continue;
      if (isConstraintError(error)) throw new CardConflictError(await getCard(db, card.id));
      throw error;
    }
  }
  throw new CardConflictError(null);
}

export async function updateCard(
  db: Db,
  id: string,
  patch: CardInput,
  expectedVersion: number,
  actor: CardActor,
): Promise<{ card: Card; revisions: CardRevision[] }> {
  const current = await getCard(db, id);
  if (!current) throw new CardNotFoundError(id);
  if (current.deleted_at) throw new CardValidationError([{ field: "id", message: "卡片已删除，不能编辑" }]);
  if (current.version !== expectedVersion) throw new CardConflictError(current);

  const normalized = normalizeCardInput(patch);
  if (has(patch, "category") && normalized.category && normalized.category !== current.category) {
    throw new CardValidationError([{ field: "category", message: "类别不能直接改，请用替换为新版本" }]);
  }

  const next: Card = { ...current };
  if (has(patch, "title")) next.title = normalized.title || "";
  if (has(patch, "body")) next.body = normalized.body || "";
  if (has(patch, "scope")) next.scope = normalized.scope || [];
  if (has(patch, "sources")) next.sources = normalized.sources || [];
  if (has(patch, "options")) next.options = normalized.options || [];
  if (has(patch, "owner")) next.owner = normalized.owner || "";
  if (has(patch, "review_after")) next.review_after = normalized.review_after || "";
  if (has(patch, "reason")) next.reason = normalized.reason || "";
  if (has(patch, "status") && normalized.status) {
    if (!["有效", "已过期", "待确认"].includes(normalized.status)) {
      throw new CardValidationError([{ field: "status", message: "改成已推翻请用替换或拒绝" }]);
    }
    next.status = normalized.status;
  }

  if (next.status === "有效" && current.status !== "有效") {
    next.confirmed_by = OWNER_NAME;
    next.confirmed_at = today();
    next.superseded_by = "";
  }
  if (next.status === "待确认" && current.status !== "待确认") {
    next.confirmed_by = "";
    next.confirmed_at = "";
  }

  next.version = current.version + 1;
  next.updated_by = actor.name;
  next.added_by = actor.name;
  next.updated_at = nowIso();
  next.recorded_at = today();

  const validation = validateCard(next, { knownIds: new Set(await allIds(db)) });
  if (!validation.ok) throw new CardValidationError(validation.errors);
  const revision = await commitVersion(db, next, "edit", next.reason, expectedVersion, actor);
  return { card: next, revisions: [revision] };
}

export async function supersedeCard(
  db: Db,
  oldId: string,
  input: CardInput,
  expectedVersion: number,
  actor: CardActor,
): Promise<{ card: Card; old: Card; revisions: CardRevision[] }> {
  const current = await getCard(db, oldId);
  if (!current) throw new CardNotFoundError(oldId);
  if (current.deleted_at) throw new CardValidationError([{ field: "id", message: "卡片已删除，不能替换" }]);
  if (current.status === "待确认") throw new CardValidationError([{ field: "status", message: "待确认的卡不能替换，请先确认" }]);
  if (current.version !== expectedVersion) throw new CardConflictError(current);

  const normalized = normalizeCardInput(input);
  if (!normalized.reason) throw new CardValidationError([{ field: "reason", message: "替换必须写原因" }]);
  if (has(input, "category") && normalized.category && !CATEGORIES.includes(normalized.category as (typeof CATEGORIES)[number])) {
    throw new CardValidationError([{ field: "category", message: "category 取值必须是 6 类之一" }]);
  }

  const category = has(input, "category") && normalized.category ? normalized.category : current.category;
  const title = has(input, "title") && normalized.title ? normalized.title : current.title;
  const body = has(input, "body") && normalized.body ? normalized.body : current.body;
  const scope = has(input, "scope") ? normalized.scope || [] : current.scope;
  const sources = has(input, "sources") ? normalized.sources || [] : current.sources;
  const options = has(input, "options") ? normalized.options || [] : current.options;
  const owner = has(input, "owner") ? normalized.owner || "" : current.owner;
  const writeDate = today();
  const timestamp = nowIso();

  const ids = await allIds(db);
  const newId = nextCardId(ids, category, compactDate(writeDate));
  const knownIds = new Set([...ids, newId]);
  const newCard: Card = {
    id: newId,
    kind: current.kind,
    version: 1,
    category,
    title,
    body,
    scope,
    sources,
    status: "有效",
    confirmed_by: OWNER_NAME,
    confirmed_at: writeDate,
    supersedes: [oldId],
    superseded_by: "",
    review_after: current.review_after,
    reason: normalized.reason,
    added_by: actor.name,
    options,
    owner,
    recorded_at: writeDate,
    created_by: actor.name,
    updated_by: actor.name,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
  };
  const newValidation = validateCard(newCard, { knownIds });
  if (!newValidation.ok) throw new CardValidationError(newValidation.errors);

  const oldNext: Card = {
    ...current,
    version: current.version + 1,
    status: "已推翻",
    superseded_by: newId,
    reason: normalized.reason,
    added_by: actor.name,
    updated_by: actor.name,
    updated_at: timestamp,
    recorded_at: writeDate,
  };
  const oldValidation = validateCard(oldNext, { knownIds });
  if (!oldValidation.ok) throw new CardValidationError(oldValidation.errors);

  const newRevision: CardRevision = {
    card_id: newCard.id,
    version: 1,
    action: "supersede",
    snapshot: newCard,
    reason: normalized.reason,
    actor: actor.name,
    created_at: timestamp,
  };
  const oldRevision: CardRevision = {
    card_id: oldNext.id,
    version: oldNext.version,
    action: "supersede",
    snapshot: oldNext,
    reason: normalized.reason,
    actor: actor.name,
    created_at: timestamp,
  };

  try {
    const results = await db.batch([
      revisionStatement(db, newRevision, { id: oldId, version: expectedVersion }),
      cardInsertStatement(db, newCard, { id: oldId, version: expectedVersion }),
      revisionStatement(db, oldRevision, { id: oldId, version: expectedVersion }),
      cardUpdateStatement(db, oldNext, expectedVersion),
    ]);
    const last = results?.[results.length - 1] as { meta?: { changes?: number } } | undefined;
    if (!last || Number(last.meta?.changes ?? 0) === 0) throw new CardConflictError(await getCard(db, oldId));
  } catch (error) {
    if (error instanceof CardConflictError) throw error;
    if (isConstraintError(error)) throw new CardConflictError(await getCard(db, oldId));
    throw error;
  }
  return { card: newCard, old: oldNext, revisions: [newRevision, oldRevision] };
}

type Transition = (card: Card) => Card;

async function transition(
  db: Db,
  id: string,
  expectedVersion: number,
  action: string,
  mutate: Transition,
  actor: CardActor,
  revisionReason: string,
): Promise<{ card: Card; revisions: CardRevision[] }> {
  const current = await getCard(db, id);
  if (!current) throw new CardNotFoundError(id);
  if (current.version !== expectedVersion) throw new CardConflictError(current);
  const next = mutate({ ...current, version: current.version + 1, updated_by: actor.name, added_by: actor.name, updated_at: nowIso() });
  next.recorded_at = today();
  const validation = validateCard(next, { knownIds: new Set(await allIds(db)) });
  if (!validation.ok) throw new CardValidationError(validation.errors);
  const revision = await commitVersion(db, next, action, revisionReason, expectedVersion, actor);
  return { card: next, revisions: [revision] };
}

export async function expireCard(db: Db, id: string, expectedVersion: number, reason: string, actor: CardActor) {
  return transition(db, id, expectedVersion, "expire", (card) => {
    if (card.deleted_at) throw new CardValidationError([{ field: "id", message: "卡片已删除" }]);
    card.status = "已过期";
    card.reason = reason || card.reason || "";
    return card;
  }, actor, reason || "");
}

export async function deleteCard(db: Db, id: string, expectedVersion: number, reason: string, actor: CardActor) {
  return transition(db, id, expectedVersion, "delete", (card) => {
    if (card.deleted_at) throw new CardValidationError([{ field: "id", message: "卡片已经删除" }]);
    card.deleted_at = nowIso();
    card.deleted_by = actor.name;
    card.delete_reason = reason || "";
    return card;
  }, actor, reason || "");
}

export async function restoreCard(db: Db, id: string, expectedVersion: number, actor: CardActor) {
  return transition(db, id, expectedVersion, "restore", (card) => {
    if (!card.deleted_at) throw new CardValidationError([{ field: "id", message: "卡片没有删除" }]);
    card.deleted_at = null;
    card.deleted_by = null;
    card.delete_reason = null;
    return card;
  }, actor, "");
}

export async function confirmCard(db: Db, id: string, expectedVersion: number, actor: CardActor) {
  return transition(db, id, expectedVersion, "confirm", (card) => {
    if (card.status !== "待确认") throw new CardValidationError([{ field: "status", message: "这条不是「待确认」状态" }]);
    card.status = "有效";
    card.confirmed_by = OWNER_NAME;
    card.confirmed_at = today();
    return card;
  }, actor, "");
}

export async function rejectCard(db: Db, id: string, expectedVersion: number, reason: string, actor: CardActor) {
  return transition(db, id, expectedVersion, "reject", (card) => {
    if (card.status !== "待确认") throw new CardValidationError([{ field: "status", message: "这条不是「待确认」状态" }]);
    card.status = "已推翻";
    card.superseded_by = "";
    card.reason = reason || "";
    return card;
  }, actor, reason || "");
}

