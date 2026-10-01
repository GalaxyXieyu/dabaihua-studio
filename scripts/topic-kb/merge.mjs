// merge.mjs — 组装 prompt → 调 pi → 校验 → 写 out/<date>-kb-topics.{json,md}
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  openDb, findRelated, writeOut, parseArgs, addDays, snippet, OUT_DIR, YU_DAILY,
} from './lib.mjs';
import { VENDOR_CAP } from '../lib/vendor.mjs';
import { loadPiKey, DEFAULT_MODEL } from '../lib/digest-pi.mjs';

const args = parseArgs(process.argv.slice(2));
const DATE = args.date;
const K = Number(args.k || 4);
const DRY = !!args['dry-run'];
const MODEL = args.model || process.env.DIGEST_MODEL || DEFAULT_MODEL;
// --focus "kb-1:N6,P14,N5;kb-4:N9,P11,P10"：固定素材组，每组只出 1 题（用来拿同一组素材对比新旧 prompt）
const FOCUS = args.focus ? String(args.focus).split(';').filter(Boolean).map((g) => {
  const [head, hint] = g.split('@');
  const [id, refs] = head.includes(':') ? head.split(':') : [null, head];
  return { id, hint: (hint || '').trim(), refs: refs.split(',').map((x) => x.trim()).filter(Boolean) };
}) : null;
const TAG = args.tag ? '-' + args.tag : (FOCUS ? '-focus' : '');
if (!DATE) { console.error('用法: node merge.mjs --date YYYY-MM-DD [--k 4] [--dry-run] [--model ...] [--focus "id:N1,P2@主线提示;..."] [--tag v2]'); process.exit(1); }

const db = openDb();
const titleOf = (d) => d.title_zh || d.title || ('doc#' + d.id);

// 1. 当天新素材（最多 10）
const newsDocs = db.prepare(`
  SELECT DISTINCT d.* FROM docs d
  JOIN sightings s ON s.doc_id = d.id
  WHERE s.day = ? AND s.role IN ('ganhuo','news') AND d.kind = 'material'
  ORDER BY d.id LIMIT 10
`).all(DATE);

const refMap = new Map(); // ref -> {doc,title,day,org,url,summary,ref}
const N = [], P = [];
newsDocs.forEach((d, i) => {
  const ref = 'N' + (i + 1);
  const rel = findRelated(db, d.id, { beforeDay: DATE, k: K });
  const shared = [...new Set(rel.flatMap((r) => r.shared))].slice(0, 6);
  const obj = { ref, doc: d, title: titleOf(d), day: d.first_seen, org: d.org || '', url: d.url || '', summary: d.summary || '', shared };
  N.push(obj); refMap.set(ref, obj);
  for (const r of rel) {
    const rd = r.doc;
    if (newsDocs.some((n) => n.id === rd.id)) continue;
    if ([...refMap.values()].some((x) => x.doc.id === rd.id)) continue;
    const pref = 'P' + (P.length + 1);
    const po = { ref: pref, doc: rd, title: titleOf(rd), day: rd.first_seen, org: rd.org || '', url: rd.url || '', summary: rd.summary || '', shared: r.shared };
    P.push(po); refMap.set(pref, po);
  }
});

// 2. 最近 7 天已出选题
const recent = db.prepare(`
  SELECT DISTINCT title, first_seen FROM docs
  WHERE kind='topic' AND first_seen >= ? AND first_seen < ?
  ORDER BY first_seen DESC LIMIT 25
`).all(addDays(DATE, -7), DATE).map((r) => `${r.first_seen} ${r.title}`);

// 3. Yu 场景池
function yuPool() {
  // 每天平均分配预算（总 2600 字），小标题优先保留，避免第一天把预算吃光
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const day = addDays(DATE, -i);
    const p = path.join(YU_DAILY, `${day}.md`);
    if (fs.existsSync(p)) days.push([day, p]);
  }
  if (!days.length) return '无';
  const per = Math.floor(2600 / days.length);
  const chunks = [];
  for (const [day, p] of days) {
    const lines = fs.readFileSync(p, 'utf8').replace(/\r/g, '').split('\n');
    let inSec = false;
    let text = '';
    for (const l of lines) {
      const h = l.match(/^##\s+(.*)$/);
      if (h) { inSec = h[1].includes('做了什么'); continue; }
      if (!inSec) continue;
      if (!(l.startsWith('**') || l.startsWith('- '))) continue;
      const line = (l.startsWith('- ') ? l.slice(0, 110) : l) + '\n';
      if (text.length + line.length > per) break;
      text += line;
    }
    if (text) chunks.push(`### ${day} 日报\n${text}`);
  }
  return chunks.length ? chunks.join('\n') : '无';
}

