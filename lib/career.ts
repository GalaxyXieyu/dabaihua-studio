/**
 * Types and small pure helpers for the admin-only `/career` page.
 *
 * The page imports `content/career/career.json` at build time and casts it to
 * `CareerData`. The types below mirror that generated file one-to-one; fields
 * the generator may omit are optional.
 */

export type CareerGroup = "reachable" | "target";

export type GapStatus = "有证据" | "有事没数字" | "没有";

export type CareerCountsByGroup = {
  reachable: number;
  target: number;
};

export type CareerCountsByChannel = {
  direct: number;
  agency: number;
  outsourcing: number;
  unknown: number;
};

export type CareerGapReportSource = {
  file: string | null;
  mtime: string | null;
  title: string | null;
  url: string | null;
  full_text_included: boolean;
};

export type CareerSources = {
  jobs_file: string;
  jobs_generated_at: string;
  results_file: string;
  gap_report: CareerGapReportSource;
  notes_present: boolean;
};

export type CareerHeader = {
  data_as_of: string;
  city: string;
  jobs_total: number;
  jobs_by_group: CareerCountsByGroup;
  jobs_by_channel: CareerCountsByChannel;
  jobs_with_detail: CareerCountsByGroup;
  jobs_excluded: number;
  results_total: number;
  results_public: number;
  partial: boolean;
  partial_note: string | null;
};

export type CareerChangeResult = {
  id: string;
  date: string;
  display_title: string | null;
  skills: string[];
};

export type CareerGapStatusChange = {
  key: string;
  label: string;
  from: string;
  to: string;
};

export type CareerChanges = {
  period_label: string | null;
  first_issue: boolean;
  prev_data_as_of: string | null;
  new_jobs: number | null;
  new_target_jobs: number | null;
  new_results: CareerChangeResult[];
  gap_status_changes: CareerGapStatusChange[];
  gap_change_note: string | null;
  sentences: string[];
};

export type CareerGapItem = {
  key: string;
  label: string;
  jd_count: number;
  jd_total: number;
  result_count: number;
  result_with_outcome_numbers: number;
  result_with_numbers: number;
  status: GapStatus;
};

export type CareerTopCount = {
  label: string;
  count: number;
};

export type CareerReachableSummary = {
  sample_size: number;
  salary_sample: number;
  salary_median_k: number | null;
  experience_top: CareerTopCount | null;
  experience_5plus: number;
  education_top: CareerTopCount | null;
  small_sample: boolean;
  sentence: string;
};

export type CareerGapMetricClass = {
  name: string;
  class: "process" | "result";
  source?: "table_result" | "table_process" | "unlisted";
  has_value: boolean;
  suggestion?: string | null;
};

export type CareerGapMetricClassesFile = {
  file: string | null;
  present: boolean;
  note: string | null;
};

export type CareerGap = {
  basis: string;
  basis_note: string | null;
  target_detail_count: number;
  sample_size: number;
  small_sample: boolean;
  items: CareerGapItem[];
  metric_classes?: CareerGapMetricClass[];
  unlisted_metrics?: CareerGapMetricClass[];
  metric_classes_file?: CareerGapMetricClassesFile;
  metric_table_unmatched?: string[];
  metric_table_conflicts?: string[];
  top_gap: string | null;
  suggestion: string | null;
  reachable: CareerReachableSummary;
};

export type CareerMissingItem = {
  id: string;
  date: string;
  display_title: string | null;
  skills: string[];
  metric: string;
  unit: string;
  target: boolean;
};

export type CareerMissing = {
  total: number;
  top: CareerMissingItem[];
  rest: CareerMissingItem[];
};

export type CareerJob = {
  no: number;
  group: CareerGroup;
  title: string;
  company: string;
  salary: string;
  experience: string | null;
  education: string | null;
  agency: boolean;
  outsourcing: boolean;
  excluded: string[];
  jd: string | null;
  link: string | null;
};

export type CareerMetric = {
  name: string | null;
  value: string | number | null;
  unit: string | null;
};

export type CareerResult = {
  id: string;
  date: string;
  display_title: string | null;
  skills: string[];
  tier_fit: string[];
  public: boolean;
  // Only present for entries whose source record is public.
  title?: string | null;
  what?: string | null;
  problem?: string | null;
  decision?: string | null;
  influence?: string | null;
  metrics?: CareerMetric[];
};

export type CareerData = {
  schema_version: number;
  generated_at: string;
  sources: CareerSources;
  header: CareerHeader;
  changes: CareerChanges;
  gap: CareerGap;
  missing: CareerMissing;
  jobs: CareerJob[];
  results: CareerResult[];
  pending: string[];
};

/** Formats an ISO timestamp as `YYYY-MM-DD HH:mm` in Asia/Shanghai (UTC+8). */
export function formatShanghai(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** Maps the generator's tier tokens to the page's Chinese labels. */
export function tierLabel(tier: string): string {
  if (tier === "reachable") return "可达层";
  if (tier === "target") return "目标层";
  return tier;
}

/** Maps the generator's group tokens to the page's Chinese labels. */
export function groupLabel(group: string): string {
  return tierLabel(group);
}

/** One-sentence header summary with sample counts for every number. */
export function headerSummary(header: CareerHeader): string {
  const channel = header.jobs_by_channel;
  const unknown = channel.unknown > 0 ? `，未判定 ${channel.unknown}` : "";
  return `本期岗位 ${header.jobs_total} 条（可达层 ${header.jobs_by_group.reachable}，目标层 ${header.jobs_by_group.target}）：直招 ${channel.direct}，疑似代招 ${channel.agency}，疑似外包 ${channel.outsourcing}${unknown}。成果库有效条目 ${header.results_total} 条，其中可公开 ${header.results_public} 条。`;
}

/** Title for a missing-number row, falling back to its skills. */
export function missingTitle(item: CareerMissingItem): string {
  if (item.display_title) return item.display_title;
  if (item.skills.length > 0) return `未公开标题的成果（技能：${item.skills.join("、")}）`;
  return "未公开标题的成果";
}
