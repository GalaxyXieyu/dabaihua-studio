// lib.mjs — topic-kb 公共函数
// 只读素材，产物写在 TOPIC_KB_DIR（默认 daily-topics/kb/）下的库文件与 out/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// ---------- 路径常量 ----------
export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(ROOT, '..', '..');
export const DT = process.env.DIGEST_OUT_DIR || '/workspace/projects/daily-topics';
export const KB_DIR = process.env.TOPIC_KB_DIR || path.join(DT, 'kb');
export const DATA_DIR = KB_DIR;
export const DB_PATH = path.join(KB_DIR, 'topic-kb.sqlite');
export const OUT_DIR = path.join(KB_DIR, 'out');
export const MODELS_DIR = (process.env.TOPIC_KB_MODELS || path.join(os.homedir(), '.cache/topic-kb/models')) + path.sep;
export const COL = path.join(REPO_ROOT, 'collector/content-strategy/daily');
export const BACKUP_MD = '/workspace/projects/drafts/digest-backup-20260928/2026-09-28.md';
export const YU_DAILY = process.env.YU_DAILY_DIR || '/workspace/daily';
export const EMB_MODEL = 'Xenova/multilingual-e5-small';
export const EMB_DIM = 384;

export function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

// ---------- 简单 CLI 参数解析：--key value / --flag ----------
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ---------- 日期 ----------
export function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}
export function shanghaiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDate(d);
}
export function dayOfFile(name) {
  const m = String(name).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ---------- URL 归一化 ----------
export function normalizeUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  try {
    const url = new URL(s);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(k)) url.searchParams.delete(k);
    }
    let out = url.toString();
    out = out.replace(/\/$/, '');
    return out;
  } catch {
    return s.replace(/\/$/, '');
  }
}

// ---------- 机构识别（按 url host）----------
// 统一走 scripts/lib/vendor.mjs，保持 (url, source) 签名。
export { vendorOf as orgFromUrl } from '../lib/vendor.mjs';

// ---------- 实体抽取 ----------
// 词表：[规范名, 模式数组]；ASCII 模式按词边界匹配，含中文按子串匹配。
const CONCEPTS = [
  ['RAG', ['rag', '检索增强']],
  ['MCP', ['mcp', '模型上下文协议']],
  ['向量', ['向量', 'vector', 'embedding', '嵌入']],
  ['全文检索', ['全文检索', 'bm25']],
  ['混合检索', ['混合检索', 'hybrid search']],
  ['知识图谱', ['知识图谱', 'knowledge graph']],
  ['知识库', ['知识库']],
  ['记忆', ['记忆', 'memory']],
  ['上下文', ['上下文', 'context']],
  ['压缩', ['压缩', 'compact']],
  ['沙箱', ['沙箱', 'sandbox']],
  ['模型路由', ['模型路由', '路由', 'model routing', 'smart routing', 'router', '选模型', '模型选择']],
  ['网关', ['网关', 'gateway']],
  ['预算', ['预算', 'budget']],
  ['成本', ['成本', 'cost', '花费', '支出', 'spend', '省钱']],
  ['账单', ['账单', 'billing']],
  ['token', ['token']],
  ['权限', ['权限', 'permission', 'rbac']],
  ['审计', ['审计', 'audit']],
  ['安全', ['安全', 'security']],
  ['供应链', ['供应链', 'supply chain']],
  ['投毒', ['投毒']],
  ['评测', ['评测', '评估', 'evaluation', 'eval', 'benchmark', '基准']],
  ['多模态', ['多模态', 'multimodal']],
  ['视频', ['视频', 'video']],
  ['抽取', ['抽取', 'extract']],
  ['结构化', ['结构化', 'structured']],
  ['元数据', ['元数据', 'metadata']],
  ['过滤', ['过滤', 'filter']],
  ['护栏', ['护栏', 'guardrail']],
  ['来源', ['来源', 'source']],
  ['引用', ['引用', 'citation']],
  ['出处', ['出处']],
  ['溯源', ['溯源', 'provenance']],
  ['编码 Agent', ['编码 agent', 'coding agent', 'coding-agent', 'codex', 'claude code', 'cursor']],
  ['浏览器', ['浏览器', 'browser']],
  ['治理', ['治理', 'governance']],
  ['可观测', ['可观测', 'observability', 'opentelemetry']],
  ['追踪', ['追踪', 'tracing', 'trace']],
  ['员工', ['员工', '全员']],
  ['上线', ['上线', 'day 1', 'day1']],
  ['语义层', ['语义层', 'semantic layer', 'ontology']],
  ['问数', ['问数', 'text-to-sql', 'text2sql']],
  ['Postgres', ['postgres', 'postgresql']],
  ['SQLite', ['sqlite']],
  ['检索', ['检索', 'retrieval', 'search', '搜索']],
  ['重排', ['重排', 'rerank']],
  ['缓存', ['缓存', 'cache']],
  ['多 Agent', ['多 agent', 'multi-agent', 'multiagent']],
  ['工作流', ['工作流', 'workflow']],
  ['审批', ['审批', 'approval']],
  ['开源', ['开源', 'open source', 'open-source']],
  ['代码库', ['代码库', 'codebase', 'repo']],
];

