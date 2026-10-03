"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  summarizeResponses,
  type DailyBrief as DailyBriefDoc,
  type ShapedBriefResponse,
} from "../../../lib/daily-brief-core";
import { PIPELINE_LABELS } from "../../../lib/brief-pipeline-core";
import {
  orderBriefTopics,
  type MaterialView,
} from "../../../lib/brief-view";
import { TopicList } from "./TopicList";
import { TopicDetail } from "./TopicDetail";
import { emptyState, type AutosaveStatus, type BriefSelection, type ResponseState } from "./brief-types";

export type BriefDateOption = {
  date: string;
  title: string;
  topicCount: number;
  responseCount: number;
  updatedAt: string;
};

const AUTOSAVE_DEBOUNCE_MS = 800;

type Props = {
  date: string;
  dateLabel: string;
  brief: DailyBriefDoc;
  dates: BriefDateOption[];
  userAccount: string;
  initialResponses: ShapedBriefResponse[];
  initialSelections: BriefSelection[];
  materialsByUrl: Record<string, MaterialView>;
  initialTopicId: string | null;
  requestedTopic: string | null;
};

type PipelineResult = {
  selection?: BriefSelection;
  response?: ShapedBriefResponse;
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
    scenarioText: response.scenario ? response.scenario.text : response.scenarioCustom,
    scenarioCustom: response.scenarioCustom,
    answers: response.answers.map((item) => item.answer),
    rejectReason: response.rejectReason,
  };
}

/**
 * 自动保存只回写场景/回答相关字段，避免把用户正在输入的评分、决定等乐观状态
 * 用旧的服务端数据盖掉。
 */
function mergeAutosaved(current: ResponseState, saved: ShapedBriefResponse): ResponseState {
  return {
    ...current,
    scenarioIndex: saved.scenario ? saved.scenario.index : null,
    scenarioText: saved.scenario ? saved.scenario.text : saved.scenarioCustom,
    scenarioCustom: saved.scenarioCustom,
    answers: saved.answers.map((item) => item.answer),
  };
}

/** 立即保存只回写本次补丁涉及的字段，其余保持乐观状态。 */
function mergePatched(current: ResponseState, saved: ShapedBriefResponse, patch: Record<string, unknown>): ResponseState {
  const next = { ...current };
  if ("rating" in patch) next.rating = saved.rating;
  if ("ratingComment" in patch) next.ratingComment = saved.ratingComment;
  if ("decision" in patch) next.decision = saved.decision;
  if ("rejectReason" in patch) next.rejectReason = saved.rejectReason;
  if ("scenarioIndex" in patch || "scenarioCustom" in patch) {
    next.scenarioIndex = saved.scenario ? saved.scenario.index : null;
    next.scenarioText = saved.scenario ? saved.scenario.text : saved.scenarioCustom;
    next.scenarioCustom = saved.scenarioCustom;
  }
  if ("answers" in patch) next.answers = saved.answers.map((item) => item.answer);
  return next;
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
  if (!response.ok || !data.response) throw new Error(data.error || "保存失败，请重试");
  return data.response;
}

