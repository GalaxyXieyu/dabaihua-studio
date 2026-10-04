// 结构化大纲编辑器的状态与保存逻辑：本地 outline、自动保存（800ms 防抖 + 串行）、
// 409 rev_conflict 处理、「按建议重生成」与「确认大纲」。所有纯逻辑（block id、
// feedback 收集等）复用 lib/outline-core.ts，这里只做网络与状态编排。

"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { collectFeedbackBlocks, type OutlineV01, type RegenerateBlock } from "../../../lib/outline-core";
import type { AutosaveStatus, BriefSelection } from "./brief-types";

/** 自动保存防抖：停止输入 800ms 后落库。 */
const AUTOSAVE_DEBOUNCE_MS = 800;
/** 保存失败时的兜底文案。 */
const SAVE_FAILED_MESSAGE = "保存失败，请重试";
/** 重生成 / 确认失败时的兜底文案。 */
const ACTION_FAILED_MESSAGE = "操作失败，请重试";
/** 读最新大纲失败时的兜底文案。 */
const RELOAD_FAILED_MESSAGE = "载入最新失败，请重试";

type DraftOptions = {
  date: string;
  topicId: string;
  selection: BriefSelection | null;
  onSelection: (selection: BriefSelection) => void;
};

/** TopicDetail 通过这个句柄把同一份状态同时给编辑器与底部栏。 */
export type OutlineDraft = {
  outline: OutlineV01 | null;
  rev: number;
  saveState: AutosaveStatus | null;
  /** 服务端最新 rev；非 null 表示提示「大纲在别处更新过」。 */
  conflict: number | null;
  /** 重生成 / 确认 / 载入失败时显示在底部栏的一行红字。 */
  actionError: string;
  /** 重生成或确认请求进行中。 */
  barBusy: boolean;
  openSuggest: Record<string, boolean>;
  setOpenSuggest: Dispatch<SetStateAction<Record<string, boolean>>>;
  update: (mutator: (draft: OutlineV01) => void) => void;
  regenerate: () => void;
  confirm: () => void;
  locked: (blockId: string) => boolean;
  /** GET pipeline，用服务端最新版本覆盖本地并清掉冲突提示。 */
  loadLatest: () => void;
  retrySave: () => void;
};

type PipelineResponse = {
  selection?: BriefSelection | null;
  error?: string;
};

function cloneOutline(outline: OutlineV01): OutlineV01 {
  return structuredClone(outline);
}

/**
 * 待重生成的块：已填 feedback 且当前不在重写中。
 * 底部栏与 hook 的 regenerate() 共用，保证计数、chip、按钮里的 n 一致。
 */
export function pendingBlocks(
  outline: OutlineV01 | null,
  locked: (blockId: string) => boolean,
): RegenerateBlock[] {
  if (!outline) return [];
  return collectFeedbackBlocks(outline).filter((item) => !locked(item.blockId));
}

