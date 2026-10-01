"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  cardsToMirrorEntries,
  computeStats,
  formatMirrorDate,
  formatShortDate,
  isMirrorCanonical,
  isMirrorDeleted,
  isMirrorInbox,
  mirrorTabCounts,
  resolveMirrorTab,
  tabKeyForCategory,
  type MirrorEntry,
} from "../../../lib/mirror";
import type { Card, CardRevision } from "../../../lib/cards-core";
import { MirrorDeck, type MirrorCardVariant } from "./MirrorDeck";

const SHEET_CATEGORIES = ["画像", "偏好", "方法论", "决策", "待调整"];
const SCOPE_OPTIONS = ["沟通", "内容", "职业", "工作", "工作台"];

function categoryLabel(category: string): string {
  return category === "待调整" ? "正在调整" : category;
}

/** 客户端上海日期（UTC+8），和服务端 shanghaiDate 一致。 */
function todayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

type WriteResult = { card: Card; old?: Card; revisions?: CardRevision[] };
type ApiError = Error & { status?: number; data?: { error?: string; errors?: Array<{ field: string; message: string }>; current?: Card } };
type SheetState =
  | { kind: "create"; category: string }
  | { kind: "edit"; id: string; confirm?: boolean }
  | { kind: "delete"; id: string }
  | { kind: "action"; id: string }
  | null;
type Decided = { id: string; kind: "confirmed" | "rejected" };

const cardPath = (id: string) => `/api/cards/${encodeURIComponent(id)}`;

async function request(path: string, init: RequestInit): Promise<WriteResult> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error((data as { error?: string }).error || "请求失败") as ApiError;
    error.status = response.status;
    error.data = data as ApiError["data"];
    throw error;
  }
  return data as WriteResult;
}

