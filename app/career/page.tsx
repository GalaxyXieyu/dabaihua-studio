import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import { SiteAppBar } from "../_components/SiteAppBar";
import { loadCareerData } from "../../lib/career-data";
import {
  formatShanghai,
  headerSummary,
  missingTitle,
  tierLabel,
  type CareerGapMetricClass,
  type CareerJob,
  type CareerMissingItem,
} from "../../lib/career";
import "./career.css";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: "职业 · 成长", robots: { index: false, follow: false } };

const noteClass = "career-a-note";
const subtleClass = "career-a-subtle";

function statusClass(status: string) {
  if (status === "没有") return "is-accent";
  if (status === "有事没数字") return "is-ink";
  return "";
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/[。.]+$/, "");
}

function metricNames(items: CareerGapMetricClass[], withSuggestion = false): string {
  if (items.length === 0) return "暂无";
  return items
    .map((item) => {
      const name = item.has_value ? `${item.name}·有值` : item.name;
      if (withSuggestion && item.suggestion) {
        return `${name}（${stripTrailingPeriod(item.suggestion)}）`;
      }
      return name;
    })
    .join("、");
}

function MissingRow({ item }: { item: CareerMissingItem }) {
  return (
    <li className="border-b border-[var(--line)] py-2">
      <p className="text-sm leading-relaxed">
        {missingTitle(item)}：缺「{item.metric}」，单位 {item.unit}。
      </p>
      <p className={subtleClass}>
        {item.date}
        {item.target ? " · 目标层" : ""}
      </p>
    </li>
  );
}

