import { Seal } from "../_components/seal/Seal";
import { StampMark } from "../_components/seal/StampMark";
import { addDays } from "../_components/seal/seal-store";
import { LedgerDaySeals } from "../_components/seal/LedgerDaySeals";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { loadDailyData } from "../../lib/daily-data";
import { getWeeklyReportHtml, listWeeklyReports, type WeeklyReportMeta } from "../../lib/weekly";
import { GROWTH_NAMES } from "../../lib/site-nav";
import { shanghaiDate } from "../../lib/today-core";
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
  type DailyDay,
  type DailyDelta,
  type DailyRepoStat,
  type DailyResultCard,
  type DailyWhatEntry,
} from "../../lib/daily";
import {
  WEEKDAY_LABELS,
  aggregateMonth,
  aggregateRepos,
  aggregateWeek,
  extractWeeklyTakeaway,
  formatMonthLabel,
  formatWeekLabel,
  heatmapLevel,
  isoWeekOf,
  monthCalendar,
  monthHasContent,
  monthOf,
  nextMonth,
  nextWeek,
  previousMonth,
  previousWeek,
  reviewAnchorDate,
  weekDates,
  weekHasContent,
  type WeeklyTakeaway,
} from "../../lib/review";
import { SiteAppBar } from "../_components/SiteAppBar";
import { MiniMarkdown } from "../content/_brief/mini-markdown";
import { DailyTrend } from "./_components/DailyTrend";
import "./daily.css";
import "./ledger.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: `${GROWTH_NAMES.ledger.label} · 成长`, robots: { index: false, follow: false } };

const REPO_VISIBLE_COUNT = 5;
const REVIEW_VIEWS = ["day", "week", "month"] as const;
type ReviewView = (typeof REVIEW_VIEWS)[number];
/** 日 / 周 / 月三个切换标签（这些是视图名，不是板块名，不进 GROWTH_NAMES）。 */
const VIEW_LABELS: Record<ReviewView, string> = { day: "日", week: "周", month: "月" };

function resolveView(value: string | undefined): ReviewView {
  return value === "week" || value === "month" ? value : "day";
}

/** `?view=…&date=…`。切换视图时保留当前选中日期。 */
function viewHref(view: ReviewView, date: string): string {
  return `/ledger?view=${view}&date=${date}`;
}

/** 周标题：`2026 年第 40 周 · 9 月 28 日 – 10 月 4 日`。 */
function weekTitle(week: string): string {
  const dates = weekDates(week);
  if (dates.length < 7) return formatWeekLabel(week);
  return `${formatWeekLabel(week)} · ${formatMonthDay(dates[0])} – ${formatMonthDay(dates[6])}`;
}

/** `10月2日 · 4 次提交 · 115.7M token`，用于热力格的 title。 */
function heatmapTitle(date: string, day: DailyDay | undefined): string {
  const parts = dateParts(date);
  const label = parts ? `${parts.month}月${parts.day}日` : date;
  if (!day) return `${label} · 无记录`;
  const commits = Number(day.commits || 0);
  if (day.tokensM == null || !Number.isFinite(day.tokensM)) return `${label} · ${commits} 次提交`;
  return `${label} · ${commits} 次提交 · ${formatNumber(day.tokensM, 1)}M token`;
}

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

/** 大数字 + 环比；上一期没数据时显示灰色说明，不显示 +∞% / NaN。
 *  `sub` 用于把次要数字（如 `+a / −d`）压成标签下的一行小字，避免大数字换行把卡片撑高。 */
function BigMetric({
  value,
  label,
  sub,
  delta,
  deltaPrefix,
  emptyText,
}: {
  value: string;
  label: string;
  sub?: string;
  delta: DailyDelta | null;
  deltaPrefix: string;
  emptyText?: string;
}) {
  return (
    <div className="daily-a-metric">
      <p className="daily-a-metric-value tabular-nums">{value}</p>
      <p className="daily-a-metric-label">{label}</p>
      {sub ? <p className="daily-a-metric-sub tabular-nums">{sub}</p> : null}
      {delta ? (
        <p className={`daily-a-metric-delta is-${delta.direction}`}>{`${deltaPrefix}${delta.text}`}</p>
      ) : (
        <p className={`daily-a-metric-delta${emptyText ? " is-none" : ""}`}>{emptyText ?? "\u00A0"}</p>
      )}
    </div>
  );
}

