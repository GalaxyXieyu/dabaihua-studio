import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** 旧 /weekly 列表并入 /ledger 的周视图；/weekly/<week>/ 的原文仍由 worker 提供。 */
export default function WeeklyRedirectPage() {
  redirect("/ledger?view=week");
}
