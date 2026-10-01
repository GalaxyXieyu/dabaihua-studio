#!/usr/bin/env node
/**
 * cards-import-handbook.mjs — 一次性把 handbook 的 entries.jsonl / inbox.jsonl 导入 D1 cards。
 *
 * Node >= 22.18 自带 TypeScript 类型擦除，可直接 import ../lib/cards-core.ts；
 * 更老的 22.x 需要 `node --experimental-strip-types scripts/cards-import-handbook.mjs`。
 *
 * 用法：
 *   node scripts/cards-import-handbook.mjs --entries <entries.jsonl> [--inbox <inbox.jsonl>]
 *        [--db <d1.sqlite>] [--dry-run] [--replace]
 *
 * 路径都从参数来，脚本里不写死 /workspace/handbook。--db 缺省用环境变量
 * CARDS_D1_PATH，再缺省时探测仓库下 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite。
 *
 * 每一版写一条 card_revisions（历史只增不改），每个 id 的最新版写 cards。
 * 先对每张卡最新版跑 validateCard，有错只打印 id + 字段 + 文案（不打印标题正文）并退出 1。
 * 默认跳过已存在的 id；--replace 时先删该 id 再重导。整段在一个事务里。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { CARDS_SCHEMA_STATEMENTS, CARD_COLUMNS, cardToRow, isDate, validateCard } from "../lib/cards-core.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARD_COLUMNS_LIST = [...CARD_COLUMNS];
const INSERT_CARD_SQL = `INSERT INTO cards (${CARD_COLUMNS_LIST.join(", ")}) VALUES (${CARD_COLUMNS_LIST.map(() => "?").join(", ")})`;
const INSERT_REVISION_SQL =
  "INSERT INTO card_revisions (card_id, version, action, snapshot_json, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)";

function parseArgs(argv) {
  const options = { dryRun: false, replace: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--entries") options.entries = argv[++index];
    else if (arg === "--inbox") options.inbox = argv[++index];
    else if (arg === "--db") options.db = argv[++index];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--replace") options.replace = true;
    else {
      process.stderr.write(`未知参数：${arg}\n`);
      process.exit(1);
    }
  }
  return options;
}

function resolveDbPath(options) {
  if (options.db) return options.db;
  if (process.env.CARDS_D1_PATH) return process.env.CARDS_D1_PATH;
  const dir = path.join(REPO_ROOT, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  try {
    const candidate = readdirSync(dir)
      .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite")
      .sort()[0];
    return candidate ? path.join(dir, candidate) : "";
  } catch {
    return "";
  }
}

function readJsonl(file) {
  if (!file) return [];
  if (!existsSync(file)) {
    process.stderr.write(`读不到文件：${file}\n`);
    process.exit(1);
  }
  const rows = [];
  const text = readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (error) {
      process.stderr.write(`${file} 第 ${index + 1} 行 JSON 解析失败：${error.message}\n`);
      process.exit(1);
    }
  });
  return rows;
}

const asArray = (value) => (Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : String(item ?? ""))) : []);

/** 合并两个账本：按 id 分组、按 version 升序；同 id 同 version 以 entries 为准。 */
function mergeRows(entriesRows, inboxRows) {
  const byKey = new Map();
  const order = [];
  const sources = new Map();
  const add = (row, source) => {
    const id = row && typeof row.id === "string" ? row.id : "";
    if (!id) {
      process.stderr.write("有记录缺 id\n");
      process.exit(1);
    }
    const version = Number.isInteger(row.version) ? row.version : 0;
    const key = `${id}#${version}`;
    const seen = sources.get(key) || new Set();
    if (seen.has(source)) {
      process.stderr.write(`重复版本：${id} v${version}\n`);
      process.exit(1);
    }
    seen.add(source);
    sources.set(key, seen);
    if (!byKey.has(key)) {
      byKey.set(key, row);
      order.push(key);
    } else if (source === "entries") {
      byKey.set(key, row);
    }
  };
  entriesRows.forEach((row) => add(row, "entries"));
  inboxRows.forEach((row) => add(row, "inbox"));

  const groups = new Map();
  for (const key of order) {
    const row = byKey.get(key);
    if (!groups.has(row.id)) groups.set(row.id, []);
    groups.get(row.id).push(row);
  }
  for (const rows of groups.values()) rows.sort((a, b) => Number(a.version || 0) - Number(b.version || 0));
  return groups;
}

function buildCard(row, firstAddedBy, index) {
  const recorded = typeof row.recorded_at === "string" && isDate(row.recorded_at) ? row.recorded_at : "1970-01-01";
  const createdAt = new Date(new Date(`${recorded}T00:00:00+08:00`).getTime() + index * 1000).toISOString();
  const sources = Array.isArray(row.sources)
    ? row.sources
        .filter((source) => source && typeof source === "object")
        .map((source) => ({ agent: String(source.agent ?? ""), date: String(source.date ?? ""), ref: String(source.ref ?? "") }))
    : [];
  return {
    id: String(row.id ?? ""),
    kind: "mirror",
    version: Number(row.version ?? 1),
    category: String(row.category ?? ""),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    scope: asArray(row.scope),
    sources,
    status: String(row.status ?? ""),
    confirmed_by: String(row.confirmed_by ?? ""),
    confirmed_at: String(row.confirmed_at ?? ""),
    supersedes: asArray(row.supersedes),
    superseded_by: String(row.superseded_by ?? ""),
    review_after: String(row.review_after ?? ""),
    reason: String(row.reason ?? ""),
    added_by: String(row.added_by ?? ""),
    options: asArray(row.options),
    owner: String(row.owner ?? ""),
    recorded_at: String(row.recorded_at ?? ""),
    created_by: firstAddedBy,
    updated_by: String(row.added_by ?? ""),
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
  };
}

