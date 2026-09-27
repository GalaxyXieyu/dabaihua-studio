import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closeSitesBrowser, sitesBrowserFetch } from "./sites-browser-fetch.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exporter = process.env.WECHAT_EXPORTER || path.join(projectRoot, "scripts", "wechat-exporter-browser.py");
const wizard = process.env.WECHAT_WIZARD || "";
const downloader = process.env.WECHAT_DOWNLOADER || "";
// 公众号后台文章列表接口已于 2026-07-30 关闭，默认改走微信读书；WECHAT_SYNC_SOURCE=exporter 可切回旧通道。
const weread = process.env.WECHAT_WEREAD || path.join(projectRoot, "collector", "moore", "scripts", "weread_mp.py");
export const syncSource = (process.env.WECHAT_SYNC_SOURCE || "weread").trim().toLowerCase();
const endpoint = (process.env.RSS_AI_ENDPOINT || "http://localhost:3000").replace(/\/$/, "");
const runtime = path.join(os.homedir(), ".moore", "wechat-article-downloader");
export const managedCacheRoot = path.join(runtime, "rss-ai-cache");
const stateFile = path.join(runtime, "rss-ai-last-daily-sync.txt");

function requiredToolPath(name, value) {
  if (!value) throw new Error(`请先设置 ${name}，指向对应的公众号采集脚本`);
  return value;
}

function keychain(service) {
  return execFileSync("security", ["find-generic-password", "-a", "rss-ai-sync", "-s", service, "-w"], { encoding: "utf8" }).trim();
}

function authHeaders() {
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(endpoint)) return {};
  return {
    "OAI-Sites-Authorization": `Bearer ${keychain("rss-ai-sites-bypass")}`,
    "x-import-token": keychain("rss-ai-import-token"),
  };
}

function runPythonJson(script, args) {
  const result = spawnSync("python3", [script, ...args], { cwd: projectRoot, encoding: "utf8", timeout: 10 * 60 * 1000 });
  const output = (result.stdout || "").trim();
  if (result.status !== 0) throw new Error((result.stderr || output || "公众号采集器运行失败").trim().slice(-800));
  let parsed;
  try { parsed = JSON.parse(output); }
  catch { throw new Error("公众号采集器返回了无法识别的结果"); }
  const collectorError = describeCollectorError(parsed);
  if (collectorError) throw new Error(collectorError.slice(-800));
  return parsed;
}

const runJson = (args) => runPythonJson(exporter, args);

export class WereadError extends Error {
  constructor(message, { code = "", fatal = false } = {}) {
    super(message);
    this.code = code;
    this.fatal = fatal;
  }
}

// weread_mp.py prints one JSON object even when it exits 1; `fatal` means stop the whole run.
export function parseWereadResult(status, stdout, stderr = "") {
  let parsed;
  try { parsed = JSON.parse(String(stdout || "").trim().split("\n").at(-1) || ""); }
  catch { throw new WereadError((stderr || stdout || "微信读书采集器运行失败").trim().slice(-800), { fatal: true }); }
  if (status !== 0 || parsed.ok === false) {
    throw new WereadError(String(parsed.error || parsed.status || "微信读书采集失败"), { code: String(parsed.code ?? ""), fatal: Boolean(parsed.fatal) });
  }
  return parsed;
}

function runWeread(args) {
  const result = spawnSync("python3", [weread, ...args], { cwd: projectRoot, encoding: "utf8", timeout: 5 * 60 * 1000 });
  return parseWereadResult(result.status, result.stdout, result.stderr);
}

function wereadAuthCheck() {
  try {
    runWeread(["auth-check"]);
    return "";
  } catch (error) {
    return `微信读书登录已失效，需要重新扫码（${error instanceof Error ? error.message : "auth-check 失败"}）`;
  }
}

