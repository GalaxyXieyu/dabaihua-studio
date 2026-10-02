// DB layer for full-text fetch of brief materials. Imports only `.ts` side
// modules (no lib/store) so tests can load it with tests/helpers/fake-d1.mjs.

import { isSummaryOnly, pickMaterialRow, reasonFromError, type FetchReason } from "./material-fetch-core.ts";
import { fetchMaterialText, type MaterialFetchResult } from "./material-fetch.ts";
import { itemUrlVariants } from "./item-url.ts";

export type MaterialFetchTarget = {
  id: number;
  url: string;
  contentMarkdown: string | null;
  originalExcerpt: string | null;
  translatedExcerpt: string | null;
  fetchStatus: string | null;
  fetchReason?: string | null;
};

export type MaterialFetchSummary = { checked: number; fetched: number; failed: Array<{ url: string; reason: FetchReason }>; skipped: number };

/** 一条素材是否还只有摘要（因此值得尝试抓原文）。 */
function targetIsSummaryOnly(target: MaterialFetchTarget): boolean {
  return isSummaryOnly({
    contentMarkdown: target.contentMarkdown,
    originalExcerpt: target.originalExcerpt,
    translatedExcerpt: target.translatedExcerpt,
  });
}

/**
 * 抓取只带摘要的素材并写回 items。成功替换 content_markdown 并标记 ok；
 * 失败只记失败原因，绝不改 content_markdown。
 */
export async function fetchMaterialTexts(
  db: D1Database,
  targets: MaterialFetchTarget[],
  options?: { force?: boolean; concurrency?: number; fetcher?: (url: string) => Promise<MaterialFetchResult> },
): Promise<MaterialFetchSummary> {
  const force = options?.force === true;
  const fetcher = options?.fetcher ?? ((url: string) => fetchMaterialText(url));
  const summary: MaterialFetchSummary = { checked: 0, fetched: 0, failed: [], skipped: 0 };

  const queue: MaterialFetchTarget[] = [];
  for (const target of targets || []) {
    if (!targetIsSummaryOnly(target)) {
      summary.skipped += 1;
      continue;
    }
    if (!force && target.fetchStatus === "failed") {
      summary.skipped += 1;
      continue;
    }
    queue.push(target);
  }
  if (!queue.length) return summary;

  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 3, queue.length));
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= queue.length) return;
      const target = queue[index];
      summary.checked += 1;

      let result: MaterialFetchResult;
      try {
        result = await fetcher(target.url);
      } catch (error) {
        result = { ok: false, reason: reasonFromError(error) };
      }

      const timestamp = new Date().toISOString();
      if (result.ok) {
        await db
          .prepare(
            "UPDATE items SET content_markdown = ?, author = COALESCE(NULLIF(author, ''), ?), content_fetch_status = 'ok', content_fetch_reason = NULL, content_fetched_at = ? WHERE id = ?",
          )
          .bind(result.markdown, String(result.author || ""), timestamp, target.id)
          .run();
        summary.fetched += 1;
      } else {
        await db
          .prepare("UPDATE items SET content_fetch_status = 'failed', content_fetch_reason = ?, content_fetched_at = ? WHERE id = ?")
          .bind(result.reason, timestamp, target.id)
          .run();
        summary.failed.push({ url: target.url, reason: result.reason });
      }
    }
  });
  await Promise.all(runners);
  return summary;
}

/**
 * 从 daily_briefs.data_json 取当天所有素材 URL，按 items.url 精确匹配
 * （先试原样，再试去掉 / 加末尾斜杠以及规范化形式），返回抓取目标。
 */
export async function briefMaterialTargets(db: D1Database, date: string): Promise<MaterialFetchTarget[]> {
  const row = await db.prepare("SELECT data_json AS dataJson FROM daily_briefs WHERE date = ?").bind(date).first<{ dataJson: string }>();
  if (!row) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(row.dataJson || ""));
  } catch {
    return [];
  }

  const topics = (parsed as { topics?: unknown } | null)?.topics;
  const urls: string[] = [];
  const seenUrl = new Set<string>();
  if (Array.isArray(topics)) {
    for (const topic of topics) {
      const materials = (topic as { materials?: unknown } | null)?.materials;
      if (!Array.isArray(materials)) continue;
      for (const material of materials) {
        const url = String((material as { url?: unknown } | null)?.url ?? "").trim();
        if (!url || seenUrl.has(url)) continue;
        seenUrl.add(url);
        urls.push(url);
      }
    }
  }
  if (!urls.length) return [];

  const candidateToBrief = new Map<string, string>();
  for (const url of urls) {
    for (const candidate of itemUrlVariants(url)) {
      if (!candidateToBrief.has(candidate)) candidateToBrief.set(candidate, url);
    }
  }
  const placeholders = Array.from(candidateToBrief.keys()).map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT id, url, content_markdown AS contentMarkdown, original_excerpt AS originalExcerpt, translated_excerpt AS translatedExcerpt, content_fetch_status AS fetchStatus, content_fetch_reason AS fetchReason FROM items WHERE url IN (${placeholders})`,
    )
    .bind(...candidateToBrief.keys())
    .all<{
      id: number;
      url: string;
      contentMarkdown: string | null;
      originalExcerpt: string | null;
      translatedExcerpt: string | null;
      fetchStatus: string | null;
      fetchReason: string | null;
    }>();

  const rowsByBriefUrl = new Map<string, MaterialFetchTarget[]>();
  for (const item of rows.results) {
    const briefUrl = candidateToBrief.get(String(item.url));
    if (!briefUrl) continue;
    const list = rowsByBriefUrl.get(briefUrl) || [];
    list.push({
      id: Number(item.id),
      url: briefUrl,
      contentMarkdown: item.contentMarkdown ?? null,
      originalExcerpt: item.originalExcerpt ?? null,
      translatedExcerpt: item.translatedExcerpt ?? null,
      fetchStatus: item.fetchStatus ?? null,
      fetchReason: item.fetchReason ?? null,
    });
    rowsByBriefUrl.set(briefUrl, list);
  }
  const byBriefUrl = new Map<string, MaterialFetchTarget>();
  for (const [briefUrl, list] of rowsByBriefUrl) {
    const picked = pickMaterialRow(list);
    if (picked) byBriefUrl.set(briefUrl, picked);
  }

  return urls.map((url) => byBriefUrl.get(url)).filter((target): target is MaterialFetchTarget => Boolean(target));
}
