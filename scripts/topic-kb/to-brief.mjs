// to-brief.mjs — 把 merge 结果转成简报页 version 1 JSON
//
// 用法：
//   node scripts/topic-kb/to-brief.mjs --date D [--in <kb-topics.json>] [--out <file>]
//        [--keep-news-from <brief.json>] [--force]
//
// 只取 valid 的题；目标文件已存在且没给 --force 时报错退出（不覆盖）。
// 写之前用 lib/daily-brief-core.ts 的 validateBrief 校验。
import fs from 'node:fs';
import path from 'node:path';
import { DT, OUT_DIR, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const DATE = args.date;
if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error('用法: node to-brief.mjs --date YYYY-MM-DD [--in <kb-topics.json>] [--out <file>] [--keep-news-from <brief.json>] [--force]');
  process.exit(1);
}

const inPath = args.in || path.join(OUT_DIR, `${DATE}-kb-topics.json`);
const outPath = args.out || path.join(DT, `${DATE}-topics.json`);
const KEEP_NEWS = args['keep-news-from'] || null;

if (fs.existsSync(outPath) && !args.force) {
  console.error(`目标已存在，不覆盖：${outPath}（要覆盖请加 --force）`);
  process.exit(3);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(inPath, 'utf8'));
} catch (e) {
  console.error(`读不了 merge 结果 ${inPath}：${e.message}`);
  process.exit(1);
}

const allTopics = Array.isArray(data.topics) ? data.topics : [];
const validTopics = allTopics.filter((t) => t && t.valid);
if (!validTopics.length) {
  console.error('没有通过校验的题，无法生成简报');
  process.exit(4);
}

// ref -> 素材（用于把 N*/P* 编号换成人能看懂的名字）
const refMap = new Map();
for (const t of allTopics) {
  for (const m of t.materials || []) {
    if (m && m.ref && !refMap.has(m.ref)) refMap.set(m.ref, m);
  }
}

const isNewMat = (m) => m.isNew === true || (/^N\d+$/.test(String(m.ref || '')) && String(m.day || '') === DATE);

function refName(ref) {
  const m = refMap.get(ref);
  if (!m) return ref;
  const org = String(m.org || '').trim();
  if (org) return org;
  return String(m.title || '').slice(0, 16);
}

function refCite(ref) {
  const m = refMap.get(ref);
  if (!m) return ref;
  const day = String(m.day || '').slice(5);
  const org = String(m.org || '').trim();
  const title = String(m.title || '').slice(0, 24);
  const head = org ? `${day} ${org}` : day;
  return `${head}《${title}》`;
}

// 把正文里的 N*/P* 换成人能看懂的名字；「Yu YYYY-MM-DD 日报」原样保留。
function humanize(text) {
  if (!text) return '';
  return String(text)
    .split(/(Yu\s+\d{4}-\d{2}-\d{2}\s+日报)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/\b([NP]\d+)\b/g, (ref) => refName(ref))))
    .join('');
}

// 「依据：」里的编号换成 MM-DD org《标题前 24 字》，多个用「；」连接。
function basisCite(basis) {
  const s = String(basis || '').replace(/^依据[：:]\s*/, '');
  const refs = s.match(/\b[NP]\d+\b/g) || [];
  if (refs.length) return refs.map(refCite).join('；');
  return s;
}

function buildDetail(t) {
  const lines = [];
  const ch = t.change || {};
  const changeLines = [];
  if (String(ch.before || '').trim()) changeLines.push(`- **以前**：${humanize(ch.before)}`);
  if (String(ch.now || '').trim()) changeLines.push(`- **现在**：${humanize(ch.now)}`);
  if (String(ch.why || '').trim()) changeLines.push(`- **为什么变**：${humanize(ch.why)}`);
  if (changeLines.length) lines.push('## 变化', ...changeLines);

  const meth = (Array.isArray(t.methodology) ? t.methodology : []).filter((x) => String(x || '').trim());
  if (meth.length) lines.push('## 方法论', ...meth.map((x, i) => `${i + 1}. ${humanize(x)}`));

  const crit = (Array.isArray(t.criteria) ? t.criteria : []).filter((c) => c && String(c.when || '').trim() && String(c.then || '').trim());
  if (crit.length) {
    lines.push('## 判断标准');
    for (const c of crit) {
      const when = humanize(String(c.when || '')).replace(/^当\s*/, '');
      const then = humanize(String(c.then || ''));
      const basis = basisCite(c.basis);
      const suffix = basis ? `（依据：${basis}）` : '';
      lines.push(`- **${when}** → ${then}${suffix}`);
    }
  }

  const compare = (Array.isArray(t.compare) ? t.compare : []).filter((c) => c && (String(c.org || '').trim() || String(c.approach || '').trim()));
  const multi = [];
  if (String(t.question || '').trim()) multi.push(`- **一线问题**：${humanize(t.question)}`);
  if (String(t.consensus || '').trim()) multi.push(`- **共识**：${humanize(t.consensus)}`);
  if (String(t.divergence || '').trim()) multi.push(`- **分歧**：${humanize(t.divergence)}`);
  for (const c of compare) {
    const num = String(c.number || '').trim();
    const tail = num ? `（${num}）` : '';
    multi.push(`- **各家做法**：${c.org || ''}：${c.approach || ''}${tail}`);
  }
  if (multi.length) lines.push('## 多篇对照', ...multi);
  return lines.join('\n');
}

