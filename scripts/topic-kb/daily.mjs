// daily.mjs — topic-kb 每日编排：ingest → 检查 N 素材 → merge → to-brief → validate
//
// 用法：
//   node scripts/topic-kb/daily.mjs --date D [--out <file>] [--force]
//        [--skip-ingest] [--keep-news-from <file>] [--dry-run]
//
// 任何一步失败都以非 0 退出，并打印是哪一步。子进程统一用 process.execPath + --no-warnings。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DT, openDb, parseArgs } from './lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ROOT, '..', '..');

const args = parseArgs(process.argv.slice(2));
const DATE = args.date;
if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error('用法: node daily.mjs --date YYYY-MM-DD [--out <file>] [--force] [--skip-ingest] [--keep-news-from <file>] [--dry-run]');
  process.exit(1);
}
const DRY = !!args['dry-run'];
const OUT = args.out || path.join(DT, `${DATE}-topics.json`);

function runStep(script, scriptArgs, label) {
  const child = spawnSync(process.execPath, ['--no-warnings', script, ...scriptArgs], { stdio: 'inherit' });
  if (child.error) {
    console.error(`[topics:daily] ${label} 失败：${child.error.message}`);
    process.exit(1);
  }
  if (child.status !== 0) {
    console.error(`[topics:daily] ${label} 失败，退出码 ${child.status}`);
    process.exit(child.status || 1);
  }
}

// 0. 目标简报已存在又没给 --force：在调模型之前就停下，不浪费 token、不覆盖已推送的那一期
if (!DRY && fs.existsSync(OUT) && !args.force) {
  console.error(`[topics:daily] 目标已存在，不覆盖：${OUT}（要覆盖请加 --force，或用 --out 写到别处）`);
  process.exit(3);
}

// 1. 入库（默认用 --until D）
if (!args['skip-ingest']) {
  runStep(path.join(ROOT, 'ingest.mjs'), ['--until', DATE], 'ingest');
} else {
  console.log('[topics:daily] --skip-ingest：跳过入库');
}

// 2. 检查当天有没有 N 素材
const mdPath = path.join(DT, `${DATE}.md`);
if (!fs.existsSync(mdPath)) {
  console.error(`[topics:daily] 没找到当天素材 ${mdPath}，先跑 npm run digest`);
  process.exit(2);
}
let newsCount = 0;
try {
  const db = openDb();
  newsCount = db.prepare(
    `SELECT COUNT(*) AS c FROM docs d
     JOIN sightings s ON s.doc_id = d.id
     WHERE s.day = ? AND s.role IN ('ganhuo','news') AND d.kind = 'material'`
  ).get(DATE).c;
  db.close();
} catch (e) {
  console.error(`[topics:daily] 查询当天素材失败：${e.message}`);
  process.exit(2);
}
if (!newsCount) {
  console.error(`[topics:daily] 知识库里当天没有 N 素材，先跑 npm run digest`);
  process.exit(2);
}
console.log(`[topics:daily] 当天 N 素材 ${newsCount} 条`);

// 3. 合并出题
const mergeArgs = ['--date', DATE];
if (DRY) mergeArgs.push('--dry-run');
runStep(path.join(ROOT, 'merge.mjs'), mergeArgs, 'merge');

if (DRY) {
  console.log('[topics:daily] --dry-run：只生成 prompt，已结束');
  process.exit(0);
}

// 4. 转简报
const briefArgs = ['--date', DATE, '--out', OUT];
if (args.force) briefArgs.push('--force');
if (args['keep-news-from']) briefArgs.push('--keep-news-from', args['keep-news-from']);
runStep(path.join(ROOT, 'to-brief.mjs'), briefArgs, 'to-brief');

// 5. 再验一次
runStep(path.join(REPO_ROOT, 'scripts/brief.mjs'), ['validate', OUT], 'brief validate');

console.log(`[topics:daily] 完成：${OUT}`);
