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
import careerJson from "../content/career/career.json";
import { digestReason, isoWeekOf, missingLine, shanghaiDate } from "./today-core";
import type { CareerData } from "./career";

type Env = { DB: D1Database };

const FINAL_ARTICLE_STATUSES = "'approved','published','changes-requested'";

export type TodayDraftItem = { title: string; href: string };
export type TodayDrafts = { total: number; items: TodayDraftItem[] };
export type TodayCandidates = { total: number; top: { id: number; title: string } | null };
export type TodayDigest = { today: number; latestDate: string | null; latestCount: number };
export type TodayMissing = { total: number; items: string[] };
export type TodayWeekly =
  | { week: string; href: string; isThisWeek: boolean; thisWeek: string }
  | { week: null; thisWeek: string };

export type TodayData = {
  date: string;
  drafts: TodayDrafts;
  candidates: TodayCandidates;
  digest: TodayDigest;
  missing: TodayMissing | null;
  weekly: TodayWeekly | null;
};

const DIGEST_PREFIX = "daily-ai-digest:";

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

  const missingData = (careerJson as unknown as CareerData).missing;
  const latestReason = digestLatest?.reason || null;

  const latest = reports[0];

  return {
    date,
    drafts: { total: Number(topicDraftCount?.c || 0) + Number(articleDraftCount?.c || 0), items: merged },
    candidates: { total: Number(candidateCount?.c || 0), top: candidateTop ? { id: Number(candidateTop.id), title: candidateTop.title || `选题 #${candidateTop.id}` } : null },
    digest: {
      today: Number(digestToday?.c || 0),
      latestDate: latestReason ? latestReason.slice(DIGEST_PREFIX.length) : null,
      latestCount: latestReason ? Number(digestLatest?.c || 0) : 0,
    },
    missing: isAdmin ? { total: missingData.total, items: missingData.top.slice(0, 3).map(missingLine) } : null,
    weekly: isAdmin
      ? latest
        ? { week: latest.week, href: `/weekly/${latest.week}/`, isThisWeek: latest.week === thisWeek, thisWeek }
        : { week: null, thisWeek }
      : null,
  };
}
