import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** 旧 /topics 列表并入 /content 的选题看板视图。 */
export default function TopicsRedirectPage() {
  redirect("/content?view=board");
}