function buildMaterials(t) {
  const raw = (Array.isArray(t.materials) ? t.materials : []).filter((m) => m && m.ref);
  const orderOf = (m) => (isNewMat(m) ? 0 : /^N\d+$/.test(String(m.ref || '')) ? 1 : 2);
  return raw
    .map((m, index) => ({ m, index }))
    .sort((a, b) => orderOf(a.m) - orderOf(b.m) || a.index - b.index)
    .map(({ m }) => {
      const day = String(m.day || '').slice(5);
      const org = String(m.org || '').trim();
      const title = String(m.title || '');
      const label = [day, org, title].filter(Boolean).join(' · ');
      const item = { title: label, summary: String(m.summary || '').slice(0, 300) };
      if (/^https?:\/\//i.test(String(m.url || ''))) item.url = m.url;
      return item;
    });
}

function buildNote(t) {
  const mats = (Array.isArray(t.materials) ? t.materials : []).filter((m) => m && m.ref);
  const n = mats.length;
  const a = mats.filter(isNewMat).length;
  const b = n - a;
  const days = mats.map((m) => String(m.day || '')).filter(Boolean).sort();
  const span = days.length ? `；首见 ${days[0]} ~ ${days[days.length - 1]}` : '';
  return `合并 ${n} 篇：当天新 ${a}、往期 ${b}${span}`;
}

const kbTopics = validTopics.map((t, i) => ({
  id: `kb-${i + 1}`,
  type: '落地题',
  label: `选题${i + 1}`,
  title: String(t.title || ''),
  oneLiner: humanize(t.oneLiner || ''),
  detail: buildDetail(t),
  scenarios: String(t.yuAngle || '').trim() ? [humanize(t.yuAngle)] : [],
  questions: (Array.isArray(t.questions) ? t.questions : [])
    .filter((q) => String(q || '').trim())
    .slice(0, 2)
    .map((q) => humanize(q)),
  materials: buildMaterials(t),
  note: buildNote(t),
}));

// --keep-news-from：把已有的新闻题原样放在最前面。
const newsTopics = [];
let recommendation = null;
if (KEEP_NEWS) {
  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(KEEP_NEWS, 'utf8'));
  } catch (e) {
    console.error(`读不了 --keep-news-from ${KEEP_NEWS}：${e.message}`);
    process.exit(1);
  }
  for (const t of existing.topics || []) {
    if (t && t.type === '新闻题') newsTopics.push(t);
  }
  if (existing.recommendation && newsTopics.some((t) => t.id === existing.recommendation.topicId)) {
    recommendation = existing.recommendation;
  }
}

const topics = [...newsTopics, ...kbTopics];

// notes：没通过校验的题 + 模型 / token 用量
const invalid = allTopics.filter((t) => t && !t.valid);
const usage = Array.isArray(data.usage) ? data.usage : [];
let totalTokens = 0;
for (const u of usage) totalTokens += Number(u?.totalTokens || 0);
const noteLines = [];
if (invalid.length) {
  noteLines.push('未通过校验：');
  for (const t of invalid) {
    const problems = (t.problems || []).slice(0, 2).join('；');
    noteLines.push(`- ${t.title || t.id || '?'}：${problems}`);
  }
} else {
  noteLines.push('全部题目通过校验。');
}
noteLines.push(`模型 ${data.model || '未知'}；token ${totalTokens}（调用 ${usage.length} 次）`);

const brief = {
  version: 1,
  date: DATE,
  title: `大白话讲AI · 每日选题简报 ${DATE}`,
  intro: '知识库合并选题：每题至少合并 2 家来源、含 1 篇往期素材，写清变化、方法论和判断标准。',
  recommendation,
  topics,
  notes: noteLines.join('\n'),
  sources: [`${DATE}.md`, `kb/out/${DATE}-kb-topics.json`],
};

const { validateBrief } = await import('../../lib/daily-brief-core.ts');
const check = validateBrief(brief);
if (!check.ok) {
  console.error('简报校验失败：');
  for (const error of check.errors) console.error(`  - ${error}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const tmp = `${outPath}.tmp`;
fs.writeFileSync(tmp, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
fs.renameSync(tmp, outPath);
console.log(`BRIEF_JSON=${outPath}`);
console.log('题目标题：');
for (const t of topics) console.log(`- ${t.id} ${t.title}`);
