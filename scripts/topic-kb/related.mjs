// related.mjs — 对当天新素材列出以前收过的同类条目
import { openDb, findRelated, writeOut, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const DATE = args.date;
const K = Number(args.k || 5);
const AS_JSON = !!args.json;
if (!DATE) { console.error('用法: node related.mjs --date YYYY-MM-DD [--k 5] [--json]'); process.exit(1); }

const db = openDb();

// 当天新素材 = 当天有 role in (ganhuo, news) sighting 的 material doc
const news = db.prepare(`
  SELECT DISTINCT d.* FROM docs d
  JOIN sightings s ON s.doc_id = d.id
  WHERE s.day = ? AND s.role IN ('ganhuo','news') AND d.kind = 'material'
  ORDER BY d.id
`).all(DATE);

const label = (d) => d.title_zh || d.title || ('doc#' + d.id);
const shown = (d) => (d.title_zh || d.title || '').replace(/\|/g, '\\|');

const lines = [];
const jsonOut = { date: DATE, generatedBy: 'dabaihua-topic-kb', items: [] };
lines.push(`# ${DATE} 新素材 × 以前收过的同类条目`);
lines.push('');
if (!news.length) {
  lines.push('（当天没有 role=ganhuo/news 的素材）');
}

news.forEach((q, i) => {
  const isNew = q.first_seen === DATE;
  const allDays = db.prepare('SELECT DISTINCT day FROM sightings WHERE doc_id=? ORDER BY day').all(q.id).map((r) => r.day);
  const labelTxt = isNew ? '新' : `重复（首见 ${q.first_seen}，已在 ${allDays.join('、')} 出现）`;
  lines.push(`## N${i + 1} ${shown(q) || label(q)}（${q.org || '未知'} · 首见 ${q.first_seen} · ${labelTxt}）`);
  const rel = findRelated(db, q.id, { beforeDay: DATE, k: K });
  const item = { docId: q.id, title: label(q), org: q.org, firstSeen: q.first_seen, isNew, related: [] };
  if (!rel.length) lines.push('- （库里没有同类条目）');
  rel.forEach((r, j) => {
    const rd = r.doc;
    const ranks = ['fts', 'vec', 'graph']
      .map((x) => (r.ranks[x] ? `${x} ${r.ranks[x]}` : null))
      .filter(Boolean)
      .join(' / ');
    const shared = r.shared && r.shared.length ? r.shared.join('、') : '无';
    lines.push(
      `- 相关 ${j + 1}：${rd.first_seen} · ${rd.kind} · ${rd.org || '未知'} · ${shown(rd) || label(rd)}  — 共享：${shared}；score ${r.score.toFixed(3)}（${ranks || '无'}）`
    );
    item.related.push({
      docId: rd.id, day: rd.first_seen, kind: rd.kind, org: rd.org,
      title: label(rd), url: rd.url, score: Number(r.score.toFixed(4)),
      ranks: r.ranks, shared: r.shared, days: r.days,
    });
  });
  lines.push('');
  jsonOut.items.push(item);
});

const md = lines.join('\n') + '\n';
const mdPath = writeOut(`${DATE}-related.md`, md);
let jsonPath = null;
if (AS_JSON) jsonPath = writeOut(`${DATE}-related.json`, JSON.stringify(jsonOut, null, 2) + '\n');

process.stdout.write(md);
console.log(`\n[written] ${mdPath}${jsonPath ? ' / ' + jsonPath : ''}`);
db.close();
