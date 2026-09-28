import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getSessionUser } from "../../lib/auth";
import { requestOrigin } from "../../lib/request-origin";
import careerJson from "../../content/career/career.json";
import {
  formatShanghai,
  headerSummary,
  missingTitle,
  tierLabel,
  type CareerData,
  type CareerGapMetricClass,
  type CareerJob,
  type CareerMissingItem,
} from "../../lib/career";

export const dynamic = "force-dynamic";
export const viewport = { width: "device-width", initialScale: 1 };
export const metadata = { title: "职业 · 成长", robots: { index: false, follow: false } };

const data = careerJson as unknown as CareerData;

const sectionClass = "mt-6 border-t border-[var(--line)] pt-5";
const headingClass = "text-base font-bold";
const noteClass = "text-xs leading-relaxed text-[var(--muted)]";
const subtleClass = "text-xs leading-relaxed text-[var(--faint)]";

function statusClass(status: string) {
  if (status === "没有") return "font-bold text-[var(--accent)]";
  if (status === "有事没数字") return "text-[var(--ink)]";
  return "text-[var(--muted)]";
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
          <a href={job.link} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
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

  const { header, changes, gap, missing, jobs, results, sources, pending } = data;
  const targetJobs = jobs.filter((job) => job.group === "target");
  const reachableJobs = jobs.filter((job) => job.group === "reachable");
  const gapReport = sources.gap_report;
  const metricClasses = gap.metric_classes ?? [];
  const metricNames = (items: CareerGapMetricClass[]) =>
    items.length > 0 ? items.map((item) => `${item.name}${item.has_value ? "·有值" : ""}`).join("、") : "暂无";

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[var(--canvas)] text-[var(--ink)]">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <a href="/topics" className="inline-flex min-h-[44px] items-center text-sm font-bold text-[var(--muted)] hover:text-[var(--accent)]">
              ← 选题看板
            </a>
            <h1 className="text-base font-bold">成长</h1>
            <nav className="flex items-center gap-3 text-sm">
              <a href="/weekly" className="inline-flex min-h-[44px] items-center text-[var(--muted)] hover:text-[var(--ink)]">
                周报
              </a>
              <a
                href="/career"
                aria-current="page"
                className="inline-flex min-h-[44px] items-center border-b-2 border-[var(--accent)] font-bold text-[var(--accent)]"
              >
                职业
              </a>
            </nav>
          </div>
          <span className="shrink-0 text-xs text-[var(--faint)]">数据截至 {formatShanghai(header.data_as_of)}（北京时间）</span>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] px-4 py-4 pb-16">
        <p className="text-sm leading-relaxed">{headerSummary(header)}</p>
        {header.partial_note ? <p className={subtleClass}>{header.partial_note}</p> : null}

        <section className={sectionClass}>
          <h2 className={headingClass}>
            这期变了什么
            {changes.period_label ? <span className={`ml-2 ${subtleClass}`}>{changes.period_label}</span> : null}
          </h2>
          <div className="mt-2 space-y-1">
            {changes.sentences.map((sentence, index) => (
              <p key={index} className="text-sm leading-relaxed">
                {sentence}
              </p>
            ))}
          </div>
        </section>

        <section className={sectionClass}>
          <h2 className={headingClass}>差距：目标岗位要的证据，你有几条</h2>
          {gap.basis_note ? <p className={`mt-2 ${noteClass}`}>{gap.basis_note}</p> : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left">
                  <th className="py-2 pr-3 font-bold">证据项</th>
                  <th className="py-2 pr-3 font-bold">JD 要求（出现/样本）</th>
                  <th className="py-2 pr-3 font-bold">成果库条目</th>
                  <th className="py-2 font-bold">状态</th>
                </tr>
              </thead>
              <tbody>
                {gap.items.map((item) => (
                  <tr key={item.key} className="border-b border-[var(--line)] align-top">
                    <td className="py-2 pr-3">{item.label}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {item.jd_count}/{item.jd_total}
                    </td>
                    <td className="py-2 pr-3">
                      {item.result_count} 条，其中 {item.result_with_outcome_numbers ?? 0} 条有结果数字
                    </td>
                    <td className={`py-2 ${statusClass(item.status)}`}>{item.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm leading-relaxed">
            {!gap.top_gap?.startsWith("最该补") && <span className="text-[var(--accent)]">最该补的：</span>}
            {gap.top_gap ? (
              <span className="text-[var(--accent)]">{gap.top_gap}</span>
            ) : (
              <span className="text-[var(--faint)]">待补充</span>
            )}
          </p>
          <p className="text-sm leading-relaxed">
            {!gap.suggestion?.startsWith("建议") && <span className="text-[var(--muted)]">建议：</span>}
            {gap.suggestion ? <span>{gap.suggestion}</span> : <span className="text-[var(--faint)]">待补充</span>}
          </p>
          <p className="mt-2 text-sm leading-relaxed">
            {gap.reachable.sentence}
            {gap.reachable.small_sample ? "（样本少）" : ""}
          </p>
          <p className={`mt-2 ${subtleClass}`}>
            JD 统计按关键词匹配，一条 JD 一项最多计一次；成果库条目按有效条目计。有证据只认有值的结果类指标，提交数、测试数、行数、版本、文档这类算过程数字。
          </p>
          {metricClasses.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-bold">指标怎么归类（{metricClasses.length} 个）</summary>
              <p className="mt-1 text-xs leading-relaxed">
                结果：{metricNames(metricClasses.filter((item) => item.class === "result"))}。
              </p>
              <p className="text-xs leading-relaxed">
                过程：{metricNames(metricClasses.filter((item) => item.class === "process"))}。
              </p>
            </details>
          ) : null}
        </section>

        <section className={sectionClass}>
          <h2 className={headingClass}>缺数字清单</h2>
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

        <section className={sectionClass}>
          <h2 className={headingClass}>明细</h2>

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
                  <a href={gapReport.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
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

        <footer className="mt-8 border-t border-[var(--line)] pt-4">
          <p className={subtleClass}>
            数据生成于 {formatShanghai(data.generated_at)}。来源：{sources.jobs_file}、{sources.results_file}。
          </p>
          {pending.length > 0 ? <p className={subtleClass}>待补充：{pending.join("、")}。</p> : null}
        </footer>
      </main>
    </div>
  );
}