export function MirrorBoard({
  initialCards,
  initialHistory,
  initialTab,
  initialView,
}: {
  initialCards: Card[];
  initialHistory: Record<string, CardRevision[]>;
  initialTab: string;
  initialView: "deck" | "trash";
}) {
  const [cards, setCards] = useState<Card[]>(initialCards);
  const [history, setHistory] = useState<Record<string, CardRevision[]>>(initialHistory);
  const [tab, setTab] = useState(initialTab);
  const [view, setView] = useState<"deck" | "trash">(initialView);
  const [prevTab, setPrevTab] = useState(initialTab);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [pending, setPending] = useState(false);
  const [decided, setDecided] = useState<Decided[]>([]);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editConflict, setEditConflict] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entries = useMemo(() => cardsToMirrorEntries(cards, history), [cards, history]);
  const canonical = useMemo(() => entries.filter(isMirrorCanonical), [entries]);
  const inbox = useMemo(() => entries.filter(isMirrorInbox), [entries]);
  const trash = useMemo(() => entries.filter(isMirrorDeleted), [entries]);
  const counts = useMemo(() => mirrorTabCounts(canonical, inbox), [canonical, inbox]);
  const stats = useMemo(() => computeStats(canonical, inbox, new Date()), [canonical, inbox]);
  const activeTab = resolveMirrorTab(tab);
  const tabEntries = activeTab.inbox ? inbox : canonical.filter((entry) => entry.category === activeTab.category);

  const agents = useMemo(() => {
    const set = new Set<string>(["Yu"]);
    for (const card of cards) for (const source of card.sources || []) if (source.agent) set.add(source.agent);
    return Array.from(set);
  }, [cards]);

  const tabByEntryId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of canonical) {
      const key = tabKeyForCategory(entry.category);
      if (key) map[entry.id] = key;
    }
    for (const entry of inbox) map[entry.id] = "inbox";
    return map;
  }, [canonical, inbox]);

  const decidedEntries = useMemo(
    () => decided.map((item) => entries.find((entry) => entry.id === item.id)).filter(Boolean) as MirrorEntry[],
    [decided, entries],
  );
  const inboxBand = useMemo(() => {
    // 已处理的卡留在原位置，显示结果，直到刷新。
    const ids = new Set(decidedEntries.map((entry) => entry.id));
    return entries.filter((entry) => isMirrorInbox(entry) || ids.has(entry.id));
  }, [entries, decidedEntries]);

  const notify = useCallback((text: string, undo?: () => void, duration = 6000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!sheet) return;
    document.body.style.overflow = "hidden";
    // 焦点不在弹层里时 Esc 也能关掉。
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [sheet]);

  const applyWrite = useCallback((result: WriteResult) => {
    setCards((prev) => {
      let next = prev.slice();
      const upsert = (card: Card) => {
        const index = next.findIndex((item) => item.id === card.id);
        if (index >= 0) next[index] = card;
        else next = [card, ...next];
      };
      upsert(result.card);
      if (result.old) upsert(result.old);
      return next;
    });
    if (result.revisions && result.revisions.length > 0) {
      setHistory((prev) => {
        const next = { ...prev };
        for (const revision of result.revisions as CardRevision[]) {
          const list = [...(next[revision.card_id] || [])];
          const index = list.findIndex((item) => item.version === revision.version);
          if (index >= 0) list[index] = revision;
          else list.push(revision);
          list.sort((a, b) => a.version - b.version);
          next[revision.card_id] = list;
        }
        return next;
      });
    }
  }, []);

  const send = useCallback(
    async (path: string, init: RequestInit): Promise<WriteResult> => {
      setPending(true);
      try {
        const result = await request(path, init);
        applyWrite(result);
        return result;
      } finally {
        setPending(false);
      }
    },
    [applyWrite],
  );

  const write = useCallback(
    (path: string, method: string, body: unknown) => send(path, { method, body: JSON.stringify(body) }),
    [send],
  );

  // 409 时带回最新卡片，再补拉历史，让历史条显示别处写的那一版。
  const reloadCard = useCallback(
    async (current: Card) => {
      try {
        const response = await fetch(cardPath(current.id), { credentials: "same-origin" });
        const data = (response.ok ? await response.json() : null) as { card?: Card; revisions?: CardRevision[] } | null;
        applyWrite({ card: data?.card || current, revisions: data?.revisions || [] });
      } catch {
        applyWrite({ card: current });
      }
    },
    [applyWrite],
  );

  const withUndo = useCallback(
    (undo: (result: WriteResult) => Promise<void>) =>
      async (result: WriteResult) => {
        try {
          await undo(result);
          notify("已撤销", undefined, 2000);
        } catch (error) {
          notify(`没撤销成功：${(error as Error).message}`, undefined, 4000);
        }
      },
    [notify],
  );

  const succeed = useCallback(
    (result: WriteResult, text: (result: WriteResult) => string, undo?: (result: WriteResult) => Promise<void>) => {
      // 撤销按钮不带参数调用，这里把本次写入的结果绑进去。
      notify(text(result), undo ? () => void withUndo(undo)(result) : undefined, undo ? 6000 : 4000);
    },
    [notify, withUndo],
  );

  const runSimple = useCallback(
    async (
      path: string,
      method: string,
      body: unknown,
      text: (result: WriteResult) => string,
      undo?: (result: WriteResult) => Promise<void>,
    ): Promise<WriteResult | null> => {
      try {
        const result = await write(path, method, body);
        succeed(result, text, undo);
        return result;
      } catch (error) {
        notify(`没保存成功：${(error as Error).message}`, undefined, 4000);
        return null;
      }
    },
    [write, succeed, notify],
  );

  // 手机上 tab 条横向滚动：当前 tab 要滚进可见区。
  useEffect(() => {
    if (view === "trash") return;
    const active = document.querySelector<HTMLElement>(".mirror-a-tabs .mirror-a-tab.is-active");
    const strip = active?.parentElement;
    if (!active || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const left = active.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + active.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 24), behavior: "smooth" });
    }
  }, [tab, view]);

  const selectTab = (key: string) => {
    setView("deck");
    setTab(key);
    if (typeof window !== "undefined") window.history.pushState(null, "", `?tab=${key}`);
  };

  const openTrash = () => {
    setPrevTab(tab);
    setView("trash");
    if (typeof window !== "undefined") window.history.pushState(null, "", "?view=trash");
  };

  const backFromTrash = () => {
    setView("deck");
    if (typeof window !== "undefined") window.history.pushState(null, "", `?tab=${prevTab}`);
  };

  const entryById = (id: string) => entries.find((entry) => entry.id === id) || null;
  const sheetEntry = sheet && "id" in sheet ? entryById(sheet.id) : null;

  const handleCreate = async (payload: Record<string, unknown>) => {
    try {
      const result = await send("/api/cards", { method: "POST", body: JSON.stringify(payload) });
      succeed(
        result,
        (r) => `已新增「${r.card.title}」`,
        async (r) => {
          await write(cardPath(r.card.id), "DELETE", { expectedVersion: r.card.version, reason: "撤销新增" });
        },
      );
      setSheet(null);
    } catch (error) {
      notify(`没保存成功：${(error as Error).message}`, undefined, 4000);
      throw error;
    }
  };

  const handleEditSave = async (entry: MirrorEntry, payload: Record<string, unknown>) => {
    try {
      const result = await send(cardPath(entry.id), { method: "PATCH", body: JSON.stringify(payload) });
      succeed(
        result,
        (r) => `已保存「${r.card.title}」为 v${r.card.version}`,
        async (r) => {
          const previous = (history[entry.id] || []).find((revision) => revision.version === payload.expectedVersion)?.snapshot;
          if (!previous) return;
          await write(cardPath(entry.id), "PATCH", {
            expectedVersion: r.card.version,
            title: previous.title,
            body: previous.body,
            scope: previous.scope,
            sources: previous.sources,
            options: previous.options,
            owner: previous.owner,
            status: previous.status,
          });
        },
      );
      setEditConflict(false);
      setSheet(null);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 409 && apiError.data?.current) {
        await reloadCard(apiError.data.current);
        setEditConflict(true);
      } else {
        notify(`没保存成功：${apiError.message}`, undefined, 4000);
      }
      throw error;
    }
  };

  const handleEditAndConfirm = async (entry: MirrorEntry, payload: Record<string, unknown>) => {
    try {
      const edited = await send(cardPath(entry.id), {
        method: "PATCH",
        body: JSON.stringify({ ...payload, status: "待确认" }),
      });
      const confirmed = await send(`${cardPath(entry.id)}/confirm`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: edited.card.version }),
      });
      succeed(
        confirmed,
        (r) => `已确认「${r.card.title}」，收进 ${categoryLabel(r.card.category)}`,
        async (r) => {
          await write(cardPath(r.card.id), "PATCH", { expectedVersion: r.card.version, status: "待确认" });
          setDecided((prev) => prev.filter((item) => item.id !== r.card.id));
        },
      );
      setDecided((prev) => [...prev.filter((item) => item.id !== entry.id), { id: entry.id, kind: "confirmed" }]);
      setEditConflict(false);
      setSheet(null);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 409 && apiError.data?.current) {
        await reloadCard(apiError.data.current);
        setEditConflict(true);
      } else {
        notify(`没保存成功：${apiError.message}`, undefined, 4000);
      }
      throw error;
    }
  };

  const handleSupersede = async (entry: MirrorEntry, payload: Record<string, unknown>) => {
    try {
      const result = await send(`${cardPath(entry.id)}/supersede`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: entry.version, ...payload }),
      });
      succeed(
        result,
        () => `已替换「${entry.title}」`,
        async (r) => {
          await write(cardPath(r.card.id), "DELETE", { expectedVersion: r.card.version, reason: "撤销替换" });
          if (r.old) await write(cardPath(r.old.id), "PATCH", { expectedVersion: r.old.version, status: "有效" });
        },
      );
      setSheet(null);
    } catch (error) {
      notify(`没保存成功：${(error as Error).message}`, undefined, 4000);
      throw error;
    }
  };

  const handleConfirm = async (entry: MirrorEntry) => {
    const result = await runSimple(
      `${cardPath(entry.id)}/confirm`,
      "POST",
      { expectedVersion: entry.version },
      (r) => `已确认「${r.card.title}」，收进 ${categoryLabel(r.card.category)}`,
      async (r) => {
        await write(cardPath(r.card.id), "PATCH", { expectedVersion: r.card.version, status: "待确认" });
        setDecided((prev) => prev.filter((item) => item.id !== r.card.id));
      },
    );
    if (result) setDecided((prev) => [...prev.filter((item) => item.id !== entry.id), { id: entry.id, kind: "confirmed" }]);
  };

  const handleReject = async (entry: MirrorEntry, reason: string) => {
    const result = await runSimple(
      `${cardPath(entry.id)}/reject`,
      "POST",
      { expectedVersion: entry.version, reason },
      (r) => `已不要「${r.card.title}」`,
      async (r) => {
        await write(cardPath(r.card.id), "PATCH", { expectedVersion: r.card.version, status: "待确认" });
        setDecided((prev) => prev.filter((item) => item.id !== r.card.id));
      },
    );
    if (result) {
      setDecided((prev) => [...prev.filter((item) => item.id !== entry.id), { id: entry.id, kind: "rejected" }]);
      setRejectId(null);
      setRejectReason("");
    }
  };

  const handleExpire = async (entry: MirrorEntry) => {
    return runSimple(
      `${cardPath(entry.id)}/expire`,
      "POST",
      { expectedVersion: entry.version, reason: "" },
      (r) => `已标记过期「${r.card.title}」`,
      async (r) => {
        await write(cardPath(r.card.id), "PATCH", { expectedVersion: r.card.version, status: "有效" });
      },
    );
  };

  const handleReactivate = async (entry: MirrorEntry) => {
    return runSimple(
      cardPath(entry.id),
      "PATCH",
      { expectedVersion: entry.version, status: "有效" },
      (r) => `已恢复「${r.card.title}」为有效`,
      async (r) => {
        await write(`${cardPath(r.card.id)}/expire`, "POST", { expectedVersion: r.card.version, reason: "" });
      },
    );
  };

  const handleDelete = async (entry: MirrorEntry, reason: string) => {
    const result = await runSimple(
      cardPath(entry.id),
      "DELETE",
      { expectedVersion: entry.version, reason },
      (r) => `已删除「${r.card.title}」`,
      async (r) => {
        await write(`${cardPath(r.card.id)}/restore`, "POST", { expectedVersion: r.card.version });
      },
    );
    if (result) setSheet(null);
  };

  const handleRestore = async (entry: MirrorEntry) => {
    return runSimple(
      `${cardPath(entry.id)}/restore`,
      "POST",
      { expectedVersion: entry.version },
      (r) => `已恢复「${r.card.title}」到 ${categoryLabel(r.card.category)}`,
      async (r) => {
        await write(cardPath(r.card.id), "DELETE", { expectedVersion: r.card.version, reason: "撤销恢复" });
      },
    );
  };

  const renderOverlay = (entry: MirrorEntry) => {
    const decision = decided.find((item) => item.id === entry.id);
    if (decision?.kind === "confirmed") {
      return (
        <div className="ce-card-done">
          <span className="ce-stamp">已收进 {categoryLabel(entry.category)}</span>
          <p>{entry.title}</p>
          <small>
            v{entry.version} · Yu 确认 · 刚刚
          </small>
        </div>
      );
    }
    if (decision?.kind === "rejected") {
      return (
        <div className="ce-card-done">
          <span className="ce-stamp mirror-a-stamp-quiet">不要了</span>
          <p>{entry.title}</p>
          <small>
            v{entry.version} · Yu 不要 · 刚刚
          </small>
        </div>
      );
    }
    if (rejectId === entry.id) {
      return (
        <div className="ce-card-done">
          <span className="ce-stamp mirror-a-stamp-quiet">不要了</span>
          <p>{entry.title}</p>
          <input
            className="ce-input is-focus"
            autoFocus
            placeholder="补一句原因，可不填"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
          />
          <span className="ce-decide">
            <small>补一句原因，可不填</small>
            <span className="mirror-a-done-actions">
              <button
                type="button"
                className="ce-link"
                onClick={() => {
                  setRejectId(null);
                  setRejectReason("");
                }}
              >
                撤销
              </button>
              <button type="button" className="ce-btn is-small is-solid" onClick={() => void handleReject(entry, rejectReason)}>
                好
              </button>
            </span>
          </span>
        </div>
      );
    }
    return null;
  };

  const renderActs = (entry: MirrorEntry) => {
    const superseded = entry.status === "已推翻";
    const expired = entry.status === "已过期";
    const wrap = (fn: () => void) => (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      fn();
    };
    return (
      <span className="ce-acts">
        {superseded ? null : (
          <button
            type="button"
            disabled={pending}
            onClick={wrap(() => {
              setEditConflict(false);
              setSheet({ kind: "edit", id: entry.id });
            })}
          >
            编辑
          </button>
        )}
        {superseded ? null : expired ? (
          <button type="button" disabled={pending} onClick={wrap(() => void handleReactivate(entry))}>
            恢复有效
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={wrap(() => void handleExpire(entry))}>
            标记过期
          </button>
        )}
        <button type="button" className="is-danger" disabled={pending} onClick={wrap(() => setSheet({ kind: "delete", id: entry.id }))}>
          删除
        </button>
      </span>
    );
  };

  const renderInboxFooter = (entry: MirrorEntry) => {
    const wrap = (fn: () => void) => (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      fn();
    };
    const pendingCard = entry.status !== "待确认";
    return (
      <>
        <span className="ce-decide">
          <button type="button" className="ce-btn is-solid is-small" disabled={pending || pendingCard} onClick={wrap(() => void handleConfirm(entry))}>
            确认
          </button>
          <button
            type="button"
            className="ce-btn is-quiet is-small"
            disabled={pending || pendingCard}
            onClick={wrap(() => {
              setRejectId(entry.id);
              setRejectReason("");
            })}
          >
            不要
          </button>
        </span>
        <button
          type="button"
          className="ce-link"
          onClick={wrap(() => {
            setEditConflict(false);
            setSheet({ kind: "edit", id: entry.id, confirm: true });
          })}
        >
          先改再确认
        </button>
      </>
    );
  };

  const deckHandlers = {
    busy: pending,
    renderActs,
    renderInboxFooter,
    onEdit: (entry: MirrorEntry) => {
      setEditConflict(false);
      setSheet({ kind: "edit", id: entry.id });
    },
    onExpire: (entry: MirrorEntry) => void handleExpire(entry),
    onReactivate: (entry: MirrorEntry) => void handleReactivate(entry),
    onDelete: (entry: MirrorEntry) => setSheet({ kind: "delete", id: entry.id }),
    onRestore: (entry: MirrorEntry) => void handleRestore(entry),
    onConfirm: (entry: MirrorEntry) => void handleConfirm(entry),
    onReject: (entry: MirrorEntry) => {
      setRejectId(entry.id);
      setRejectReason("");
    },
    onEditAndConfirm: (entry: MirrorEntry) => {
      setEditConflict(false);
      setSheet({ kind: "edit", id: entry.id, confirm: true });
    },
    onLongPress: (entry: MirrorEntry) => setSheet({ kind: "action", id: entry.id }),
    overlay: renderOverlay,
  };

  const variant: MirrorCardVariant = view === "trash" ? "trash" : (activeTab.key as MirrorCardVariant);

  return (
    <>
      <div className="mirror-a-masthead-wrap">
        <header className="mirror-a-masthead">
          <p className="page-kicker">成长 · 照照镜子</p>
          <h1 className="page-title">照照镜子</h1>
          <div className="mirror-a-masthead-row">
            <p className="page-sub">
              共 {stats.entryCount} 条
              {stats.latestDate ? ` · 最近更新 ${formatMirrorDate(stats.latestDate)}` : ""}
            </p>
            <button
              type="button"
              className={`ce-link mirror-a-trash${view === "trash" ? " is-on" : ""}`}
              onClick={() => (view === "trash" ? backFromTrash() : openTrash())}
            >
              最近删除
              <b>{trash.length}</b>
            </button>
          </div>
        </header>
        <div className="double-rule" />
      </div>

      <main className="mirror-a-main">
        <nav className="mirror-a-tabs" aria-label="按类型查看">
          {counts.map((item) => {
            const active = view !== "trash" && item.key === activeTab.key;
            return (
              <a
                key={item.key}
                className={`mirror-a-tab${active ? " is-active" : ""}${item.key === "inbox" ? " is-inbox" : ""}${
                  view === "trash" ? " is-dim" : ""
                }`}
                href={`/mirror?tab=${item.key}`}
                aria-current={active ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  selectTab(item.key);
                }}
              >
                <span className="mirror-a-tab-num">{item.count}</span>
                <span className="mirror-a-tab-label">{item.label}</span>
              </a>
            );
          })}
        </nav>

        {view === "trash" ? (
          <section className="mirror-a-deck-section">
            <div className="mirror-a-deck-head">
              <h2 className="mirror-a-heading">最近删除</h2>
              <div className="mirror-a-deck-tools">
                <button type="button" className="ce-link mirror-a-back" onClick={backFromTrash}>
                  返回{resolveMirrorTab(prevTab).label}
                </button>
                <span className="mirror-a-sep" />
                <p className="mirror-a-deck-hint">{trash.length} 条 · 恢复后回到原来的类型</p>
              </div>
            </div>
            {trash.length > 0 ? (
              <MirrorDeck entries={trash} variant="trash" tabByEntryId={tabByEntryId} {...deckHandlers} />
            ) : (
              <p className="mirror-a-empty-line">最近没有删除的卡</p>
            )}
          </section>
        ) : (
          <section className="mirror-a-deck-section">
            <div className="mirror-a-deck-head">
              <h2 className="mirror-a-heading">{activeTab.label}</h2>
              <div className="mirror-a-deck-tools">
                {activeTab.inbox ? (
                  <p className="mirror-a-deck-hint">助手提的，确认后才进正本 · 还剩 {inbox.length} 条</p>
                ) : (
                  <p className="mirror-a-deck-hint">{tabEntries.length} 条 · 左右滑动或点箭头</p>
                )}
                {activeTab.inbox ? null : (
                  <>
                    <p className="mirror-a-deck-hint mirror-a-hint-m">长按卡片编辑</p>
                    <span className="mirror-a-sep" />
                    <button type="button" className="ce-btn is-small" onClick={() => setSheet({ kind: "create", category: activeTab.category })}>
                      {activeTab.key === "adjustment" ? "新增一条" : `新增${activeTab.label}`}
                    </button>
                  </>
                )}
              </div>
            </div>
            {tabEntries.length > 0 || (activeTab.inbox && inboxBand.length > 0) ? (
              <MirrorDeck
                entries={activeTab.inbox ? inboxBand : tabEntries}
                variant={variant}
                tabByEntryId={tabByEntryId}
                {...deckHandlers}
              />
            ) : (
              <p className="mirror-a-empty-line">
                {activeTab.inbox ? "没有等确认的卡。" : "这个类型还没有记录。"}
              </p>
            )}
          </section>
        )}
      </main>

      {toast ? (
        <div className="ce-toast" role="status">
          {toast.text}
          {toast.undo ? (
            <button type="button" onClick={() => toast.undo?.()}>
              撤销
            </button>
          ) : null}
        </div>
      ) : null}

      {sheet?.kind === "create" ? (
        <CreateSheet
          initialCategory={sheet.category}
          agents={agents}
          pending={pending}
          onClose={() => setSheet(null)}
          onSubmit={handleCreate}
        />
      ) : null}

      {sheet?.kind === "edit" && sheetEntry ? (
        <EditSheet
          key={`${sheetEntry.id}-${sheetEntry.version}`}
          entry={sheetEntry}
          agents={agents}
          confirm={Boolean(sheet.confirm)}
          conflict={editConflict}
          pending={pending}
          onClose={() => {
            setEditConflict(false);
            setSheet(null);
          }}
          onSave={(payload) =>
            sheet.confirm ? handleEditAndConfirm(sheetEntry, payload) : handleEditSave(sheetEntry, payload)
          }
          onSupersede={(payload) => handleSupersede(sheetEntry, payload)}
        />
      ) : null}

      {sheet?.kind === "delete" && sheetEntry ? (
        <DeleteDialog
          entry={sheetEntry}
          pending={pending}
          onClose={() => setSheet(null)}
          onDelete={(reason) => void handleDelete(sheetEntry, reason)}
          onExpire={() =>
            void handleExpire(sheetEntry).then((result) => {
              if (result) setSheet(null);
            })
          }
        />
      ) : null}

      {sheet?.kind === "action" && sheetEntry ? (
        <ActionSheet
          entry={sheetEntry}
          onClose={() => setSheet(null)}
          onEdit={() => {
            setEditConflict(false);
            setSheet({ kind: "edit", id: sheetEntry.id });
          }}
          onExpire={() => {
            setSheet(null);
            void handleExpire(sheetEntry);
          }}
          onReactivate={() => {
            setSheet(null);
            void handleReactivate(sheetEntry);
          }}
          onDelete={() => setSheet({ kind: "delete", id: sheetEntry.id })}
        />
      ) : null}
    </>
  );
}