const PROPER_STOP = new Set(
  ('the how what why with from building using your note day ai llm api this that when where which who and for are but not you can will its it in on at to of or as by an a is be we our us they their there here new use make made get got let may might must should could would do does did has have had was were being been about into over after before more most some such only also than then now just like one two three first best top guide intro build built run running work works test tests data model models series part post blog news update release announcing introducing getting right source fact agent agents').split(/\s+/)
);

function isAscii(p) {
  return /^[\x00-\x7F]+$/.test(p);
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function matchPattern(text, p) {
  if (isAscii(p)) {
    const re = new RegExp('(?<![a-z0-9])' + escapeRegExp(p) + '(?![a-z0-9])', 'i');
    return re.test(text);
  }
  return text.toLowerCase().includes(p.toLowerCase());
}

export function extractEntities(text, org = '') {
  const out = [];
  const seen = new Set();
  const put = (name, type) => {
    const k = name.toLowerCase();
    if (!name || seen.has(k)) return;
    seen.add(k);
    out.push({ name, type });
  };
  const t = String(text || '');
  for (const [canon, pats] of CONCEPTS) {
    if (out.length >= 12) break;
    if (pats.some((p) => matchPattern(t, p))) put(canon, 'concept');
  }
  const proper = t.match(/\b[A-Z][A-Za-z0-9]*(?:[ .-][A-Z0-9][A-Za-z0-9]*)*\b/g) || [];
  for (const p of proper) {
    if (out.length >= 12) break;
    const name = p.trim();
    if (name.length < 3) continue;
    if (PROPER_STOP.has(name.toLowerCase())) continue;
    put(name, 'product');
  }
  if (org) put(org, 'org');
  return out.slice(0, 12);
}

// ---------- 文本 / 嵌入 ----------
export function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}
export function docText(kind, d) {
  const body = [d.title_zh, d.title, d.summary].filter(Boolean).join(' ');
  return kind + ': ' + body.slice(0, 1200);
}

let _extractor = null;
export async function getExtractor() {
  if (_extractor) return _extractor;
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = MODELS_DIR;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  _extractor = await pipeline('feature-extraction', EMB_MODEL, { dtype: 'q8' });
  return _extractor;
}
export async function embedTexts(texts) {
  const ex = await getExtractor();
  const out = await ex(texts, { pooling: 'mean', normalize: true });
  return out.tolist();
}
export function blobToVec(buf) {
  if (!buf) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Float32Array(copy);
}
export function vecToBlob(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}
export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// ---------- 摘要合并 ----------
export function isBadSummary(s) {
  return !s || s.trim() === '' || /摘要生成失败/.test(s);
}
function cjkCount(s) {
  const m = String(s).match(/[\u4e00-\u9fff]/g);
  return m ? m.length : 0;
}
export function betterSummary(a, b) {
  const av = isBadSummary(a) ? '' : String(a);
  const bv = isBadSummary(b) ? '' : String(b);
  if (!av) return bv;
  if (!bv) return av;
  const ac = cjkCount(av), bc = cjkCount(bv);
  if (bc > ac) return bv;
  if (bc === ac && bv.length > av.length) return bv;
  return av;
}

