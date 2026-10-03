import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../../lib/auth";
import { requestOrigin } from "../../../lib/request-origin";
import { getBrief, getLatestBriefDate, listBriefDates, listResponses } from "../../../lib/daily-brief";
import { isValidBriefDate } from "../../../lib/daily-brief-core";
import { findMaterialItemsByUrls } from "../../../lib/store";
import { orderBriefTopics, pickInitialTopic, toMaterialView, type MaterialView } from "../../../lib/brief-view";
import { dateLabel, shanghaiDate } from "../../../lib/today-core";
import { SiteAppBar } from "../../_components/SiteAppBar";
import { DailyBrief } from "./_components/DailyBrief";
import "./daily-brief.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };

export default async function DailyBriefPage({ searchParams }: { searchParams: Promise<{ date?: string; topic?: string }> }) {
  const { date: requested, topic: requestedTopic } = await searchParams;

  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/topics/daily`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/topics/daily");
  if (user.role !== "admin") notFound();

  const dates = await listBriefDates(env);
  const selected = requested && isValidBriefDate(requested) ? requested : await getLatestBriefDate(env);
  const stored = selected ? await getBrief(env, selected) : null;
  const label = dateLabel(selected ?? shanghaiDate());

  const materialsByUrl: Record<string, MaterialView> = {};
  let initialTopicId: string | null = null;
  let initialResponses: Awaited<ReturnType<typeof listResponses>> = [];
  if (stored && selected) {
    const materialUrls = stored.brief.topics.flatMap((topic) => topic.materials.map((material) => material.url)).filter(Boolean);
    const materialItems = await findMaterialItemsByUrls(env, materialUrls);
    for (const topic of stored.brief.topics) {
      for (const material of topic.materials) {
        if (!material.url) continue;
        materialsByUrl[material.url] = toMaterialView(material, materialItems.get(material.url) ?? null);
      }
    }

    initialResponses = await listResponses(env, { date: selected });
    const decided: Record<string, "pick" | "reject" | null> = {};
    for (const response of initialResponses) {
      if (response.user.account !== user.account) continue;
      decided[response.topicId] = response.decision;
    }
    const ordered = orderBriefTopics(stored.brief.topics, stored.brief.recommendation?.topicId ?? null);
    initialTopicId = pickInitialTopic(
      ordered.map((topic) => topic.id),
      stored.brief.recommendation?.topicId ?? null,
      decided,
      requestedTopic ?? null,
    );
  }

  return (
    <div className="db-page">
      <SiteAppBar user={user} pathname="/topics/daily" />
      {stored && selected ? (
        <DailyBrief
          date={selected}
          dateLabel={label}
          brief={stored.brief}
          dates={dates}
          userAccount={user.account}
          initialResponses={initialResponses}
          materialsByUrl={materialsByUrl}
          initialTopicId={initialTopicId}
          requestedTopic={requestedTopic ?? null}
        />
      ) : (
        <main className="db-empty-wrap">
          <h1 className="page-title">{label}</h1>
          <div className="double-rule" />
          <div className="db-empty">
            <h2>还没有选题简报</h2>
            <p>等晴儿推送后，这里会显示当天的选题卡片。</p>
          </div>
        </main>
      )}
    </div>
  );
}