/* ── 稿纸通用控件 ─────────────────────────────── */

function Seg({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="ce-seg is-full">
      {options.map((option) => (
        <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  );
}

function ScopeChips({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const toggle = (scope: string) =>
    onChange(value.includes(scope) ? value.filter((item) => item !== scope) : [...value, scope]);
  return (
    <div className="ce-chips">
      {SCOPE_OPTIONS.map((scope) => (
        <button key={scope} type="button" className="ce-chip" aria-pressed={value.includes(scope)} onClick={() => toggle(scope)}>
          {scope}
        </button>
      ))}
    </div>
  );
}

function SourceFields({
  who,
  date,
  refValue,
  agents,
  changed,
  onChange,
}: {
  who: string;
  date: string;
  refValue: string;
  agents: string[];
  changed?: boolean;
  onChange: (patch: { who?: string; date?: string; ref?: string }) => void;
}) {
  return (
    <div className="ce-field">
      <p className="ce-label">
        依据或来源
        {changed ? <span className="ce-changed">已改</span> : null}
      </p>
      <div className="ce-source">
        <div className="ce-select">
          <select className="ce-input" aria-label="谁提的" value={who} onChange={(event) => onChange({ who: event.target.value })}>
            {agents.map((agent) => (
              <option key={agent} value={agent}>
                {agent}
              </option>
            ))}
          </select>
        </div>
        <input
          className="ce-input"
          aria-label="日期"
          style={{ fontFamily: "var(--font-latin)" }}
          value={date}
          onChange={(event) => onChange({ date: event.target.value })}
        />
        <input
          className="ce-input"
          aria-label="出处"
          placeholder="出处，例如 群聊 10-01"
          value={refValue}
          onChange={(event) => onChange({ ref: event.target.value })}
        />
      </div>
    </div>
  );
}

function fieldErrors(errors: Record<string, string>, key: string) {
  return errors[key] ? <p className="ce-error">{errors[key]}</p> : null;
}

/* ── 新增稿纸 ─────────────────────────────────── */

function CreateSheet({
  initialCategory,
  agents,
  pending,
  onClose,
  onSubmit,
}: {
  initialCategory: string;
  agents: string[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [category, setCategory] = useState(SHEET_CATEGORIES.includes(initialCategory) ? initialCategory : "偏好");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [who, setWho] = useState("Yu");
  const [date, setDate] = useState(todayIso());
  const [refValue, setRefValue] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [status, setStatus] = useState("有效");
  const [options, setOptions] = useState("");
  const [owner, setOwner] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const submit = async () => {
    setErrors({});
    try {
      await onSubmit({
        category,
        title,
        body,
        sources: [{ agent: who, date, ref: refValue }],
        scope,
        status,
        options: splitList(options),
        owner,
      });
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 400 && Array.isArray(apiError.data?.errors)) {
        const map: Record<string, string> = {};
        for (const item of apiError.data.errors) if (!map[item.field]) map[item.field] = item.message;
        setErrors(map);
      } else {
        setErrors({ _: `没保存成功：${apiError.message}` });
      }
    }
  };

  return (
    <div
      className="ce-scrim"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <div className="ce-sheet" role="dialog" aria-label="新增一条">
        <header className="ce-sheet-head">
          <div>
            <p className="ce-kicker">照照镜子 · 新增</p>
            <h2 className="ce-title">新增一条</h2>
          </div>
          <button type="button" className="ce-link" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="ce-sheet-body">
          <div className="ce-field">
            <p className="ce-label">类型</p>
            <Seg
              options={SHEET_CATEGORIES}
              value={category}
              onChange={(value) => setCategory(value)}
            />
            <p className="ce-help">选「决策」会多出 备选 和 负责人 两栏</p>
          </div>
          <div className="ce-field">
            <p className="ce-label">
              标题<span className="ce-req">必填</span>
            </p>
            <input
              ref={titleRef}
              className="ce-input is-title is-focus"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            {fieldErrors(errors, "title")}
          </div>
          <div className="ce-field">
            <p className="ce-label">
              内容<span className="ce-req">必填</span>
            </p>
            <textarea className="ce-textarea" rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
            {fieldErrors(errors, "body")}
          </div>
          <SourceFields
            who={who}
            date={date}
            refValue={refValue}
            agents={agents}
            onChange={(patch) => {
              if (patch.who !== undefined) setWho(patch.who);
              if (patch.date !== undefined) setDate(patch.date);
              if (patch.ref !== undefined) setRefValue(patch.ref);
            }}
          />
          {fieldErrors(errors, "sources")}
          <div className="ce-row">
            <div className="ce-field">
              <p className="ce-label">适用范围</p>
              <ScopeChips value={scope} onChange={setScope} />
            </div>
            <div className="ce-field">
              <p className="ce-label">状态</p>
              <Seg options={["有效", "待确认"]} value={status} onChange={setStatus} />
            </div>
          </div>
          {category === "决策" ? (
            <div className="ce-row">
              <div className="ce-field">
                <p className="ce-label">备选</p>
                <input
                  className="ce-input"
                  placeholder="逗号或换行分隔"
                  value={options}
                  onChange={(event) => setOptions(event.target.value)}
                />
              </div>
              <div className="ce-field">
                <p className="ce-label">负责人</p>
                <input className="ce-input" value={owner} onChange={(event) => setOwner(event.target.value)} />
              </div>
            </div>
          ) : null}
          {errors._ ? <p className="ce-error">{errors._}</p> : null}
        </div>
        <footer className="ce-sheet-foot">
          <p className="ce-foot-note">
            {status === "待确认" ? "保存后进 等你确认" : "保存即进正本，记为 v1 · Ctrl Enter 保存"}
          </p>
          <div className="ce-foot-btns">
            <button type="button" className="ce-btn is-quiet" onClick={onClose}>
              取消
            </button>
            <button type="button" className="ce-btn is-solid" disabled={pending} onClick={() => void submit()}>
              保存
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ── 编辑稿纸 ─────────────────────────────────── */

function EditSheet({
  entry,
  agents,
  confirm,
  conflict,
  pending,
  onClose,
  onSave,
  onSupersede,
}: {
  entry: MirrorEntry;
  agents: string[];
  confirm: boolean;
  conflict: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onSupersede: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [mode, setMode] = useState<"plain" | "supersede">("plain");
  const source = entry.sources[0];
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [who, setWho] = useState(source?.agent || "Yu");
  const [date, setDate] = useState(source?.date || todayIso());
  const [refValue, setRefValue] = useState(source?.ref || "");
  const [scope, setScope] = useState<string[]>(entry.scope);
  const [status, setStatus] = useState(entry.status === "已过期" ? "已过期" : "有效");
  const [options, setOptions] = useState(entry.options.join("\n"));
  const [owner, setOwner] = useState(entry.owner);
  const [supTitle, setSupTitle] = useState(entry.title);
  const [supBody, setSupBody] = useState(entry.body);
  const [reason, setReason] = useState("");
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 父组件用 key={`${id}-${version}`} 重挂本组件，冲突刷新时字段随最新版重置。
  const changed = {
    title: title.trim() !== entry.title,
    body: body.trim() !== entry.body,
    source: who !== (source?.agent || "Yu") || date !== (source?.date || todayIso()) || refValue !== (source?.ref || ""),
    scope: JSON.stringify(scope) !== JSON.stringify(entry.scope),
    status: status !== (entry.status === "已过期" ? "已过期" : "有效"),
    options: options.trim() !== entry.options.join("\n"),
    owner: owner.trim() !== entry.owner,
  };
  const dirty = Object.values(changed).some(Boolean);

  const submitPlain = async () => {
    setErrors({});
    try {
      await onSave({
        expectedVersion: entry.version,
        title,
        body,
        sources: [{ agent: who, date, ref: refValue }],
        scope,
        options: splitList(options),
        owner,
        ...(confirm ? {} : { status }),
      });
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 400 && Array.isArray(apiError.data?.errors)) {
        const map: Record<string, string> = {};
        for (const item of apiError.data.errors) if (!map[item.field]) map[item.field] = item.message;
        setErrors(map);
      } else if (apiError.status !== 409) {
        setErrors({ _: `没保存成功：${apiError.message}` });
      }
    }
  };

  const submitSupersede = async () => {
    setErrors({});
    try {
      await onSupersede({ reason, title: supTitle, body: supBody });
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 400 && Array.isArray(apiError.data?.errors)) {
        const map: Record<string, string> = {};
        for (const item of apiError.data.errors) if (!map[item.field]) map[item.field] = item.message;
        setErrors(map);
      }
    }
  };

  const orderedHistory = entry.history.slice().sort((a, b) => a.version - b.version);
  const shownHistory = orderedHistory.length > 5 ? orderedHistory.slice(orderedHistory.length - 5) : orderedHistory;
  const selectedRevision = viewVersion ? orderedHistory.find((item) => item.version === viewVersion) : null;
  const notEmpty =
    mode === "supersede" ? supTitle.trim() !== "" && supBody.trim() !== "" && reason.trim() !== "" : confirm || dirty;

  return (
    <div
      className="ce-scrim"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && notEmpty) {
          event.preventDefault();
          void (mode === "supersede" ? submitSupersede() : submitPlain());
        }
      }}
    >
      <div className="ce-sheet" role="dialog">
        <header className="ce-sheet-head">
          <div>
            <p className="ce-kicker">
              {categoryLabel(entry.category)} · <b>{entry.id}</b> · v{entry.version}
            </p>
            <h2 className="ce-title">编辑这张卡</h2>
          </div>
          <button type="button" className="ce-link" onClick={onClose}>
            关闭
          </button>
        </header>
        <div className="ce-sheet-body">
          {conflict ? (
            <p className="ce-conflict">这张卡刚被改过（现在是 v{entry.version}），已载入最新内容，请再确认一次</p>
          ) : null}
          <div className="ce-modes">
            <button className="ce-mode" type="button" aria-pressed={mode === "plain"} onClick={() => setMode("plain")}>
              <strong>直接改</strong>
              <span>同一张卡，版本 +1。改错字、补说明用这个。</span>
            </button>
            <button className="ce-mode" type="button" aria-pressed={mode === "supersede"} onClick={() => setMode("supersede")}>
              <strong>替换为新版本</strong>
              <span>想法变了。旧卡标记已推翻，指向新卡。</span>
            </button>
          </div>

          {mode === "supersede" ? (
            <>
              <div className="ce-supersede">
                <div className="ce-mini is-old">
                  <div className="ce-mini-meta">
                    <span>{entry.id}</span>
                    <span>v{entry.version}</span>
                  </div>
                  <p className="ce-mini-title">{entry.title}</p>
                  <p className="ce-mini-state">保存后：已推翻，指向新卡</p>
                </div>
                <div className="ce-arrow">
                  <span>取代</span>
                </div>
                <div className="ce-mini is-new">
                  <div className="ce-mini-meta">
                    <span>新编号</span>
                    <span>v1</span>
                  </div>
                  <p className="ce-mini-title">{supTitle || "新标题"}</p>
                  <p className="ce-mini-state">保存后：有效</p>
                </div>
              </div>
              <div className="ce-field">
                <p className="ce-label">
                  新标题<span className="ce-req">必填</span>
                </p>
                <input className="ce-input is-title" value={supTitle} onChange={(event) => setSupTitle(event.target.value)} />
                {fieldErrors(errors, "title")}
              </div>
              <div className="ce-field">
                <p className="ce-label">
                  新内容<span className="ce-req">必填</span>
                </p>
                <textarea className="ce-textarea" rows={2} value={supBody} onChange={(event) => setSupBody(event.target.value)} />
                {fieldErrors(errors, "body")}
              </div>
              <div className="ce-field">
                <p className="ce-label">
                  为什么替换<span className="ce-req">必填</span>
                </p>
                <input className="ce-input is-focus" value={reason} onChange={(event) => setReason(event.target.value)} />
                {fieldErrors(errors, "reason")}
              </div>
            </>
          ) : (
            <>
              <div className="ce-field">
                <div className="ce-history-head">
                  <p className="ce-label">历史</p>
                  <p className="ce-help">点一个版本看当时的内容</p>
                </div>
                <ol className="ce-history">
                  {orderedHistory.length > 5 ? (
                    <li className="mirror-a-history-more">
                      <span className="ce-history-what">…</span>
                    </li>
                  ) : null}
                  {shownHistory.map((item) => (
                    <li key={item.version} className={item.version === entry.version ? "is-current" : ""}>
                      <button
                        type="button"
                        className="ce-history-btn"
                        onClick={() => setViewVersion(viewVersion === item.version ? null : item.version)}
                      >
                        <span className="ce-history-v">
                          <b>v{item.version}</b>
                          <time>{formatShortDate(item.recordedAt)}</time>
                        </span>
                        <span className="ce-history-what">{item.summary}</span>
                      </button>
                    </li>
                  ))}
                  <li className="is-draft">
                    <span className="ce-history-v">
                      <b>v{entry.version + 1}</b>
                      <time>现在</time>
                    </span>
                    <span className="ce-history-what">保存后生成</span>
                  </li>
                </ol>
                {selectedRevision ? (
                  <div className="ce-history-view">
                    <p className="ce-history-view-label">v{selectedRevision.version} 当时的内容</p>
                    <p className="ce-history-view-title">{selectedRevision.title}</p>
                    <p className="ce-history-view-body">{selectedRevision.body}</p>
                  </div>
                ) : null}
              </div>
              <div className="ce-field">
                <p className="ce-label">
                  标题
                  {changed.title ? <span className="ce-changed">已改</span> : null}
                </p>
                <input className="ce-input is-title" value={title} onChange={(event) => setTitle(event.target.value)} />
                {fieldErrors(errors, "title")}
              </div>
              <div className="ce-field">
                <p className="ce-label">
                  内容
                  {changed.body ? <span className="ce-changed">已改</span> : null}
                </p>
                <textarea className="ce-textarea" rows={2} value={body} onChange={(event) => setBody(event.target.value)} />
                {fieldErrors(errors, "body")}
              </div>
              <div className="ce-row">
                <SourceFields
                  who={who}
                  date={date}
                  refValue={refValue}
                  agents={agents}
                  changed={changed.source}
                  onChange={(patch) => {
                    if (patch.who !== undefined) setWho(patch.who);
                    if (patch.date !== undefined) setDate(patch.date);
                    if (patch.ref !== undefined) setRefValue(patch.ref);
                  }}
                />
                {confirm ? null : (
                  <div className="ce-field">
                    <p className="ce-label">
                      状态
                      {changed.status ? <span className="ce-changed">已改</span> : null}
                    </p>
                    <Seg options={["有效", "已过期"]} value={status} onChange={setStatus} />
                  </div>
                )}
              </div>
              <div className="ce-field">
                <p className="ce-label">
                  适用范围
                  {changed.scope ? <span className="ce-changed">已改</span> : null}
                </p>
                <ScopeChips value={scope} onChange={setScope} />
              </div>
              {entry.category === "决策" ? (
                <div className="ce-row">
                  <div className="ce-field">
                    <p className="ce-label">
                      备选
                      {changed.options ? <span className="ce-changed">已改</span> : null}
                    </p>
                    <input
                      className="ce-input"
                      placeholder="逗号或换行分隔"
                      value={options}
                      onChange={(event) => setOptions(event.target.value)}
                    />
                  </div>
                  <div className="ce-field">
                    <p className="ce-label">
                      负责人
                      {changed.owner ? <span className="ce-changed">已改</span> : null}
                    </p>
                    <input className="ce-input" value={owner} onChange={(event) => setOwner(event.target.value)} />
                  </div>
                </div>
              ) : null}
              {fieldErrors(errors, "sources")}
            </>
          )}
          {errors._ ? <p className="ce-error">{errors._}</p> : null}
        </div>
        <footer className="ce-sheet-foot">
          {mode === "supersede" ? (
            <>
              <p className="ce-foot-note">
                保存后新卡出现在「{categoryLabel(entry.category)}」第一张，旧卡留在历史里
              </p>
              <div className="ce-foot-btns">
                <button type="button" className="ce-btn is-quiet" onClick={onClose}>
                  取消
                </button>
                <button type="button" className="ce-btn is-solid" disabled={pending || !notEmpty} onClick={() => void submitSupersede()}>
                  替换
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="ce-foot-note">
                保存为 v{entry.version + 1}，v{entry.version} 可随时查看
              </p>
              <div className="ce-foot-btns">
                <button type="button" className="ce-btn is-quiet" onClick={onClose}>
                  取消
                </button>
                <button type="button" className="ce-btn is-solid" disabled={pending || !notEmpty} onClick={() => void submitPlain()}>
                  {confirm ? "保存并确认" : "保存"}
                </button>
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

/* ── 删除确认 ─────────────────────────────────── */

function DeleteDialog({
  entry,
  pending,
  onClose,
  onDelete,
  onExpire,
}: {
  entry: MirrorEntry;
  pending: boolean;
  onClose: () => void;
  onDelete: (reason: string) => void;
  onExpire: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="ce-scrim" onKeyDown={(event) => event.key === "Escape" && onClose()}>
      <div className="ce-sheet is-narrow" role="alertdialog">
        <header className="ce-sheet-head">
          <div>
            <p className="ce-kicker">
              {categoryLabel(entry.category)} · <b>{entry.id}</b>
            </p>
            <h2 className="ce-title">删掉「{entry.title}」？</h2>
          </div>
        </header>
        <div className="ce-sheet-body">
          <p className="ce-confirm-text">卡片会从页面移走，放进「最近删除」，随时能恢复。历史一条不丢。</p>
          <div className="ce-field">
            <p className="ce-label">原因</p>
            <input
              className="ce-input"
              placeholder="可不填，例如：已经改掉了"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <p className="ce-confirm-tip">
            只是不再适用？
            <button type="button" onClick={onExpire}>
              标记过期
            </button>{" "}
            更合适，卡片还留在页面上，灰着显示。
          </p>
        </div>
        <footer className="ce-sheet-foot">
          <span />
          <div className="ce-foot-btns">
            <button type="button" className="ce-btn is-quiet" onClick={onClose}>
              取消
            </button>
            <button type="button" className="ce-btn is-danger" disabled={pending} onClick={() => onDelete(reason)}>
              删除
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ── 手机长按动作单 ───────────────────────────── */

function ActionSheet({
  entry,
  onClose,
  onEdit,
  onExpire,
  onReactivate,
  onDelete,
}: {
  entry: MirrorEntry;
  onClose: () => void;
  onEdit: () => void;
  onExpire: () => void;
  onReactivate: () => void;
  onDelete: () => void;
}) {
  const superseded = entry.status === "已推翻";
  return (
    <div className="ce-action-sheet" onClick={onClose}>
      <div className="ce-action-panel" onClick={(event) => event.stopPropagation()}>
        <p>
          <b>{entry.title}</b> · {categoryLabel(entry.category)} · v{entry.version}
        </p>
        {superseded ? null : (
          <button type="button" onClick={onEdit}>
            编辑<small>改这条或替换为新版本</small>
          </button>
        )}
        {superseded ? null : entry.status === "已过期" ? (
          <button type="button" onClick={onReactivate}>
            恢复有效<small>回到按类型浏览的页面</small>
          </button>
        ) : (
          <button type="button" onClick={onExpire}>
            标记过期<small>留在页面上，灰着显示</small>
          </button>
        )}
        <button type="button" className="is-danger" onClick={onDelete}>
          删除<small>可在最近删除里恢复</small>
        </button>
        <button type="button" className="is-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}
