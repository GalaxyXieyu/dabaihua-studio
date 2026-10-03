"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  entryOwnDate,
  formatMirrorDate,
  formatShortDate,
  sourceAgent,
  sourceLine,
  type MirrorEntry,
} from "../../../lib/mirror";
import { MiniMarkdown } from "../../content/_brief/mini-markdown";

/** 卡片带的类型，决定卡片外观 class `is-<variant>`；trash 是最近删除。 */
export type MirrorCardVariant = "profile" | "preference" | "method" | "decision" | "adjustment" | "inbox" | "trash";

function categoryLabel(category: string): string {
  return category === "待调整" ? "正在调整" : category;
}

/** 删除时间：今天显示「今天 HH:MM」，其它显示 MM-DD。 */
export function formatDeletedAt(value: string, now: Date = new Date()): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const iso = shifted.toISOString();
  const day = iso.slice(0, 10);
  const today = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (day === today) return `今天 ${iso.slice(11, 13)}:${iso.slice(14, 16)}`;
  return `${day.slice(5, 7)}-${day.slice(8, 10)}`;
}

function ScopeTags({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) return null;
  return (
    <span className="mirror-a-scope-tags">
      {scopes.map((scope) => (
        <span key={scope} className="mirror-a-scope-tag">
          {scope}
        </span>
      ))}
    </span>
  );
}

/** 一张卡片正文；不同类型用不同排版，都不撑破卡片。 */
function CardContent({ entry, variant, index }: { entry: MirrorEntry; variant: MirrorCardVariant; index: number }) {
  if (variant === "profile") {
    return (
      <>
        <span className="mirror-a-card-index" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>
        <p className="mirror-a-card-quote">{entry.title}</p>
        {entry.body ? <p className="mirror-a-card-explain">{entry.body}</p> : null}
      </>
    );
  }

  if (variant === "preference") {
    return (
      <>
        <ScopeTags scopes={entry.scope} />
        <p className="mirror-a-card-title">{entry.title}</p>
        {entry.body ? <p className="mirror-a-card-text">{entry.body}</p> : null}
      </>
    );
  }

  if (variant === "method") {
    return (
      <>
        <p className="mirror-a-card-aphorism">{entry.title}</p>
        {entry.body ? <p className="mirror-a-card-text">{entry.body}</p> : null}
        {entry.scope.length > 0 ? (
          <p className="mirror-a-card-scene">
            <span className="mirror-a-card-scene-label">适用场景</span>
            <ScopeTags scopes={entry.scope} />
          </p>
        ) : null}
      </>
    );
  }

  if (variant === "decision") {
    return (
      <>
        <p className="mirror-a-card-date">{formatShortDate(entryOwnDate(entry))}</p>
        <p className="mirror-a-card-title">{entry.title}</p>
        {entry.body ? <p className="mirror-a-card-text">{entry.body}</p> : null}
        {entry.options.length > 0 ? <p className="mirror-a-card-line">备选：{entry.options.join("；")}</p> : null}
        {entry.owner ? <p className="mirror-a-card-line">负责人：{entry.owner}</p> : null}
      </>
    );
  }

  if (variant === "adjustment") {
    return (
      <>
        <span className="mirror-a-progress" aria-hidden="true">
          <i />
        </span>
        <span className="mirror-a-tag is-outline">调整中</span>
        <p className="mirror-a-card-title">{entry.title}</p>
        {entry.body ? <p className="mirror-a-card-text">{entry.body}</p> : null}
      </>
    );
  }

  return (
    <>
      <span className="mirror-a-tag is-accent">待确认</span>
      <p className="mirror-a-card-title">{entry.title}</p>
      {entry.body ? <p className="mirror-a-card-text">{entry.body}</p> : null}
      {entry.options.length > 0 ? <p className="mirror-a-card-line">备选：{entry.options.join("；")}</p> : null}
    </>
  );
}