/** 上一个 / 下一个可去的方向；null 表示那个方向没有数据。 */
type ReviewSteps = { prev: string | null; next: string | null };

function reviewSteps(
  view: ReviewView,
  date: string,
  days: DailyDay[],
  reportWeeks: string[],
): ReviewSteps {
  if (view === "day") {
    const index = days.findIndex((item) => item.date === date);
    const prev = index > 0 ? days[index - 1].date : null;
    const next = index >= 0 && index < days.length - 1 ? days[index + 1].date : null;
    return {
      prev: prev ? viewHref("day", prev) : null,
      next: next ? viewHref("day", next) : null,
    };
  }
  if (view === "week") {
    // 只要目标周有日报或周记就可以翻过去。
    const week = isoWeekOf(date);
    const prev = previousWeek(week);
    const next = nextWeek(week);
    return {
      prev: weekHasContent(prev, days, reportWeeks) ? viewHref("week", weekDates(prev)[0]) : null,
      next: weekHasContent(next, days, reportWeeks) ? viewHref("week", weekDates(next)[0]) : null,
    };
  }
  // 目标月有日报，或有周一落在那个月的周记。
  const month = monthOf(date);
  const prev = previousMonth(month);
  const next = nextMonth(month);
  return {
    prev: monthHasContent(prev, days, reportWeeks) ? viewHref("month", `${prev}-01`) : null,
    next: monthHasContent(next, days, reportWeeks) ? viewHref("month", `${next}-01`) : null,
  };
}

function ReviewMasthead({
  view,
  date,
  title,
  steps,
}: {
  view: ReviewView;
  date: string;
  title: string;
  steps: ReviewSteps;
}) {
  return (
    <div className="daily-a-masthead-wrap">
      <header className="review-a-masthead">
        <div className="review-a-masthead-main">
          <p className="page-kicker">
            成长 · {GROWTH_NAMES.ledger.label}
          </p>
          <h1 className="page-title review-a-title">{title}</h1>
        </div>
        <div className="review-a-masthead-side">
          <nav className="review-a-switch" aria-label="切换视图">
            {REVIEW_VIEWS.map((item) => (
              <a
                key={item}
                href={viewHref(item, date)}
                className={`review-a-switch-item${item === view ? " is-active" : ""}`}
                aria-current={item === view ? "page" : undefined}
              >
                {VIEW_LABELS[item]}
              </a>
            ))}
          </nav>
          <nav className="review-a-steps" aria-label="前后翻页">
            {steps.prev ? (
              <a className="review-a-step" href={steps.prev}>
                上一个
              </a>
            ) : (
              <span className="review-a-step is-disabled">上一个</span>
            )}
            {steps.next ? (
              <a className="review-a-step" href={steps.next}>
                下一个
              </a>
            ) : (
              <span className="review-a-step is-disabled">下一个</span>
            )}
          </nav>
        </div>
      </header>
      <div className="double-rule" />
    </div>
  );
}

function EmptyState({ user }: { user: Awaited<ReturnType<typeof getSessionUser>> }) {
  return (
    <div className="daily-a review-a">
      <SiteAppBar user={user} pathname="/ledger" />
      <div className="daily-a-masthead-wrap">
        <header className="daily-a-masthead">
          <p className="page-kicker">成长 · {GROWTH_NAMES.ledger.label}</p>
          <h1 className="page-title">{GROWTH_NAMES.ledger.label}</h1>
        </header>
        <div className="double-rule" />
      </div>
      <main className="daily-a-main">
        <div className="daily-a-empty">
          <h2>还没有日报数据</h2>
          <p>
            在本机运行 <code>scripts/upload-daily.sh</code> 上传。
          </p>
        </div>
      </main>
    </div>
  );
}

