"use client";

import { useState } from "react";
import type { DailyBrief } from "../../../lib/daily-brief-core";
import { PIPELINE_LABELS, type PipelineStatus } from "../../../lib/brief-pipeline-core";
import type { MaterialView } from "../../../lib/brief-view";
import { MiniMarkdown } from "./mini-markdown";
import { MaterialItem } from "./MaterialItem";
import { hasDecisionContent, stripDuplicateOutlineHeading } from "./detail-helpers";
import type { AutosaveStatus, BriefSelection, ResponseState } from "./brief-types";

const STARS = [1, 2, 3, 4, 5];
const STAR = "\u2605";
// 按钮/区块标签集中在这里，避免散落在 JSX 里。
const CONFIRM_OUTLINE_LABEL = "确认大纲";
const OUTLINE_TITLE = "大纲";
const SELECT_LABEL = "就写这个";
const REJECT_LABEL = "不要";
const CUSTOM_SCENARIO_LABEL = "都不是，我自己说";
const OUTLINE_COLLAPSE_LINES = 12;

type Props = {
  topic: DailyBrief["topics"][number];
  recommended: boolean;
  reason: string;
  state: ResponseState;
  busy: boolean;
  materialsByUrl: Record<string, MaterialView>;
  selection: BriefSelection | null;
  selectionBusy: boolean;
  actionError: string;
  autosave: AutosaveStatus | null;
  onAutosave: (topicId: string, patch: Record<string, unknown>, optimistic: Partial<ResponseState>) => void;
  onFlush: (topicId: string) => void;
  onRetryAutosave: (topicId: string) => void;
  onSelect: (topicId: string) => void;
  onUndoSelection: (topicId: string) => void;
  onConfirmOutline: (topicId: string) => void;
  onNotifyRetry: (topicId: string) => void;
  rejectOpen: boolean;
  onRejectToggle: (open: boolean) => void;
  onSave: (topicId: string, patch: Record<string, unknown>, optimistic: Partial<ResponseState>) => Promise<void>;
};

/** 管线状态 code → 展示标签，退回到后端给的 label。 */
function pipelineLabel(selection: BriefSelection): string {
  const label = PIPELINE_LABELS[selection.status as PipelineStatus];
  if (label) return label;
  return selection.statusLabel || selection.status;
}

