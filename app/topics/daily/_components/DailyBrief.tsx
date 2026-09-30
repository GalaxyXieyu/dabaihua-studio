"use client";

import { useMemo, useState } from "react";
import { summarizeResponses, type DailyBrief, type ShapedBriefResponse } from "../../../../lib/daily-brief-core";
import { MiniMarkdown } from "./mini-markdown";

export type BriefDateOption = {
  date: string;
  title: string;
  topicCount: number;
  responseCount: number;
  updatedAt: string;
};

type ResponseState = {
  rating: number | null;
  ratingComment: string;
  decision: "pick" | "reject" | null;
  scenarioIndex: number | null;
  scenarioText: string;
  answers: string[];
  rejectReason: string;
};

type Props = {
  date: string;
  dateLabel: string;
  brief: DailyBrief;
  dates: BriefDateOption[];
  userAccount: string;
  initialResponses: ShapedBriefResponse[];
  materialReaderLinks: Record<string, number>;
};

const STARS = [1, 2, 3, 4, 5];
const STAR = "\u2605";

/** `2026-09-30` → `9月30日`, short enough for a phone-width select. */
function shortDate(date: string): string {
  const parts = String(date).split("-");
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return date;
  return `${month}月${day}日`;
}

function emptyState(): ResponseState {
  return { rating: null, ratingComment: "", decision: null, scenarioIndex: null, scenarioText: "", answers: [], rejectReason: "" };
}

function toState(response: ShapedBriefResponse): ResponseState {
  return {
    rating: response.rating,
    ratingComment: response.ratingComment,
    decision: response.decision,
    scenarioIndex: response.scenario ? response.scenario.index : null,
    scenarioText: response.scenario ? response.scenario.text : "",
    answers: response.answers.map((item) => item.answer),
    rejectReason: response.rejectReason,
  };
}

