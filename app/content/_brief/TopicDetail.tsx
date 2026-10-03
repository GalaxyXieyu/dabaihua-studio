"use client";

import { useEffect, useRef, useState } from "react";
import type { DailyBrief } from "../../../lib/daily-brief-core";
import type { MaterialView } from "../../../lib/brief-view";
import { MiniMarkdown } from "./mini-markdown";
import { MaterialItem } from "./MaterialItem";
import type { ResponseState } from "./brief-types";

const STARS = [1, 2, 3, 4, 5];
const STAR = "\u2605";

type Props = {
  topic: DailyBrief["topics"][number];
  recommended: boolean;
  reason: string;
  state: ResponseState;
  busy: boolean;
  materialsByUrl: Record<string, MaterialView>;
  tray: "pick" | "reject" | null;
  onTrayChange: (tray: "pick" | "reject" | null) => void;
  onSave: (topicId: string, patch: Record<string, unknown>, optimistic: Partial<ResponseState>) => Promise<void>;
};

/** The right-hand (and phone full-screen) topic detail with its reply tray. */
export function TopicDetail({ topic, recommended, reason, state, busy, materialsByUrl, tray, onTrayChange, onSave }: Props) {
  const [scenarioIndex, setScenarioIndex] = useState<number | null>(state.scenarioIndex);
  const [answers, setAnswers] = useState<string[]>(() => topic.questions.map((_, index) => state.answers[index] || ""));
  const [comment, setComment] = useState(state.ratingComment);
  const [rejectReason, setRejectReason] = useState(state.rejectReason);
  const scenarioRef = useRef<HTMLInputElement | null>(null);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
  const rejectRef = useRef<HTMLInputElement | null>(null);

  const picked = state.decision === "pick";
  const rejected = state.decision === "reject";
  const showComment = state.rating !== null || comment.length > 0;

  useEffect(() => {
    if (tray !== "pick") return;
    if (topic.scenarios.length > 0) scenarioRef.current?.focus();
    else answerRef.current?.focus();
  }, [tray, topic.scenarios.length]);

  useEffect(() => {
    if (tray === "reject") rejectRef.current?.focus();
  }, [tray]);

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
    onTrayChange(null);
    void onSave(
      topic.id,
      { decision: "pick", scenarioIndex, answers },
      { decision: "pick", scenarioIndex, answers, rejectReason: "", scenarioText: scenarioIndex !== null ? topic.scenarios[scenarioIndex] : "" },
    );
  }

  function submitReject() {
    onTrayChange(null);
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
    <div className="db-detail">
      <header className="db-detail-head">
        <span className="db-card-tags">
          <span className={`db-type db-type-${topic.type === "新闻题" ? "news" : "landing"}`}>{topic.type}</span>
          {topic.label && <span className="db-label">{topic.label}</span>}
          {recommended && (
            <span className="db-recommend-badge" data-testid="brief-recommended">
              今日推荐
            </span>
          )}
        </span>
        <h2 className="db-detail-title">{topic.title}</h2>
        {topic.oneLiner && <p className="db-detail-oneliner">{topic.oneLiner}</p>}
        {recommended && reason && <p className="db-recommend-reason">{reason}</p>}
      </header>

      {(picked || rejected) && (
        <section className="db-decision-result" data-testid="brief-status" data-decision={state.decision || ""}>
          {picked && state.scenarioText && <p className="db-picked-summary">已选场景：{state.scenarioText}</p>}
          {picked && state.answers.some((answer) => answer) && (
            <ul className="db-picked-answers">
              {state.answers.map((answer, index) =>
                answer ? (
                  <li key={index}>
                    {topic.questions[index] ? `${topic.questions[index]}：` : ""}
                    {answer}
                  </li>
                ) : null,
              )}
            </ul>
          )}
          {rejected && state.rejectReason && <p className="db-rejected-reason">不要的理由：{state.rejectReason}</p>}
        </section>
      )}

      <div className="db-detail-body">
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
            <h3 className="db-section-title">
              素材 <span className="db-section-count">{topic.materials.length}</span>
            </h3>
            <div className="db-material-list">
              {topic.materials.map((material, index) => (
                <MaterialItem key={index} material={material} view={materialsByUrl[material.url] ?? null} first={index === 0} />
              ))}
            </div>
          </section>
        )}
        {topic.note && (
          <section className="db-section">
            <h3 className="db-section-title">备注</h3>
            <MiniMarkdown text={topic.note} />
          </section>
        )}
      </div>

      <div className="db-actionbar">
        {(tray || showComment) && (
          <div
            className="db-tray"
            data-testid="brief-tray"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onTrayChange(null);
              }
            }}
          >
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

            {tray === "pick" && (
              <div className="db-pick-form">
                {topic.scenarios.length > 0 && (
                  <fieldset className="db-scenario-picker">
                    <legend>选一个场景</legend>
                    {topic.scenarios.map((scenario, index) => (
                      <label key={index} className="db-radio">
                        <input
                          ref={index === 0 ? scenarioRef : undefined}
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
                      ref={index === 0 ? answerRef : undefined}
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

            {tray === "reject" && (
              <div className="db-reject-form">
                <input
                  ref={rejectRef}
                  className="db-reject-reason"
                  data-testid="brief-reject-reason"
                  type="text"
                  value={rejectReason}
                  placeholder="一句理由（可选）"
                  aria-label="不要的理由"
                  onChange={(event) => setRejectReason(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitReject();
                    }
                  }}
                />
                <button type="button" className="db-btn db-btn-primary" data-testid="brief-reject-submit" disabled={busy} onClick={submitReject}>
                  确定不要
                </button>
              </div>
            )}
          </div>
        )}

        <div className="db-bar-row">
          <div className="db-bar-left">
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
            <p className="db-key-hint">J K 切换 · Y N 决定 · 1-5 打星</p>
          </div>
          <div className="db-decisions">
            {!rejected && (
              <button
                type="button"
                className="db-btn db-btn-pick"
                data-testid="brief-pick"
                disabled={busy}
                onClick={() => onTrayChange(tray === "pick" ? null : "pick")}
              >
                {picked ? "修改" : "就写这个"}
              </button>
            )}
            {!picked && (
              <button
                type="button"
                className="db-btn db-btn-reject"
                data-testid="brief-reject"
                disabled={busy}
                onClick={() => onTrayChange(tray === "reject" ? null : "reject")}
              >
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
      </div>
    </div>
  );
}
