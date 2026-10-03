import { redirect } from "next/navigation";
import { dateParts } from "../../lib/daily";

export const dynamic = "force-dynamic";

/** 旧 /daily 链接继续可用：跳到 /ledger 的日视图，带上合法日期。 */
export default async function DailyRedirectPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  redirect(date && dateParts(date) ? `/ledger?view=day&date=${date}` : "/ledger?view=day");
}
