// ingest.mjs — 解析素材 → upsert docs/sightings → 重建实体与 FTS → 计算嵌入
import fs from 'node:fs';
import path from 'node:path';
import {
  DT, COL, BACKUP_MD, DB_PATH, EMB_MODEL,
  openDb, normalizeUrl, orgFromUrl, extractEntities, sha1, docText,
  embedTexts, vecToBlob, betterSummary, isBadSummary,
  parseArgs, dayOfFile, ensureDirs, shanghaiToday,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const SINCE = args.since || '2000-01-01';
const UNTIL = args.until || shanghaiToday();
const NO_ARCHIVE = !!args['no-archive'];
const DB = args.db || DB_PATH;

// ---------- markdown 分块 ----------
function parseSections(content) {
  const lines = String(content).replace(/\r/g, '').split('\n');
  const sections = [];
  let sec = null;
  let block = null;
  const pushBlock = () => { if (block && sec) sec.blocks.push(block); block = null; };
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)$/);
    const h3 = line.match(/^###\s+(.*)$/);
    if (h2) { pushBlock(); sec = { heading: h2[1].trim(), lines: [], blocks: [] }; sections.push(sec); continue; }
    if (h3) {
      pushBlock();
      if (!sec) { sec = { heading: '', lines: [], blocks: [] }; sections.push(sec); }
      block = { heading: h3[1].trim(), lines: [] };
      continue;
    }
    if (block) block.lines.push(line);
    else if (sec) sec.lines.push(line);
  }
  pushBlock();
  return sections;
}
const linksIn = (lines) => {
  const out = [];
  for (const l of lines) {
    const re = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
    let m;
    while ((m = re.exec(l))) out.push(m[2]);
  }
  return out;
};

// ---------- 文件 1 / 6：每日素材（干货 + 推荐选题）----------
function parseDigestMd(content, day, file, role, opts = {}) {
  const records = [];
  const base = path.basename(file);
  for (const sec of parseSections(content)) {
    if (sec.heading.includes('今日干货')) {
      let n = 0;
      for (const b of sec.blocks) {
        n++;
        const titleZh = b.heading.replace(/^\d+[.、]\s*/, '').trim();
        let url = '', title = '', source = '', pubDate = '', tags = '';
        const body = [];
        for (const l of b.lines) {
          let m;
          if ((m = l.match(/^-\s*原文：\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/))) {
            title = m[1].trim(); url = m[2];
          } else if ((m = l.match(/^-\s*来源：(.+?)(?:\s*·\s*(\d{4}-\d{2}-\d{2}))?\s*$/))) {
            source = m[1].trim(); pubDate = m[2] || '';
          } else if ((m = l.match(/^-\s*标签：(.+)$/))) {
            tags = m[1].trim();
          } else if (!l.startsWith('- ')) {
            if (l.trim()) body.push(l.trim());
          }
        }
        const summary = body.join('\n');
        const key = url ? normalizeUrl(url) : `${base}#ganhuo${n}`;
        records.push({
          key, kind: 'material', url, title, title_zh: titleZh, summary,
          org: orgFromUrl(url, source), source, pub_date: pubDate, tags,
          archive: opts.archive ? 1 : 0, sighting: { day, file, role },
          refs: [],
        });
      }
    } else if (sec.heading.includes('推荐选题')) {
      let n = 0;
      for (const b of sec.blocks) {
        const m = b.heading.match(/^选题\s*(\d+)/);
        if (!m) continue;
        n = m[1];
        const title = b.heading.split(/[：:]/).slice(1).join('：').trim();
        const core = (b.lines.join('\n').match(/-\s*\*\*核心观点\*\*[：:]\s*([^\n]+)/) || [])[1] || '';
        const cs = (b.lines.join('\n').match(/-\s*\*\*贯穿案例\*\*[：:]\s*([^\n]+)/) || [])[1] || '';
        records.push({
          key: `${base}#选题${n}`, kind: 'topic', url: '', title,
          title_zh: '', summary: [core, cs].filter(Boolean).join(' '),
          org: '', source: '', pub_date: '', tags: '',
          archive: opts.archive ? 1 : 0, sighting: { day, file, role: opts.topicRole || 'topic' },
          refs: linksIn(b.lines),
        });
      }
    }
  }
  return records;
}

