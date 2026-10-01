/**
 * candidates-archive.mjs — digest 候选素材的永久归档。
 *
 * `.cache/<date>.json` 只保留最新一天，迁移时容易丢；这里把每天的候选素材
 * 追加进 `<outDir>/candidates/<date>.json`，只增不改，供 topic-kb 反复入库。
 * 已存在的 URL 不重复追加，旧的条目原样保留。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeUrl } from "./digest-text.mjs";

function writeJsonAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 把当天的候选素材追加归档到 candidates/<date>.json。
 * 文件不存在时新建；已存在时按 normalizeUrl 去重后只追加新 URL，runs 按 generatedAt 去重。
 */
export function archiveCandidates(outDir, date, { materials, llmResult, stats, generatedAt } = {}) {
  const file = path.join(outDir, "candidates", `${date}.json`);
  const now = new Date().toISOString();
  const existing = readJson(file);
  const items = Array.isArray(llmResult?.items) ? llmResult.items : [];
  const run = {
    generatedAt: generatedAt || now,
    stats: stats || {},
    itemIds: items.map((item) => item?.id).filter((id) => id !== undefined && id !== null),
  };
  const incoming = (Array.isArray(materials) ? materials : []).map((material) => ({
    ...material,
    archivedAt: now,
  }));

  if (!existing || !Array.isArray(existing.materials)) {
    writeJsonAtomic(file, {
      version: 1,
      date,
      createdAt: now,
      updatedAt: now,
      materials: incoming,
      runs: [run],
    });
    return { file, added: incoming.length, total: incoming.length };
  }

  // 用 normalizeUrl(url) 判重；没有 url 的条目退回用 id 判重。
  const seenUrls = new Set();
  const seenIds = new Set();
  for (const material of existing.materials) {
    const key = normalizeUrl(material?.url);
    if (key) seenUrls.add(key);
    else if (material?.id) seenIds.add(String(material.id));
  }
  const added = [];
  for (const material of incoming) {
    const key = normalizeUrl(material?.url);
    if (key) {
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
    } else if (material?.id) {
      if (seenIds.has(String(material.id))) continue;
      seenIds.add(String(material.id));
    }
    added.push(material);
  }

  const runs = Array.isArray(existing.runs) ? [...existing.runs] : [];
  if (!runs.some((entry) => entry && entry.generatedAt === run.generatedAt)) runs.push(run);

  writeJsonAtomic(file, {
    ...existing,
    version: existing.version || 1,
    date: existing.date || date,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    materials: [...existing.materials, ...added],
    runs,
  });
  return { file, added: added.length, total: existing.materials.length + added.length };
}
