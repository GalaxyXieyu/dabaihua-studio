// Pure helpers for the daily topic brief (晴儿 → Yu → 晴儿). This module
// intentionally imports nothing and only uses erasable TypeScript syntax so
// Node's type-stripping test runner can load it directly.

export const BRIEF_VERSION = 1;
export const BRIEF_MAX_BYTES = 512 * 1024;
export const BRIEF_MAX_TOPICS = 30;
export const BRIEF_TOPIC_TYPES = ["落地题", "新闻题"] as const;
export const BRIEF_DECISIONS = ["pick", "reject"] as const;

export type BriefTopicType = (typeof BRIEF_TOPIC_TYPES)[number];
export type BriefDecision = (typeof BRIEF_DECISIONS)[number];

export type BriefMaterialLink = { label: string; url: string };
export type BriefMaterial = {
  title: string;
  summary: string;
  url: string;
  links: BriefMaterialLink[];
};
export type BriefTopic = {
  id: string;
  type: BriefTopicType;
  label: string;
  title: string;
  oneLiner: string;
  detail: string;
  scenarios: string[];
  scenarioSources: string[];
  questions: string[];
  questionSources: string[];
  materials: BriefMaterial[];
  note: string;
};
export type BriefRecommendation = { topicId: string; reason: string } | null;
export type DailyBrief = {
  version: number;
  date: string;
  title: string;
  intro: string;
  recommendation: BriefRecommendation;
  topics: BriefTopic[];
  notes: string;
  sources: string[];
};

export type BriefValidation = { ok: true; brief: DailyBrief } | { ok: false; errors: string[] };

const TOPIC_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
}

/**
 * `scenarioSources` / `questionSources` 与 `scenarios` / `questions` 按下标对齐：
 * 缺失补空串、多余的丢掉、非字符串当空串、去首尾空白、每个最多 200 字。
 * 旧简报没有这两个数组时一律返回等长的空串数组。
 */