/** 由前后两版状态推断 action。 */
function inferAction(previous, row) {
  if (!previous) return "add";
  const previousStatus = String(previous.status ?? "");
  const status = String(row.status ?? "");
  if (previousStatus === "待确认" && status === "有效") return "confirm";
  if (status === "已推翻" && String(row.superseded_by ?? "") !== "") return "supersede";
  if (previousStatus === "待确认" && status === "已推翻" && String(row.superseded_by ?? "") === "") return "reject";
  if (status === "已过期") return "expire";
  return "edit";
}

function groupCards(rows) {
  const firstAddedBy = String(rows[0].added_by ?? "");
  const cards = rows.map((row, index) => buildCard(row, firstAddedBy, index));
  // created_at 是第一版的时间，updated_at 是这一版的时间。
  for (const card of cards) card.created_at = cards[0].created_at;
  return cards;
}

function groupRevisions(rows, cards) {
  return cards.map((card, index) => ({
    card_id: card.id,
    version: card.version,
    action: inferAction(index > 0 ? rows[index - 1] : null, rows[index]),
    snapshot: card,
    reason: card.reason,
    actor: card.added_by,
    created_at: card.updated_at,
  }));
}

function countWarnings(groups) {
  let warnings = 0;
  for (const rows of groups.values()) {
    const numbers = rows.map((row) => Number(row.version || 0)).sort((a, b) => a - b);
    for (let index = 1; index < numbers.length; index += 1) {
      if (numbers[index] - numbers[index - 1] !== 1) warnings += 1;
    }
  }
  return warnings;
}

function insertCard(db, card) {
  const row = cardToRow(card);
  db.prepare(INSERT_CARD_SQL).run(...CARD_COLUMNS_LIST.map((column) => row[column]));
}

function insertRevision(db, revision) {
  db.prepare(INSERT_REVISION_SQL).run(
    revision.card_id,
    revision.version,
    revision.action,
    JSON.stringify(revision.snapshot),
    revision.reason,
    revision.actor,
    revision.created_at,
  );
}

function existingId(db, id) {
  try {
    return db.prepare("SELECT id FROM cards WHERE id = ?").get(id);
  } catch {
    return null;
  }
}

function importInto(db, groups, { replace }) {
  const stats = { added: 0, skipped: 0, revisions: 0 };
  db.exec("BEGIN");
  try {
    for (const [id, rows] of groups) {
      if (existingId(db, id) && !replace) {
        stats.skipped += 1;
        continue;
      }
      if (replace) {
        db.prepare("DELETE FROM card_revisions WHERE card_id = ?").run(id);
        db.prepare("DELETE FROM cards WHERE id = ?").run(id);
      }
      const cards = groupCards(rows);
      const revisions = groupRevisions(rows, cards);
      for (const revision of revisions) {
        insertRevision(db, revision);
        stats.revisions += 1;
      }
      insertCard(db, cards[cards.length - 1]);
      stats.added += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return stats;
}

function countOnly(db, groups) {
  const stats = { added: 0, skipped: 0, revisions: 0 };
  for (const [id, rows] of groups) {
    if (existingId(db, id)) stats.skipped += 1;
    else stats.added += 1;
    stats.revisions += groupCards(rows).length;
  }
  return stats;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.entries && !options.inbox) {
    process.stderr.write("至少需要 --entries 或 --inbox\n");
    process.exit(1);
  }
  const groups = mergeRows(readJsonl(options.entries), readJsonl(options.inbox));
  const knownIds = new Set(groups.keys());
  const warnings = countWarnings(groups);

  let failed = false;
  for (const [id, rows] of groups) {
    const cards = groupCards(rows);
    const result = validateCard(cards[cards.length - 1], { knownIds });
    if (!result.ok) {
      failed = true;
      for (const error of result.errors) process.stderr.write(`${id} ${error.field} ${error.message}\n`);
    }
  }
  if (failed) process.exit(1);

  const dbPath = resolveDbPath(options);
  if (!dbPath) {
    process.stderr.write("找不到 D1 sqlite，请用 --db 或 CARDS_D1_PATH 指定\n");
    process.exit(1);
  }

  let stats;
  if (options.dryRun) {
    if (existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        stats = countOnly(db, groups);
      } finally {
        db.close();
      }
    } else {
      stats = {
        added: groups.size,
        skipped: 0,
        revisions: [...groups.values()].reduce((total, rows) => total + rows.length, 0),
      };
    }
  } else {
    const db = new DatabaseSync(dbPath);
    try {
      for (const sql of CARDS_SCHEMA_STATEMENTS) db.exec(sql);
      stats = importInto(db, groups, { replace: options.replace });
    } finally {
      db.close();
    }
  }

  process.stdout.write(`cards: 新增 ${stats.added} / 跳过 ${stats.skipped}；revisions: ${stats.revisions}；警告 ${warnings}\n`);
}

main();