function JobRow({ job }: { job: CareerJob }) {
  const meta = [
    job.salary,
    job.experience || "经验暂无",
    job.education || "学历暂无",
    job.agency ? "疑似代招" : "",
    job.outsourcing ? "疑似外包" : "",
    job.excluded.length > 0 ? `排除：${job.excluded.join("、")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="border-b border-[var(--line)] py-3">
      <p className="text-sm font-bold leading-relaxed">
        {job.title} · {job.company}
      </p>
      <p className={noteClass}>{meta}</p>
      {job.link ? (
        <p className="text-xs leading-relaxed">
          <a href={job.link} target="_blank" rel="noopener noreferrer" className="career-a-link">
            招聘页
          </a>
        </p>
      ) : null}
      {job.jd ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-sm font-bold">JD 原文</summary>
          <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--muted)]">{job.jd}</div>
        </details>
      ) : (
        <p className={subtleClass}>暂无 JD 原文</p>
      )}
    </li>
  );
}

export default async function CareerPage() {
  const requestHeaders = await headers();
  const user = await getSessionUser(
    env,
    new Request(`${requestOrigin(requestHeaders)}/career`, {
      headers: {
        cookie: requestHeaders.get("cookie") || "",
        authorization: requestHeaders.get("authorization") || "",
      },
    }),
  );
  if (!user) redirect("/login?next=/career");
  if (user.role !== "admin") notFound();

  const data = loadCareerData();

  if (!data) {
    return (
      <div className="career-a">
        <SiteAppBar user={user} pathname="/career" />
        <div className="career-a-masthead-wrap">
          <header className="career-a-masthead">
            <p className="page-kicker">成长 · 职业</p>
            <h1 className="page-title">职业</h1>
          </header>
          <div className="double-rule" />
        </div>
        <main className="career-a-main">
          <p className="career-a-lede">还没有数据</p>
        </main>
      </div>
    );
  }

  const { header, changes, gap, missing, jobs, results, sources, pending } = data;
  const targetJobs = jobs.filter((job) => job.group === "target");
  const reachableJobs = jobs.filter((job) => job.group === "reachable");
  const gapReport = sources.gap_report;
  const metricClasses = gap.metric_classes ?? [];
  const unlistedMetrics = gap.unlisted_metrics ?? [];
  const metricClassesFile = gap.metric_classes_file;
  const metricTableUnmatched = gap.metric_table_unmatched ?? [];
  const metricTableConflicts = gap.metric_table_conflicts ?? [];
  const resultMetrics = metricClasses.filter((item) => item.source === "table_result");
  const processMetrics = metricClasses.filter((item) => item.source === "table_process");
  const unlistedMetricItems =
    unlistedMetrics.length > 0 ? unlistedMetrics : metricClasses.filter((item) => item.source === "unlisted");
  const metricTotal = resultMetrics.length + processMetrics.length + unlistedMetricItems.length;
  const hasMetricInfo =
    metricTotal > 0 ||
    metricClassesFile?.present === false ||
    metricTableUnmatched.length > 0 ||
    metricTableConflicts.length > 0;

  return (
    <div className="career-a">
      <SiteAppBar user={user} pathname="/career" />

      <div className="career-a-masthead-wrap">
        <header className="career-a-masthead">
          <p className="page-kicker">成长 · 职业</p>
          <h1 className="page-title">职业</h1>
          <p className="page-sub">数据截至 {formatShanghai(header.data_as_of)}（北京时间）</p>
        </header>
        <div className="double-rule" />
      </div>

      <main className="career-a-main">
        <p className="career-a-lede">{headerSummary(header)}</p>
        {header.partial_note ? <p className={subtleClass}>{header.partial_note}</p> : null}

        <section className="career-a-section">
          <h2 className="career-a-heading">
            <span className="career-a-roman" aria-hidden="true">I</span>
            <span>
              这期变了什么
              {changes.period_label ? <span className="career-a-heading-note">{changes.period_label}</span> : null}
            </span>
          </h2>
          <div className="mt-2 space-y-1">
            {changes.sentences.map((sentence, index) => (
              <p key={index} className="text-sm leading-relaxed">
                {sentence}
              </p>
            ))}
          </div>
        </section>

        <section className="career-a-section">
          <h2 className="career-a-heading">
            <span className="career-a-roman" aria-hidden="true">II</span>
            <span>差距：目标岗位要的证据，你有几条</span>
          </h2>
          {gap.basis_note ? <p className={`mt-2 ${noteClass}`}>{gap.basis_note}</p> : null}
          <div className="career-a-table-wrap">
            <table className="career-a-table">
              <thead>
                <tr>
                  <th>证据项</th>
                  <th className="career-a-num">JD 要求（出现/样本）</th>
                  <th>成果库条目</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {gap.items.map((item) => (
                  <tr key={item.key}>
                    <td>{item.label}</td>
                    <td className="career-a-num tabular-nums">
                      {item.jd_count}/{item.jd_total}
                    </td>
                    <td>
                      {item.result_count} 条，其中 {item.result_with_outcome_numbers ?? 0} 条有结果数字
                    </td>
                    <td className={`career-a-status ${statusClass(item.status)}`}>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <blockquote className="career-a-quote">
            {!gap.top_gap?.startsWith("最该补") && <span className="career-a-quote-label">最该补的：</span>}
            {gap.top_gap ? (
              <span>{gap.top_gap}</span>
            ) : (
              <span className="career-a-muted">待补充</span>
            )}
          </blockquote>
          <p className="text-sm leading-relaxed">
            {!gap.suggestion?.startsWith("建议") && <span className="text-[var(--muted)]">建议：</span>}
            {gap.suggestion ? <span>{gap.suggestion}</span> : <span className="text-[var(--faint)]">待补充</span>}
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            {gap.reachable.sentence}
            {gap.reachable.small_sample ? "（样本少）" : ""}
          </p>
          <p className={`mt-2 ${subtleClass}`}>
            JD 统计按关键词匹配，一条 JD 一项最多计一次；成果库条目按有效条目计。有证据只认归类表里标为结果、且有值的指标；没写进归类表的指标一律按过程算。
          </p>
          {hasMetricInfo ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-bold">指标怎么归类（{metricTotal} 个）</summary>
              {metricClassesFile?.present === false ? (
                <p className="mt-1 text-xs leading-relaxed text-[var(--accent)]">归类表缺失，所有指标都按过程算。</p>
              ) : null}
              {metricTableUnmatched.length > 0 ? (
                <p className="mt-1 text-xs leading-relaxed">
                  归类表里有 {metricTableUnmatched.length} 个名字在成果库里找不到：{metricTableUnmatched.join("、")}。
                </p>
              ) : null}
              {metricTableConflicts.length > 0 ? (
                <p className="mt-1 text-xs leading-relaxed">
                  这些名字同时写在结果和过程里，按过程算：{metricTableConflicts.join("、")}。
                </p>
              ) : null}
              <p className="mt-1 text-xs leading-relaxed">结果（归类表）：{metricNames(resultMetrics)}。</p>
              <p className="text-xs leading-relaxed">过程（归类表）：{metricNames(processMetrics)}。</p>
              <p className="text-xs leading-relaxed">
                未归类，默认按过程算：{metricNames(unlistedMetricItems, true)}。
              </p>
            </details>
          ) : null}
        </section>

        <section className="career-a-section">
          <h2 className="career-a-heading">
            <span className="career-a-roman" aria-hidden="true">III</span>
            <span>缺数字清单</span>
          </h2>
          <p className={`mt-1 ${noteClass}`}>共 {missing.total} 条，只有这里需要你动手。</p>
          {missing.total === 0 ? (
            <p className="mt-2 text-sm leading-relaxed">暂无缺数字的条目。</p>
          ) : (
            <>
              <ol className="mt-2">
                {missing.top.map((item, index) => (
                  <MissingRow key={`${item.id}-${item.metric}-${index}`} item={item} />
                ))}
              </ol>
              {missing.rest.length > 0 ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-bold">其余 {missing.rest.length} 条</summary>
                  <ol className="mt-2">
                    {missing.rest.map((item, index) => (
                      <MissingRow key={`${item.id}-${item.metric}-${index}`} item={item} />
                    ))}
                  </ol>
                </details>
              ) : null}
            </>
          )}
        </section>

        <section className="career-a-section">
          <h2 className="career-a-heading">
            <span className="career-a-roman" aria-hidden="true">IV</span>
            <span>明细</span>
          </h2>

          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-bold">岗位明细（{jobs.length} 条）</summary>
            <div className="mt-2">
              <h3 className={noteClass}>目标层</h3>
              {targetJobs.length === 0 ? (
                <p className="text-sm leading-relaxed text-[var(--faint)]">暂无</p>
              ) : (
                <ol>
                  {targetJobs.map((job) => (
                    <JobRow key={job.no} job={job} />
                  ))}
                </ol>
              )}
              <h3 className={`mt-4 ${noteClass}`}>可达层</h3>
              {reachableJobs.length === 0 ? (
                <p className="text-sm leading-relaxed text-[var(--faint)]">暂无</p>
              ) : (
                <ol>
                  {reachableJobs.map((job) => (
                    <JobRow key={job.no} job={job} />
                  ))}
                </ol>
              )}
            </div>
          </details>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-bold">成果库全部条目（{results.length} 条）</summary>
            <ol className="mt-2">
              {results.map((result) => (
                <li key={result.id} className="border-b border-[var(--line)] py-2">
                  <p className="text-sm leading-relaxed">
                    {result.date} {result.display_title || "未公开标题"}
                  </p>
                  <p className={noteClass}>
                    技能：{result.skills.length > 0 ? result.skills.join("、") : "暂无"} · 适用：
                    {result.tier_fit.length > 0 ? result.tier_fit.map(tierLabel).join("、") : "暂无"}
                  </p>
                  {result.public ? (
                    <>
                      {result.what ? <p className="mt-1 text-sm leading-relaxed">{result.what}</p> : null}
                      {result.problem ? <p className="text-sm leading-relaxed">{result.problem}</p> : null}
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-bold">完整差距报告</summary>
            <div className="mt-2">
              {gapReport.url ? (
                <p className="text-sm leading-relaxed">
                  <a href={gapReport.url} target="_blank" rel="noopener noreferrer" className="career-a-link">
                    查看完整差距报告
                  </a>
                </p>
              ) : (
                <p className="text-sm leading-relaxed">
                  {gapReport.file ? (
                    <>
                      完整报告含内部项目细节，不放在网站上。本地文件：{gapReport.file}（{gapReport.title}，更新于{" "}
                      {gapReport.mtime ? formatShanghai(gapReport.mtime) : "暂无"}）。
                    </>
                  ) : (
                    "暂无"
                  )}
                </p>
              )}
            </div>
          </details>
        </section>

        <footer className="career-a-footer">
          <p className={subtleClass}>
            数据生成于 {formatShanghai(data.generated_at)}。来源：{sources.jobs_file}、{sources.results_file}。
          </p>
          {pending.length > 0 ? <p className={subtleClass}>待补充：{pending.join("、")}。</p> : null}
        </footer>
      </main>
    </div>
  );
}