/** 日视图：原来的 /daily 页面内容。 */
function DayView({ days, day, generatedAt }: { days: DailyDay[]; day: DailyDay; generatedAt: string | null }) {
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
    <>
      {/* 印章区：左角色右印位，紧凑一行；空白日不渲染虚线（LedgerDaySeals 里处理） */}
      <section className="daily-a-seal-row" aria-label="这一天的印章">
        <Seal id="seal-actor-ledger" kind="fang" size={96} pose="idle" />
        <LedgerDaySeals
          days={days.map((d) => ({ date: d.date, commits: d.commits }))}
          generatedAt={generatedAt}
          pageDate={day.date}
        />
      </section>

      <section className="daily-a-metrics" aria-label="当天关键数字">
        {metrics.map((metric) => (
          <BigMetric
            key={metric.key}
            value={metric.value}
            label={metric.label}
            delta={metric.delta}
            deltaPrefix="较前一日 "
          />
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

        <aside className="daily-a-rail" aria-label={`按月的${GROWTH_NAMES.ledger.label}`}>
          <section className="daily-a-section is-calendar">
            <div className="daily-a-calendar-head">
              <h2 className="daily-a-heading">{parts ? `${parts.year} 年 ${parts.month} 月` : "日历"}</h2>
              <div className="daily-a-calendar-nav">
                {prevMonth ? (
                  <a href={viewHref("day", prevMonth)} aria-label="上一个月">
                    ‹
                  </a>
                ) : (
                  <span className="is-disabled">‹</span>
                )}
                {nextMonth ? (
                  <a href={viewHref("day", nextMonth)} aria-label="下一个月">
                    ›
                  </a>
                ) : (
                  <span className="is-disabled">›</span>
                )}
              </div>
            </div>
            <div className="daily-a-calendar" role="grid" aria-label={`按月的${GROWTH_NAMES.ledger.label}`}>
              {WEEKDAY_LABELS.map((weekday) => (
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
                        href={viewHref("day", cell.date)}
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
    </>
  );
}

/** 周视图：三个大数字 + 逐日柱 + 按仓库 + 本周要点 + 往期周记。 */
function WeekView({
  days,
  date,
  reports,
  takeaway,
}: {
  days: DailyDay[];
  date: string;
  reports: WeeklyReportMeta[];
  takeaway: WeeklyTakeaway | null;
}) {
  const week = isoWeekOf(date);
  const dates = weekDates(week);
  const byDate = new Map(days.map((item) => [item.date, item]));
  const totals = aggregateWeek(days, week);
  const previous = aggregateWeek(days, previousWeek(week));
  const previousEmpty = !previous.hasData;
  const emptyText = previousEmpty ? "上周无记录" : undefined;

  const maxCommits = Math.max(1, ...dates.map((date) => Number(byDate.get(date)?.commits || 0)));
  const repos = aggregateRepos(days, dates);
  const maxRepoCommits = Math.max(1, ...repos.map((stat) => stat.commits));

  return (
    <>
      <section className="daily-a-metrics" aria-label="本周关键数字">
        <BigMetric
          value={formatNumber(totals.commits)}
          label="提交"
          delta={compareToPrevious(totals.commits, previousEmpty ? null : previous.commits)}
          deltaPrefix="较上周 "
          emptyText={emptyText}
        />
        <BigMetric
          value={totals.hasData ? formatNumber(totals.tokensM, 1) : "—"}
          label="百万 token"
          delta={compareToPrevious(totals.tokensM, previousEmpty ? null : previous.tokensM, 1)}
          deltaPrefix="较上周 "
          emptyText={emptyText}
        />
        <BigMetric
          value={formatNumber(totals.repos)}
          label="涉及仓库"
          delta={compareToPrevious(totals.repos, previousEmpty ? null : previous.repos)}
          deltaPrefix="较上周 "
          emptyText={emptyText}
        />
      </section>

      <section className="review-a-section">
        <h2 className="daily-a-heading">逐日</h2>
        <ol className="review-a-week">
          {dates.map((date) => {
            const item = byDate.get(date);
            const commits = Number(item?.commits || 0);
            const height = item ? Math.max(3, (commits / maxCommits) * 100) : 0;
            const body = (
              <>
                <span className="review-a-week-weekday">{weekdayOf(date)}</span>
                <span className="review-a-week-commits tabular-nums">
                  {item ? formatNumber(commits) : "\u00A0"}
                </span>
                <span className="review-a-week-barwrap">
                  <span className="review-a-week-bar" style={{ height: `${height}%` }} />
                </span>
                <span className="review-a-week-value tabular-nums">
                  {item ? (item.tokensM == null ? "—" : `${formatNumber(item.tokensM, 1)}M`) : "无记录"}
                </span>
              </>
            );
            return (
              <li key={date} className="review-a-week-col">
                {item ? (
                  <a
                    href={viewHref("day", date)}
                    className="review-a-week-link"
                    aria-label={`${formatMonthDay(date)}：${commits} 个提交`}
                  >
                    {body}
                  </a>
                ) : (
                  <span className="review-a-week-link is-empty">{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {repos.length > 0 ? (
        <section className="review-a-section">
          <h2 className="daily-a-heading">按仓库</h2>
          <div className="review-a-repos">
            {repos.map((stat) => (
              <div key={stat.repo} className="review-a-repo">
                <span className="review-a-repo-name">{stat.repo}</span>
                <span className="review-a-repo-track">
                  <span
                    className="review-a-repo-bar"
                    style={{ width: `${Math.max(2, (stat.commits / maxRepoCommits) * 100)}%` }}
                  />
                </span>
                <span className="review-a-repo-commits tabular-nums">{formatNumber(stat.commits)} 个</span>
                <span className="review-a-repo-lines tabular-nums">
                  {formatSigned(stat.additions)} / {formatSigned(-stat.deletions)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {takeaway ? (
        <section className="review-a-section">
          <h2 className="daily-a-heading">本周要点</h2>
          <div className="review-a-takeaway">
            {takeaway.title ? <p className="review-a-takeaway-title">{takeaway.title}</p> : null}
            <p className="review-a-takeaway-body">{takeaway.description}</p>
            <a className="review-a-takeaway-link" href={`/weekly/${week}/`}>
              看完整周记 →
            </a>
          </div>
        </section>
      ) : null}

      {reports.length > 0 ? (
        <section className="review-a-section review-a-archive">
          <h2 className="daily-a-heading">往期周记</h2>
          <ul className="review-a-archive-list">
            {reports.map((report) => {
              const reportDates = weekDates(report.week);
              const label =
                reportDates.length === 7
                  ? `W${Number(report.week.slice(6))} · ${formatMonthDay(reportDates[0])} – ${formatMonthDay(reportDates[6])}`
                  : report.week;
              return (
                <li key={report.week}>
                  <a href={viewHref("week", reportDates[0] ?? `${report.week}-01`)}>{label}</a>
                  <a className="review-a-archive-source" href={`/weekly/${report.week}/`}>
                    原文
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** 月视图：5 个大数字 + 整月热力日历。 */
function MonthView({ days, date }: { days: DailyDay[]; date: string }) {
  const month = monthOf(date);
  const dates = monthCalendar(month);
  const byDate = new Map(days.map((item) => [item.date, item]));
  const totals = aggregateMonth(days, month);
  const previous = aggregateMonth(days, previousMonth(month));
  const previousEmpty = !previous.hasData;
  const emptyText = previousEmpty ? "上月无记录" : undefined;
  const monthMax = Math.max(1, ...dates.map((cell) => Number(cell ? byDate.get(cell.date)?.commits || 0 : 0)));
  const today = shanghaiDate();

  // 有提交的日期集合：算每个日格的连续天数（数据缺口算断，算不出来按 1 天）
  const commitDates = new Set(days.filter((d) => (d.commits ?? 0) > 0).map((d) => d.date));
  const streakUntil = (date: string): number => {
    let streak = 0;
    let cursor = date;
    while (commitDates.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak || 1;
  };

  return (
    <>
      <section className="daily-a-metrics" data-count={5} aria-label="本月关键数字">
        <BigMetric
          value={formatNumber(totals.commits)}
          label="提交"
          delta={compareToPrevious(totals.commits, previousEmpty ? null : previous.commits)}
          deltaPrefix="较上月 "
          emptyText={emptyText}
        />
        <BigMetric
          value={totals.hasData ? formatNumber(totals.tokensM, 1) : "—"}
          label="百万 token"
          delta={compareToPrevious(totals.tokensM, previousEmpty ? null : previous.tokensM, 1)}
          deltaPrefix="较上月 "
          emptyText={emptyText}
        />
        <BigMetric
          value={formatNumber(totals.recordedDays)}
          label="有记录的天数"
          delta={compareToPrevious(totals.recordedDays, previousEmpty ? null : previous.recordedDays)}
          deltaPrefix="较上月 "
          emptyText={emptyText}
        />
        <BigMetric
          value={formatNumber(totals.repos)}
          label="涉及仓库"
          delta={compareToPrevious(totals.repos, previousEmpty ? null : previous.repos)}
          deltaPrefix="较上月 "
          emptyText={emptyText}
        />
        <BigMetric
          value={formatNumber(totals.additions + totals.deletions)}
          label="改动行数"
          sub={`${formatSigned(totals.additions)} / ${formatSigned(-totals.deletions)}`}
          delta={compareToPrevious(
            totals.additions + totals.deletions,
            previousEmpty ? null : previous.additions + previous.deletions,
          )}
          deltaPrefix="较上月 "
          emptyText={emptyText}
        />
      </section>

      <section className="review-a-section">
        <div className="review-a-heatmap-head">
          <h2 className="daily-a-heading">日历</h2>
          <div className="review-a-legend" aria-hidden="true">
            <span>少</span>
            <span className="review-a-swatch is-level-1" />
            <span className="review-a-swatch is-level-2" />
            <span className="review-a-swatch is-level-3" />
            <span className="review-a-swatch is-level-4" />
            <span>多</span>
          </div>
        </div>
        <div className="review-a-heatmap" role="grid" aria-label={`${formatMonthLabel(month)} 提交热力`}>
          {WEEKDAY_LABELS.map((weekday) => (
            <span key={weekday} className="review-a-heatmap-weekday">
              {weekday}
            </span>
          ))}
          {dates.map((cell, cellIndex) => {
            if (!cell) return <span key={`blank-${cellIndex}`} className="review-a-heatmap-blank" />;
            const item = byDate.get(cell.date);
            const commits = Number(item?.commits || 0);
            const level = heatmapLevel(item ? commits : 0, monthMax);
            const isSelected = cell.date === date;
            const isToday = cell.date === today;
            const className = `review-a-heatmap-cell is-level-${level}${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}`;
            const title = heatmapTitle(cell.date, item);
            if (item) {
              return (
                <a
                  key={cell.date}
                  href={viewHref("day", cell.date)}
                  className={className}
                  title={title}
                  aria-label={title}
                  aria-current={isSelected ? "date" : undefined}
                >
                  {cell.dayNumber}
                  <span className="review-a-heatmap-count tabular-nums">{formatNumber(commits)}</span>
                  {commits > 0 ? (
                    <StampMark
                      className="review-a-heatmap-seal"
                      kind="fang"
                      size={24}
                      streak={streakUntil(cell.date)}
                    />
                  ) : null}
                </a>
              );
            }
            return (
              <span key={cell.date} className={className} title={title}>
                {cell.dayNumber}
              </span>
            );
          })}
        </div>
      </section>
    </>
  );
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const { view: requestedView, date: requested } = await searchParams;
  const view = resolveView(requestedView);

  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/ledger`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/ledger");
  if (user.role !== "admin") notFound();

  const [data, reports] = await Promise.all([loadDailyData(env.DB), listWeeklyReports(env)]);
  if (!data || data.days.length === 0) return <EmptyState user={user} />;

  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  const day = selectDay(days, requested);
  if (!day) return <EmptyState user={user} />;

  const reportWeeks = reports.map((report) => report.week);
  // 日视图吸附到有记录的一天；周 / 月视图接受任意合法日期（那天没日报也停在那一周 / 那一月）。
  const anchorDate = view === "day" ? day.date : reviewAnchorDate(days, requested) ?? day.date;

  const steps = reviewSteps(view, anchorDate, days, reportWeeks);
  const title =
    view === "week"
      ? weekTitle(isoWeekOf(anchorDate))
      : view === "month"
        ? formatMonthLabel(monthOf(anchorDate))
        : `${formatFullDate(day.date)} · ${day.weekday || weekdayOf(day.date)}`;

  // 只在看某一周时读那一周的原文，别把整库 HTML 拉出来。
  let takeaway: WeeklyTakeaway | null = null;
  if (view === "week") {
    const week = isoWeekOf(anchorDate);
    if (reports.some((report) => report.week === week)) {
      const bytes = await getWeeklyReportHtml(env, week);
      if (bytes) takeaway = extractWeeklyTakeaway(new TextDecoder().decode(bytes));
    }
  }

  return (
    <div className="daily-a review-a">
      <SiteAppBar user={user} pathname="/ledger" />
      <ReviewMasthead view={view} date={anchorDate} title={title} steps={steps} />
      <main className="daily-a-main">
        {view === "day" ? (
          <DayView days={days} day={day} generatedAt={data.generatedAt} />
        ) : view === "week" ? (
          <WeekView days={days} date={anchorDate} reports={reports} takeaway={takeaway} />
        ) : (
          <MonthView days={days} date={anchorDate} />
        )}
      </main>
    </div>
  );
}