// ---------- 库结构 ----------
export function openDb(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs(
      id INTEGER PRIMARY KEY, key TEXT UNIQUE, kind TEXT, url TEXT,
      title TEXT, title_zh TEXT, summary TEXT, org TEXT, source TEXT,
      pub_date TEXT, tags TEXT, first_seen TEXT, archive INTEGER DEFAULT 0,
      emb BLOB, emb_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS sightings(
      doc_id INTEGER, day TEXT, file TEXT, role TEXT,
      UNIQUE(doc_id, day, file, role)
    );
    CREATE TABLE IF NOT EXISTS topic_refs(
      topic_doc_id INTEGER, material_doc_id INTEGER,
      UNIQUE(topic_doc_id, material_doc_id)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
      title, title_zh, summary, tokenize='trigram'
    );
    CREATE TABLE IF NOT EXISTS entities(
      id INTEGER PRIMARY KEY, name TEXT UNIQUE, type TEXT
    );
    CREATE TABLE IF NOT EXISTS doc_entities(
      doc_id INTEGER, entity_id INTEGER, UNIQUE(doc_id, entity_id)
    );
    CREATE TABLE IF NOT EXISTS entity_edges(
      a INTEGER, b INTEGER, weight INTEGER, UNIQUE(a, b)
    );
    CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
    CREATE INDEX IF NOT EXISTS idx_docs_first_seen ON docs(first_seen);
    CREATE INDEX IF NOT EXISTS idx_sightings_day ON sightings(day);
  `);
  return db;
}

// ---------- 检索 ----------
function ftsQuery(entities) {
  const terms = entities.map((e) => e.name).filter((n) => n && [...n].length >= 3);
  if (!terms.length) return null;
  return terms.map((t) => '"' + t.replace(/"/g, '""') + '"').join(' OR ');
}

// 返回 [{doc, score, ranks:{fts,vec,graph}, shared:[], days:[]}]
export function findRelated(db, docId, { beforeDay, k = 5 } = {}) {
  const q = db.prepare('SELECT * FROM docs WHERE id=?').get(docId);
  if (!q) return [];
  const qUrl = normalizeUrl(q.url);
  const qEnts = db
    .prepare(
      'SELECT e.id, e.name, e.type FROM doc_entities de JOIN entities e ON e.id=de.entity_id WHERE de.doc_id=?'
    )
    .all(docId);
  const candidates = db
    .prepare('SELECT * FROM docs WHERE first_seen IS NOT NULL AND first_seen < ? AND id != ?')
    .all(beforeDay, docId)
    .filter((d) => {
      if (q.title && d.title && d.title === q.title) return false;
      if (qUrl && d.url && normalizeUrl(d.url) === qUrl) return false;
      return true;
    });
  const candIds = new Set(candidates.map((d) => d.id));
  const routes = { fts: [], vec: [], graph: [] };

  // 1) 全文 FTS
  const mq = ftsQuery(qEnts);
  if (mq) {
    try {
      const rows = db
        .prepare('SELECT rowid AS id, bm25(docs_fts) AS s FROM docs_fts WHERE docs_fts MATCH ? ORDER BY s LIMIT 50')
        .all(mq);
      for (const r of rows) if (candIds.has(r.id)) routes.fts.push(r.id);
    } catch (e) {
      // trigram 对某些查询可能报错，忽略该路
    }
  }

  // 2) 向量
  const qv = blobToVec(q.emb);
  if (qv) {
    const scored = [];
    for (const d of candidates) {
      const v = blobToVec(d.emb);
      if (!v) continue;
      scored.push([d.id, dot(qv, v)]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    routes.vec = scored.slice(0, 50).map((x) => x[0]);
  }

  // 3) 图：加权重叠
  const idf = new Map();
  if (qEnts.length) {
    const N = db.prepare('SELECT COUNT(*) c FROM docs').get().c || 1;
    const dfs = new Map(
      db.prepare('SELECT entity_id, COUNT(*) c FROM doc_entities GROUP BY entity_id').all().map((r) => [r.entity_id, r.c])
    );
    const owners = new Map(); // entity_id -> [doc_id]
    for (const r of db.prepare('SELECT doc_id, entity_id FROM doc_entities').all()) {
      if (!owners.has(r.entity_id)) owners.set(r.entity_id, []);
      owners.get(r.entity_id).push(r.doc_id);
    }
    const acc = new Map();
    for (const e of qEnts) {
      // 概念词全权重；机构/专名只给 0.4，避免「同一家厂商」压过「同一类问题」
      const w = Math.log(N / (dfs.get(e.id) || 1)) * (e.type === 'concept' ? 1 : 0.4);
      idf.set(e.id, w);
      for (const did of owners.get(e.id) || []) {
        if (did === docId || !candIds.has(did)) continue;
        if (!acc.has(did)) acc.set(did, { score: 0, shared: new Set() });
        const a = acc.get(did);
        a.score += w;
        a.shared.add(e.name);
      }
    }
    routes.graph = [...acc.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 50).map((x) => x[0]);
    for (const [did, a] of acc) idf.set('shared:' + did, [...a.shared]);
  }

  // RRF 融合
  const RRF_K = 60;
  const merged = new Map();
  const ensure = (id) => {
    if (!merged.has(id)) merged.set(id, { id, score: 0, ranks: {}, shared: [], days: [] });
    return merged.get(id);
  };
  for (const [route, list] of Object.entries(routes)) {
    list.forEach((id, i) => {
      const m = ensure(id);
      m.score += 1 / (RRF_K + i + 1);
      m.ranks[route] = i + 1;
    });
  }
  const all = [...merged.values()].sort((a, b) => b.score - a.score);
  const orgCount = new Map();
  const topicCount = { n: 0 };
  const seenTitles = new Set();
  const normT = (t) => String(t || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  const result = [];
  for (const m of all) {
    if (result.length >= k) break;
    const doc = candidates.find((d) => d.id === m.id);
    if (!doc) continue;
    const tkey = normT(doc.title_zh || doc.title);
    if (tkey && seenTitles.has(tkey)) continue; // md/json 里同一个题只留一条
    const org = doc.org || '';
    if ((orgCount.get(org) || 0) >= 2) continue;
    if (doc.kind === 'topic' && topicCount.n >= 2) continue;
    orgCount.set(org, (orgCount.get(org) || 0) + 1);
    if (doc.kind === 'topic') topicCount.n++;
    if (tkey) seenTitles.add(tkey);
    m.doc = doc;
    m.shared = idf.get('shared:' + m.id) ? [...idf.get('shared:' + m.id)] : [];
    m.days = db.prepare('SELECT DISTINCT day FROM sightings WHERE doc_id=? ORDER BY day').all(m.id).map((r) => r.day);
    result.push(m);
  }
  return result;
}

// ---------- 通用小工具 ----------
export function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
export function writeOut(name, content) {
  ensureDirs();
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, content);
  return p;
}
export function snippet(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}