// ---------- 文件 2：today-topics.md ----------
function parseTopicsMd(content, day, file) {
  const records = [];
  const base = path.basename(file);
  for (const sec of parseSections(content)) {
    if (sec.heading.includes('素材')) {
      // (a) ### 素材N. 标题
      for (const b of sec.blocks) {
        const m = b.heading.match(/^素材\s*(\d+)[.、]\s*(.+)$/);
        if (!m) continue;
        const n = m[1];
        let url = '', source = '';
        const body = [];
        for (const l of b.lines) {
          let mm;
          if ((mm = l.match(/^来源[：:]\s*(.+)$/))) source = mm[1].trim();
          else if ((mm = l.match(/^链接[：:]\s*(\S+)/))) url = url || mm[1];
          else if (l.trim() && !l.startsWith('- ') && !l.startsWith('#')) body.push(l.trim());
        }
        records.push({
          key: url ? normalizeUrl(url) : `${base}#素材${n}`, kind: 'material', url,
          title: m[2].trim(), title_zh: '', summary: body.join('\n'),
          org: orgFromUrl(url, source), source, pub_date: '', tags: '',
          archive: 0, sighting: { day, file, role: 'topics-material' }, refs: [],
        });
      }
      // (b) N. 摘要文字 + 链接：url
      let cur = null;
      const flush = () => {
        if (!cur) return;
        records.push({
          key: cur.url ? normalizeUrl(cur.url) : `${base}#m${cur.n}`, kind: 'material', url: cur.url,
          title: '', title_zh: '', summary: cur.summary, org: orgFromUrl(cur.url, ''),
          source: '', pub_date: '', tags: '', archive: 0,
          sighting: { day, file, role: 'topics-material' }, refs: [],
        });
        cur = null;
      };
      for (const l of sec.lines) {
        const m = l.match(/^(\d+)[.、]\s*(.+)$/);
        const link = l.match(/^链接[：:]\s*(\S+)/);
        if (m) { flush(); cur = { n: m[1], summary: m[2].trim(), url: '' }; }
        else if (link && cur) { cur.url = cur.url || link[1]; }
        else if (cur && l.trim() && !l.match(/^来源[：:]/)) cur.summary += ' ' + l.trim();
      }
      flush();
    } else {
      // 推荐选题块（09-30/10-01 混合格式）
      for (const b of sec.blocks) {
        if (!/^(选题|新闻主选题|新闻备选|新闻)/.test(b.heading)) continue;
        const m = b.heading.match(/^(.*?)(?:（([^）]+)）)?[：:]\s*(.*)$/);
        if (!m) continue;
        const id = (m[2] || m[1]).trim();
        const title = (m[3] || '').trim();
        const txt = b.lines.join('\n');
        const one = (txt.match(/-\s*\*\*(?:核心观点|一句话)\*\*[：:]\s*([^\n]+)/) || [])[1] || '';
        if (!title && !one) continue;
        records.push({
          key: `${base}#${id}`, kind: 'topic', url: '', title, title_zh: '',
          summary: one, org: '', source: '', pub_date: '', tags: '',
          archive: 0, sighting: { day, file, role: 'topic' }, refs: [],
        });
      }
    }
  }
  return records;
}

