import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { loadDailyData } from "../../lib/daily-data";
import {
  compareToPrevious,
  dateParts,
  FOLD_MIN_LENGTH,
  formatFullDate,
  formatMonthDay,
  formatNumber,
  formatSigned,
  markdownPlainText,
  monthWeeks,
  nearestReportInMonth,
  parseResultCards,
  previewText,
  resultCardScale,
  selectDay,
  trendPoints,
  weekdayOf,
  type DailyRepoStat,
  type DailyResultCard,
  type DailyWhatEntry,
} from "../../lib/daily";
import { SiteAppBar } from "../_components/SiteAppBar";
import { MiniMarkdown } from "../topics/daily/_components/mini-markdown";
import { DailyTrend } from "./_components/DailyTrend";
import "./daily.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: "日报 · 成长", robots: { index: false, follow: false } };

const WEEKDAY_HEAD = ["一", "二", "三", "四", "五", "六", "日"];
/** 「按仓库」默认只铺前 5 个，其余收进可展开项，避免右侧一长串。 */
const REPO_VISIBLE_COUNT = 5;

function caret() {
  return <span className="daily-a-caret" aria-hidden="true">›</span>;
}

function WhatEntry({ entry }: { entry: DailyWhatEntry }) {
  // 正文太短就不折叠，直接把全文铺出来。
  if (markdownPlainText(entry.body).length < FOLD_MIN_LENGTH) {
    return (
      <div className="daily-a-what is-static">
        <p className="daily-a-what-title">{entry.title}</p>
        <div className="daily-a-what-body">
          <MiniMarkdown text={entry.body} />
        </div>
      </div>
    );
  }
  const preview = previewText(entry.body);
  return (
    <details className="daily-a-what">
      <summary className="daily-a-what-summary">
        <span className="daily-a-what-title">{entry.title}</span>
        {preview ? <span className="daily-a-what-preview">{preview}</span> : null}
        {caret()}
      </summary>
      <div className="daily-a-what-body">
        <MiniMarkdown text={entry.body} />
      </div>
    </details>
  );
}

function Fold({ title, markdown }: { title: string; markdown: string }) {
  // 正文太短就不折叠，直接把全文铺出来。
  if (markdownPlainText(markdown).length < FOLD_MIN_LENGTH) {
    return (
      <div className="daily-a-fold is-static">
        <p className="daily-a-fold-title">{title}</p>
        <div className="daily-a-fold-body">
          <MiniMarkdown text={markdown} />
        </div>
      </div>
    );
  }
  const preview = previewText(markdown);
  return (
    <details className="daily-a-fold">
      <summary className="daily-a-fold-summary">
        <span className="daily-a-fold-title">{title}</span>
        {preview ? <span className="daily-a-fold-preview">{preview}</span> : null}
        {caret()}
      </summary>
      <div className="daily-a-fold-body">
        <MiniMarkdown text={markdown} />
      </div>
    </details>
  );
}