export type MirrorDeckHandlers = {
  busy?: boolean;
  renderActs?: (entry: MirrorEntry) => ReactNode;
  renderInboxFooter?: (entry: MirrorEntry) => ReactNode;
  onEdit?: (entry: MirrorEntry) => void;
  onExpire?: (entry: MirrorEntry) => void;
  onReactivate?: (entry: MirrorEntry) => void;
  onDelete?: (entry: MirrorEntry) => void;
  onRestore?: (entry: MirrorEntry) => void;
  onConfirm?: (entry: MirrorEntry) => void;
  onReject?: (entry: MirrorEntry) => void;
  onEditAndConfirm?: (entry: MirrorEntry) => void;
  onLongPress?: (entry: MirrorEntry) => void;
  overlay?: (entry: MirrorEntry) => ReactNode;
};

function MirrorCard({
  entry,
  index,
  variant,
  tabByEntryId,
  onOpen,
  onJump,
  ...handlers
}: {
  entry: MirrorEntry;
  index: number;
  variant: MirrorCardVariant;
  tabByEntryId: Record<string, string>;
  onOpen: (id: string) => void;
  onJump: (id: string) => void;
} & MirrorDeckHandlers) {
  const [pressed, setPressed] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  // 长按弹出动作单后，手指抬起触发的那次 click 不再打开详情。
  const suppressClick = useRef(false);

  const clearPress = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
    setPressed(false);
  }, []);

  // 手机长按：按住 500ms 且移动 < 8px 才弹出动作单。
  const beginPress = useCallback(
    (event: ReactPointerEvent) => {
      if (variant === "trash" || !handlers.onLongPress) return;
      // 只认触摸/触控笔；桌面鼠标按住不弹动作单（桌面用悬停操作条）。
      if (event.pointerType === "mouse") return;
      pressOrigin.current = { x: event.clientX, y: event.clientY };
      pressTimer.current = setTimeout(() => {
        suppressClick.current = true;
        setPressed(true);
        handlers.onLongPress?.(entry);
      }, 500);
    },
    [entry, handlers, variant],
  );

  const movePress = useCallback((event: ReactPointerEvent) => {
    const origin = pressOrigin.current;
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) {
      if (pressTimer.current) {
        clearTimeout(pressTimer.current);
        pressTimer.current = null;
      }
    }
  }, []);

  useEffect(() => clearPress, [clearPress]);

  const stop = (action?: (entry: MirrorEntry) => void) => (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    action?.(entry);
  };

  if (variant === "trash") {
    return (
      <article id={`card-${entry.id}`} className="mirror-a-card ce-deleted">
        <div className="mirror-a-card-body">
          <span className="ce-type">
            <span className="ce-type-tag">{categoryLabel(entry.category)}</span>
          </span>
          <p className="mirror-a-card-title">{entry.title}</p>
          {entry.body ? <p className="mirror-a-card-text">{entry.body}</p> : null}
        </div>
        <footer className="mirror-a-card-foot">
          <span className="ce-foot-left">
            {entry.deletedBy} 删除 · {formatDeletedAt(entry.deletedAt)}
          </span>
          <button type="button" className="ce-btn is-small" disabled={handlers.busy} onClick={stop(handlers.onRestore)}>
            恢复
          </button>
        </footer>
      </article>
    );
  }

  if (variant === "inbox") {
    return (
      <article id={`card-${entry.id}`} className="mirror-a-card is-inbox">
        <div className="mirror-a-card-body">
          <span className="ce-type">
            <span className="mirror-a-tag is-accent">待确认</span>
            <span className="ce-type-tag">进 {categoryLabel(entry.category)}</span>
            <span className="ce-by">
              {sourceAgent(entry)} 提 · {formatShortDate(entryOwnDate(entry))}
            </span>
          </span>
          <p className="mirror-a-card-title">{entry.title}</p>
          {entry.body ? <p className="mirror-a-card-text">{entry.body}</p> : null}
          {entry.options.length > 0 ? <p className="mirror-a-card-line">备选：{entry.options.join("；")}</p> : null}
        </div>
        <footer className="mirror-a-card-foot">
          {handlers.renderInboxFooter ? (
            handlers.renderInboxFooter(entry)
          ) : (
            <>
              <span className="ce-decide">
                <button
                  type="button"
                  className="ce-btn is-solid is-small"
                  disabled={handlers.busy || entry.status !== "待确认"}
                  onClick={stop(handlers.onConfirm)}
                >
                  确认
                </button>
                <button
                  type="button"
                  className="ce-btn is-quiet is-small"
                  disabled={handlers.busy || entry.status !== "待确认"}
                  onClick={stop(handlers.onReject)}
                >
                  不要
                </button>
              </span>
              <button type="button" className="ce-link" onClick={stop(handlers.onEditAndConfirm)}>
                先改再确认
              </button>
            </>
          )}
        </footer>
        {handlers.overlay ? handlers.overlay(entry) : null}
      </article>
    );
  }

  const superseded = entry.status === "已推翻";
  const expired = entry.status === "已过期";
  const target = entry.supersededBy;
  const targetTab = target ? tabByEntryId[target] || variant : variant;
  const href = target ? `/mirror?tab=${targetTab}#card-${target}` : "";

  return (
    <article
      id={`card-${entry.id}`}
      className={`mirror-a-card is-${variant} ce-has-acts${expired ? " is-expired" : ""}${
        superseded ? " is-superseded" : ""
      }${pressed ? " is-pressed" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`查看「${entry.title}」的正文和历史`}
      onPointerDown={beginPress}
      onPointerMove={movePress}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerLeave={clearPress}
      onTouchEnd={(event) => {
        // 长按已弹出动作单：吞掉抬手后的合成 click，免得落到遮罩上把动作单关掉。
        if (suppressClick.current) {
          event.preventDefault();
          suppressClick.current = false;
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        if ((event.target as HTMLElement).closest("a,button")) return;
        onOpen(entry.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(entry.id);
        }
      }}
    >
      <div className="mirror-a-card-body">
        <CardContent entry={entry} variant={variant} index={index} />
      </div>
      <footer className="mirror-a-card-foot">
        {superseded && target ? (
          <a
            className="mirror-a-card-superseded"
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onJump(target);
            }}
          >
            已被 {target} 取代
          </a>
        ) : (
          <span className="mirror-a-card-source">{sourceLine(entry)}</span>
        )}
        {handlers.renderActs ? (
          handlers.renderActs(entry)
        ) : (
          <span className="ce-acts">
            {[
              superseded ? null : (
                <button key="edit" type="button" disabled={handlers.busy} onClick={stop(handlers.onEdit)}>
                  编辑
                </button>
              ),
              superseded ? null : expired ? (
                <button key="reactivate" type="button" disabled={handlers.busy} onClick={stop(handlers.onReactivate)}>
                  恢复有效
                </button>
              ) : (
                <button key="expire" type="button" disabled={handlers.busy} onClick={stop(handlers.onExpire)}>
                  标记过期
                </button>
              ),
              <button key="delete" type="button" className="is-danger" disabled={handlers.busy} onClick={stop(handlers.onDelete)}>
                删除
              </button>,
            ]}
          </span>
        )}
        <span className="mirror-a-card-version">v{entry.version}</span>
      </footer>
    </article>
  );
}

/** 卡片下方详情区：完整正文 + 备选 + 来源 + 历史，不重复卡片标题。 */
function CardDetail({ entry, onClose }: { entry: MirrorEntry; onClose: () => void }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <section ref={ref} className="mirror-a-detail-panel" aria-label={`${entry.title} 详情`}>
      <header className="mirror-a-detail-head">
        <p className="mirror-a-detail-kicker">完整正文</p>
        <button type="button" className="mirror-a-detail-close" onClick={onClose}>
          收起
        </button>
      </header>
      <div className="mirror-a-detail-body">
        <div className="mirror-a-detail-text">
          <MiniMarkdown text={entry.body} />
          {entry.options.length > 0 ? <p className="mirror-a-detail-line">备选：{entry.options.join("；")}</p> : null}
          {entry.reason ? <p className="mirror-a-detail-line">说明：{entry.reason}</p> : null}
          {entry.confirmedBy ? (
            <p className="mirror-a-detail-line">
              由 {entry.confirmedBy} 确认{entry.confirmedAt ? ` · ${formatMirrorDate(entry.confirmedAt)}` : ""}
            </p>
          ) : null}
          <p className="mirror-a-detail-source">来源：{sourceLine(entry)}</p>
        </div>
        <div className="mirror-a-history">
          <p className="mirror-a-history-title">历史</p>
          <ol className="mirror-a-history-list">
            {entry.history.map((item) => (
              <li key={`v${item.version}`}>
                <span className="mirror-a-history-version">v{item.version}</span>
                <span className="mirror-a-history-status">{item.status}</span>
                {item.recordedAt ? (
                  <span className="mirror-a-history-date">{formatShortDate(item.recordedAt)}</span>
                ) : null}
                <span className="mirror-a-history-reason">{item.summary}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/**
 * 横向卡片带：CSS scroll-snap + 左右箭头 + 「3 / 6」页码；键盘左右键可用，
 * 触控板横滑走原生滚动。正文超长在卡片内滚动，点卡片在下方详情区展开。
 */
export function MirrorDeck({
  entries,
  variant,
  tabByEntryId,
  ...handlers
}: {
  entries: MirrorEntry[];
  variant: MirrorCardVariant;
  tabByEntryId: Record<string, string>;
} & MirrorDeckHandlers) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>(".mirror-a-card"));
    if (cards.length === 0) return;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    cards.forEach((card, position) => {
      const distance = Math.abs(card.offsetLeft - track.offsetLeft - track.scrollLeft);
      if (distance < best) {
        best = distance;
        nearest = position;
      }
    });
    setIndex(nearest);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    measure();
    track.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      track.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure, entries.length]);

  // 新增或替换出的新卡排在最前：首张变了就滑回开头，让它露出来。
  const firstId = entries[0]?.id;
  const previousFirst = useRef(firstId);
  useEffect(() => {
    if (previousFirst.current && firstId && previousFirst.current !== firstId) {
      trackRef.current?.scrollTo({ left: 0, behavior: "smooth" });
    }
    previousFirst.current = firstId;
  }, [firstId]);

  const goTo = useCallback((next: number) => {
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>(".mirror-a-card"));
    const clamped = Math.max(0, Math.min(cards.length - 1, next));
    const card = cards[clamped];
    if (!card) return;
    track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
    setIndex(clamped);
  }, []);

  const jumpTo = useCallback((id: string) => {
    const card = document.getElementById(`card-${id}`);
    if (!card) return;
    const track = trackRef.current;
    if (track && track.contains(card)) {
      track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
    } else {
      card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
    setOpenId(id);
  }, []);

  const openEntry = openId ? entries.find((entry) => entry.id === openId) ?? null : null;

  return (
    <div className="mirror-a-deck" data-variant={variant}>
      <div
        ref={trackRef}
        className="mirror-a-track"
        role="group"
        aria-label={`${entries.length} 张卡片，左右滑动查看`}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            goTo(index + 1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            goTo(index - 1);
          }
        }}
      >
        {entries.map((entry, position) => (
          <MirrorCard
            key={entry.id}
            entry={entry}
            index={position}
            variant={variant}
            tabByEntryId={tabByEntryId}
            onOpen={setOpenId}
            onJump={jumpTo}
            {...handlers}
          />
        ))}
        {entries.length === 1 && variant !== "trash" ? (
          <p className="mirror-a-deck-note" aria-hidden="true">
            有新条目会出现在这里
          </p>
        ) : null}
      </div>

      <div className="mirror-a-deck-controls">
        <div className="mirror-a-deck-arrows">
          <button
            type="button"
            className="mirror-a-deck-arrow"
            onClick={() => goTo(index - 1)}
            disabled={index <= 0}
            aria-label="上一张"
          >
            ‹
          </button>
          <button
            type="button"
            className="mirror-a-deck-arrow"
            onClick={() => goTo(index + 1)}
            disabled={index >= entries.length - 1}
            aria-label="下一张"
          >
            ›
          </button>
        </div>
        <p className="mirror-a-deck-count">
          <span className="mirror-a-deck-index">{index + 1}</span>
          <span className="mirror-a-deck-total"> / {entries.length}</span>
        </p>
      </div>

      {openEntry && variant !== "trash" ? <CardDetail key={openEntry.id} entry={openEntry} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