async function postPipeline(
  date: string,
  topicId: string,
  action: "select" | "undo" | "confirm-outline" | "notify",
  body?: Record<string, unknown>,
): Promise<PipelineResult> {
  const response = await fetch(`/api/briefs/${date}/topics/${topicId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => ({}))) as PipelineResult & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败，请重试");
  return data;
}

function optimisticSelection(topicId: string): BriefSelection {
  return {
    topicId,
    boardTopicId: null,
    status: "selected",
    statusLabel: PIPELINE_LABELS.selected,
    outlineMd: "",
    outlineBy: "",
    outlineAt: null,
    statusBy: "Yu",
    statusAt: new Date().toISOString(),
    notifyEvent: "select",
    notifyState: null,
    notifyHttpStatus: null,
    notifyError: null,
    notifyAt: null,
  };
}

export function DailyBrief({
  date,
  dateLabel,
  brief,
  dates,
  userAccount,
  initialResponses,
  initialSelections,
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
  const [selections, setSelections] = useState<Record<string, BriefSelection | null>>(() => {
    const map: Record<string, BriefSelection | null> = {};
    for (const selection of initialSelections) map[selection.topicId] = selection;
    return map;
  });
  const [autosave, setAutosave] = useState<Record<string, AutosaveStatus>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const responsesRef = useRef(responses);
  responsesRef.current = responses;
  const selectionsRef = useRef(selections);
  selectionsRef.current = selections;
  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autosaveQueue = useRef<Record<string, Record<string, unknown>>>({});
  const autosaveChain = useRef<Record<string, Promise<void>>>({});

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
  const [tray, setTray] = useState<"reject" | null>(null);
  // null = 还没在浏览器里量过（服务端渲染时两套都出，交给 CSS 隐藏）；量过之后只挂需要的那一套，避免重复 DOM。
  const [isWide, setIsWide] = useState<boolean | null>(null);
  // 详情层是不是我们 pushState 打开的：直接带 ?topic= 进来时，「返回」不能 history.back() 离开页面。
  const pushedRef = useRef(false);

  const wideScrollRef = useRef<HTMLElement | null>(null);
  const overlayScrollRef = useRef<HTMLDivElement | null>(null);
  const listRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const counts = summarizeResponses(Object.values(responses), brief.topics.length);

  const currentIndex = dates.findIndex((item) => item.date === date);
  const older = currentIndex >= 0 ? dates[currentIndex + 1] : undefined;
  const newer = currentIndex > 0 ? dates[currentIndex - 1] : undefined;

  const activeTopic = orderedTopics.find((topic) => topic.id === activeTopicId) ?? null;

  function applySelection(topicId: string, selection: BriefSelection) {
    setSelections((current) => ({ ...current, [topicId]: selection }));
  }

  function clearActionError(topicId: string) {
    setActionError((current) => {
      if (!current[topicId]) return current;
      const next = { ...current };
      delete next[topicId];
      return next;
    });
  }

  function setActionErrorFor(topicId: string, message: string) {
    setActionError((current) => ({ ...current, [topicId]: message }));
  }

  /**
   * 把选中的选题在左栏内滚动到可见位置：只计算相对 `.db-left` 的偏移并设置它的
   * scrollTop（block: "nearest" 的语义）。刻意不用 element.scrollIntoView：
   * 它可能把整页带走，这里只动 .db-left 自己的 scrollTop。
   */
  function scrollTopicIntoView(topicId: string) {
    if (typeof window === "undefined") return;
    const item = listRefs.current[topicId];
    if (!item) return;
    const container = item.closest(".db-left") as HTMLElement | null;
    if (!container) return;
    // 窄屏下列表不是滚动容器（整页滚），此时不接管滚动。
    if (container.scrollHeight <= container.clientHeight) return;
    const itemRect = item.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const itemTop = itemRect.top - containerRect.top + container.scrollTop;
    const itemBottom = itemTop + itemRect.height;
    if (itemTop < container.scrollTop) container.scrollTop = itemTop;
    else if (itemBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = itemBottom - container.clientHeight;
    }
  }

  /** 目的地条在详情顶部：操作成功后把右栏（或手机层）滚回顶部，不动窗口。 */
  function scrollDetailTop() {
    wideScrollRef.current?.scrollTo({ top: 0 });
    overlayScrollRef.current?.scrollTo({ top: 0 });
  }

  async function save(
    topicId: string,
    patch: Record<string, unknown>,
    optimistic: Partial<ResponseState>,
  ) {
    const previous = responsesRef.current[topicId];
    setResponses((current) => ({
      ...current,
      [topicId]: { ...emptyState(), ...current[topicId], ...optimistic },
    }));
    setBusy((current) => ({ ...current, [topicId]: true }));
    try {
      const saved = await postResponse(date, { topicId, ...patch });
      setResponses((current) => ({
        ...current,
        [topicId]: mergePatched(current[topicId] || emptyState(), saved, patch),
      }));
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

  /** 合并 800ms 内的改动，立即更新乐观状态，延迟发请求。 */
  function queueAutosave(topicId: string, patch: Record<string, unknown>, optimistic: Partial<ResponseState>) {
    setResponses((current) => ({
      ...current,
      [topicId]: { ...emptyState(), ...current[topicId], ...optimistic },
    }));
    autosaveQueue.current[topicId] = { ...(autosaveQueue.current[topicId] ?? {}), ...patch };
    setAutosave((current) => ({ ...current, [topicId]: "saving" }));
    const existing = autosaveTimers.current[topicId];
    if (existing) clearTimeout(existing);
    autosaveTimers.current[topicId] = setTimeout(() => {
      void flushAutosave(topicId);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /** 立刻把排队中的改动落库；返回本次落库完成（含失败）的 promise。 */
  function flushAutosave(topicId: string): Promise<void> {
    const timer = autosaveTimers.current[topicId];
    if (timer) {
      clearTimeout(timer);
      delete autosaveTimers.current[topicId];
    }
    const queued = autosaveQueue.current[topicId];
    if (!queued) return autosaveChain.current[topicId] ?? Promise.resolve();
    delete autosaveQueue.current[topicId];
    setAutosave((current) => ({ ...current, [topicId]: "saving" }));
    const previous = autosaveChain.current[topicId] ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        const saved = await postResponse(date, { topicId, ...queued });
        if (!autosaveQueue.current[topicId]) {
          setResponses((current) => ({
            ...current,
            [topicId]: mergeAutosaved(current[topicId] || emptyState(), saved),
          }));
        }
        setAutosave((current) => ({ ...current, [topicId]: "saved" }));
      } catch (error) {
        autosaveQueue.current[topicId] = { ...queued, ...(autosaveQueue.current[topicId] ?? {}) };
        setAutosave((current) => ({ ...current, [topicId]: "error" }));
        throw error;
      }
    });
    const tracked = next.catch(() => {});
    autosaveChain.current[topicId] = tracked;
    return tracked;
  }

  function retryAutosave(topicId: string) {
    if (!autosaveQueue.current[topicId]) {
      const state = responsesRef.current[topicId];
      if (state) {
        autosaveQueue.current[topicId] = {
          scenarioIndex: state.scenarioIndex,
          scenarioCustom: state.scenarioCustom,
          answers: state.answers,
        };
      }
    }
    void flushAutosave(topicId);
  }

  /** 「就写这个」：先把待保存的场景落库，再选中并通知漱芳斋；列表立即变已选。 */
  async function selectNow(topicId: string) {
    clearActionError(topicId);
    const previous = responsesRef.current[topicId];
    const previousSelection = selectionsRef.current[topicId] ?? null;
    const state = previous ?? emptyState();
    setBusy((current) => ({ ...current, [topicId]: true }));
    setResponses((current) => ({
      ...current,
      [topicId]: { ...emptyState(), ...current[topicId], decision: "pick", rejectReason: "" },
    }));
    setSelections((current) => ({ ...current, [topicId]: optimisticSelection(topicId) }));
    try {
      await flushAutosave(topicId);
      const data = await postPipeline(date, topicId, "select", {
        scenarioIndex: state.scenarioIndex,
        scenarioCustom: state.scenarioCustom,
        answers: state.answers,
      });
      if (data.selection) applySelection(topicId, data.selection);
      if (data.response) {
        const saved = data.response;
        setResponses((current) => ({ ...current, [topicId]: toState(saved) }));
      }
      scrollDetailTop();
    } catch (error) {
      setResponses((current) => {
        const next = { ...current };
        if (previous) next[topicId] = previous;
        else delete next[topicId];
        return next;
      });
      setSelections((current) => {
        const next = { ...current };
        if (previousSelection) next[topicId] = previousSelection;
        else delete next[topicId];
        return next;
      });
      setActionErrorFor(topicId, error instanceof Error ? error.message : "选中失败，请重试");
    } finally {
      setBusy((current) => ({ ...current, [topicId]: false }));
    }
  }

  /** 「撤销」：搁置选题（POST /undo），按钮区恢复成「就写这个」。 */
  async function undoSelection(topicId: string) {
    clearActionError(topicId);
    const previous = selectionsRef.current[topicId] ?? null;
    setBusy((current) => ({ ...current, [topicId]: true }));
    if (previous) {
      setSelections((current) => ({
        ...current,
        [topicId]: { ...previous, status: "shelved", statusLabel: PIPELINE_LABELS.shelved, notifyState: null },
      }));
    }
    try {
      const data = await postPipeline(date, topicId, "undo");
      if (data.selection) applySelection(topicId, data.selection);
      if (data.response) {
        const saved = data.response;
        setResponses((current) => ({ ...current, [topicId]: toState(saved) }));
      }
      scrollDetailTop();
    } catch (error) {
      setSelections((current) => {
        const next = { ...current };
        if (previous) next[topicId] = previous;
        else delete next[topicId];
        return next;
      });
      setActionErrorFor(topicId, error instanceof Error ? error.message : "撤销失败，请重试");
    } finally {
      setBusy((current) => ({ ...current, [topicId]: false }));
    }
  }

  async function confirmOutline(topicId: string) {
    clearActionError(topicId);
    setBusy((current) => ({ ...current, [topicId]: true }));
    try {
      const data = await postPipeline(date, topicId, "confirm-outline");
      if (data.selection) applySelection(topicId, data.selection);
      scrollDetailTop();
    } catch (error) {
      setActionErrorFor(topicId, error instanceof Error ? error.message : "确认失败，请重试");
    } finally {
      setBusy((current) => ({ ...current, [topicId]: false }));
    }
  }

  async function retryNotify(topicId: string) {
    clearActionError(topicId);
    setBusy((current) => ({ ...current, [topicId]: true }));
    try {
      const data = await postPipeline(date, topicId, "notify");
      if (data.selection) applySelection(topicId, data.selection);
      scrollDetailTop();
    } catch (error) {
      setActionErrorFor(topicId, error instanceof Error ? error.message : "通知失败，请重试");
    } finally {
      setBusy((current) => ({ ...current, [topicId]: false }));
    }
  }

  function updateUrl(topicId: string | null, mode: "push" | "replace") {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("view", "brief");
    params.set("date", date);
    if (topicId) params.set("topic", topicId);
    else params.delete("topic");
    const next = `/content?${params.toString()}`;
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

  // 首屏（?topic=）和任何来源的选中变化，都把左栏里的当前条目滚进视野。
  useEffect(() => {
    if (activeTopicId) scrollTopicIntoView(activeTopicId);
  }, [activeTopicId]);

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
        scrollTopicIntoView(orderedTopics[nextIndex].id);
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
        scrollTopicIntoView(orderedTopics[nextIndex].id);
      }
      return;
    }

    if (lower === "y") {
      event.preventDefault();
      const selection = selectionsRef.current[activeTopic.id];
      if (selection && selection.status !== "shelved") return;
      void selectNow(activeTopic.id);
      return;
    }

    if (lower === "n") {
      event.preventDefault();
      const selection = selectionsRef.current[activeTopic.id];
      if (selection && selection.status !== "shelved") return;
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
        reason={topic.id === recommendedId ? brief.recommendation?.reason || "" : ""}
        state={responses[topic.id] || emptyState()}
        busy={Boolean(busy[topic.id])}
        materialsByUrl={materialsByUrl}
        selection={selections[topic.id] ?? null}
        selectionBusy={Boolean(busy[topic.id])}
        actionError={actionError[topic.id] || ""}
        autosave={autosave[topic.id] ?? null}
        onAutosave={queueAutosave}
        onFlush={flushAutosave}
        onRetryAutosave={retryAutosave}
        onSelect={selectNow}
        onUndoSelection={undoSelection}
        onConfirmOutline={confirmOutline}
        onNotifyRetry={retryNotify}
        rejectOpen={tray === "reject"}
        onRejectToggle={(open) => setTray(open ? "reject" : null)}
        onSave={save}
      />
    );
  }

  return (
    <div className="db">
      <header className="db-head">
        {/* 刊头压成一行：日期标题 + 统计；完整简报标题只放在 title 里供悬停查看。 */}
        <div className="db-head-main">
          <h1 className="db-head-title" title={brief.title || undefined}>
            {dateLabel}
          </h1>
          <span className="db-progress" aria-live="polite">
            已选 {counts.pick} · 不要 {counts.reject} · 已打分 {counts.rated}/{counts.total}
          </span>
        </div>
        <nav className="db-nav" aria-label="日期切换">
          {older ? (
            <a
              className="db-nav-button"
              data-testid="brief-prev"
              href={`/content?view=brief&date=${older.date}`}
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
                window.location.assign(`/content?view=brief&date=${next}`);
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
              href={`/content?view=brief&date=${newer.date}`}
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
          selections={selections}
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