const pool = yuPool();

// 4. prompt
function materialLines(list) {
  return list.map((m) =>
    `- [${m.ref}] (${m.day}, ${m.org || '未知'}, ${m.doc.kind}${m.ref.startsWith('N') ? (m.day === DATE ? '，新' : '，重复：首见 ' + m.day) : ''}) ${m.title}\n  摘要：${snippet(m.summary, 260)}\n  共享实体：${m.shared && m.shared.length ? m.shared.join('、') : '无'}`
  ).join('\n');
}

const RULES = `你在帮「大白话讲AI」从多篇素材里看出关键变化，提炼值得展开讲的观点或方法论。主线是 Yu 自己的场景和判断。
这一步的价值不在把几篇拼在一起，而在回答三件事：
1. 变化：以前怎么做 → 现在怎么做 → 为什么会变（变的驱动力：成本、规模、风险、能力边界……要落到素材里的事实）。
2. 方法论：变化背后可以复用的做法，写成「步骤或原则」，换个团队、换个业务也能照着做。
3. 判断标准：读者拿去就能用的标准，每条都要带门槛或条件（「当……/超过……/如果……时，就……；否则……」）。
产出 3–5 个落地题。每题必须合并 ≥2 篇素材、来自 ≥2 个不同 org，并且至少 1 篇是往期 P*（这正是要验证的「回看以前收过的内容」）。
只输出一个 JSON 对象，不要多余文字。格式：
{"topics":[{"id":"kb-1","title":"...","oneLiner":"...",
"change":{"before":"以前怎么做（具体到做法）","now":"现在怎么做","why":"为什么会变","refs":["P2","N3"]},
"methodology":["可复用做法 1（动词开头）","做法 2","做法 3"],
"criteria":[{"when":"门槛或条件","then":"该怎么判断/怎么做","basis":"依据：N*/P* 编号或「Yu YYYY-MM-DD 日报」"}],
"question":"这几篇共同回答的一线问题","compare":[{"ref":"N1","org":"...","approach":"...","number":"逐字复制的数字，没有就空字符串"}],
"consensus":"共识 1 条","divergence":"分歧 1 条","yuAngle":"仅当场景池里有同一类技术问题时才写，并标明出自哪天日报；对不上就写空字符串","questions":["问 Yu 1–2 个，必须含素材里的专有名词或数字"],"refs":["N3","P2"]}]}
规则：
- 「变化」讲的是做法怎么变了，不是「先发的那篇 vs 后发的那篇」。不许写成「以前用 A 公司的产品，现在用 B 公司的产品」。
  before 只能来自：① 素材里明说的旧做法（如「无需手动选择」说明以前要手动选、「不用一个个单独配」说明以前要逐个配）；② 往期 P* 里当时的做法；③ Yu 场景池里 Yu 以前的做法（写明日期）。change.refs 写出依据编号或「Yu YYYY-MM-DD 日报」。看不出旧做法就别硬编。
  why 写驱动力（规模、成本、风险、能力边界），只能用素材里的事实，不要自己推一个原因再配数字。
- methodology 2–4 条，每条是换个团队也能照做的动作（动词开头），不写口号，不写某家产品的命令或参数名（产品名可以出现在括号里当例子）。
- criteria 2–4 条：when 写读者自己的处境（团队规模、请求类型、是否会写外部系统、是否跨多个文件、有没有按请求记账……），then 写该怎么选或怎么做，最好带「否则……」。
  素材里的结果数字（省了 30%、成本低 29%、示例金额、累计 token 数、召回率）是证据，绝不能拿来当门槛；只有素材明确写成要求或阈值的（如「最低 4 核 CPU、16GB 内存」「三天内判断」）才能当门槛。其余写可观察的定性条件，不要自己编阈值。
- 数字只能按原文的意思用：「新模型比上一代每次会话成本低 29%」不能改写成「模型之间差 29%」。
- 「我」只能用于 Yu 场景池里真实出现过的经历，并写明日期；场景池里没有的业务（比如 Yu 没做过理赔问答）用「如果你在做……」，不许虚构 Yu 做过。
- 观点要站在 Yu 的位置给判断，而不是转述别人的文章。title 和观点里不写「某某说过 / 据 X / X 认为」，不做「解读某篇文章」。
- 不编造数字；compare.number 必须从对应素材摘要里逐字复制，找不到数字就留空。
- 禁用表达：清单、少走弯路、分水岭、「不是……而是……」、「对……而言」、赋能、颠覆。
- 禁止「哪一步是你自己拍板的」这类通用问题，questions 必须带专有名词或数字。
- 避免和「最近 7 天已出过的选题」同题复读。
- 全天所有题合计，同一 org 的素材（N 和 P 都算）最多用 ${VENDOR_CAP} 篇；org 为空/未知、或 kind 为 topic/hot（往期选题）的不算。
- 重复素材（标注「重复」的 N）只能当佐证，不能当主证据；每题必须至少引用 1 篇标「新」的 N 当主证据。
- title/oneLiner/change/methodology/criteria/questions 里出现的数字，必须能在所引素材摘要或 Yu 场景池里逐字找到。`;

