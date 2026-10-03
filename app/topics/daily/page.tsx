import { redirect } from "next/navigation";
import { isValidBriefDate } from "../../../lib/daily-brief-core";

export const dynamic = "force-dynamic";

const TOPIC_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** 旧 /topics/daily 链接继续可用：跳到 /content 的简报视图，带上合法日期与选题。 */
export default async function DailyBriefRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; topic?: string }>;
}) {
  const { date, topic } = await searchParams;
  const params = new URLSearchParams({ view: "brief" });
  if (date && isValidBriefDate(date)) params.set("date", date);
  if (topic && TOPIC_ID_RE.test(topic)) params.set("topic", topic);
  redirect(`/content?${params.toString()}`);
}
