"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  summarizeResponses,
  type DailyBrief as DailyBriefDoc,
  type ShapedBriefResponse,
} from "../../../../lib/daily-brief-core";
import {
  orderBriefTopics,
  type MaterialView,
} from "../../../../lib/brief-view";
import { TopicList } from "./TopicList";
import { TopicDetail } from "./TopicDetail";
import { emptyState, type ResponseState } from "./brief-types";

export type BriefDateOption = {
  date: string;
  title: string;
  topicCount: number;
  responseCount: number;
  updatedAt: string;
};

type Props = {
  date: string;
  dateLabel: string;
  brief: DailyBriefDoc;
  dates: BriefDateOption[];
  userAccount: string;
  initialResponses: ShapedBriefResponse[];
  materialsByUrl: Record<string, MaterialView>;
  initialTopicId: string | null;
  requestedTopic: string | null;
};

/** `2026-09-30` → `9月30日`, short enough for a phone-width select. */
function shortDate(date: string): string {
  const parts = String(date).split("-");
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return date;
  return `${month}月${day}日`;
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

async function postResponse(
  date: string,
  body: Record<string, unknown>,
): Promise<ShapedBriefResponse> {
  const response = await fetch(`/api/briefs/${date}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    response?: ShapedBriefResponse;
  };
  if (!response.ok || !data.response)
    throw new Error(data.error || "保存失败，请重试");
  return data.response;
}

export function DailyBrief({
  date,
  dateLabel,
  brief,
  dates,
  userAccount,
  initialResponses,
  materialsByUrl,
  initialTopicId,
  requestedTopic,
}: Props) {
  const [responses, setResponses] = useState<Record<string, ResponseState>>(
    () => {
      const map: Record<string, ResponseState> = {};
      for (const response of initialResponses) {
        if (response.user.account === userAccount)
          map[response.topicId] = toState(response);
      }
      return map;
    },
  );
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const orderedTopics = useMemo(
    () => orderBriefTopics(brief.topics, brief.recommendation?.topicId ?? null),
    [brief],
  );
  const [activeTopicId, setActiveTopicId] = useState<string | null>(
    () => initialTopicId ?? orderedTopics[0]?.id ?? null,
  );
  const [mobileOpen, setMobileOpen] = useState<boolean>(() =>
    Boolean(requestedTopic && requestedTopic === initialTopicId),
  );
  const [tray, setTray] = useState<"pick" | "reject" | null>(null);
  // null = 还没在浏览器里量过（服务端渲染时两套都出，交给 CSS 隐藏）；量过之后只挂需要的那一套，避免重复 DOM。
  const [isWide, setIsWide] = useState<boolean | null>(null);
  // 详情层是不是我们 pushState 打开的：直接带 ?topic= 进来时，「返回」不能 history.back() 离开页面。
  const pushedRef = useRef(false);

  const wideScrollRef = useRef<HTMLElement | null>(null);
  const overlayScrollRef = useRef<HTMLDivElement | null>(null);
  const listRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const counts = summarizeResponses(
    Object.values(responses),
    brief.topics.length,
  );

  const currentIndex = dates.findIndex((item) => item.date === date);
  const older = currentIndex >= 0 ? dates[currentIndex + 1] : undefined;
  const newer = currentIndex > 0 ? dates[currentIndex - 1] : undefined;

  const activeTopic =
    orderedTopics.find((topic) => topic.id === activeTopicId) ?? null;

  async function save(
    topicId: string,
    patch: Record<string, unknown>,
    optimistic: Partial<ResponseState>,
  ) {
    const previous = responses[topicId];
    setResponses((current) => ({
      ...current,
      [topicId]: { ...emptyState(), ...current[topicId], ...optimistic },
    }));
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

  function updateUrl(topicId: string | null, mode: "push" | "replace") {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("date", date);
    if (topicId) params.set("topic", topicId);
    else params.delete("topic");
    const next = `${window.location.pathname}?${params.toString()}`;
    if (mode === "push") {
      window.history.pushState({ topic: topicId }, "", next);
      pushedRef.current = true;
    } else window.history.replaceState({ topic: topicId }, "", next);
  }

  function selectTopic(
    topicId: string,
    mode: "push" | "replace" = "push",
    openMobile = true,
  ) {
    setActiveTopicId(topicId);
    setTray(null);
    if (openMobile) setMobileOpen(true);
    updateUrl(topicId, mode);
    if (wideScrollRef.current) wideScrollRef.current.scrollTop = 0;
    if (overlayScrollRef.current) overlayScrollRef.current.scrollTop = 0;
  }

  useEffect(() => {
    function onPopState() {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const topic = params.get("topic");
      if (topic && orderedTopics.some((item) => item.id === topic)) {
        setActiveTopicId(topic);
        setMobileOpen(true);
        setTray(null);
        if (wideScrollRef.current) wideScrollRef.current.scrollTop = 0;
        if (overlayScrollRef.current) overlayScrollRef.current.scrollTop = 0;
      } else {
        setMobileOpen(false);
        // 宽屏回到没带 topic 的网址：回到进页面时默认选中的那一条。
        if (initialTopicId) setActiveTopicId(initialTopicId);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [orderedTopics, initialTopicId]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  function closeOverlay() {
    if (pushedRef.current) {
      window.history.back();
      return;
    }
    updateUrl(null, "replace");
    setMobileOpen(false);
    setTray(null);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 1024px)").matches
    )
      return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  function handleKeyDown(event: KeyboardEvent) {
    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 1024px)").matches
    )
      return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    if (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      target?.isContentEditable
    )
      return;

    const key = event.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;

    if (key === "Escape") {
      if (tray) {
        event.preventDefault();
        setTray(null);
      }
      return;
    }

    if (!activeTopic) return;

    if (key === "ArrowUp" || lower === "k") {
      event.preventDefault();
      const index = orderedTopics.findIndex(
        (item) => item.id === activeTopic.id,
      );
      const nextIndex = Math.max(0, index - 1);
      if (nextIndex !== index) {
        selectTopic(orderedTopics[nextIndex].id, "replace", false);
        listRefs.current[orderedTopics[nextIndex].id]?.scrollIntoView({
          block: "nearest",
        });
      }
      return;
    }

    if (key === "ArrowDown" || lower === "j") {
      event.preventDefault();
      const index = orderedTopics.findIndex(
        (item) => item.id === activeTopic.id,
      );
      const nextIndex = Math.min(orderedTopics.length - 1, index + 1);
      if (nextIndex !== index) {
        selectTopic(orderedTopics[nextIndex].id, "replace", false);
        listRefs.current[orderedTopics[nextIndex].id]?.scrollIntoView({
          block: "nearest",
        });
      }
      return;
    }

    if (lower === "y") {
      event.preventDefault();
      if (
        activeTopic.scenarios.length === 0 &&
        activeTopic.questions.length === 0
      ) {
        void save(
          activeTopic.id,
          { decision: "pick", scenarioIndex: null, answers: [] },
          {
            decision: "pick",
            scenarioIndex: null,
            scenarioText: "",
            answers: [],
            rejectReason: "",
          },
        );
      } else {
        setTray("pick");
      }
      return;
    }

    if (lower === "n") {
      event.preventDefault();
      setTray("reject");
      return;
    }

    if (key >= "1" && key <= "5") {
      event.preventDefault();
      const value = Number(key);
      const current = responses[activeTopic.id]?.rating ?? null;
      const next = current === value ? null : value;
      void save(activeTopic.id, { rating: next }, { rating: next });
    }
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  const recommendedId = brief.recommendation?.topicId ?? null;

  function detailFor(topic: DailyBriefDoc["topics"][number]) {
    return (
      <TopicDetail
        topic={topic}
        recommended={topic.id === recommendedId}
        reason={
          topic.id === recommendedId ? brief.recommendation?.reason || "" : ""
        }
        state={responses[topic.id] || emptyState()}
        busy={Boolean(busy[topic.id])}
        materialsByUrl={materialsByUrl}
        tray={tray}
        onTrayChange={setTray}
        onSave={save}
      />
    );
  }

  return (
    <div className="db">
      <header className="db-head">
        <div className="db-head-main">
          <p className="page-kicker">内容 · 选题简报</p>
          <h1 className="page-title">{dateLabel}</h1>
          <p className="db-subtitle">
            {brief.title && <span>{brief.title}</span>}
            <span className="db-progress" aria-live="polite">
              已选 {counts.pick} · 不要 {counts.reject} · 已打分 {counts.rated} / {counts.total}
            </span>
          </p>
        </div>
        <nav className="db-nav" aria-label="日期切换">
          {older ? (
            <a
              className="db-nav-button"
              data-testid="brief-prev"
              href={`/topics/daily?date=${older.date}`}
            >
              ‹ 上一期
            </a>
          ) : (
            <span
              className="db-nav-button is-disabled"
              data-testid="brief-prev"
              aria-disabled="true"
            >
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
              if (next && next !== date)
                window.location.assign(`/topics/daily?date=${next}`);
            }}
          >
            {dates.map((option) => (
              <option key={option.date} value={option.date}>
                {shortDate(option.date)} · 已回复 {option.responseCount}/
                {option.topicCount}
              </option>
            ))}
          </select>
          {newer ? (
            <a
              className="db-nav-button"
              data-testid="brief-next"
              href={`/topics/daily?date=${newer.date}`}
            >
              下一期 ›
            </a>
          ) : (
            <span
              className="db-nav-button is-disabled"
              data-testid="brief-next"
              aria-disabled="true"
            >
              下一期 ›
            </span>
          )}
        </nav>
      </header>

      <div className="db-body">
        <TopicList
          topics={orderedTopics}
          activeId={activeTopicId}
          recommendedId={recommendedId}
          responses={responses}
          intro={brief.intro}
          notes={brief.notes}
          onSelect={(topicId) => selectTopic(topicId)}
          registerRef={(topicId, element) => {
            listRefs.current[topicId] = element;
          }}
        />

        {isWide !== false && (
          <aside className="db-right" ref={wideScrollRef}>
            {activeTopic ? (
              <div key={activeTopic.id} className="db-fade">
                {detailFor(activeTopic)}
              </div>
            ) : (
              <p className="db-none">暂无选题</p>
            )}
          </aside>
        )}
      </div>

      {mobileOpen && activeTopic && isWide !== true && (
        <div
          className="db-overlay"
          role="dialog"
          aria-modal="true"
          onTouchStart={(event) => {
            const touch = event.touches[0];
            touchStartRef.current = { x: touch.clientX, y: touch.clientY };
          }}
          onTouchEnd={(event) => {
            const start = touchStartRef.current;
            touchStartRef.current = null;
            if (!start) return;
            const touch = event.changedTouches[0];
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (start.x < 24 && dx > 80 && dx > Math.abs(dy)) closeOverlay();
          }}
        >
          <div className="db-overlay-head">
            <button
              type="button"
              className="db-overlay-back"
              onClick={closeOverlay}
            >
              ‹ 返回
            </button>
            <span className="db-overlay-date">{dateLabel}</span>
          </div>
          <div className="db-overlay-scroll" ref={overlayScrollRef}>
            <div key={activeTopic.id} className="db-fade">
              {detailFor(activeTopic)}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="db-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