async function syncWereadAccount(account, requestId, { force = false } = {}) {
  const fakeid = String(account.fakeid || "").trim();
  if (!fakeid) throw new WereadError("公众号账号信息不完整");
  const args = ["latest", "--fakeid", fakeid, "--name", String(account.nickname || "")];
  if (force) args.push("--force");
  const result = runWeread(args);
  const withAvatar = { ...account, avatar_url: account.avatar_url || result.avatar_url || "" };
  const rows = result.articles || [];
  const imported = rows.length ? await importPublicationMetadata(withAvatar, rows, requestId) : 0;
  // Only after the app accepted the rows do we mark the newest reviewId as seen (local, no network).
  if (result.source === "weread-cover" && rows[0]?.msgid) runWeread(["seen", "--fakeid", fakeid, "--review-id", String(rows[0].msgid)]);
  return { imported, unchanged: Boolean(result.unchanged), source: result.source, latestTitle: result.articles?.[0]?.title || result.latest_title || "" };
}

export function describeCollectorError(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  const baseResponse = parsed.base_resp;
  if (baseResponse && typeof baseResponse === "object") {
    const code = String(baseResponse.ret ?? "0").trim();
    if (code && code !== "0") return String(baseResponse.err_msg || `公众号会话失效（${code}）`);
  }
  if (parsed.ok === false) {
    const details = Array.isArray(parsed.errors) ? parsed.errors.join("；") : parsed.error;
    return String(details || "公众号采集器返回失败");
  }
  return "";
}

export function describeSyncResultError(result) {
  const collectorError = describeCollectorError(result);
  if (collectorError) return collectorError;
  if (result && typeof result === "object" && "fetched_count" in result && Number(result.fetched_count) <= 0) {
    return "公众号没有返回任何文章，登录态可能已失效";
  }
  return "";
}

function syncExporterAccount(accountId, limit = 20) {
  const result = runJson(["exporter-sync", "--account-id", String(accountId), "--limit", String(limit)]);
  const syncError = describeSyncResultError(result);
  if (syncError) {
    // fetched_count=0 不一定是登录失效，用 auth-check 确认后再决定
    if (syncError.includes("没有返回任何文章")) {
      const auth = runJson(["exporter-auth-check"]);
      if (auth.ok && auth.status === "valid") return result;
    }
    throw new Error(syncError);
  }
  return result;
}

export function retryablePartialImport(partialImport, message) {
  return {
    status: "pending",
    stage: "retrying",
    resultName: partialImport.resultName,
    itemCount: partialImport.itemCount,
    error: String(message || "公众号历史文章导入失败").slice(0, 500),
  };
}

const metadataProbe = `
import html, importlib.util, json, re, sys
module_path, url = sys.argv[1], sys.argv[2]
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(module_path)))
spec = importlib.util.spec_from_file_location("rss_ai_wechat_downloader", module_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
raw_html = module.fetch_text(url)
meta = module.extract_meta(raw_html, url)
clues = module.extract_account_clues(raw_html, url, meta)
profile = re.search(r'id=["\\\']js_name["\\\'][^>]*>(.*?)</', raw_html, re.S | re.I)
profile_name = re.sub(r'<[^>]+>', ' ', html.unescape(profile.group(1))) if profile else ''
profile_name = re.sub(r'\\s+', ' ', profile_name).strip()
if not profile_name:
    nickname = re.search(r'nick_name\\s*:\\s*(["\\\'])(.*?)\\1', raw_html, re.S | re.I)
    profile_name = html.unescape(nickname.group(2)).strip() if nickname else ''
print(json.dumps({"profileName": profile_name, "accountName": clues.get("account_name") or meta.get("account") or meta.get("author") or "", "biz": clues.get("biz") or "", "title": meta.get("title") or ""}, ensure_ascii=False))
`;

export function normalizeWechatProfileName(primary, fallback = "") {
  for (const candidate of [primary, fallback]) {
    const clean = String(candidate || "").replace(/\s+/g, " ").trim();
    if (!clean || /^(?:[➜➡→⮕►▶]*\s*)?(?:点击)?关注(?:\s*[➜➡→⮕►▶]*)?$/u.test(clean) || clean === "unknown-account") continue;
    return clean;
  }
  return "";
}

function inspectWechatArticle(url, fallbackName = "") {
  try {
    const metadata = runPythonJson("-c", [metadataProbe, requiredToolPath("WECHAT_DOWNLOADER", downloader), url]);
    return { accountName: normalizeWechatProfileName(metadata.profileName, metadata.accountName || fallbackName), biz: String(metadata.biz || "").trim() };
  } catch {
    return { accountName: normalizeWechatProfileName(fallbackName), biz: "" };
  }
}