// ---------- 文件 3：topics.json ----------
function parseTopicsJson(content, day, file) {
  const records = [];
  const base = path.basename(file);
  let data;
  try { data = JSON.parse(content); } catch (e) { throw new Error('json parse: ' + e.message); }
  for (const t of data.topics || []) {
    const id = t.id || `t${records.length}`;
    const summary = [t.oneLiner, (t.detail || '').slice(0, 300)].filter(Boolean).join(' ');
    const refs = [];
    for (const m of t.materials || []) {
      const url = m.url || '';
      const key = url ? normalizeUrl(url) : `${base}#${id}-m${refs.length}`;
      records.push({
        key, kind: 'material', url, title: m.title || '', title_zh: '',
        summary: m.summary || '', org: orgFromUrl(url, ''), source: '',
        pub_date: '', tags: '', archive: 0,
        sighting: { day, file, role: 'topics-material' }, refs: [],
      });
      if (url) refs.push(url);
    }
    records.push({
      key: `${base}#${id}`, kind: 'topic', url: '', title: t.title || '',
      title_zh: '', summary, org: '', source: '', pub_date: '', tags: '',
      archive: 0, sighting: { day, file, role: 'topic' }, refs,
    });
  }
  return records;
}

// ---------- 文件 4：news.md ----------
function parseNewsMd(content, day, file) {
  const records = [];
  const base = path.basename(file);
  for (const sec of parseSections(content)) {
    for (const b of sec.blocks) {
      const m = b.heading.match(/^(\d+)[.、]\s*(.+?)(?:（(\d{4}-\d{2}-\d{2})）)?\s*$/);
      if (!m) continue;
      const title = m[2].trim();
      const pubDate = m[3] || '';
      let summary = '';
      for (const l of b.lines) {
        if (l.startsWith('- ') || !l.trim()) continue;
        summary = l.trim();
        break;
      }
      const text = b.lines.join('\n');
      const um = text.match(/https?:\/\/[^\s)）」"']+/);
      const url = um ? um[0] : '';
      records.push({
        key: url ? normalizeUrl(url) : `${base}#news${m[1]}`, kind: 'material', url,
        title, title_zh: '', summary, org: orgFromUrl(url, ''), source: '',
        pub_date: pubDate, tags: '', archive: 0,
        sighting: { day, file, role: 'news' }, refs: [],
      });
    }
  }
  return records;
}

// ---------- 文件 5：.cache/YYYY-MM-DD.json ----------
function parseCacheJson(content, day, file) {
  const records = [];
  let data;
  try { data = JSON.parse(content); } catch (e) { throw new Error('json parse: ' + e.message); }
  for (const m of data.materials || []) {
    const url = m.url || '';
    records.push({
      key: url ? normalizeUrl(url) : `${path.basename(file)}#${m.id}`,
      kind: 'candidate', url, title: m.title || '', title_zh: '',
      summary: m.summary || '', org: orgFromUrl(url, m.source || ''),
      source: m.source || '', pub_date: m.date || '', tags: '', archive: 0,
      sighting: { day, file, role: 'candidate' }, refs: [],
    });
  }
  return records;
}

// ---------- 文件 7：collector 归档 ----------
function parseCollectorMd(content, day, file) {
  const records = [];
  const base = path.basename(file);
  let hN = 0, tN = 0;
  for (const sec of parseSections(content)) {
    if (sec.heading.includes('今日热点') || sec.heading.includes('热点扫描')) {
      for (const l of sec.lines) {
        const m = l.match(/^(?:[-*]|\d+[.、])\s*\*\*(.+?)\*\*(.*)$/);
        if (!m) continue;
        hN++;
        const title = m[1].trim();
        const rest = m[2].replace(/^[：:．]?\s*/, '').replace(/^[（(][^）)]*[）)]\s*/, '').replace(/^——\s*/, '').trim();
        records.push({
          key: `col-${day}#h${hN}`, kind: 'hot', url: '', title, title_zh: '',
          summary: rest, org: '', source: '', pub_date: '', tags: '', archive: 1,
          sighting: { day, file, role: 'hot' }, refs: [],
        });
      }
    }
    for (const b of sec.blocks) {
      if (!/^(选题\s*\d+|①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩)/.test(b.heading)) continue;
      tN++;
      const parts = b.heading.split(/[：:]/);
      const title = (parts.length > 1 ? parts.slice(1).join('：') : parts[0]).replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '').trim();
      const txt = b.lines.join('\n');
      const why = (txt.match(/-\s*\*\*为什么现在写\*\*[：:]\s*([^\n]+)/) || [])[1] || '';
      const angle = (txt.match(/-\s*\*\*核心角度\*\*[：:]\s*([^\n]+)/) || [])[1] || '';
      records.push({
        key: `col-${day}#t${tN}`, kind: 'topic', url: '', title, title_zh: '',
        summary: [angle, why].filter(Boolean).join(' '), org: '', source: '',
        pub_date: '', tags: '', archive: 1,
        sighting: { day, file, role: 'col-topic' }, refs: [],
      });
    }
  }
  return records;
}

