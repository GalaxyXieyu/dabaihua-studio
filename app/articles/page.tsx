import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** 旧 /articles 目录并入 /content 的文章视图；/articles/<slug> 详情保持不变。 */
export default function ArticlesRedirectPage() {
  redirect("/content?view=articles");
}