async function downloadSubmittedArticle(url, requestId) {
  const requestCache = path.join(managedCacheRoot, `request-${Number(requestId) || "unknown"}`);
  const downloaded = runPythonJson(requiredToolPath("WECHAT_WIZARD", wizard), ["run", `下载：${url}`, "--force", "--output-dir", requestCache]);
  if (!downloaded.output_dir) throw new Error("没有从这篇文章识别到公众号作者");
  const articles = JSON.parse(await readFile(path.join(downloaded.output_dir, "articles.json"), "utf8"));
  const first = articles?.[0] || {};
  let accountName = String(first.account || "").trim();
  if (!accountName) {
    const probed = inspectWechatArticle(url, "");
    accountName = String(probed.accountName || "").trim();
  }
  if (!accountName) accountName = "未命名公众号";
  const articleKey = String(first.article_id || first.msgid || "").trim() || `url-${Buffer.from(url).toString("base64url").slice(0, 24)}`;
  return { outputDir: String(downloaded.output_dir), accountName, articleKey };
}

function resolveWechatAccount(url, accountName, biz) {
  if (biz) return { fakeid: biz, nickname: accountName, alias: "", avatar_url: "", description: "" };
  try {
    const direct = runJson(["exporter-account-by-url", url]);
    if (direct.accounts?.[0]?.fakeid) return direct.accounts[0];
  } catch {
    // The public account-by-URL endpoint is occasionally unavailable; use the article author below.
  }
  const searched = runJson(["exporter-search", accountName, "--size", "5"]);
  const exact = (searched.accounts || []).filter((account) => account.nickname === accountName);
  if (exact.length !== 1) throw new Error(`无法唯一确认公众号“${accountName}”`);
  return exact[0];
}

async function request(pathname, options = {}) {
  const remote = !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(endpoint);
  const requestOptions = {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  };
  let response;
  try {
    response = remote
      ? await sitesBrowserFetch(`${endpoint}${pathname}`, requestOptions)
      : await fetch(`${endpoint}${pathname}`, requestOptions);
  } catch (error) {
    if (remote) throw error;
    // 本地 dev server 偶发连接重置（如 HMR 重载），稍等后重试一次
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      response = await fetch(`${endpoint}${pathname}`, requestOptions);
    } catch (retryError) {
      const cause = retryError?.cause?.code || retryError?.cause?.message || "";
      throw new Error(`情报台请求失败 ${pathname}${cause ? `（${cause}）` : ""}`);
    }
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `情报台返回 ${response.status}`);
  return result;
}