export function useOutlineDraft({ date, topicId, selection, onSelection }: DraftOptions): OutlineDraft {
  const [outline, setOutline] = useState<OutlineV01 | null>(selection?.outlineJson ?? null);
  const [rev, setRev] = useState<number>(selection?.outlineRev ?? 0);
  const [saveState, setSaveState] = useState<AutosaveStatus | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [barBusy, setBarBusy] = useState(false);
  const [openSuggest, setOpenSuggest] = useState<Record<string, boolean>>({});

  // 只读的“最新值”引用：在回调里读到最新数据，绝不在渲染期间写 ref。
  const outlineRef = useRef<OutlineV01 | null>(outline);
  const revRef = useRef(rev);
  const conflictRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const savingPromiseRef = useRef<Promise<void> | null>(null);
  const queuedRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    outlineRef.current = outline;
  }, [outline]);
  useEffect(() => {
    revRef.current = rev;
  }, [rev]);
  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);

  /** 清空待保存状态，用一份服务端 selection 重置本地。 */
  const reset = useCallback((next: BriefSelection) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    dirtyRef.current = false;
    queuedRef.current = false;
    conflictRef.current = null;
    setConflict(null);
    setOutline(next.outlineJson ?? null);
    setRev(next.outlineRev);
    setSaveState(null);
  }, []);

  /** 真正发一次 PUT；串行，如果保存期间又有改动，回来后补发一次。 */
  async function flush() {
    const current = outlineRef.current;
    if (!current) return;
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState("saving");
    const run = (async () => {
      try {
        const response = await fetch(`/api/briefs/${date}/topics/${topicId}/outline-draft`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ outlineJson: current, baseRev: revRef.current }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string; rev?: number; selection?: BriefSelection };
        if (response.status === 409 && data.error === "rev_conflict") {
          // 冲突：停止自动保存，等 Yu 点「载入最新」。
          conflictRef.current = typeof data.rev === "number" ? data.rev : revRef.current;
          setConflict(conflictRef.current);
          setSaveState(null);
          return;
        }
        if (!response.ok || !data.selection) throw new Error(data.error || SAVE_FAILED_MESSAGE);
        const server = data.selection;
        revRef.current = server.outlineRev;
        setRev(server.outlineRev);
        setSaveState("saved");
        onSelection(server);
      } catch {
        setSaveState("error");
      } finally {
        savingRef.current = false;
        savingPromiseRef.current = null;
        if (queuedRef.current && conflictRef.current === null) {
          queuedRef.current = false;
          void flushRef.current();
        }
      }
    })();
    savingPromiseRef.current = run;
    await run;
  }

  /** 等正在路上的保存结束（忽略它的错误），再用最新 revRef 发动作请求。 */
  async function awaitPendingSave(): Promise<void> {
    // 排队补发的保存可能接在上一笔后面，循环等到真的没有在途的 PUT。
    while (savingPromiseRef.current) {
      try {
        await savingPromiseRef.current;
      } catch {
        // 保存失败不影响重生成/确认，它们自带完整 outlineJson。
      }
    }
  }

  const flushRef = useRef<() => Promise<void>>(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  /** 不可变地改本地 outline，并安排一次防抖保存。 */
  function update(mutator: (draft: OutlineV01) => void) {
    const current = outlineRef.current;
    if (!current) return;
    const next = cloneOutline(current);
    mutator(next);
    outlineRef.current = next;
    setOutline(next);
    // 冲突未解决前只改本地，不再自动写，避免反复 409。
    if (conflictRef.current !== null) return;
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function locked(blockId: string): boolean {
    if (!selection) return false;
    if (selection.regenerating.some((item) => item.blockId === "all")) return true;
    return selection.regenerating.some((item) => item.blockId === blockId);
  }

  /** 取消防抖并立即把当前状态发给服务端；返回服务端 selection 或 null。 */
  async function pushNow(path: string, body: Record<string, unknown>): Promise<BriefSelection | null> {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const response = await fetch(`/api/briefs/${date}/topics/${topicId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; rev?: number; selection?: BriefSelection };
    if (response.status === 409 && data.error === "rev_conflict") {
      conflictRef.current = typeof data.rev === "number" ? data.rev : revRef.current;
      setConflict(conflictRef.current);
      return null;
    }
    if (!response.ok || !data.selection) throw new Error(data.error || ACTION_FAILED_MESSAGE);
    return data.selection;
  }

  async function regenerate() {
    if (!outlineRef.current) return;
    setActionError("");
    const blocks = pendingBlocks(outlineRef.current, locked);
    if (blocks.length === 0) return;
    setBarBusy(true);
    try {
      await awaitPendingSave();
      const server = await pushNow("regenerate-outline", {
        outlineJson: outlineRef.current,
        baseRev: revRef.current,
        blocks,
      });
      if (!server) return;
      revRef.current = server.outlineRev;
      setRev(server.outlineRev);
      setSaveState("saved");
      onSelection(server);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : ACTION_FAILED_MESSAGE);
    } finally {
      setBarBusy(false);
    }
  }

  async function confirm() {
    if (!outlineRef.current) return;
    setActionError("");
    setBarBusy(true);
    try {
      await awaitPendingSave();
      const server = await pushNow("confirm-outline", {
        outlineJson: outlineRef.current,
        baseRev: revRef.current,
      });
      if (!server) return;
      revRef.current = server.outlineRev;
      setRev(server.outlineRev);
      onSelection(server);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : ACTION_FAILED_MESSAGE);
    } finally {
      setBarBusy(false);
    }
  }

  async function loadLatest() {
    setActionError("");
    try {
      const response = await fetch(`/api/briefs/${date}/topics/${topicId}/pipeline`);
      const data = (await response.json().catch(() => ({}))) as PipelineResponse;
      if (!response.ok || !data.selection) throw new Error(data.error || RELOAD_FAILED_MESSAGE);
      reset(data.selection);
      onSelection(data.selection);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : RELOAD_FAILED_MESSAGE);
    }
  }

  function retrySave() {
    void flushRef.current();
  }

  // 外部 rev 变大（重生成回来、确认后）且本地没有未保存改动时，用服务端版本重置。
  useEffect(() => {
    if (!selection) return;
    if (selection.outlineRev === revRef.current) return;
    if (dirtyRef.current || savingRef.current || timerRef.current) return;
    if (conflictRef.current !== null) return;
    reset(selection);
  }, [selection, reset]);

  return {
    outline,
    rev,
    saveState,
    conflict,
    actionError,
    barBusy,
    openSuggest,
    setOpenSuggest,
    update,
    regenerate: () => {
      void regenerate();
    },
    confirm: () => {
      void confirm();
    },
    locked,
    loadLatest: () => {
      void loadLatest();
    },
    retrySave,
  };
}