/** `2026-10-03T21:10:00+08:00` → `10月3日 21:10`；解析不了就原样返回。 */
function shortMoment(value: string | null): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`;
}

function scenarioSource(topic: DailyBrief["topics"][number], index: number): string {
  const sources = topic.scenarioSources;
  if (!Array.isArray(sources)) return "";
  return typeof sources[index] === "string" ? sources[index].trim() : "";
}

function questionSource(topic: DailyBrief["topics"][number], index: number): string {
  const sources = topic.questionSources;
  if (!Array.isArray(sources)) return "";
  return typeof sources[index] === "string" ? sources[index].trim() : "";
}

/** 自动保存指示：保存中… / 已保存 / 保存失败，重试（可点重试）。 */
function SaveIndicator({ status, onRetry }: { status: AutosaveStatus | null; onRetry: () => void }) {
  if (!status) return null;
  if (status === "error") {
    return (
      <button type="button" className="db-save-indicator is-error" data-testid="brief-autosave" onClick={onRetry}>
        保存失败，重试
      </button>
    );
  }
  return (
    <span className="db-save-indicator" data-testid="brief-autosave">
      {status === "saving" ? "保存中…" : "已保存"}
    </span>
  );
}

/** 目的地条：看板卡片链接 + 管线状态 + 通知状态。 */
function DestinationStrip({
  selection,
  onNotifyRetry,
  busy,
}: {
  selection: BriefSelection;
  onNotifyRetry: () => void;
  busy: boolean;
}) {
  const notifyState = selection.notifyState;
  return (
    <div className="db-dest" data-testid="brief-destination">
      {selection.boardTopicId !== null && (
        <a
          className="db-dest-link"
          data-testid="brief-board-link"
          href={`/content?view=board&card=${selection.boardTopicId}`}
        >
          已进选题看板 · 查看卡片 →
        </a>
      )}
      <span className="db-dest-status" data-testid="brief-selection-status" data-status={selection.status}>
        {pipelineLabel(selection)}
      </span>
      {notifyState === "delivered" && (
        <span
          className="db-dest-notify is-delivered"
          data-testid="brief-notify-delivered"
          title={shortMoment(selection.notifyAt)}
        >
          已通知漱芳斋
        </span>
      )}
      {notifyState === "failed" && (
        <span className="db-dest-notify is-failed" data-testid="brief-notify-failed" title={selection.notifyError || ""}>
          通知失败，
          <button type="button" className="db-notify-retry" data-testid="brief-notify-retry" disabled={busy} onClick={onNotifyRetry}>
            重试
          </button>
        </span>
      )}
      {notifyState === "unconfigured" && (
        <span className="db-dest-notify is-unconfigured" data-testid="brief-notify-unconfigured">
          未配置通知
        </span>
      )}
    </div>
  );
}

/** 大纲区块：内容 + 作者/时间；超过 ~12 行折叠；大纲待确认时给确认按钮。 */
function OutlineSection({
  selection,
  busy,
  onConfirm,
}: {
  selection: BriefSelection;
  busy: boolean;
  onConfirm: () => void;
}) {
  const outline = stripDuplicateOutlineHeading(selection.outlineMd).trim();
  if (!outline) return null;
  const lines = outline.split("\n").length;
  const collapsible = lines > OUTLINE_COLLAPSE_LINES;
  const meta = [selection.outlineBy, shortMoment(selection.outlineAt)].filter(Boolean).join(" · ");
  const needConfirm = selection.status === "outline_pending";
  return (
    <section className="db-outline" data-testid="brief-outline">
      {collapsible ? (
        <details>
          <summary>{OUTLINE_TITLE}</summary>
          <div className="db-outline-body">
            <MiniMarkdown text={outline} />
          </div>
        </details>
      ) : (
        <>
          <h3 className="db-section-title">{OUTLINE_TITLE}</h3>
          <div className="db-outline-body">
            <MiniMarkdown text={outline} />
          </div>
        </>
      )}
      {meta && <p className="db-outline-meta">{meta}</p>}
      {needConfirm && (
        <button
          type="button"
          className="db-btn db-btn-primary db-outline-confirm"
          data-testid="brief-confirm-outline"
          disabled={busy}
          onClick={onConfirm}
        >
          {CONFIRM_OUTLINE_LABEL}
        </button>
      )}
    </section>
  );
}

/** The right-hand (and phone full-screen) topic detail with its reply form. */
export function TopicDetail({
  topic,
  recommended,
  reason,
  state,
  busy,
  materialsByUrl,
  selection,
  selectionBusy,
  actionError,
  autosave,
  onAutosave,
  onFlush,
  onRetryAutosave,
  onSelect,
  onUndoSelection,
  onConfirmOutline,
  onNotifyRetry,
  rejectOpen,
  onRejectToggle,
  onSave,
}: Props) {
  const [comment, setComment] = useState(state.ratingComment);
  const [rejectReason, setRejectReason] = useState(state.rejectReason);
  // 「都不是，我自己说」的展开态是纯 UI 状态，文本本身走自动保存。
  const [customOpen, setCustomOpen] = useState(() => state.scenarioCustom.trim().length > 0);

  const picked = state.decision === "pick";
  const rejected = state.decision === "reject";
  const showComment = state.rating !== null || comment.length > 0;
  const selectionActive = Boolean(selection && selection.status !== "shelved");
  const showQuestionAnswer = topic.questions.length > 0;
  const showDecisionResult = (picked || rejected) && hasDecisionContent(state);

  function chooseScenario(index: number) {
    setCustomOpen(false);
    const clearing = state.scenarioIndex === index && !state.scenarioCustom;
    if (clearing) {
      onAutosave(topic.id, { scenarioIndex: null }, { scenarioIndex: null, scenarioText: "", scenarioCustom: "" });
      onFlush(topic.id);
      return;
    }
    onAutosave(
      topic.id,
      { scenarioIndex: index, scenarioCustom: "" },
      { scenarioIndex: index, scenarioText: topic.scenarios[index], scenarioCustom: "" },
    );
  }

  function toggleCustom() {
    if (customOpen) {
      setCustomOpen(false);
      onAutosave(topic.id, { scenarioCustom: "" }, { scenarioCustom: "" });
      onFlush(topic.id);
      return;
    }
    setCustomOpen(true);
    onAutosave(topic.id, { scenarioIndex: null, scenarioCustom: state.scenarioCustom }, { scenarioIndex: null, scenarioText: "" });
  }

  function updateAnswer(index: number, value: string) {
    const next = [...state.answers];
    while (next.length < topic.questions.length) next.push("");
    next[index] = value;
    onAutosave(topic.id, { answers: next }, { answers: next });
  }

  function chooseRating(value: number) {
    const next = state.rating === value ? null : value;
    void onSave(topic.id, { rating: next }, { rating: next });
  }

  function saveComment() {
    if (comment === state.ratingComment) return;
    void onSave(topic.id, { ratingComment: comment }, { ratingComment: comment });
  }

  function submitReject() {
    onRejectToggle(false);
    void onSave(
      topic.id,
      { decision: "reject", rejectReason },
      { decision: "reject", rejectReason, scenarioIndex: null, scenarioText: "", scenarioCustom: "" },
    );
  }

  function clearReject() {
    void onSave(topic.id, { decision: null, rejectReason: "" }, { decision: null, rejectReason: "" });
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

      {selection && <DestinationStrip selection={selection} onNotifyRetry={() => onNotifyRetry(topic.id)} busy={selectionBusy} />}
      {selection && <OutlineSection selection={selection} busy={selectionBusy} onConfirm={() => onConfirmOutline(topic.id)} />}

      {showDecisionResult && (
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
            <div className="db-section-head">
              <h3 className="db-section-title">可代入场景</h3>
              <SaveIndicator status={autosave} onRetry={() => onRetryAutosave(topic.id)} />
            </div>
            <div className="db-scenario-options" role="radiogroup" aria-label="可代入场景" data-testid="brief-scenario-options">
              {topic.scenarios.map((scenario, index) => {
                const chosen = customOpen === false && state.scenarioIndex === index && !state.scenarioCustom;
                const source = scenarioSource(topic, index);
                return (
                  <div key={index} className="db-scenario-option">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      className={`db-scenario-choice ${chosen ? "is-on" : ""}`}
                      data-testid={`brief-scenario-option-${index}`}
                      onClick={() => chooseScenario(index)}
                    >
                      <span className="db-radio-dot" aria-hidden="true" />
                      <span className="db-scenario-text">
                        <MiniMarkdown text={scenario} />
                      </span>
                    </button>
                    {source && (
                      <p className="db-source" data-testid={`brief-scenario-source-${index}`}>
                        来源：{source}
                      </p>
                    )}
                  </div>
                );
              })}

              <div className="db-scenario-option">
                <button
                  type="button"
                  role="radio"
                  aria-checked={customOpen}
                  className={`db-scenario-choice ${customOpen ? "is-on" : ""}`}
                  data-testid="brief-scenario-custom-option"
                  onClick={toggleCustom}
                >
                  <span className="db-radio-dot" aria-hidden="true" />
                  <span className="db-scenario-text">{CUSTOM_SCENARIO_LABEL}</span>
                </button>
                {customOpen && (
                  <textarea
                    className="db-scenario-custom"
                    data-testid="brief-scenario-custom"
                    value={state.scenarioCustom}
                    rows={3}
                    placeholder="说说你想从哪个场景切入"
                    aria-label="自定义场景"
                    onChange={(event) =>
                      onAutosave(
                        topic.id,
                        { scenarioCustom: event.target.value },
                        { scenarioCustom: event.target.value, scenarioIndex: null, scenarioText: "" },
                      )
                    }
                    onBlur={() => onFlush(topic.id)}
                  />
                )}
              </div>
            </div>
          </section>
        )}

        {showQuestionAnswer && (
          <section className="db-section" data-testid="brief-section-questions">
            <div className="db-section-head">
              <h3 className="db-section-title">问 Yu</h3>
              {topic.scenarios.length === 0 && (
                <SaveIndicator status={autosave} onRetry={() => onRetryAutosave(topic.id)} />
              )}
            </div>
            <div className="db-question-list">
              {topic.questions.map((question, index) => {
                const source = questionSource(topic, index);
                return (
                  <div key={index} className="db-question">
                    <p className="db-question-text">{question}</p>
                    {source && (
                      <p className="db-source" data-testid={`brief-question-source-${index}`}>
                        来源：{source}
                      </p>
                    )}
                    <textarea
                      data-testid={`brief-answer-${index}`}
                      value={state.answers[index] || ""}
                      rows={3}
                      placeholder="写下你的回答（可选）"
                      aria-label={question}
                      onChange={(event) => updateAnswer(index, event.target.value)}
                      onBlur={() => onFlush(topic.id)}
                    />
                  </div>
                );
              })}
            </div>
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
        {rejectOpen && (
          <div
            className="db-tray"
            data-testid="brief-tray"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onRejectToggle(false);
              }
            }}
          >
            <div className="db-reject-form">
              <input
                autoFocus
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
          </div>
        )}

        {showComment && (
          <div className="db-tray" data-testid="brief-comment-tray">
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
          </div>
        )}

        {actionError && (
          <p className="db-action-error" role="alert" data-testid="brief-action-error">
            {actionError}
          </p>
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
            {selectionActive ? (
              <button
                type="button"
                className="db-btn db-btn-undo"
                data-testid="brief-undo"
                disabled={selectionBusy}
                onClick={() => onUndoSelection(topic.id)}
              >
                撤销
              </button>
            ) : (
              <>
                {!rejected && (
                  <button
                    type="button"
                    className="db-btn db-btn-pick"
                    data-testid="brief-pick"
                    disabled={busy || selectionBusy}
                    onClick={() => onSelect(topic.id)}
                  >
                    {SELECT_LABEL}
                  </button>
                )}
                {!picked && (
                  <button
                    type="button"
                    className="db-btn db-btn-reject"
                    data-testid="brief-reject"
                    disabled={busy || selectionBusy}
                    onClick={() => onRejectToggle(!rejectOpen)}
                  >
                    {rejected ? "修改不要" : REJECT_LABEL}
                  </button>
                )}
                {state.decision && (
                  <button type="button" className="db-btn db-btn-undo" data-testid="brief-undo" disabled={busy} onClick={clearReject}>
                    撤销
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