async function postResponse(date: string, body: Record<string, unknown>): Promise<ShapedBriefResponse> {
  const response = await fetch(`/api/briefs/${date}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; response?: ShapedBriefResponse };
  if (!response.ok || !data.response) throw new Error(data.error || "保存失败，请重试");
  return data.response;
}

function StatusTag({ state }: { state: ResponseState }) {
  const tags: string[] = [];
  if (state.decision === "pick") tags.push("已选");
  if (state.decision === "reject") tags.push("不要");
  if (state.rating) tags.push(`${STAR}${state.rating}`);
  if (tags.length === 0) return null;
  return (
    <span className="db-status" data-testid="brief-status" data-decision={state.decision || ""}>
      {tags.map((tag) => (
        <span key={tag} className="db-status-tag">
          {tag}
        </span>
      ))}
    </span>
  );
}

export function DailyBrief({ date, dateLabel, brief, dates, userAccount, initialResponses, materialReaderLinks }: Props) {
  const [responses, setResponses] = useState<Record<string, ResponseState>>(() => {
    const map: Record<string, ResponseState> = {};
    for (const response of initialResponses) {
      if (response.user.account === userAccount) map[response.topicId] = toState(response);
    }
    return map;
  });
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const orderedTopics = useMemo(() => {
    const recommendedId = brief.recommendation?.topicId;
    if (!recommendedId) return brief.topics;
    const recommended = brief.topics.find((topic) => topic.id === recommendedId);
    if (!recommended) return brief.topics;
    return [recommended, ...brief.topics.filter((topic) => topic.id !== recommendedId)];
  }, [brief]);

  const counts = summarizeResponses(Object.values(responses), brief.topics.length);

  const currentIndex = dates.findIndex((item) => item.date === date);
  const older = currentIndex >= 0 ? dates[currentIndex + 1] : undefined;
  const newer = currentIndex > 0 ? dates[currentIndex - 1] : undefined;

  async function save(topicId: string, patch: Record<string, unknown>, optimistic: Partial<ResponseState>) {
    const previous = responses[topicId];
    setResponses((current) => ({ ...current, [topicId]: { ...emptyState(), ...current[topicId], ...optimistic } }));
    setBusy((current) => ({ ...current, [topicId]: true }));
    try {
      const saved = await postResponse(date, { topicId, ...patch });
      setResponses((current) => ({ ...current, [topicId]: toState(saved) }));
      setToast("");
    } catch (error) {
      setResponses((current) => {
        const next = { ...current };
        if (previous) next[topicId] = previous;
        else delete next[topicId];
        return next;
      });
      setToast(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setBusy((current) => ({ ...current, [topicId]: false }));
    }
  }

  return (
    <div className="db">
      <header className="db-head">
        <p className="page-kicker">内容 · 选题简报</p>
        <h1 className="page-title">{dateLabel}</h1>
        {brief.title && <p className="db-subtitle">{brief.title}</p>}

        <nav className="db-nav" aria-label="日期切换">
          {older ? (
            <a className="db-nav-button" data-testid="brief-prev" href={`/topics/daily?date=${older.date}`}>
              ‹ 上一期
            </a>
          ) : (
            <span className="db-nav-button is-disabled" data-testid="brief-prev" aria-disabled="true">
              ‹ 上一期
            </span>
          )}
          <select
            className="db-date-select"
            data-testid="brief-date-select"
            value={date}
            aria-label="选择日期"
            onChange={(event) => {
              const next = event.target.value;
              if (next && next !== date) window.location.assign(`/topics/daily?date=${next}`);
            }}
          >
            {dates.map((option) => (
              <option key={option.date} value={option.date}>
                {shortDate(option.date)} · 已回复 {option.responseCount}/{option.topicCount}
              </option>
            ))}
          </select>
          {newer ? (
            <a className="db-nav-button" data-testid="brief-next" href={`/topics/daily?date=${newer.date}`}>
              下一期 ›
            </a>
          ) : (
            <span className="db-nav-button is-disabled" data-testid="brief-next" aria-disabled="true">
              下一期 ›
            </span>
          )}
        </nav>

        <p className="db-progress" aria-live="polite">
          已选 {counts.pick} · 不要 {counts.reject} · 已打分 {counts.rated} / 共 {counts.total}
        </p>
      </header>

      <main className="db-list">
        {orderedTopics.map((topic) => (
          <Card
            key={topic.id}
            topic={topic}
            recommended={brief.recommendation?.topicId === topic.id}
            reason={brief.recommendation?.topicId === topic.id ? brief.recommendation?.reason || "" : ""}
            state={responses[topic.id] || emptyState()}
            busy={Boolean(busy[topic.id])}
            materialReaderLinks={materialReaderLinks}
            onSave={save}
          />
        ))}
      </main>

      {(brief.intro || brief.notes) && (
        <footer className="db-foot">
          {brief.intro && (
            <details className="db-note">
              <summary>说明</summary>
              <MiniMarkdown text={brief.intro} />
            </details>
          )}
          {brief.notes && (
            <details className="db-note">
              <summary>附注</summary>
              <MiniMarkdown text={brief.notes} />
            </details>
          )}
        </footer>
      )}

      {toast && (
        <div className="db-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

type CardProps = {
  topic: DailyBrief["topics"][number];
  recommended: boolean;
  reason: string;
  state: ResponseState;
  busy: boolean;
  materialReaderLinks: Record<string, number>;
  onSave: (topicId: string, patch: Record<string, unknown>, optimistic: Partial<ResponseState>) => Promise<void>;
};

function Card({ topic, recommended, reason, state, busy, materialReaderLinks, onSave }: CardProps) {
  const [open, setOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [scenarioIndex, setScenarioIndex] = useState<number | null>(state.scenarioIndex);
  const [answers, setAnswers] = useState<string[]>(() => topic.questions.map((_, index) => state.answers[index] || ""));
  const [comment, setComment] = useState(state.ratingComment);
  const [rejectReason, setRejectReason] = useState(state.rejectReason);

  const picked = state.decision === "pick";
  const rejected = state.decision === "reject";
  const showComment = state.rating !== null || comment.length > 0;

  function chooseRating(value: number) {
    const next = state.rating === value ? null : value;
    void onSave(topic.id, { rating: next }, { rating: next });
  }

  function saveComment() {
    if (comment === state.ratingComment) return;
    void onSave(topic.id, { ratingComment: comment }, { ratingComment: comment });
  }

  function submitPick() {
    if (topic.scenarios.length > 0 && scenarioIndex === null) return;
    setPickOpen(false);
    setRejectOpen(false);
    void onSave(
      topic.id,
      { decision: "pick", scenarioIndex, answers },
      { decision: "pick", scenarioIndex, answers, rejectReason: "", scenarioText: scenarioIndex !== null ? topic.scenarios[scenarioIndex] : "" },
    );
  }

  function submitReject() {
    setRejectOpen(false);
    setPickOpen(false);
    void onSave(
      topic.id,
      { decision: "reject", rejectReason },
      { decision: "reject", rejectReason, scenarioIndex: null, scenarioText: "" },
    );
  }

  function undo() {
    if (picked) void onSave(topic.id, { decision: null, scenarioIndex: null, answers: [] }, { decision: null, scenarioIndex: null, scenarioText: "", answers: [] });
    else void onSave(topic.id, { decision: null, rejectReason: "" }, { decision: null, rejectReason: "" });
  }

  return (
    <article
      className={`db-card ${recommended ? "is-recommended" : ""} ${rejected ? "is-rejected" : ""}`}
      data-testid="brief-card"
      data-topic-id={topic.id}
    >
      <div className="db-card-head">
        <span className="db-card-tags">
          <span className={`db-type db-type-${topic.type === "新闻题" ? "news" : "landing"}`}>{topic.type}</span>
          {topic.label && <span className="db-label">{topic.label}</span>}
          {recommended && (
            <span className="db-recommend-badge" data-testid="brief-recommended">
              今日推荐
            </span>
          )}
        </span>
        <StatusTag state={state} />
      </div>

      <h2 className="db-card-title">{topic.title}</h2>
      {topic.oneLiner && <p className="db-card-oneliner">{topic.oneLiner}</p>}
      {recommended && reason && <p className="db-recommend-reason">{reason}</p>}

      <button
        type="button"
        className="db-card-fold-hint"
        data-testid="brief-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "收起 ▴" : "展开详情 ▾"}
      </button>

      <div className="db-actions">
        <div className="db-stars" role="group" aria-label="打分">
          {STARS.map((star) => (
            <button
              key={star}
              type="button"
              className={`db-star ${state.rating && state.rating >= star ? "is-on" : ""}`}
              data-testid={`brief-star-${star}`}
              aria-label={`打 ${star} 星`}
              aria-pressed={state.rating === star}
              disabled={busy}
              onClick={() => chooseRating(star)}
            >
              {STAR}
            </button>
          ))}
        </div>

        <div className="db-decisions">
          {!rejected && (
            <button type="button" className="db-btn db-btn-pick" data-testid="brief-pick" disabled={busy} onClick={() => setPickOpen((value) => !value)}>
              {picked ? "修改" : "就写这个"}
            </button>
          )}
          {!picked && (
            <button type="button" className="db-btn db-btn-reject" data-testid="brief-reject" disabled={busy} onClick={() => setRejectOpen((value) => !value)}>
              {rejected ? "修改不要" : "不要"}
            </button>
          )}
          {state.decision && (
            <button type="button" className="db-btn db-btn-undo" data-testid="brief-undo" disabled={busy} onClick={undo}>
              撤销
            </button>
          )}
        </div>
      </div>

      {showComment && (
        <input
          className="db-comment"
          data-testid="brief-rating-comment"
          type="text"
          value={comment}
          placeholder="一句评语（可选，回车保存）"
          aria-label="评语"
          onChange={(event) => setComment(event.target.value)}
          onBlur={saveComment}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              saveComment();
            }
          }}
        />
      )}

      {open && (
        <div className="db-card-body">
          {topic.detail && (
            <section className="db-section" data-testid="brief-section-detail">
              <h3 className="db-section-title">详细观点</h3>
              <MiniMarkdown text={topic.detail} />
            </section>
          )}
          {topic.scenarios.length > 0 && (
            <section className="db-section" data-testid="brief-section-scenarios">
              <h3 className="db-section-title">可代入场景</h3>
              <ol className="db-scenario-list">
                {topic.scenarios.map((scenario, index) => (
                  <li key={index}>
                    <MiniMarkdown text={scenario} />
                  </li>
                ))}
              </ol>
            </section>
          )}
          {topic.questions.length > 0 && (
            <section className="db-section" data-testid="brief-section-questions">
              <h3 className="db-section-title">问 Yu</h3>
              <ol className="db-question-list">
                {topic.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ol>
            </section>
          )}
          {topic.materials.length > 0 && (
            <section className="db-section" data-testid="brief-section-materials">
              <h3 className="db-section-title">素材</h3>
              <ul className="db-material-list">
                {topic.materials.map((material, index) => (
                  <li key={index} className="db-material">
                    {material.title && <p className="db-material-title">{material.title}</p>}
                    {material.summary && <p className="db-material-summary">{material.summary}</p>}
                    {(material.url || material.links.length > 0) && (
                      <p className="db-material-links">
                        {material.url && (
                          <a href={material.url} target="_blank" rel="noopener noreferrer">
                            原文链接
                          </a>
                        )}
                        {material.url && materialReaderLinks[material.url] && (
                          <a
                            href={`/discover?item=${materialReaderLinks[material.url]}`}
                            data-testid="brief-material-reader-link"
                          >
                            在阅读中打开
                          </a>
                        )}
                        {material.links.map((link, linkIndex) => (
                          <a key={linkIndex} href={link.url} target="_blank" rel="noopener noreferrer">
                            {link.label || link.url}
                          </a>
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {topic.note && (
            <section className="db-section">
              <h3 className="db-section-title">备注</h3>
              <MiniMarkdown text={topic.note} />
            </section>
          )}
        </div>
      )}

      {pickOpen && (
        <div className="db-pick-form">
          {topic.scenarios.length > 0 && (
            <fieldset className="db-scenario-picker">
              <legend>选一个场景</legend>
              {topic.scenarios.map((scenario, index) => (
                <label key={index} className="db-radio">
                  <input
                    type="radio"
                    name={`scenario-${topic.id}`}
                    data-testid={`brief-pick-scenario-${index}`}
                    checked={scenarioIndex === index}
                    onChange={() => setScenarioIndex(index)}
                  />
                  <span>{scenario}</span>
                </label>
              ))}
            </fieldset>
          )}
          {topic.questions.map((question, index) => (
            <label key={index} className="db-answer">
              <span className="db-answer-question">{question}</span>
              <textarea
                data-testid={`brief-pick-answer-${index}`}
                value={answers[index] || ""}
                rows={3}
                onChange={(event) => {
                  const next = [...answers];
                  next[index] = event.target.value;
                  setAnswers(next);
                }}
              />
            </label>
          ))}
          <button type="button" className="db-btn db-btn-primary" data-testid="brief-pick-submit" disabled={busy} onClick={submitPick}>
            确定就写这个
          </button>
        </div>
      )}

      {picked && state.scenarioText && <p className="db-picked-summary">已选场景：{state.scenarioText}</p>}
      {picked && state.answers.some((answer) => answer) && (
        <ul className="db-picked-answers">
          {state.answers.map((answer, index) =>
            answer ? <li key={index}>{topic.questions[index] ? `${topic.questions[index]}：` : ""}{answer}</li> : null,
          )}
        </ul>
      )}

      {rejectOpen && (
        <div className="db-reject-form">
          <input
            className="db-reject-reason"
            data-testid="brief-reject-reason"
            type="text"
            value={rejectReason}
            placeholder="一句理由（可选）"
            aria-label="不要的理由"
            onChange={(event) => setRejectReason(event.target.value)}
          />
          <button type="button" className="db-btn db-btn-primary" data-testid="brief-reject-submit" disabled={busy} onClick={submitReject}>
            确定不要
          </button>
        </div>
      )}

      {rejected && state.rejectReason && <p className="db-rejected-reason">不要的理由：{state.rejectReason}</p>}
    </article>
  );
}
