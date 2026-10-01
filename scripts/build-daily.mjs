/**
 * build-daily.mjs — 把本机私密日报汇总成站点可读的 content/daily/daily.json。
 *
 * 输入（只读，两个目录都在仓库之外）：
 *   /workspace/daily/YYYY-MM-DD.md          早八每晚生成的中文日报（YAML front matter + 固定二级标题）
 *   /workspace/career/git-daily/YYYY-MM-DD.json   当天的 git 提交明细（见同目录 README.md）
 *
 * 输出：content/daily/daily.json —— 页面只读这个文件；它被 .gitignore 忽略，不进公开仓库。
 * 任一边缺失都不报错：没有 git 明细就只出日报正文，没有任何日报就写出空 days。
 *
 * 用法：
 *   npm run daily:build
 *   node scripts/build-daily.mjs [--out <path>] [--daily-dir <dir>] [--git-daily-dir <dir>]
 *
 * 环境变量：DAILY_DIR、GIT_DAILY_DIR、DAILY_OUT（命令行参数优先）。
 * 隐私：脚本只读 .md / .json、跳过 backup-* 目录和 *.partial，绝不写入源目录。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const DEFAULT_DAILY_DIR = process.env.DAILY_DIR || "/workspace/daily";
export const DEFAULT_GIT_DAILY_DIR = process.env.GIT_DAILY_DIR || "/workspace/career/git-daily";
export const DEFAULT_OUT = process.env.DAILY_OUT || path.join(REPO_ROOT, "content/daily/daily.json");

const SECTION_KEYS = {
  概览: "overview",
  做了什么: "what",
  卡点和返工: "blockers",
  结果数字: "results",
  牵头和带人: "leading",
  未完成: "unfinished",
};

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;

function unquote(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseScalar(value) {
  const raw = unquote(value);
  if (raw === "" || raw === "null" || raw === "~") return null;
  return raw;
}

function parseNumber(value) {
  const raw = unquote(value);
  if (raw === "" || raw === "null" || raw === "~") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 解析最小 YAML front matter：标量 + `- ` 列表 + `null`。 */
export function parseFrontMatter(text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---")) return { fields: {}, body: normalized };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { fields: {}, body: normalized };
  const head = normalized.slice(normalized.indexOf("\n", 3) + 1, end);
  const bodyStart = normalized.indexOf("\n", end + 1);
  const body = bodyStart === -1 ? "" : normalized.slice(bodyStart + 1);

  const fields = {};
  let listKey = null;
  for (const line of head.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      fields[listKey].push(parseScalar(item[1]));
      continue;
    }
    const entry = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (entry) {
      const key = entry[1];
      const value = entry[2].trim();
      if (value === "" || value === "[]") {
        fields[key] = value === "[]" ? [] : [];
        listKey = key;
      } else {
        fields[key] = parseScalar(value);
        listKey = null;
      }
      continue;
    }
    listKey = null;
  }
  return { fields, body };
}

