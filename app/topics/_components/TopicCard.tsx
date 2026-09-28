"use client";

import { platformLabel, type Topic } from "./Board";

export function TopicCard({ topic, onClick }: { topic: Topic; onClick: () => void }) {
  const platform = platformLabel(topic.platform);
  const seriesText = topic.series
    ? topic.seriesOrder ? `${topic.series} #${topic.seriesOrder}` : topic.series
    : null;
  const tags = [platform, topic.contentType, seriesText].filter(Boolean).join(" · ");
  const hasReviewRow =
    Boolean(topic.hasDraft) ||
    topic.reviewStatus === "approved" ||
    topic.reviewStatus === "rejected" ||
    Boolean(topic.scheduledDate) ||
    Boolean(topic.publishedDate) ||
    Boolean(topic.hkr);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className="tp-item"
    >
      {/* 标题 */}
      <h3 className="tp-item-title">{topic.title}</h3>

      {/* 摘要（切入角度） */}
      {topic.angle && (
        <p className="tp-item-summary">{topic.angle}</p>
      )}

      {/* 平台 / 类型 + 分数 */}
      <div className="tp-item-meta">
        <span className="tp-item-tags">
          {tags || "未分类"}
        </span>
        <span className="tp-item-score">{topic.total} 分</span>
      </div>

      {/* 审稿入口、审稿状态、日期 */}
      {hasReviewRow && (
        <div className="tp-item-sub">
          {topic.hasDraft ? (
            <a
              href={`/review/${topic.id}`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className="topic-review-link tp-review-link"
            >
              审稿
            </a>
          ) : null}
          {topic.reviewStatus === "approved" && <span>已通过</span>}
          {topic.reviewStatus === "rejected" && <span>已打回</span>}
          {topic.scheduledDate && <span className="tp-item-date">{topic.scheduledDate}</span>}
          {topic.publishedDate && <span className="tp-item-date">{topic.publishedDate}</span>}
          {topic.hkr && <span>{topic.hkr}</span>}
        </div>
      )}
    </div>
  );
}