const FOCUS_REFS = new Set(FOCUS ? FOCUS.flatMap((g) => g.refs) : []);
const FOCUS_RULES = FOCUS ? `

## 本次只做指定素材组（覆盖上面的「3–5 题」）
下面每组素材固定，每组只出 1 题，id 用给定的 id，refs 只能从该组里选（可以全用）：
${FOCUS.map((g) => `- ${g.id || '?'}：${g.refs.join('、')}${g.hint ? `（主线：${g.hint}）` : ''}`).join('\n')}` : '';

const prompt = `# 任务：从下面素材里看出关键变化，产出 ${DATE} 的落地选题

${RULES}${FOCUS_RULES}

## 最近 7 天已出过的选题（避免复读）
${recent.length ? recent.join('\n') : '无'}

## Yu 场景池（最近 7 天工作日报「做了什么」）
${pool}

## 当天新素材 N*
${materialLines(FOCUS ? N.filter((m) => FOCUS_REFS.has(m.ref)) : N)}

## 往期相关素材 P*
${(FOCUS ? P.filter((m) => FOCUS_REFS.has(m.ref)) : P).length ? materialLines(FOCUS ? P.filter((m) => FOCUS_REFS.has(m.ref)) : P) : '（无）'}

按要求只输出 JSON。`;

const promptFile = writeOut(`${DATE}-prompt${TAG}.md`, prompt + '\n');

if (DRY) {
  console.log(`[dry-run] prompt 已写入 ${promptFile}`);
  console.log(`  新素材 ${N.length} 条，往期 ${P.length} 条，最近选题 ${recent.length} 条，场景池 ${pool === '无' ? 0 : pool.length} 字`);
  db.close();
  process.exit(0);
}

// 5. 调 pi
function callPi(promptPath) {
  return new Promise((resolve, reject) => {
    const piBin = process.env.PI_BIN || 'pi';
    // 只在子进程 env 里注入密钥，不修改 process.env，也不打印。
    const env = { ...process.env };
    const key = loadPiKey();
    if (!process.env.OPENCODE_API_KEY && key) env.OPENCODE_API_KEY = key;
    env.PATH = '/home/box/.local/bin:' + (process.env.PATH || '');
    const child = spawn(piBin, ['-p', '--no-session', '--no-tools', '--mode', 'json', '--model', MODEL, '@' + promptPath, '按要求只输出 JSON。'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let out = '', err = '';
    let done = false;
    const timer = setTimeout(() => { if (!done) { child.kill('SIGKILL'); reject(new Error('pi 超时(240s)')); } }, 240000);
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (err += d.toString('utf8')));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      done = true; clearTimeout(timer);
      let last = null;
      for (const line of out.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        let ev; try { ev = JSON.parse(s); } catch { continue; }
        if (ev.type === 'message_end' && ev.message && ev.message.role === 'assistant') last = ev.message;
      }
      if (!last) return reject(new Error(`pi 无 assistant message (exit ${code})\n${err.slice(0, 500)}`));
      const content = last.content;
      const text = Array.isArray(content)
        ? content.filter((c) => c && c.type === 'text').map((c) => c.text).join('')
        : String(content || '');
      const u = last.usage || {};
      resolve({
        text,
        usage: {
          input: u.input || 0, output: u.output || 0, cacheRead: u.cacheRead || 0,
          totalTokens: u.totalTokens || 0, cost: (u.cost && u.cost.total) || 0,
        },
      });
    });
  });
}