/** 把正文按二级标题切成 `Map<标题, 行[]>`。 */
function splitSections(body) {
  const sections = new Map();
  let current = null;
  for (const line of String(body ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return sections;
}

function cleanMarkdown(lines) {
  return lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "").trim();
}

/** 「做了什么」由 `**N. 标题**` 分段，每段成为一条可展开条目。 */
export function parseWhatEntries(lines) {
  const entries = [];
  let current = null;
  for (const line of lines) {
    const heading = /^\*\*(.+?)\*\*\s*$/.exec(line.trim());
    if (heading) {
      current = { title: heading[1].trim(), body: [] };
      entries.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return entries
    .map((entry) => ({ title: entry.title, body: cleanMarkdown(entry.body) }))
    .filter((entry) => entry.title);
}

function sectionText(sections, key) {
  const lines = sections.get(key);
  if (!lines) return null;
  const text = cleanMarkdown(lines);
  return text || null;
}

/** 解析一份日报 markdown（含 front matter）为页面需要的结构。 */
export function parseDailyMarkdown(text, fallbackDate = "") {
  const { fields, body } = parseFrontMatter(text);
  const fileDate = DATE_FILE.exec(String(fallbackDate).split("/").pop() || "")?.[1] || "";
  const date = String(fields.date ?? fileDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const repos = Array.isArray(fields.repos) ? fields.repos.filter(Boolean).map(String) : [];
  const sections = splitSections(body);
  const parsed = { overview: null, what: [], blockers: null, results: null, leading: null, unfinished: null };
  for (const [heading, key] of Object.entries(SECTION_KEYS)) {
    parsed[key] = key === "what" ? parseWhatEntries(sections.get(heading) || []) : sectionText(sections, heading);
  }

  return {
    date,
    weekday: String(fields.weekday ?? "").trim(),
    summary: String(fields.summary ?? "").trim(),
    commits: parseNumber(fields.commits),
    repos,
    tokensM: parseNumber(fields.tokens_m),
    sections: parsed,
    repoStats: [],
  };
}

/** v1 在顶层 `commits`，v2（git-daily/2）放在 `git.commits`，两种都支持。 */
function collectCommits(raw) {
  if (Array.isArray(raw?.commits)) return raw.commits;
  if (Array.isArray(raw?.git?.commits)) return raw.git.commits;
  return [];
}

/** 旧格式 `noise: true`（合并 / stash）跳过；v2 的 `bump` 仍计入日报口径。 */
function isNoiseCommit(commit) {
  if (!commit) return true;
  if (commit.exclude_from_net === true) return true;
  const noise = commit.noise;
  if (noise === true) return true;
  if (typeof noise === "string") return noise !== "" && noise !== "bump";
  return false;
}

/** 从 git-daily json 汇总每个仓库的净提交数与增删行（剔掉噪声提交）。 */
export function summarizeCommitRepos(raw) {
  const commits = collectCommits(raw);
  const byRepo = new Map();
  if (commits.length > 0) {
    for (const commit of commits) {
      if (isNoiseCommit(commit)) continue;
      const repo = String(commit.repo || "unknown");
      const entry = byRepo.get(repo) || { repo, commits: 0, additions: 0, deletions: 0 };
      entry.commits += 1;
      entry.additions += Number(commit.additions || 0);
      entry.deletions += Number(commit.deletions || 0);
      byRepo.set(repo, entry);
    }
  } else if (raw?.stats?.by_repo && typeof raw.stats.by_repo === "object") {
    for (const [repo, stat] of Object.entries(raw.stats.by_repo)) {
      const net = Number(stat?.net ?? stat?.total ?? 0);
      byRepo.set(repo, { repo, commits: net, additions: 0, deletions: 0 });
    }
  }
  return [...byRepo.values()].sort(
    (a, b) => b.commits - a.commits || b.additions + b.deletions - (a.additions + a.deletions),
  );
}

function loadGitDaily(dir, date) {
  if (!dir) return null;
  const file = path.join(dir, `${date}.json`);
  if (!existsSync(file)) return null;
  try {
    return summarizeCommitRepos(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** 汇总整个目录，返回 { generatedAt, days }。 */
export function buildDailyData({ dailyDir = DEFAULT_DAILY_DIR, gitDailyDir = DEFAULT_GIT_DAILY_DIR } = {}) {
  const days = [];
  if (dailyDir && existsSync(dailyDir)) {
    const files = readdirSync(dailyDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && DATE_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    for (const name of files) {
      const day = parseDailyMarkdown(readFileSync(path.join(dailyDir, name), "utf8"), name);
      if (!day) continue;
      day.repoStats = loadGitDaily(gitDailyDir, day.date) || [];
      days.push(day);
    }
  }
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { generatedAt: new Date().toISOString(), days };
}

export function writeDailyData(data, outFile = DEFAULT_OUT) {
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return outFile;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") options.out = argv[++index];
    else if (arg === "--daily-dir") options.dailyDir = argv[++index];
    else if (arg === "--git-daily-dir") options.gitDailyDir = argv[++index];
  }
  return options;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const data = buildDailyData({
    dailyDir: options.dailyDir || DEFAULT_DAILY_DIR,
    gitDailyDir: options.gitDailyDir || DEFAULT_GIT_DAILY_DIR,
  });
  const out = writeDailyData(data, options.out || DEFAULT_OUT);
  const withGit = data.days.filter((day) => day.repoStats.length > 0).length;
  console.log(
    `日报已汇总：${data.days.length} 天（其中 ${withGit} 天带 git 明细） -> ${path.relative(REPO_ROOT, out) || out}`,
  );
}