function safeDirectory(value) {
  return (value || "公众号").replace(/[/\\:*?"<>|]/g, "_").trim() || "公众号";
}

export function normalizeWechatPublishTime(value) {
  const clean = String(value || "").trim();
  if (!clean) return undefined;
  const shanghai = clean.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  const date = new Date(shanghai ? `${shanghai[1]}T${shanghai[2]}+08:00` : clean);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function importPublicationMetadata(account, rows, requestId) {
  const articles = (rows || []).flatMap((row) => {
    const publishedAt = normalizeWechatPublishTime(row.publish_time || row.create_time);
    if (!row.title || !row.url || !publishedAt) return [];
    return [{
      title: String(row.title),
      url: String(row.url),
      excerpt: String(row.digest || ""),
      author: String(row.author || row.account_name || account.nickname || ""),
      publishedAt,
      ...(row.content_markdown ? { contentMarkdown: String(row.content_markdown) } : {}),
    }];
  });
  for (let index = 0; index < articles.length; index += 20) {
    await request("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "import-wechat", accountKey: String(account.fakeid), accountName: String(account.nickname || account.fakeid), avatarUrl: String(account.avatar_url || "").replace(/^http:/i, "https:"), requestId, articles: articles.slice(index, index + 20) }),
    });
  }
  return articles.length;
}

export function isManagedCacheDirectory(directory) {
  const root = path.resolve(managedCacheRoot);
  const target = path.resolve(String(directory || ""));
  return target !== root && target.startsWith(`${root}${path.sep}`);
}

async function cleanupImportedCache(directory) {
  if (!isManagedCacheDirectory(directory)) throw new Error("拒绝清理采集器缓存目录之外的文件");
  await rm(directory, { recursive: true, force: true });
}

async function importDownloaded(outputDir, accountKey, accountName, requestId) {
  const backfill = spawnSync(process.execPath, [
    path.join(projectRoot, "scripts", "backfill-wechat-markdown.mjs"),
    "--input", outputDir,
    "--endpoint", endpoint,
    "--account-key", String(accountKey),
    "--account-name", String(accountName),
    ...(requestId ? ["--request-id", String(requestId)] : []),
  ], { cwd: projectRoot, encoding: "utf8", timeout: 20 * 60 * 1000 });
  if (backfill.status !== 0) throw new Error((backfill.stderr || backfill.stdout || "公众号文章上传失败").trim().slice(-800));
  const lastLine = (backfill.stdout || "").trim().split("\n").at(-1) || "{}";
  let result = {};
  try { result = JSON.parse(lastLine); } catch { result = {}; }
  await cleanupImportedCache(outputDir);
  return result;
}

async function importAccount(account, articleIds = [], requestId) {
  const accountId = Number(account.id);
  if (!accountId || !account.fakeid) throw new Error("公众号账号信息不完整");
  const accountName = String(account.nickname || account.fakeid);
  const outputDir = path.join(managedCacheRoot, safeDirectory(accountName));
  const args = ["exporter-download", "--account-id", String(accountId), "--output-dir", outputDir];
  if (articleIds.length) args.push("--article-ids", articleIds.join(","));
  else args.push("--latest", "20");
  runJson(args);
  return importDownloaded(outputDir, String(account.fakeid), accountName, requestId);
}

async function reportTask(task, stage, details = {}) {
  await request("/api/import-queue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: task.id, status: "pending", stage, ...details }),
  });
}

async function processPendingRequests() {
  const queue = await request("/api/import-queue");
  let completed = 0;
  let failed = 0;
  for (const task of queue.requests || []) {
    let partialImport = Number(task.itemCount) > 0 && task.resultName
      ? { resultName: String(task.resultName), itemCount: Number(task.itemCount) }
      : null;
    try {
      let metadata;
      if (partialImport) {
        metadata = inspectWechatArticle(task.query, partialImport.resultName);
        await reportTask(task, "history", { ...partialImport, error: "" });
      } else {
        await reportTask(task, "reading");
        const submitted = await downloadSubmittedArticle(task.query, task.id);
        metadata = inspectWechatArticle(task.query, submitted.accountName);
        const accountName = metadata.accountName || submitted.accountName;
        await reportTask(task, "importing", { resultName: accountName });
        const submittedImport = await importDownloaded(submitted.outputDir, metadata.biz || submitted.articleKey, accountName, task.id);
        partialImport = { resultName: accountName, itemCount: Number(submittedImport.articles || 1) };
        await reportTask(task, "history", partialImport);
      }

      const accountName = metadata.accountName || partialImport.resultName;
      const candidate = resolveWechatAccount(task.query, accountName, metadata.biz);
      const saved = runJson(["exporter-add", "--from-json", JSON.stringify(candidate)]);
      const account = saved.account;
      if (syncSource === "weread") {
        const latest = await syncWereadAccount(account, task.id, { force: true });
        await request("/api/import-queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: task.id, status: "completed", stage: "completed", resultName: account.nickname || accountName, itemCount: Math.max(partialImport.itemCount, latest.imported), error: "" }),
        });
        completed += 1;
        continue;
      }
      syncExporterAccount(account.id);
      const knownArticles = runJson(["exporter-articles", "--account-id", String(account.id), "--limit", "20"]).articles || [];
      await importPublicationMetadata(account, knownArticles, task.id);
      const historyImport = await importAccount(account, [], task.id);
      await request("/api/import-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: task.id, status: "completed", stage: "completed", resultName: account.nickname || accountName, itemCount: Math.max(partialImport.itemCount, knownArticles.length, Number(historyImport.articles || 0)), error: "" }),
      });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "公众号导入失败";
      if (partialImport) {
        await request("/api/import-queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: task.id, ...retryablePartialImport(partialImport, message) }),
        });
        failed += 1;
        continue;
      }
      await request("/api/import-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: task.id, status: "failed", stage: "failed", error: message.slice(0, 500) }),
      }).catch(() => undefined);
      failed += 1;
    }
  }
  return { completed, failed };
}

