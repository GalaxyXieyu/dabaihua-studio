"use client";

import type { DailyBrief } from "../../../lib/daily-brief-core";
import { topicStatusLabel } from "../../../lib/brief-view";
import { MiniMarkdown } from "./mini-markdown";
import type { ResponseState } from "./brief-types";

type Props = {
  topics: DailyBrief["topics"];
  activeId: string | null;
  recommendedId: string | null;
  responses: Record<string, ResponseState>;
  intro: string;
  notes: string;
  onSelect: (topicId: string) => void;
  registerRef: (topicId: string, element: HTMLButtonElement | null) => void;
};

/** Left column: one compact row per topic, no fold-out, no per-row buttons. */
export function TopicList({ topics, activeId, recommendedId, responses, intro, notes, onSelect, registerRef }: Props) {
  return (
    <div className="db-left">
      <ul className="db-topic-list">
        {topics.map((topic) => {
          const state = responses[topic.id];
          const active = topic.id === activeId;
          const recommended = topic.id === recommendedId;
          const status = topicStatusLabel(state ? { decision: state.decision, rating: state.rating } : { decision: null, rating: null });
          return (
            <li key={topic.id}>
              <button
                ref={(element) => registerRef(topic.id, element)}
                type="button"
                className={`db-topic ${active ? "is-active" : ""}`}
                data-testid="brief-card"
                data-topic-id={topic.id}
                onClick={() => onSelect(topic.id)}
              >
                <span className="db-topic-tags">
                  <span className={`db-type db-type-${topic.type === "新闻题" ? "news" : "landing"}`}>{topic.type}</span>
                  {topic.label && <span className="db-label">{topic.label}</span>}
                  {recommended && (
                    <span className="db-recommend-badge" data-testid="brief-recommended">
                      今日推荐
                    </span>
                  )}
                </span>
                <span className="db-topic-status" data-decision={state?.decision || ""}>
                  {status}
                </span>
                <span className="db-topic-title">{topic.title}</span>
                {topic.oneLiner && <span className="db-topic-oneliner">{topic.oneLiner}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {(intro || notes) && (
        <footer className="db-foot">
          {intro && (
            <details className="db-note">
              <summary>说明</summary>
              <MiniMarkdown text={intro} />
            </details>
          )}
          {notes && (
            <details className="db-note">
              <summary>附注</summary>
              <MiniMarkdown text={notes} />
            </details>
          )}
        </footer>
      )}
    </div>
  );
}
