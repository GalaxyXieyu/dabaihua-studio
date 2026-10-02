import { env } from "cloudflare:workers";
import { assertSameOrigin, authenticateApiKey, getSessionUser, type SessionUser } from "../../../../../lib/auth";
import { isValidBriefDate } from "../../../../../lib/daily-brief-core";
import { getBrief, runBriefMaterialFetch } from "../../../../../lib/daily-brief";
import { briefMaterialTargets } from "../../../../../lib/brief-material-fetch";
import { isSummaryOnly } from "../../../../../lib/material-fetch-core";
import { PayloadTooLargeError, readBodyWithLimit } from "../../../../../lib/weekly";

type Params = { params: Promise<{ date: string }> };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Bearer `topk_…` key or website session, admin only. */
async function authorize(request: Request, write: boolean): Promise<{ user: SessionUser } | Response> {
  const viaKey = await authenticateApiKey(env, request);
  if (viaKey.status === "ok") {
    if (viaKey.user.role !== "admin") return json({ error: "forbidden" }, 403);
    return { user: viaKey.user };
  }
  const user = await getSessionUser(env, request);
  if (!user) return json({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);
  if (write) {
    try {
      assertSameOrigin(request);
    } catch {
      return json({ error: "forbidden" }, 403);
    }
  }
  return { user };
}

/** 手动补抓当天素材；body 可选 `{ "force": true }`。 */
export async function POST(request: Request, { params }: Params) {
  const auth = await authorize(request, true);
  if (auth instanceof Response) return auth;
  const { date } = await params;
  if (!isValidBriefDate(date)) return json({ error: "invalid brief", errors: ["路径日期不合法"] }, 400);

  let force = false;
  try {
    const bytes = await readBodyWithLimit(request, 4096);
    if (bytes.byteLength) {
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      force = parsed !== null && typeof parsed === "object" && (parsed as { force?: unknown }).force === true;
    }
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: "payload too large" }, 413);
    return json({ error: "invalid body", errors: ["请求体不是合法 JSON"] }, 400);
  }

  const stored = await getBrief(env, date);
  if (!stored) return json({ error: "not found" }, 404);

  const summary = await runBriefMaterialFetch(env, date, { force });
  return json({ ok: true, date, ...summary });
}

/** 排查用只读视图：当天每条素材的抓取状态。 */
export async function GET(request: Request, { params }: Params) {
  const auth = await authorize(request, false);
  if (auth instanceof Response) return auth;
  const { date } = await params;
  if (!isValidBriefDate(date)) return json({ error: "not found" }, 404);

  const stored = await getBrief(env, date);
  if (!stored) return json({ error: "not found" }, 404);

  const targets = await briefMaterialTargets(env.DB, date);
  const byUrl = new Map(targets.map((target) => [target.url, target]));
  const materials: Array<{ url: string; itemId: number | null; summaryOnly: boolean; fetchStatus: string | null; fetchReason: string | null }> = [];
  const seen = new Set<string>();
  for (const topic of stored.brief.topics) {
    for (const material of topic.materials) {
      const url = String(material.url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const target = byUrl.get(url);
      if (!target) {
        materials.push({ url, itemId: null, summaryOnly: true, fetchStatus: null, fetchReason: null });
        continue;
      }
      materials.push({
        url,
        itemId: target.id,
        summaryOnly: isSummaryOnly({
          contentMarkdown: target.contentMarkdown,
          originalExcerpt: target.originalExcerpt,
          translatedExcerpt: target.translatedExcerpt,
        }),
        fetchStatus: target.fetchStatus,
        fetchReason: target.fetchReason ?? null,
      });
    }
  }
  return json({ ok: true, date, materials });
}