export function dailySyncDecision(now, completedDate = "") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const afterWindow = (Number(parts.hour) * 60) + Number(parts.minute) >= (9 * 60) + 30;
  const completed = String(completedDate || "").trim() === today;
  return {
    today,
    shouldRun: afterWindow && !completed,
    reason: completed ? "completed" : afterWindow ? "ready" : "before-window",
  };
}

async function dailySync() {
  const previous = await readFile(stateFile, "utf8").catch(() => "");
  const decision = dailySyncDecision(new Date(), previous);
  if (!process.argv.includes("--force-daily") && !decision.shouldRun) {
    return { ran: false, accounts: 0, failed: 0, reason: decision.reason };
  }
  const accounts = runJson(["exporter-accounts"]).accounts || [];
  if (syncSource === "weread") return dailyWereadSync(accounts, decision);
  let synced = 0;
  let failed = 0;
  const errors = [];
  for (const account of accounts) {
    try {
      syncExporterAccount(account.id);
      const latest = runJson(["exporter-articles", "--account-id", String(account.id), "--limit", "20"]).articles || [];
      await importPublicationMetadata(account, latest);
      const rows = runJson(["exporter-articles", "--account-id", String(account.id), "--limit", "20", "--downloaded", "no"]).articles || [];
      if (rows.length) await importAccount(account, rows.map((article) => Number(article.id)).filter(Boolean));
      synced += 1;
    } catch (error) {
      failed += 1;
      const accountName = String(account.nickname || account.fakeid || account.id || "未知公众号");
      const message = error instanceof Error ? error.message : "公众号同步失败";
      errors.push(`${accountName}: ${message}`);
    }
  }
  if (failed === 0) {
    await mkdir(runtime, { recursive: true });
    await writeFile(stateFile, `${decision.today}\n`, "utf8");
  }
  return { ran: true, accounts: synced, failed, errors };
}

async function dailyWereadSync(accounts, decision) {
  const authError = wereadAuthCheck();
  if (authError) return { ran: true, source: "weread", accounts: 0, failed: Math.max(accounts.length, 1), errors: [authError] };
  let synced = 0;
  let failed = 0;
  let imported = 0;
  const errors = [];
  const details = [];
  for (const [index, account] of accounts.entries()) {
    const accountName = String(account.nickname || account.fakeid || account.id || "未知公众号");
    try {
      const result = await syncWereadAccount(account);
      synced += 1;
      imported += result.imported;
      details.push({ account: accountName, imported: result.imported, unchanged: result.unchanged, latest: result.latestTitle });
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "公众号同步失败";
      errors.push(`${accountName}: ${message}`);
      if (error instanceof WereadError && error.fatal) {
        const skipped = accounts.length - index - 1;
        failed += skipped;
        errors.push(`微信读书登录失效或被限流，已停止本轮同步（跳过 ${skipped} 个公众号）`);
        break;
      }
    }
  }
  if (failed === 0) {
    await mkdir(runtime, { recursive: true });
    await writeFile(stateFile, `${decision.today}\n`, "utf8");
  }
  return { ran: true, source: "weread", accounts: synced, failed, imported, details, errors };
}

async function main() {
  await mkdir(managedCacheRoot, { recursive: true });
  let pending;
  try {
    pending = await processPendingRequests();
  } catch (error) {
    pending = {
      completed: 0,
      failed: 1,
      error: error instanceof Error ? error.message : "读取公众号导入队列失败",
    };
  }
  const daily = await dailySync();
  const result = { ok: pending.failed === 0 && daily.failed === 0, pending, daily };
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "公众号自动同步失败");
      process.exitCode = 1;
    })
    .finally(closeSitesBrowser);
}
