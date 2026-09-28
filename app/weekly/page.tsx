import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { listWeeklyReports } from "../../lib/weekly";
import { SiteAppBar } from "../_components/SiteAppBar";
import "./weekly.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };

function isoWeekRange(week: string) {
  const year = Number(week.slice(0, 4));
  const number = Number(week.slice(6));
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = jan4.getUTCDay() || 7; // 1 = Monday .. 7 = Sunday
  const week1Monday = new Date(jan4.getTime() - (weekday - 1) * 86400000);
  const monday = new Date(week1Monday.getTime() + (number - 1) * 7 * 86400000);
  return { monday, sunday: new Date(monday.getTime() + 6 * 86400000) };
}

function formatMonthDay(date: Date) {
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShanghai(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** `2026-W39` → `39`，用于列表左侧的大号周序号。 */
function weekNumber(iso: string): string {
  return String(Number(iso.slice(iso.indexOf("-W") + 2)));
}

export default async function WeeklyPage() {
  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/weekly`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/weekly");
  if (user.role !== "admin") notFound();

  const reports = await listWeeklyReports(env);

  return (
    <div className="weekly-a">
      <SiteAppBar user={user} pathname="/weekly" />

      <div className="weekly-a-masthead-wrap">
        <header className="weekly-a-masthead">
          <p className="page-kicker">成长 · 周报</p>
          <h1 className="page-title">周报</h1>
          <p className="page-sub">
            共 <span className="weekly-a-count">{reports.length}</span> 期已发布
          </p>
        </header>
        <div className="double-rule" />
      </div>

      <main className="weekly-a-list-wrap">
        {reports.length === 0 ? (
          <div className="weekly-a-empty">
            <h2>还没有发布的周报</h2>
            <p>
              运行 <code>topics daily publish weekly.html --week 2026-W39</code> 发布一期。
            </p>
          </div>
        ) : (
          <ul className="weekly-a-list">
            {reports.map((report) => {
              const range = isoWeekRange(report.week);
              return (
                <li key={report.week} className="weekly-a-item">
                  <a href={`/weekly/${report.week}/`} className="weekly-a-link">
                    <span className="weekly-a-weekno" aria-hidden="true">
                      <span className="weekly-a-w">W</span>
                      <span className="weekly-a-num tabular-nums">{weekNumber(report.week)}</span>
                    </span>
                    <span className="weekly-a-body">
                      <span className="weekly-a-code">{report.week}</span>
                      <span className="weekly-a-meta">
                        <span>
                          {formatMonthDay(range.monday)}–{formatMonthDay(range.sunday)}
                        </span>
                        <span className="weekly-a-dot">·</span>
                        <span>更新于 {formatShanghai(report.updatedAt)}</span>
                        <span className="weekly-a-dot">·</span>
                        <span>{formatSize(report.bytes)}</span>
                        {report.nickname ? (
                          <>
                            <span className="weekly-a-dot">·</span>
                            <span className="weekly-a-by">by {report.nickname}</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="weekly-a-open">
                      打开<span className="weekly-a-arrow"> →</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
