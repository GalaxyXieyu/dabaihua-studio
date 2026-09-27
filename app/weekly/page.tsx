import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { listWeeklyReports } from "../../lib/weekly";
import { BRAND_NAME } from "../../lib/brand";

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

  const reports = await listWeeklyReports(env);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <a href="/topics" aria-label={`返回${BRAND_NAME}选题看板`} className="inline-flex min-h-[44px] items-center text-sm font-bold text-[var(--muted)] hover:text-[var(--green)]">← 选题看板</a>
            <h1 className="min-w-0 truncate text-base font-bold">📅 周报</h1>
          </div>
          <span className="shrink-0 text-xs text-[var(--faint)]">共 {reports.length} 期</span>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 py-4">
        {reports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--paper)] p-8 text-center">
            <div className="mb-2 text-2xl">📭</div>
            <h2 className="mb-1 text-base font-bold">还没有发布的周报</h2>
            <p className="break-words text-sm text-[var(--muted)]">
              运行 <code className="rounded bg-[var(--canvas)] px-1.5 py-0.5">topics daily publish weekly.html --week 2026-W39</code> 发布一期。
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {reports.map((report) => {
              const range = isoWeekRange(report.week);
              return (
                <li key={report.week}>
                  <a
                    href={`/weekly/${report.week}/`}
                    className="block rounded-xl border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm transition hover:border-[var(--green)] hover:shadow-md"
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--faint)]">
                      <span className="rounded-full bg-[var(--green-soft)] px-2 py-0.5 font-bold text-[var(--green)]">{report.week}</span>
                      <span>{formatMonthDay(range.monday)}–{formatMonthDay(range.sunday)}</span>
                      <span className="rounded-full bg-[var(--canvas)] px-2 py-0.5 font-bold text-[var(--muted)]">{formatSize(report.bytes)}</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="text-xs text-[var(--muted)]">更新于 {formatShanghai(report.updatedAt)}（北京时间）</span>
                      {report.nickname ? <span className="text-xs text-[var(--faint)]">by {report.nickname}</span> : null}
                    </div>
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
