import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../lib/auth";
import { requestOrigin } from "../lib/request-origin";
import { SiteAppBar } from "./_components/SiteAppBar";
import { getTodayData } from "../lib/today";

export const dynamic = "force-dynamic";
export const metadata = { title: "今天", robots: { index: false, follow: false } };

const rowNameClass = "shrink-0 text-sm font-bold sm:w-[5.5rem]";
const rowBodyClass = "min-w-0 text-sm leading-relaxed";
const emptyClass = "text-[var(--muted)]";
const linkClass = "text-[var(--green)] hover:underline";

export default async function TodayPage() {
  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/");

  const isAdmin = user.role === "admin";
  const data = await getTodayData(env, { isAdmin });

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[var(--canvas)] text-[var(--ink)]">
      <SiteAppBar role={user.role} pathname="/" />
      <main className="mx-auto max-w-[720px] px-4 py-5">
        <header className="flex flex-wrap items-baseline gap-2 border-b border-[var(--line)] pb-3">
          <h1 className="text-lg font-bold">今天</h1>
          <span className="text-xs text-[var(--faint)]">{data.date}（北京时间）</span>
        </header>

        <ul>
          <li className="flex flex-col gap-1 border-b border-[var(--line)] py-3 sm:flex-row sm:gap-3">
            <span className={rowNameClass}>待审稿件</span>
            <div className={rowBodyClass}>
              {data.drafts.total > 0 ? (
                <span>
                  {data.drafts.total} 篇：
                  {data.drafts.items.map((item, index) => (
                    <span key={item.href}>
                      {index > 0 ? "、" : ""}
                      <a className={linkClass} href={item.href}>
                        {item.title}
                      </a>
                    </span>
                  ))}
                  {data.drafts.total > 3 ? "等" : ""}
                </span>
              ) : (
                <span className={emptyClass}>没有待审稿件</span>
              )}
            </div>
          </li>

          <li className="flex flex-col gap-1 border-b border-[var(--line)] py-3 sm:flex-row sm:gap-3">
            <span className={rowNameClass}>待挑选题</span>
            <div className={rowBodyClass}>
              {data.candidates.total > 0 ? (
                <a className={linkClass} href="/topics">
                  {data.candidates.total} 个候选
                  {data.candidates.top ? `，最高分：${data.candidates.top.title}` : ""}
                </a>
              ) : (
                <span className={emptyClass}>没有待挑选题</span>
              )}
            </div>
          </li>

          <li className="flex flex-col gap-1 border-b border-[var(--line)] py-3 sm:flex-row sm:gap-3">
            <span className={rowNameClass}>每日 AI 简报</span>
            <div className={rowBodyClass}>
              {data.digest.today > 0 ? (
                <a className={linkClass} href="/topics">
                  今天的简报产出 {data.digest.today} 个选题
                </a>
              ) : data.digest.latestDate ? (
                <a className={linkClass} href="/topics">
                  今天还没有简报，最近一次 {data.digest.latestDate}（{data.digest.latestCount} 个选题）
                </a>
              ) : (
                <span className={emptyClass}>没有 AI 简报</span>
              )}
            </div>
          </li>

          {isAdmin && data.missing && (
            <li className="flex flex-col gap-1 border-b border-[var(--line)] py-3 sm:flex-row sm:gap-3">
              <span className={rowNameClass}>缺数字</span>
              <div className={rowBodyClass}>
                {data.missing.total > 0 ? (
                  <div>
                    <p>共 {data.missing.total} 条，前 3 条：</p>
                    <ul>
                      {data.missing.items.map((line) => (
                        <li key={line} className="text-xs leading-relaxed text-[var(--muted)]">
                          {line}
                        </li>
                      ))}
                    </ul>
                    <a className={linkClass} href="/career">
                      去补数字
                    </a>
                  </div>
                ) : (
                  <span className={emptyClass}>没有缺数字的成果</span>
                )}
              </div>
            </li>
          )}

          {isAdmin && data.weekly && (
            <li className="flex flex-col gap-1 border-b border-[var(--line)] py-3 sm:flex-row sm:gap-3">
              <span className={rowNameClass}>本周周报</span>
              <div className={rowBodyClass}>
                {data.weekly.week ? (
                  data.weekly.isThisWeek ? (
                    <a className={linkClass} href={data.weekly.href}>
                      {data.weekly.week} 周报
                    </a>
                  ) : (
                    <a className={linkClass} href={data.weekly.href}>
                      本周（{data.weekly.thisWeek}）还没发布，最新一期 {data.weekly.week}
                    </a>
                  )
                ) : (
                  <span className={emptyClass}>还没有周报</span>
                )}
              </div>
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