// ---------- 合并记录（同一 key）----------
function mergeInto(map, rec) {
  const ex = map.get(rec.key);
  if (!ex) {
    map.set(rec.key, { ...rec, sightings: [rec.sighting] });
    return;
  }
  if (ex.kind === 'candidate' && rec.kind !== 'candidate') ex.kind = rec.kind;
  ex.summary = betterSummary(ex.summary, rec.summary);
  ex.title_zh = ex.title_zh || rec.title_zh;
  ex.title = ex.title || rec.title;
  ex.url = ex.url || rec.url;
  ex.org = ex.org || rec.org;
  ex.source = ex.source || rec.source;
  ex.pub_date = ex.pub_date || rec.pub_date;
  ex.tags = ex.tags || rec.tags;
  ex.archive = ex.archive || rec.archive;
  ex.refs = [...new Set([...(ex.refs || []), ...(rec.refs || [])])];
  const sk = `${rec.sighting.day}|${rec.sighting.file}|${rec.sighting.role}`;
  if (!ex.sightings.some((s) => `${s.day}|${s.file}|${s.role}` === sk)) ex.sightings.push(rec.sighting);
}

// ---------- 主流程 ----------
async function main() {
  ensureDirs();
  const t0 = Date.now();
  const db = openDb(DB);
  const records = new Map();
  const counts = {}; // 来源文件解析条数

  const addAll = (file, list) => {
    counts[file] = list.length;
    for (const r of list) mergeInto(records, r);
  };
  const inRange = (d) => d && d >= SINCE && d <= UNTIL;

  // DT 范围内的素材与选题
  let dtFiles = [];
  try { dtFiles = fs.readdirSync(DT); } catch { dtFiles = []; }
  for (const name of dtFiles.sort()) {
    const day = dayOfFile(name);
    if (!day || !inRange(day)) continue;
    const full = path.join(DT, name);
    if (!fs.statSync(full).isFile()) continue;
    const content = fs.readFileSync(full, 'utf8');
    try {
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name) || /^\d{4}-\d{2}-\d{2}\.auto\.md$/.test(name)) {
        addAll(name, parseDigestMd(content, day, name, 'ganhuo'));
      } else if (/^\d{4}-\d{2}-\d{2}-topics\.md$/.test(name)) {
        addAll(name, parseTopicsMd(content, day, name));
      } else if (/^\d{4}-\d{2}-\d{2}-topics\.json$/.test(name)) {
        addAll(name, parseTopicsJson(content, day, name));
      } else if (/^\d{4}-\d{2}-\d{2}-news\.md$/.test(name)) {
        addAll(name, parseNewsMd(content, day, name));
      }
    } catch (e) {
      console.warn('[warn] 解析失败', name, e.message);
    }
  }
  // .cache
  try {
    const cacheDir = path.join(DT, '.cache');
    for (const name of fs.readdirSync(cacheDir)) {
      const day = dayOfFile(name);
      if (!day || !inRange(day) || !name.endsWith('.json')) continue;
      try {
        const content = fs.readFileSync(path.join(cacheDir, name), 'utf8');
        addAll('.cache/' + name, parseCacheJson(content, day, '.cache/' + name));
      } catch (e) {
        console.warn('[warn] 解析失败 .cache/' + name, e.message);
      }
    }
  } catch { /* 没有 .cache */ }

  // candidates/<date>.json（digest 的永久归档，格式和 .cache 的 materials 一样）
  try {
    const candDir = path.join(DT, 'candidates');
    for (const name of fs.readdirSync(candDir)) {
      const day = dayOfFile(name);
      if (!day || !inRange(day) || !name.endsWith('.json')) continue;
      try {
        const content = fs.readFileSync(path.join(candDir, name), 'utf8');
        addAll('candidates/' + name, parseCacheJson(content, day, 'candidates/' + name));
      } catch (e) {
        console.warn('[warn] 解析失败 candidates/' + name, e.message);
      }
    }
  } catch { /* 没有 candidates */ }

  // drafts 备份
  try {
    const day = dayOfFile(BACKUP_MD);
    if (inRange(day)) {
      const content = fs.readFileSync(BACKUP_MD, 'utf8');
      addAll('digest-backup:' + path.basename(BACKUP_MD), parseDigestMd(content, day, path.basename(BACKUP_MD), 'ganhuo-backup'));
    }
  } catch (e) {
    console.warn('[warn] 备份解析失败', e.message);
  }

  // collector 归档
  if (!NO_ARCHIVE) {
    try {
      for (const name of fs.readdirSync(COL).sort()) {
        const day = dayOfFile(name);
        if (!day || !name.endsWith('.md')) continue;
        try {
          const content = fs.readFileSync(path.join(COL, name), 'utf8');
          addAll('col:' + name, parseCollectorMd(content, day, 'col:' + name));
        } catch (e) {
          console.warn('[warn] 解析失败', name, e.message);
        }
      }
    } catch { /* 没有归档 */ }
  }

  // upsert docs + sightings
  const getDoc = db.prepare('SELECT * FROM docs WHERE key=?');
  const insDoc = db.prepare(`INSERT INTO docs(key,kind,url,title,title_zh,summary,org,source,pub_date,tags,first_seen,archive)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const upDoc = db.prepare(`UPDATE docs SET kind=?, url=?, title=?, title_zh=?, summary=?, org=?, source=?, pub_date=?, tags=?, archive=? WHERE id=?`);
  const insSight = db.prepare('INSERT OR IGNORE INTO sightings(doc_id,day,file,role) VALUES(?,?,?,?)');
  const minDay = db.prepare('SELECT MIN(day) m FROM sightings WHERE doc_id=?');

  let newDocs = 0, newSightings = 0;
  const keyToId = new Map();
  for (const rec of records.values()) {
    let row = getDoc.get(rec.key);
    if (!row) {
      const first = rec.sightings.length ? rec.sightings.map((s) => s.day).sort()[0] : null;
      const info = insDoc.run(rec.key, rec.kind, rec.url || null, rec.title || null, rec.title_zh || null,
        rec.summary || null, rec.org || null, rec.source || null, rec.pub_date || null, rec.tags || null,
        first, rec.archive || 0);
      row = { id: Number(info.lastInsertRowid) };
      newDocs++;
    } else {
      // 合并已有摘要，保留已有非空字段
      const mergedSummary = betterSummary(row.summary, rec.summary);
      upDoc.run(
        row.kind === 'candidate' && rec.kind !== 'candidate' ? rec.kind : row.kind,
        row.url || rec.url || null,
        row.title || rec.title || null,
        row.title_zh || rec.title_zh || null,
        mergedSummary || null,
        row.org || rec.org || null,
        row.source || rec.source || null,
        row.pub_date || rec.pub_date || null,
        row.tags || rec.tags || null,
        row.archive || rec.archive || 0,
        row.id
      );
    }
    for (const s of rec.sightings) {
      const info = insSight.run(row.id, s.day, s.file, s.role);
      if (info.changes) newSightings++;
    }
    const m = minDay.get(row.id);
    if (m && m.m) db.prepare('UPDATE docs SET first_seen=? WHERE id=?').run(m.m, row.id);
    keyToId.set(rec.key, row.id);
  }

  // topic_refs
  const findMat = db.prepare('SELECT id FROM docs WHERE key=?');
  const insRef = db.prepare('INSERT OR IGNORE INTO topic_refs(topic_doc_id,material_doc_id) VALUES(?,?)');
  for (const rec of records.values()) {
    if (rec.kind !== 'topic' || !rec.refs || !rec.refs.length) continue;
    const tid = keyToId.get(rec.key);
    for (const u of rec.refs) {
      const m = findMat.get(normalizeUrl(u));
      if (m) insRef.run(tid, m.id);
    }
  }

  // 实体重建
  db.exec('DELETE FROM doc_entities; DELETE FROM entity_edges; DELETE FROM entities;');
  const insEnt = db.prepare('INSERT OR IGNORE INTO entities(name,type) VALUES(?,?)');
  const getEnt = db.prepare('SELECT id FROM entities WHERE name=?');
  const insDe = db.prepare('INSERT OR IGNORE INTO doc_entities(doc_id,entity_id) VALUES(?,?)');
  const edgeMap = new Map();
  const allDocs = db.prepare('SELECT * FROM docs').all();
  for (const d of allDocs) {
    const text = [d.title_zh, d.title, d.summary, d.tags].filter(Boolean).join(' ');
    const ents = extractEntities(text, d.org || '');
    const ids = [];
    for (const e of ents) {
      insEnt.run(e.name, e.type);
      const row = getEnt.get(e.name);
      if (row) { insDe.run(d.id, row.id); ids.push(row.id); }
    }
    ids.sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = ids[i] + '|' + ids[j];
        edgeMap.set(k, (edgeMap.get(k) || 0) + 1);
      }
  }
  const insEdge = db.prepare('INSERT OR IGNORE INTO entity_edges(a,b,weight) VALUES(?,?,?)');
  for (const [k, w] of edgeMap) {
    const [a, b] = k.split('|').map(Number);
    insEdge.run(a, b, w);
  }

  // 嵌入：只算新增/变更
  const need = [];
  for (const d of db.prepare('SELECT * FROM docs').all()) {
    const text = docText('passage', d);
    const h = sha1(text);
    if (d.emb && d.emb_hash === h) continue;
    if (!text.replace('passage: ', '').trim()) continue;
    need.push({ id: d.id, text, h });
  }
  let embNew = 0;
  if (need.length) {
    for (let i = 0; i < need.length; i += 16) {
      const batch = need.slice(i, i + 16);
      const vecs = await embedTexts(batch.map((x) => x.text));
      const up = db.prepare('UPDATE docs SET emb=?, emb_hash=? WHERE id=?');
      batch.forEach((x, j) => { up.run(vecToBlob(vecs[j]), x.h, x.id); embNew++; });
    }
  }

  // FTS 全量重建
  db.exec('DELETE FROM docs_fts');
  db.exec(`INSERT INTO docs_fts(rowid,title,title_zh,summary)
    SELECT id, COALESCE(title,''), COALESCE(title_zh,''), COALESCE(summary,'') FROM docs`);

  // meta
  db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('last_ingest', new Date().toISOString());
  db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('embed_model', EMB_MODEL);

  // 统计
  const byKind = db.prepare('SELECT kind, COUNT(*) c FROM docs GROUP BY kind ORDER BY kind').all();
  const sightCount = db.prepare('SELECT COUNT(*) c FROM sightings').get().c;
  const entCount = db.prepare('SELECT COUNT(*) c FROM entities').get().c;
  const edgeCount = db.prepare('SELECT COUNT(*) c FROM entity_edges').get().c;
  const embCount = db.prepare('SELECT COUNT(*) c FROM docs WHERE emb IS NOT NULL').get().c;

  console.log('== ingest 统计 ==');
  console.log('since..until:', SINCE, '..', UNTIL, NO_ARCHIVE ? '(no-archive)' : '');
  for (const [f, c] of Object.entries(counts).sort()) console.log(`  来源文件 ${f}: ${c} 条`);
  console.log('  docs 总数:', byKind.map((r) => `${r.kind}=${r.c}`).join(' '), `(本次新增 ${newDocs})`);
  console.log('  sightings:', sightCount, `(本次新增 ${newSightings})`);
  console.log('  entities:', entCount, '  edges:', edgeCount);
  console.log('  embeddings:', embCount, `(本次新算 ${embNew})`);
  console.log('  耗时:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
