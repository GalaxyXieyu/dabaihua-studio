"use client";

import { platformLabel, type Topic } from "./Board";

const PLATFORM_COLORS: Record<string, string> = {
  公众号: "bg-emerald-50 text-emerald-700",
  小红书: "bg-red-50 text-red-600",
  X: "bg-sky-50 text-sky-600",
  B站: "bg-pink-50 text-pink-600",
};

const TYPE_COLORS: Record<string, string> = {
  连载: "bg-indigo-50 text-indigo-600",
  工具: "bg-cyan-50 text-cyan-700",
  热点: "bg-orange-50 text-orange-600",
  产品: "bg-violet-50 text-violet-600",
};

function scoreBadge(total: number) {
  if (total >= 9) return "bg-green-100 text-green-700 ring-green-300";
  if (total >= 7) return "bg-blue-100 text-blue-700 ring-blue-300";
  if (total >= 6) return "bg-amber-100 text-amber-700 ring-amber-300";
  return "bg-gray-100 text-gray-500 ring-gray-300";
}

export function TopicCard({ topic, onClick }: { topic: Topic; onClick: () => void }) {
  const platform = platformLabel(topic.platform);
  const seriesText = topic.series
    ? topic.seriesOrder ? `${topic.series} #${topic.seriesOrder}` : topic.series
    : null;

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
      className="group w-full cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3.5 text-left shadow-sm transition hover:border-[var(--green)] hover:shadow-md"
    >
      {/* 标题 */}
      <h3 className="mb-1.5 line-clamp-2 text-sm font-bold leading-snug text-[var(--ink)] group-hover:text-[var(--green)]">
        {topic.title}
      </h3>

      {/* 角度 */}
      {topic.angle && (
        <p className="mb-2 line-clamp-1 text-xs text-[var(--muted)]">{topic.angle}</p>
      )}

      {/* 标签行 */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {platform && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PLATFORM_COLORS[platform] || "bg-gray-100 text-gray-600"}`}>
            {platform}
          </span>
        )}
        {topic.contentType && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TYPE_COLORS[topic.contentType] || "bg-gray-100 text-gray-600"}`}>
            {topic.contentType}
          </span>
        )}
        {seriesText && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
            📚 {seriesText}
          </span>
        )}
      </div>

      {/* 审稿入口与审稿状态 */}
      {(topic.hasDraft || topic.reviewStatus === "approved" || topic.reviewStatus === "rejected") && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {topic.hasDraft ? (
            <a
              href={`/review/${topic.id}`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className="topic-review-link rounded-full bg-[var(--green-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--green)] hover:brightness-95"
            >
              📝 审稿
            </a>
          ) : null}
          {topic.reviewStatus === "approved" && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">✅ 已通过</span>
          )}
          {topic.reviewStatus === "rejected" && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">↩️ 已打回</span>
          )}
        </div>
      )}

      {/* 底行 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {topic.scheduledDate && (
            <span className="text-[10px] font-medium text-amber-600">📅 {topic.scheduledDate}</span>
          )}
          {topic.publishedDate && (
            <span className="text-[10px] font-medium text-purple-600">🚀 {topic.publishedDate}</span>
          )}
          {topic.hkr && (
            <span className="text-[10px] text-[var(--faint)]">{topic.hkr}</span>
          )}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${scoreBadge(topic.total)}`}>
          {topic.total}分
        </span>
      </div>
    </div>
  );
}