function extractJson(text) {
  let s = String(text || '');
  const fence = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/);
  if (fence) s = fence[1];
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  const data = JSON.parse(s);
  return Array.isArray(data) ? { topics: data } : data;
}

// 6. 校验
const FORBIDDEN = ['清单', '少走弯路', '分水岭', '赋能', '颠覆'];
function validate(topic) {
  const problems = [];
  const refs = Array.isArray(topic.refs) ? topic.refs : [];
  for (const r of refs) if (!refMap.has(r)) problems.push(`refs 不存在: ${r}`);
  const refDocs = refs.map((r) => refMap.get(r)).filter(Boolean);
  const orgs = new Set(refDocs.map((d) => d.org).filter(Boolean));
  if (orgs.size < 2) problems.push(`不同 org 只有 ${orgs.size} 个（需 ≥2）`);
  if (!refs.some((r) => /^P\d+$/.test(r))) problems.push('缺少往期 P* 素材');
  for (const c of topic.compare || []) {
    if (!c || c.number === undefined || c.number === null || String(c.number).trim() === '') continue;
    const doc = refMap.get(c.ref);
    const num = String(c.number);
    if (!doc) problems.push(`compare 的 ref 找不到: ${c.ref}`);
    else {
      const hay = String(doc.summary || '').replace(/[\s,，]/g, '');
      const needle = num.replace(/[\s,，]/g, '');
      if (needle && !hay.includes(needle)) problems.push(`number「${num}」不在 ${c.ref} 摘要中`);
    }
  }
  // 变化 / 方法论 / 判断标准
  const ch = topic.change || {};
  for (const k of ['before', 'now', 'why']) if (!String(ch[k] || '').trim()) problems.push(`change.${k} 为空`);
  const chRefs = Array.isArray(ch.refs) ? ch.refs : [];
  if (!chRefs.length) problems.push('change.refs 为空（「以前怎么做」要有出处）');
  for (const r of chRefs) if (!refMap.has(r) && !/日报/.test(r)) problems.push(`change.refs 不存在: ${r}`);
  const meth = Array.isArray(topic.methodology) ? topic.methodology.filter((x) => String(x || '').trim()) : [];
  if (meth.length < 2) problems.push(`methodology 只有 ${meth.length} 条（需 2–4）`);
  const crit = Array.isArray(topic.criteria) ? topic.criteria : [];
  if (crit.length < 2) problems.push(`criteria 只有 ${crit.length} 条（需 2–4）`);
  for (const [i, c] of crit.entries()) {
    if (!c || !String(c.when || '').trim() || !String(c.then || '').trim()) problems.push(`criteria[${i}] 缺 when/then`);
    else if (String(c.when).replace(/[；;。，,\s]/g, '').length < 6) problems.push(`criteria[${i}].when 太短，写不出具体处境`);
  }
  if (/我/.test([topic.title, topic.oneLiner].join('')) && !String(topic.yuAngle || '').trim()) problems.push('标题/一句话用了「我」，但 yuAngle 为空（场景池对不上就别写成 Yu 的经历）');
  if (FOCUS) {
    const g = FOCUS.find((x) => x.id === topic.id);
    if (!g) problems.push(`id ${topic.id} 不在 --focus 组里`);
    else for (const r of refs) if (!g.refs.includes(r)) problems.push(`ref ${r} 不在该组素材里`);
  }
  // 至少 1 篇当天首见的新素材（否则只是把重复素材再炒一遍）
  if (!refDocs.some((d) => /^N\d+$/.test(d.ref) && d.day === DATE)) problems.push('没有当天首见的新素材 N*（只用了重复/往期素材）');
  // 正文里出现的数字必须能在所引素材摘要或 Yu 场景池里找到（不编造数字）
  const hayAll = (refDocs.map((d) => d.summary || '').join('\n') + '\n' + (typeof pool === 'string' ? pool : '')).replace(/[\s,，]/g, '');
  const numText = [topic.title, topic.oneLiner, topic.newAngle, topic.yuAngle, ...(topic.questions || []),
    ch.before, ch.now, ch.why, ...meth, ...crit.flatMap((c) => [c && c.when, c && c.then])].join('\n')
    .replace(/\d{4}-\d{2}-\d{2}|\d{2}-\d{2}/g, '')
    .replace(/\b[A-Za-z][A-Za-z_]*-?v?\d+(?:\.\d+)*\b/g, '') // 模型名/版本号（M3.1、GPT-5、v0.0.23）不算数字
    .replace(/\bv?\d+\.\d+\.\d+\b/g, '')
    .replace(/\b[NP]\d+\b/g, '');
  for (const m of numText.matchAll(/\d[\d,，.]*\d|\d{2,}/g)) {
    const n = m[0].replace(/[,，]/g, '');
    if (n.length >= 2 && !hayAll.includes(n)) problems.push(`正文数字「${m[0]}」在所引素材里找不到`);
  }
  const text = [topic.title, topic.oneLiner, topic.newAngle, topic.yuAngle, topic.consensus, topic.divergence,
    ch.before, ch.now, ch.why, ...meth, ...crit.flatMap((c) => [c && c.when, c && c.then])].join('\n');
  for (const f of FORBIDDEN) if (text.includes(f)) problems.push(`禁用表达：${f}`);
  if (/不是[^。；\n]{0,40}而是/.test(text)) problems.push('禁用表达：不是……而是……');
  if (/对[^。；\n]{0,20}而言/.test(text)) problems.push('禁用表达：对……而言');
  return { valid: problems.length === 0, problems };
}

