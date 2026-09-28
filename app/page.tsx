import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../lib/auth";
import { requestOrigin } from "../lib/request-origin";
import { SiteAppBar } from "./_components/SiteAppBar";
import { getTodayData } from "../lib/today";
import { dateLabel } from "../lib/today-core";

export const dynamic = "force-dynamic";
export const metadata = { title: "今天", robots: { index: false, follow: false } };

const rowClass = "flex flex-col gap-1.5 border-b border-[var(--line)] py-5 sm:grid sm:grid-cols-[7.5rem_1fr_auto] sm:gap-6 sm:items-baseline";
const rowNameClass = "text-[13px] text-[var(--muted)]";
const primaryClass = "text-[15px] leading-relaxed text-[var(--ink)] tabular-nums";
const secondaryClass = "text-[13px] text-[var(--muted)] tabular-nums";
const emptyClass = "text-[15px] text-[var(--faint)]";
const actionClass = "whitespace-nowrap text-[13px] font-medium text-[var(--green)] hover:underline underline-offset-4";
const titleLinkClass = "text-[var(--ink)] hover:text-[var(--green)] hover:underline underline-offset-4";

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
      <main className="mx-auto max-w-[760px] px-5 pt-10 pb-16 sm:px-8 sm:pt-14">
        <header>
          <h1 className="text-[28px] font-semibold tracking-tight">今天</h1>
          <p className="mt-1.5 text-[13px] text-[var(--muted)]">{dateLabel(data.date)}</p>
        </header>

        <ul className="mt-8 border-t border-[var(--line)]">
          <li className={rowClass}>
            <span className={rowNameClass}>待审稿件</span>
            <div className="min-w-0">
              {data.drafts.total > 0 ? (
                <>
                  <p className={primaryClass}>{data.drafts.total} 篇待审</p>
                  <ul className="mt-1">
                    {data.drafts.items.map((item) => (
                      <li key={item.href} className="text-[14px] leading-relaxed">
                        <a className={titleLinkClass} href={item.href}>
                          {item.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                  {data.drafts.total > 3 && <p className={`mt-1 ${secondaryClass}`}>还有 {data.drafts.total - 3} 篇</p>}
                </>
              ) : (
                <p className={emptyClass}>没有待审稿件</p>
              )}
            </div>
            {data.drafts.total > 0 && data.drafts.items[0] && (
              <a className={actionClass} href={data.drafts.items[0].href}>
                去审稿 →
              </a>
            )}
          </li>

          <li className={rowClass}>
            <span className={rowNameClass}>待挑选题</span>
            <div className="min-w-0">
              {data.candidates.total > 0 ? (
                <>
                  <p className={primaryClass}>{data.candidates.total} 个候选</p>
                  {data.candidates.top && <p className={secondaryClass}>最高分：{data.candidates.top.title}</p>}
                </>
              ) : (
                <p className={emptyClass}>没有待挑选题</p>
              )}
            </div>
            {data.candidates.total > 0 && (
              <a className={actionClass} href="/topics">
                去挑选 →
              </a>
            )}
          </li>

          <li className={rowClass}>
            <span className={rowNameClass}>每日 AI 简报</span>
            <div className="min-w-0">
              {data.digest.today > 0 ? (
                <p className={primaryClass}>今天产出 {data.digest.today} 个选题</p>
              ) : data.digest.latestDate ? (
                <>
                  <p className={primaryClass}>今天还没有简报</p>
                  <p className={secondaryClass}>
                    最近一次 {data.digest.latestDate}，{data.digest.latestCount} 个选题
                  </p>
                </>
              ) : (
                <p className={emptyClass}>没有 AI 简报</p>
              )}
            </div>
            {(data.digest.today > 0 || data.digest.latestDate) && (
              <a className={actionClass} href="/topics">
                看选题 →
              </a>
            )}
          </li>

          {isAdmin && data.missing && (
            <li className={rowClass}>
              <span className={rowNameClass}>缺数字</span>
              <div className="min-w-0">
                {data.missing.total > 0 ? (
                  <>
                    <p className={primaryClass}>{data.missing.total} 条成果缺数字</p>
                    <ul className="mt-1">
                      {data.missing.items.map((line) => (
                        <li key={line} className="text-[13px] leading-relaxed text-[var(--muted)]">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className={emptyClass}>没有缺数字的成果</p>
                )}
              </div>
              {data.missing.total > 0 && (
                <a className={actionClass} href="/career">
                  去补数字 →
                </a>
              )}
            </li>
          )}

          {isAdmin && data.weekly && (
            <li className={rowClass}>
              <span className={rowNameClass}>本周周报</span>
              <div className="min-w-0">
                {data.weekly.week ? (
                  data.weekly.isThisWeek ? (
                    <p className={primaryClass}>{data.weekly.week} 已发布</p>
                  ) : (
                    <>
                      <p className={primaryClass}>本周（{data.weekly.thisWeek}）还没发布</p>
                      <p className={secondaryClass}>最新一期 {data.weekly.week}</p>
                    </>
                  )
                ) : (
                  <p className={emptyClass}>还没有周报</p>
                )}
              </div>
              {data.weekly.week && (
                <a className={actionClass} href={data.weekly.href}>
                  {data.weekly.isThisWeek ? "打开 →" : "打开最新一期 →"}
                </a>
              )}
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
