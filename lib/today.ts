/**
 * Server-side data for the "今天" page: one pass over the real in-app signals
 * that need a human decision today (pending drafts, candidate topics, the
 * daily-AI digest run, missing career numbers, this week's report).
 *
 * Everything here comes from existing tables or bundled, privacy-filtered
 * data — no placeholder numbers.
 */

import { ensureSchema } from "./store";
import { listWeeklyReports } from "./weekly";
import { loadCareerData } from "./career-data";
import { digestReason, isoWeekOf, missingLine, shanghaiDate } from "./today-core";

type Env = { DB: D1Database };

const FINAL_ARTICLE_STATUSES = "'approved','published','changes-requested'";

export type TodayDraftItem = { title: string; href: string };
export type TodayDrafts = { total: number; items: TodayDraftItem[] };
export type TodayCandidates = { total: number; top: { id: number; title: string } | null };
export type TodayDigest = { today: number; latestDate: string | null; latestCount: number };
export type TodayBrief = { date: string; isToday: boolean; topicCount: number; responseCount: number };
export type TodayMissing = { total: number; items: string[] };
export type TodayWeekly =
  | { week: string; href: string; isThisWeek: boolean; thisWeek: string }
  | { week: null; thisWeek: string };

export type TodayData = {
  date: string;
  drafts: TodayDrafts;
  brief: TodayBrief | null;
  candidates: TodayCandidates;
  digest: TodayDigest;
  missing: TodayMissing | { unavailable: true } | null;
  weekly: TodayWeekly | null;
};

const DIGEST_PREFIX = "daily-ai-digest:";

/**
 * Today's brief (or the latest one). Missing table / query errors must never
 * break the today page, so anything thrown returns null.
 */
async function loadTodayBrief(env: Env): Promise<TodayBrief | null> {
  try {
    const today = shanghaiDate();
    const row = await env.DB.prepare(
      `SELECT b.date AS date, b.topic_count AS topicCount,
        (SELECT COUNT(*) FROM daily_brief_responses r WHERE r.date = b.date) AS responseCount
       FROM daily_briefs b
       ORDER BY CASE WHEN b.date = ? THEN 0 ELSE 1 END, b.date DESC
       LIMIT 1`,
    ).bind(today).first<{ date: string; topicCount: number; responseCount: number }>();
    if (!row) return null;
    return {
      date: String(row.date),
      isToday: String(row.date) === today,
      topicCount: Number(row.topicCount || 0),
      responseCount: Number(row.responseCount || 0),
    };
  } catch {
    return null;
  }
}

export async function getTodayData(env: Env, { isAdmin }: { isAdmin: boolean }): Promise<TodayData> {
  await ensureSchema(env.DB);
  const date = shanghaiDate();
  const thisWeek = isoWeekOf(date);

  const pendingTopicWhere = `draft_markdown IS NOT NULL AND TRIM(draft_markdown) != '' AND COALESCE(NULLIF(TRIM(review_status), ''), 'pending') = 'pending'`;
  const pendingArticleWhere = `COALESCE(status, '') NOT IN (${FINAL_ARTICLE_STATUSES})`;

  const [
    topicDraftCount,
    articleDraftCount,
    topicDraftRows,
    articleDraftRows,
    candidateCount,
    candidateTop,
    digestToday,
    digestLatest,
    reports,
    brief,
  ] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS c FROM topics WHERE ${pendingTopicWhere}`).first<{ c: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM articles WHERE ${pendingArticleWhere}`).first<{ c: number }>(),
    env.DB.prepare(`SELECT id, title, updated_at AS updatedAt FROM topics WHERE ${pendingTopicWhere} ORDER BY updated_at DESC LIMIT 3`).all<{ id: number; title: string | null; updatedAt: string | null }>(),
    env.DB.prepare(`SELECT slug, title, updated_at AS updatedAt FROM articles WHERE ${pendingArticleWhere} ORDER BY updated_at DESC LIMIT 3`).all<{ slug: string; title: string | null; updatedAt: string | null }>(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM topics WHERE status = 'candidate'").first<{ c: number }>(),
    env.DB.prepare("SELECT id, title FROM topics WHERE status = 'candidate' ORDER BY total DESC, id DESC LIMIT 1").first<{ id: number; title: string | null }>(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM topics WHERE reason = ?").bind(digestReason(date)).first<{ c: number }>(),
    env.DB.prepare(`SELECT reason, COUNT(*) AS c FROM topics WHERE reason LIKE '${DIGEST_PREFIX}%' GROUP BY reason ORDER BY reason DESC LIMIT 1`).first<{ reason: string; c: number }>(),
    isAdmin ? listWeeklyReports(env) : Promise.resolve([]),
    isAdmin ? loadTodayBrief(env) : Promise.resolve(null),
  ]);

  const merged: TodayDraftItem[] = [
    ...topicDraftRows.results.map((row) => ({
      title: row.title || `选题 #${row.id}`,
      href: `/review/${row.id}`,
      updatedAt: row.updatedAt || "",
    })),
    ...articleDraftRows.results.map((row) => ({
      title: row.title || row.slug,
      href: `/articles/${row.slug}`,
      updatedAt: row.updatedAt || "",
    })),
  ]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, 3)
    .map(({ title, href }) => ({ title, href }));

  const career = loadCareerData();
  const latestReason = digestLatest?.reason || null;

  const latest = reports[0];

  return {
    date,
    drafts: { total: Number(topicDraftCount?.c || 0) + Number(articleDraftCount?.c || 0), items: merged },
    brief,
    candidates: { total: Number(candidateCount?.c || 0), top: candidateTop ? { id: Number(candidateTop.id), title: candidateTop.title || `选题 #${candidateTop.id}` } : null },
    digest: {
      today: Number(digestToday?.c || 0),
      latestDate: latestReason ? latestReason.slice(DIGEST_PREFIX.length) : null,
      latestCount: latestReason ? Number(digestLatest?.c || 0) : 0,
    },
    missing: isAdmin
      ? career
        ? { total: career.missing.total, items: career.missing.top.slice(0, 3).map(missingLine) }
        : { unavailable: true }
      : null,
    weekly: isAdmin
      ? latest
        ? { week: latest.week, href: `/weekly/${latest.week}/`, isThisWeek: latest.week === thisWeek, thisWeek }
        : { week: null, thisWeek }
      : null,
  };
}
