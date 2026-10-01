"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  entryOwnDate,
  formatMirrorDate,
  formatShortDate,
  sourceLine,
  type MirrorEntry,
} from "../../../lib/mirror";
import { MiniMarkdown } from "../../topics/daily/_components/mini-markdown";

/** 卡片带的类型，决定卡片外观 class `is-<variant>`。 */
export type MirrorCardVariant = "profile" | "preference" | "method" | "decision" | "adjustment" | "inbox";

function latestVersion(entry: MirrorEntry): number {
  return entry.history[entry.history.length - 1]?.version || 1;
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

function MirrorCard({
  entry,
  index,
  variant,
  tabByEntryId,
  onOpen,
  onJump,
}: {
  entry: MirrorEntry;
  index: number;
  variant: MirrorCardVariant;
  tabByEntryId: Record<string, string>;
  onOpen: (id: string) => void;
  onJump: (id: string) => void;
}) {
  const superseded = entry.status === "已推翻";
  const target = entry.supersededBy;
  const targetTab = target ? tabByEntryId[target] || variant : variant;
  const href = target ? `/mirror?tab=${targetTab}#card-${target}` : "";

  return (
    <article
      id={`card-${entry.id}`}
      className={`mirror-a-card is-${variant}${superseded ? " is-superseded" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`查看「${entry.title}」的正文和历史`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) return;
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
        <span className="mirror-a-card-version">v{latestVersion(entry)}</span>
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
                {item.reason ? <span className="mirror-a-history-reason">{item.reason}</span> : null}
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
 * 触控板横滑走原生滚动。正文超长在卡片内滚动，点版本号在下方详情区展开。
 */
export function MirrorDeck({
  entries,
  variant,
  tabByEntryId,
}: {
  entries: MirrorEntry[];
  variant: MirrorCardVariant;
  tabByEntryId: Record<string, string>;
}) {
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

  const jumpTo = useCallback(
    (id: string) => {
      const card = document.getElementById(`card-${id}`);
      if (!card) return;
      const track = trackRef.current;
      if (track && track.contains(card)) {
        track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
      } else {
        card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
      setOpenId(id);
    },
    [],
  );

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
          />
        ))}
        {entries.length === 1 ? (
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

      {openEntry ? <CardDetail key={openEntry.id} entry={openEntry} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