// 每日厂商上限：全天所有有效的题合计，同一 org 的素材最多 VENDOR_CAP 篇。
// 计数只看 kind 为 material/candidate、org 非空且非「未知」的素材。
function validateDay(topics) {
  const orgDocs = new Map(); // org -> Set(docId)
  for (const t of topics) {
    if (!t.valid) continue;
    const perOrg = new Map();
    for (const r of Array.isArray(t.refs) ? t.refs : []) {
      const m = refMap.get(r);
      if (!m) continue;
      const doc = m.doc || {};
      if (doc.kind !== 'material' && doc.kind !== 'candidate') continue;
      const org = m.org;
      if (!org || org === '未知') continue;
      if (!perOrg.has(org)) perOrg.set(org, new Set());
      perOrg.get(org).add(doc.id);
    }
    let overOrg = null;
    let overCount = 0;
    for (const [org, ids] of perOrg) {
      const used = orgDocs.get(org) || new Set();
      const unionSize = new Set([...used, ...ids]).size;
      if (unionSize > VENDOR_CAP) { overOrg = org; overCount = unionSize; break; }
    }
    if (overOrg) {
      t.valid = false;
      t.problems = [...(t.problems || []), `厂商超限：${overOrg} 全天已用 ${overCount} 篇`];
      continue;
    }
    for (const [org, ids] of perOrg) {
      if (!orgDocs.has(org)) orgDocs.set(org, new Set());
      for (const id of ids) orgDocs.get(org).add(id);
    }
  }
  return topics;
}

// 组装输出
function buildTopics(parsed) {
  const topics = (parsed.topics || []).map((t) => {
    const v = validate(t);
    const refs = Array.isArray(t.refs) ? t.refs : [];
    const materials = refs.map((r) => {
      const m = refMap.get(r);
      return m
        ? { ref: r, kind: m.doc.kind, title: m.title, day: m.day, org: m.org, url: m.url, summary: m.summary, isNew: /^N\d+$/.test(r) && m.day === DATE }
        : { ref: r };
    });
    return { ...t, valid: v.valid, problems: v.problems, materials };
  });
  return validateDay(topics);
}