function sourceArray(value: unknown, length: number): string[] {
  const raw = Array.isArray(value) ? value : [];
  const result: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const item = raw[index];
    result.push(typeof item === "string" ? item.trim().slice(0, 200) : "");
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** `true` for a real calendar date written as `YYYY-MM-DD`. */
export function isValidBriefDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `true` for an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseMaterial(value: unknown, path: string, errors: string[]): BriefMaterial {
  const raw = asRecord(value) ?? {};
  const url = str(raw.url);
  if (url && !isHttpUrl(url)) errors.push(`${path}.url 只允许 http 或 https`);
  const links: BriefMaterialLink[] = [];
  if (Array.isArray(raw.links)) {
    raw.links.forEach((link, index) => {
      const linkRaw = asRecord(link) ?? {};
      const linkUrl = str(linkRaw.url);
      if (linkUrl && !isHttpUrl(linkUrl)) errors.push(`${path}.links[${index}].url 只允许 http 或 https`);
      links.push({ label: str(linkRaw.label), url: linkUrl });
    });
  }
  return { title: str(raw.title), summary: str(raw.summary), url, links };
}

function parseTopic(value: unknown, index: number, seen: Set<string>, errors: string[]): BriefTopic {
  const path = `topics[${index}]`;
  const raw = asRecord(value) ?? {};
  const id = str(raw.id);
  if (!TOPIC_ID_RE.test(id)) {
    errors.push(`${path}.id 只能是 1–40 位字母、数字、下划线或连字符`);
  } else if (seen.has(id)) {
    errors.push(`${path}.id 与前面的选题重复`);
  } else {
    seen.add(id);
  }

  const typeRaw = str(raw.type);
  let type: BriefTopicType = "落地题";
  if (typeRaw !== "落地题" && typeRaw !== "新闻题") {
    errors.push(`${path}.type 只能是 落地题 或 新闻题`);
  } else {
    type = typeRaw;
  }

  const title = str(raw.title);
  if (!title) errors.push(`${path}.title 不能为空`);

  const materials: BriefMaterial[] = [];
  if (Array.isArray(raw.materials)) {
    raw.materials.forEach((material, materialIndex) => {
      materials.push(parseMaterial(material, `${path}.materials[${materialIndex}]`, errors));
    });
  }

  const scenarios = stringArray(raw.scenarios);
  const questions = stringArray(raw.questions);

  return {
    id,
    type,
    label: str(raw.label),
    title,
    oneLiner: str(raw.oneLiner),
    detail: str(raw.detail),
    scenarios,
    scenarioSources: sourceArray(raw.scenarioSources, scenarios.length),
    questions,
    questionSources: sourceArray(raw.questionSources, questions.length),
    materials,
    note: str(raw.note),
  };
}

function parseRecommendation(value: unknown, topics: BriefTopic[], errors: string[]): BriefRecommendation {
  if (value === undefined || value === null) return null;
  const raw = asRecord(value);
  if (!raw) {
    errors.push("recommendation 必须是对象或 null");
    return null;
  }
  const topicId = str(raw.topicId);
  const reason = str(raw.reason);
  if (!topicId) {
    errors.push("recommendation.topicId 不能为空");
    return null;
  }
  if (!topics.some((topic) => topic.id === topicId)) {
    errors.push("recommendation.topicId 指向不存在的选题");
    return null;
  }
  return { topicId, reason };
}

/**
 * Validates and normalizes one brief. Missing optional fields become empty
 * strings / arrays / null, unknown fields are dropped, and every problem is
 * reported as a Chinese message carrying its field path.
 */
export function validateBrief(input: unknown): BriefValidation {
  const raw = asRecord(input);
  if (!raw) return { ok: false, errors: ["简报必须是一个 JSON 对象"] };

  const errors: string[] = [];

  let version = BRIEF_VERSION;
  if (raw.version !== undefined && raw.version !== null) {
    if (raw.version !== BRIEF_VERSION) errors.push(`version 只能是 ${BRIEF_VERSION}`);
    else version = BRIEF_VERSION;
  }

  const date = str(raw.date);
  if (!date) errors.push("date 必填（格式 YYYY-MM-DD）");
  else if (!isValidBriefDate(date)) errors.push("date 不是合法日期（格式 YYYY-MM-DD）");

  const rawTopics = raw.topics;
  if (!Array.isArray(rawTopics) || rawTopics.length === 0) {
    errors.push("topics 必填且至少 1 个选题");
  } else if (rawTopics.length > BRIEF_MAX_TOPICS) {
    errors.push(`topics 最多 ${BRIEF_MAX_TOPICS} 个选题`);
  }

  const seen = new Set<string>();
  const topics: BriefTopic[] = Array.isArray(rawTopics)
    ? rawTopics.map((topic, index) => parseTopic(topic, index, seen, errors))
    : [];

  const recommendation = parseRecommendation(raw.recommendation, topics, errors);

  const brief: DailyBrief = {
    version,
    date,
    title: str(raw.title),
    intro: str(raw.intro),
    recommendation,
    topics,
    notes: str(raw.notes),
    sources: stringArray(raw.sources),
  };

  if (errors.length > 0) return { ok: false, errors };

  if (JSON.stringify(brief).length > BRIEF_MAX_BYTES) {
    return { ok: false, errors: ["brief 超过 512KB"] };
  }
  return { ok: true, brief };
}

/** Answers for one topic, paired with the questions asked on that topic. */
export type BriefAnswer = { question: string; answer: string };

export type BriefResponseRow = {
  date?: string;
  topicId?: string;
  rating?: number | null;
  ratingComment?: string | null;
  decision?: string | null;
  scenarioIndex?: number | null;
  scenarioText?: string | null;
  scenarioCustom?: string | null;
  answersJson?: string | null;
  rejectReason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  account?: string | null;
  nickname?: string | null;
  user?: { account?: string | null; nickname?: string | null } | null;
};

export type ShapedBriefResponse = {
  date: string;
  topicId: string;
  topicTitle: string;
  topicType: string;
  topicMissing: boolean;
  user: { account: string; nickname: string };
  rating: number | null;
  ratingComment: string;
  decision: BriefDecision | null;
  scenario: { index: number; text: string } | null;
  scenarioCustom: string;
  answers: BriefAnswer[];
  rejectReason: string;
  createdAt: string;
  updatedAt: string;
};

function parseAnswers(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((item) => (typeof item === "string" ? item : item === null || item === undefined ? "" : String(item)));
}

function normalizeDecision(value: unknown): BriefDecision | null {
  return value === "pick" || value === "reject" ? value : null;
}

/**
 * Turns one stored reply row into the shape 晴儿 reads back. Unknown topic ids
 * are kept (never deleted) and flagged with `topicMissing: true`; answers are
 * paired with the questions of the current brief version.
 */
export function shapeResponse(row: BriefResponseRow, brief: DailyBrief | null): ShapedBriefResponse {
  const topic = brief ? brief.topics.find((item) => item.id === row.topicId) ?? null : null;
  const scenarioIndex = typeof row.scenarioIndex === "number" ? row.scenarioIndex : null;
  const storedText = str(row.scenarioText);
  const scenario =
    scenarioIndex !== null && scenarioIndex >= 0
      ? { index: scenarioIndex, text: storedText || topic?.scenarios[scenarioIndex] || "" }
      : null;
  const answers = parseAnswers(row.answersJson);
  const account = row.user?.account ?? row.account ?? "";
  const nickname = row.user?.nickname ?? row.nickname ?? "";
  return {
    date: str(row.date),
    topicId: str(row.topicId),
    topicTitle: topic?.title ?? "",
    topicType: topic?.type ?? "",
    topicMissing: !topic,
    user: { account: str(account), nickname: str(nickname) },
    rating: typeof row.rating === "number" ? row.rating : null,
    ratingComment: str(row.ratingComment),
    decision: normalizeDecision(row.decision),
    scenario,
    scenarioCustom: str(row.scenarioCustom),
    answers: answers.map((answer, index) => ({ question: topic?.questions[index] ?? "", answer })),
    rejectReason: str(row.rejectReason),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
  };
}

/** Only replies with an actual opinion are read back: rating, decision or comment. */
export function responseHasContent(row: BriefResponseRow): boolean {
  if (typeof row.rating === "number" && row.rating >= 1) return true;
  if (normalizeDecision(row.decision)) return true;
  if (str(row.ratingComment)) return true;
  if (str(row.rejectReason)) return true;
  return false;
}

export type BriefSummaryCounts = { pick: number; reject: number; rated: number; total: number };

/** Counts the progress line: 已选 n · 不要 n · 已打分 n / 共 N. */
export function summarizeResponses(responses: BriefResponseRow[], total: number): BriefSummaryCounts {
  let pick = 0;
  let reject = 0;
  let rated = 0;
  for (const row of responses) {
    if (normalizeDecision(row.decision) === "pick") pick += 1;
    if (normalizeDecision(row.decision) === "reject") reject += 1;
    if (typeof row.rating === "number" && row.rating >= 1) rated += 1;
  }
  return { pick, reject, rated, total };
}