/** 「结果数字」：只把总量做成大号数字卡片，按工具拆分/对比说明落到卡片下的细线列表。 */
function ResultCardGrid({ cards }: { cards: DailyResultCard[] }) {
  const scale = resultCardScale(cards);
  return (
    <div
      className="daily-a-result-grid"
      data-count={cards.length}
      style={{ "--result-scale": scale } as CSSProperties}
    >
      {cards.map((card, index) => (
        <div key={`${index}-${card.value}`} className="daily-a-result-card">
          <p className="daily-a-result-value tabular-nums">
            {card.value}
            {card.unit ? <span className="daily-a-result-unit">{card.unit}</span> : null}
          </p>
          <p className="daily-a-result-label">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

function RepoRow({ stat, maxCommits, maxLines }: { stat: DailyRepoStat; maxCommits: number; maxLines: number }) {
  return (
    <div className="daily-a-repo">
      <span className="daily-a-repo-name">{stat.repo}</span>
      <span className="daily-a-repo-track is-commits">
        <span
          className="daily-a-repo-bar is-commits"
          style={{ width: `${Math.max(2, (stat.commits / maxCommits) * 100)}%` }}
        />
      </span>
      <span className="daily-a-repo-track is-lines">
        <span
          className="daily-a-repo-bar is-lines"
          style={{ width: `${Math.max(2, ((stat.additions + stat.deletions) / maxLines) * 100)}%` }}
        />
      </span>
      <span className="daily-a-repo-nums tabular-nums">
        {formatNumber(stat.commits)} 个 · {formatSigned(stat.additions)} / {formatSigned(-stat.deletions)}
      </span>
    </div>
  );
}

function EmptyState({ user }: { user: Awaited<ReturnType<typeof getSessionUser>> }) {
  return (
    <div className="daily-a">
      <SiteAppBar user={user} pathname="/daily" />
      <div className="daily-a-masthead-wrap">
        <header className="daily-a-masthead">
          <p className="page-kicker">成长 · 日报</p>
          <h1 className="page-title">日报</h1>
        </header>
        <div className="double-rule" />
      </div>
      <main className="daily-a-main">
        <div className="daily-a-empty">
          <h2>还没有日报数据</h2>
          <p>
            运行 <code>npm run daily:build</code> 汇总本机日报后再刷新。
          </p>
        </div>
      </main>
    </div>
  );
}

export default async function DailyPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: requested } = await searchParams;

  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/daily`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/daily");
  if (user.role !== "admin") notFound();

  const data = loadDailyData();
  if (!data || data.days.length === 0) return <EmptyState user={user} />;

  const days = data.days;
  const day = selectDay(days, requested);
  if (!day) return <EmptyState user={user} />;

  const index = days.findIndex((item) => item.date === day.date);
  const previous = index > 0 ? days[index - 1] : null;
  const repoCount = day.repos.length > 0 ? day.repos.length : day.repoStats.length;
  const metrics = [
    {
      key: "commits",
      label: "提交",
      value: day.commits == null ? "—" : formatNumber(day.commits),
      delta: compareToPrevious(day.commits, previous?.commits ?? null),
    },
    {
      key: "tokens",
      label: "百万 token",
      value: day.tokensM == null ? "—" : formatNumber(day.tokensM, 1),
      delta: compareToPrevious(day.tokensM, previous?.tokensM ?? null, 1),
    },
    {
      key: "repos",
      label: "涉及仓库",
      value: String(repoCount),
      delta: compareToPrevious(repoCount, previous ? previous.repos.length || previous.repoStats.length : null),
    },
  ];

  const maxRepoCommits = Math.max(1, ...day.repoStats.map((stat) => stat.commits));
  const maxRepoLines = Math.max(1, ...day.repoStats.map((stat) => stat.additions + stat.deletions));
  const visibleRepos = day.repoStats.slice(0, REPO_VISIBLE_COUNT);
  const hiddenRepos = day.repoStats.slice(REPO_VISIBLE_COUNT);

  const parts = dateParts(day.date);
  const monthPrefix = parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-` : "";
  const monthMax = Math.max(1, ...days.filter((item) => item.date.startsWith(monthPrefix)).map((item) => Number(item.commits || 0)));
  const cells = monthWeeks(days, day.date);
  const prevMonth = nearestReportInMonth(days, day.date, -1);
  const nextMonth = nearestReportInMonth(days, day.date, 1);

  const trend = trendPoints(days, day.date);
  const trendHeading = trend.length >= 30 ? "近 30 天" : `近 ${trend.length} 天`;

  const folds: Array<[string, string | null]> = [
    ["卡点和返工", day.sections.blockers],
    ["未完成", day.sections.unfinished],
    ["牵头和带人", day.sections.leading],
    ["概览", day.sections.overview],
  ];

  const parsedResults = day.sections.results
    ? parseResultCards(day.sections.results, {
        excludeValues: [day.commits, day.tokensM, repoCount].filter(
          (value): value is number => typeof value === "number",
        ),
      })
    : null;
  const hasFolds = folds.some(([, markdown]) => markdown);
  const hasResultRest = Boolean(
    parsedResults && (parsedResults.cards.length === 0 ? day.sections.results : parsedResults.rest),
  );

  return (
    <div className="daily-a">
      <SiteAppBar user={user} pathname="/daily" />

      <div className="daily-a-masthead-wrap">
        <header className="daily-a-masthead">
          <p className="page-kicker">成长 · 日报</p>
          <h1 className="page-title">{formatFullDate(day.date)}</h1>
          <p className="page-sub">
            {day.weekday || weekdayOf(day.date)}
            {day.summary ? ` · ${day.summary}` : ""}
          </p>
        </header>
        <div className="double-rule" />
      </div>

      <main className="daily-a-main">
        <section className="daily-a-metrics" aria-label="当天关键数字">
          {metrics.map((metric) => (
            <div key={metric.key} className="daily-a-metric">
              <p className="daily-a-metric-value tabular-nums">{metric.value}</p>
              <p className="daily-a-metric-label">{metric.label}</p>
              <p className={`daily-a-metric-delta is-${metric.delta?.direction || "none"}`}>
                {metric.delta ? `较前一日 ${metric.delta.text}` : "\u00A0"}
              </p>
            </div>
          ))}
        </section>

        <div className="daily-a-body">
          <section className="daily-a-section is-trend">
            <h2 className="daily-a-heading">{trendHeading}</h2>
            <DailyTrend points={trend} selected={day.date} />
          </section>

          {day.repoStats.length > 0 ? (
            <section className="daily-a-section is-repos">
              <h2 className="daily-a-heading">按仓库</h2>
              <div className="daily-a-repos">
                <div className="daily-a-repos-head" aria-hidden="true">
                  <span>仓库</span>
                  <span>提交</span>
                  <span>改动行</span>
                  <span />
                </div>
                {visibleRepos.map((stat) => (
                  <RepoRow key={stat.repo} stat={stat} maxCommits={maxRepoCommits} maxLines={maxRepoLines} />
                ))}
                {hiddenRepos.length > 0 ? (
                  <details className="daily-a-repos-more">
                    <summary className="daily-a-repos-more-summary">
                      <span className="daily-a-repos-more-label">展开其余 {hiddenRepos.length} 个</span>
                      {caret()}
                    </summary>
                    <div className="daily-a-repos-rest">
                      {hiddenRepos.map((stat) => (
                        <RepoRow key={stat.repo} stat={stat} maxCommits={maxRepoCommits} maxLines={maxRepoLines} />
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </section>
          ) : null}

          {day.sections.what.length > 0 ? (
            <section className="daily-a-section is-what">
              <h2 className="daily-a-heading">做了什么</h2>
              <div className="daily-a-whats">
                {day.sections.what.map((entry, entryIndex) => (
                  <WhatEntry key={`${entryIndex}-${entry.title}`} entry={entry} />
                ))}
              </div>
            </section>
          ) : null}

          {parsedResults || hasFolds ? (
            <section className="daily-a-section is-pair">
              {parsedResults ? <h2 className="daily-a-heading">结果数字</h2> : null}
              {parsedResults && parsedResults.cards.length > 0 ? (
                <div className="daily-a-results">
                  <ResultCardGrid cards={parsedResults.cards} />
                </div>
              ) : null}
              <div className="daily-a-pair">
                {hasResultRest ? (
                  <div className="daily-a-pair-col is-results">
                    <div className="daily-a-results-rest">
                      <MiniMarkdown
                        text={parsedResults && parsedResults.cards.length > 0 ? parsedResults.rest : day.sections.results || ""}
                      />
                    </div>
                  </div>
                ) : null}
                {hasFolds ? (
                  <div className="daily-a-pair-col is-folds">
                    <div className="daily-a-folds">
                      {folds.map(([title, markdown]) =>
                        markdown ? <Fold key={title} title={title} markdown={markdown} /> : null,
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <aside className="daily-a-rail" aria-label="按月的日报">
            <section className="daily-a-section is-calendar">
              <div className="daily-a-calendar-head">
                <h2 className="daily-a-heading">{parts ? `${parts.year} 年 ${parts.month} 月` : "日历"}</h2>
                <div className="daily-a-calendar-nav">
                  {prevMonth ? (
                    <a href={`/daily?date=${prevMonth}`} aria-label="上一个月">
                      ‹
                    </a>
                  ) : (
                    <span className="is-disabled">‹</span>
                  )}
                  {nextMonth ? (
                    <a href={`/daily?date=${nextMonth}`} aria-label="下一个月">
                      ›
                    </a>
                  ) : (
                    <span className="is-disabled">›</span>
                  )}
                </div>
              </div>
              <div className="daily-a-calendar" role="grid" aria-label="按月的日报">
                {WEEKDAY_HEAD.map((weekday) => (
                  <span key={weekday} className="daily-a-calendar-weekday">
                    {weekday}
                  </span>
                ))}
                {cells.map((week) => (
                  <div
                    key={week.index}
                    className={`daily-a-calendar-week${week.hasReport || week.isCurrent ? "" : " is-collapsed"}`}
                  >
                    {week.cells.map((cell, cellIndex) => {
                      if (!cell) return <span key={`empty-${cellIndex}`} className="daily-a-calendar-empty" />;
                      const dayNumber = dateParts(cell.date)?.day ?? "";
                      if (!cell.day) {
                        return (
                          <span key={cell.date} className="daily-a-calendar-cell is-empty" aria-hidden="true">
                            {dayNumber}
                          </span>
                        );
                      }
                      const commits = cell.day.commits;
                      const level = commits == null || commits <= 0 ? 1 : Math.min(4, Math.max(1, Math.ceil((commits / monthMax) * 4)));
                      return (
                        <a
                          key={cell.date}
                          href={`/daily?date=${cell.date}`}
                          className={`daily-a-calendar-cell is-level-${level} ${cell.date === day.date ? "is-selected" : ""}`}
                          aria-label={`${formatMonthDay(cell.date)}：${commits ?? 0} 个提交`}
                          aria-current={cell.date === day.date ? "date" : undefined}
                        >
                          {dayNumber}
                          {commits != null ? <span className="daily-a-calendar-count">{commits}</span> : null}
                        </a>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