const usages = [];
let topics = [];
try {
  const r1 = await callPi(promptFile);
  usages.push(r1.usage);
  topics = buildTopics(extractJson(r1.text));
  if (topics.filter((t) => t.valid).length < (FOCUS ? FOCUS.length : 3)) {
    const problems = topics.flatMap((t) => [`${t.id || '?'}: ${(t.problems || []).join('; ')}`]);
    const retryPrompt = prompt + `\n\n## 上一次输出的问题（请修正后重新只输出 JSON）\n${problems.join('\n')}\n`;
    const retryFile = writeOut(`${DATE}-prompt${TAG}-retry.md`, retryPrompt);
    const r2 = await callPi(retryFile);
    usages.push(r2.usage);
    topics = buildTopics(extractJson(r2.text));
  }
} catch (e) {
  console.error('调用/解析模型失败:', e.message);
  db.close();
  process.exit(1);
}

// 7. 输出
const validCount = topics.filter((t) => t.valid).length;
const json = {
  version: 1, date: DATE, generatedBy: 'dabaihua-topic-kb', model: MODEL,
  usage: usages, topics,
};
const jsonPath = writeOut(`${DATE}-kb-topics${TAG}.json`, JSON.stringify(json, null, 2) + '\n');

const md = [];
md.push(`# ${DATE} 知识库合并选题`);
md.push('');
md.push(`模型 ${MODEL} ｜ 共 ${topics.length} 题，有效 ${validCount} 题`);
md.push('');
for (const t of topics) {
  md.push(`## ${t.id || ''} ${t.title || ''} ${t.valid ? '' : '⚠️ 未通过校验'}`);
  if (t.oneLiner) md.push(`- 一句话：${t.oneLiner}`);
  if (t.change) {
    md.push(`- 变化`);
    md.push(`  - 以前：${t.change.before || ''}`);
    md.push(`  - 现在：${t.change.now || ''}`);
    md.push(`  - 为什么变：${t.change.why || ''}`);
    if (t.change.refs && t.change.refs.length) md.push(`  - 依据：${t.change.refs.join('、')}`);
  }
  if (t.methodology && t.methodology.length) { md.push('- 方法论'); t.methodology.forEach((x, i) => md.push(`  ${i + 1}. ${x}`)); }
  if (t.criteria && t.criteria.length) { md.push('- 判断标准'); t.criteria.forEach((c) => md.push(`  - ${String(c.when || '').replace(/^当\s*/, '当').replace(/[；;，,。\s]+$/, '')} → ${c.then}${c.basis ? `（依据：${String(c.basis).replace(/^依据[：:]\s*/, '')}）` : ''}`)); }
  if (t.question) md.push(`- 一线问题：${t.question}`);
  if (t.newAngle) md.push(`- 新角度：${t.newAngle}`);
  if (t.yuAngle) md.push(`- Yu 场景：${t.yuAngle}`);
  if (t.consensus) md.push(`- 共识：${t.consensus}`);
  if (t.divergence) md.push(`- 分歧：${t.divergence}`);
  if (t.questions && t.questions.length) md.push(`- 问 Yu：${t.questions.join(' / ')}`);
  const merged = (t.materials || []).map((m) => `${m.day} ${m.title}（${m.org}）`).join('；');
  md.push(`- 合并素材：${merged}`);
  if (!t.valid && t.problems && t.problems.length) md.push(`- 问题：${t.problems.join('；')}`);
  md.push('');
}
writeOut(`${DATE}-kb-topics${TAG}.md`, md.join('\n'));

let totalTokens = 0, totalCost = 0;
for (const u of usages) { totalTokens += u.totalTokens; totalCost += u.cost; }
console.log('== merge 完成 ==');
console.log(`  题数 ${topics.length}，有效 ${validCount}`);
console.log(`  token 用量 ${totalTokens}，cost $${totalCost.toFixed(4)}（调用 ${usages.length} 次）`);
console.log(`  written out/${DATE}-kb-topics${TAG}.json, out/${DATE}-kb-topics${TAG}.md`);
console.log(`KB_TOPICS_JSON=${jsonPath}`);
db.close();
