import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../lib/auth";
import { requestOrigin } from "../lib/request-origin";
import { getTodayData } from "../lib/today";
import { dateLabel } from "../lib/today-core";
import { SiteAppBar } from "./_components/SiteAppBar";
import "./today.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "今天", robots: { index: false, follow: false } };

const WEEKDAY_CN = "日一二三四五六";
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

/** 报纸刊头第一行：`2026 年 9 月 28 日 · 星期一`。 */
function mastheadLine(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = WEEKDAY_CN[date.getUTCDay()];
  return `${year} 年 ${month} 月 ${day} 日 · 星期${weekday}`;
}

/** `2026-W40` → `40`，用于周报那一行的大数字。 */
function weekNumber(iso: string): string {
  return String(Number(iso.slice(iso.indexOf("-W") + 2)));
}

function seq(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function indexClass(value: number): string {
  return value > 0 ? "td-a-index tabular-nums" : "td-a-index tabular-nums is-zero";
}

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
    <div className="td-a">
      <SiteAppBar user={user} pathname="/" />

      <div className="td-a-masthead-wrap">
        <div className="td-a-double-rule" />
        <header className="td-a-masthead">
          <time className="td-a-kicker" dateTime={data.date} aria-label={dateLabel(data.date)}>
            {mastheadLine(data.date)}
          </time>
          <h1 className="td-a-wordmark">今天</h1>
          <p className="td-a-subtitle">今日需要你拍板的事</p>
        </header>
        <div className="td-a-double-rule" />
      </div>

      <main className="td-a-briefing">
        <section className="td-a-row" aria-labelledby="td-a-row-drafts">
          <div className="td-a-col-label">
            <span className="td-a-roman" aria-hidden="true">{ROMAN[0]}</span>
            <span className="td-a-label" id="td-a-row-drafts">待审稿件</span>
          </div>
          <div className="td-a-col-body">
            {data.drafts.total > 0 ? (
              <>
                <p className="td-a-lede is-headline">{data.drafts.total} 篇稿件等你审</p>
                <ol className="td-a-titles">
                  {data.drafts.items.map((item, i) => (
                    <li key={item.href} className="td-a-title-item">
                      <span className="td-a-seq tabular-nums">{seq(i)}</span>
                      <a className="td-a-title-link" href={item.href}>
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ol>
                {data.drafts.total > 3 && <p className="td-a-note">还有 {data.drafts.total - 3} 篇</p>}
              </>
            ) : (
              <p className="td-a-empty">没有待审稿件</p>
            )}
            {data.drafts.total > 0 && data.drafts.items[0] && (
              <a className="td-a-action" href={data.drafts.items[0].href}>
                去审稿 →
              </a>
            )}
          </div>
          <div className="td-a-col-figure">
            <span className={indexClass(data.drafts.total)}>{data.drafts.total}</span>
            <span className="td-a-unit">篇</span>
          </div>
        </section>

        {isAdmin && (
          <section className="td-a-row" aria-labelledby="td-a-row-brief">
            <div className="td-a-col-label">
              <span className="td-a-roman" aria-hidden="true">{ROMAN[1]}</span>
              <span className="td-a-label" id="td-a-row-brief">选题简报</span>
            </div>
            <div className="td-a-col-body">
              {data.brief ? (
                data.brief.isToday ? (
                  <p className="td-a-lede">今天 {data.brief.topicCount} 个选题，已回复 {data.brief.responseCount} 个</p>
                ) : (
                  <>
                    <p className="td-a-lede">今天还没有简报</p>
                    <p className="td-a-note">
                      最近一期 {data.brief.date}，{data.brief.topicCount} 个选题，已回复 {data.brief.responseCount} 个
                    </p>
                  </>
                )
              ) : (
                <p className="td-a-empty">还没有选题简报</p>
              )}
              <a className="td-a-action" href="/topics/daily">
                去看简报 →
              </a>
            </div>
            <div className="td-a-col-figure">
              <span className={indexClass(data.brief?.topicCount ?? 0)}>{data.brief?.topicCount ?? 0}</span>
              <span className="td-a-unit">个</span>
            </div>
          </section>
        )}

        <section className="td-a-row" aria-labelledby="td-a-row-candidates">
          <div className="td-a-col-label">
            <span className="td-a-roman" aria-hidden="true">{isAdmin ? ROMAN[2] : ROMAN[1]}</span>
            <span className="td-a-label" id="td-a-row-candidates">待挑选题</span>
          </div>
          <div className="td-a-col-body">
            {data.candidates.total > 0 ? (
              <>
                <p className="td-a-lede">{data.candidates.total} 个候选待你挑</p>
                {data.candidates.top && <p className="td-a-note">最高分：{data.candidates.top.title}</p>}
              </>
            ) : (
              <p className="td-a-empty">没有待挑选题</p>
            )}
            {data.candidates.total > 0 && (
              <a className="td-a-action" href="/topics">
                去挑选 →
              </a>
            )}
          </div>
          <div className="td-a-col-figure">
            <span className={indexClass(data.candidates.total)}>{data.candidates.total}</span>
            <span className="td-a-unit">个</span>
          </div>
        </section>

        <section className="td-a-row" aria-labelledby="td-a-row-digest">
          <div className="td-a-col-label">
            <span className="td-a-roman" aria-hidden="true">{isAdmin ? ROMAN[3] : ROMAN[2]}</span>
            <span className="td-a-label" id="td-a-row-digest">每日 AI 简报</span>
          </div>
          <div className="td-a-col-body">
            {data.digest.today > 0 ? (
              <p className="td-a-lede">今天产出 {data.digest.today} 个选题</p>
            ) : data.digest.latestDate ? (
              <>
                <p className="td-a-lede">今天还没有简报</p>
                <p className="td-a-note">
                  最近一次 {data.digest.latestDate}，{data.digest.latestCount} 个选题
                </p>
              </>
            ) : (
              <p className="td-a-empty">没有 AI 简报</p>
            )}
            {(data.digest.today > 0 || data.digest.latestDate) && (
              <a className="td-a-action" href="/topics">
                看选题 →
              </a>
            )}
          </div>
          <div className="td-a-col-figure">
            <span className={indexClass(data.digest.today)}>{data.digest.today}</span>
            <span className="td-a-unit">个</span>
          </div>
        </section>

        {isAdmin && data.missing && (
          <section className="td-a-row" aria-labelledby="td-a-row-missing">
            <div className="td-a-col-label">
              <span className="td-a-roman" aria-hidden="true">{ROMAN[4]}</span>
              <span className="td-a-label" id="td-a-row-missing">缺数字</span>
            </div>
            <div className="td-a-col-body">
              {"unavailable" in data.missing ? (
                <p className="td-a-empty">还没有职业数据</p>
              ) : data.missing.total > 0 ? (
                <>
                  <p className="td-a-lede">{data.missing.total} 条成果缺数字</p>
                  <ul className="td-a-missing">
                    {data.missing.items.map((line) => (
                      <li key={line}>— {line}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="td-a-empty">没有缺数字的成果</p>
              )}
              {"total" in data.missing && data.missing.total > 0 && (
                <a className="td-a-action" href="/career">
                  去补数字 →
                </a>
              )}
            </div>
            <div className="td-a-col-figure">
              <span className={indexClass("total" in data.missing ? data.missing.total : 0)}>
                {"total" in data.missing ? data.missing.total : 0}
              </span>
              <span className="td-a-unit">条</span>
            </div>
          </section>
        )}

        {isAdmin && data.weekly && (
          <section className="td-a-row" aria-labelledby="td-a-row-weekly">
            <div className="td-a-col-label">
              <span className="td-a-roman" aria-hidden="true">{ROMAN[5]}</span>
              <span className="td-a-label" id="td-a-row-weekly">本周周报</span>
            </div>
            <div className="td-a-col-body">
              {data.weekly.week ? (
                data.weekly.isThisWeek ? (
                  <p className="td-a-lede">{data.weekly.week} 已发布</p>
                ) : (
                  <>
                    <p className="td-a-lede">本周（{data.weekly.thisWeek}）还没发布</p>
                    <p className="td-a-note">最新一期 {data.weekly.week}</p>
                  </>
                )
              ) : (
                <p className="td-a-empty">还没有周报</p>
              )}
              {data.weekly.week && (
                <a className="td-a-action" href={data.weekly.href}>
                  {data.weekly.isThisWeek ? "打开 →" : "打开最新一期 →"}
                </a>
              )}
            </div>
            <div className="td-a-col-figure">
              {data.weekly.week ? (
                <>
                  <span
                    className={
                      data.weekly.isThisWeek
                        ? "td-a-index tabular-nums"
                        : "td-a-index tabular-nums is-zero"
                    }
                  >
                    {weekNumber(data.weekly.week)}
                  </span>
                  <span className="td-a-unit">期</span>
                  {!data.weekly.isThisWeek && <span className="td-a-unit-note">本周未发</span>}
                </>
              ) : (
                <>
                  <span className="td-a-index tabular-nums is-zero">—</span>
                  <span className="td-a-unit">期</span>
                </>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="td-a-footer">
        <div className="td-a-footer-rule" />
        <p className="td-a-footer-text">大白话工作室 · 每日简报</p>
      </footer>
    </div>
  );
}
