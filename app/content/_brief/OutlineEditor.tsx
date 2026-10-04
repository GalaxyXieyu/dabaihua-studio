// 结构化大纲 outline/v0.1 的编辑界面：块级「不好，重新生成」建议、标题/观点/开头/
// 小节/配图/问题和底部粘性栏。纯逻辑（答案解析、feedback 收集、block id）全部复用
// lib/outline-core.ts，这里只做渲染与交互。

"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, DotsSixVertical } from "@phosphor-icons/react";
import {
  resolveQuestionAnswer,
  type OutlineDiagram,
  type OutlineQuestion,
  type OutlineSection,
  type OutlineV01,
} from "../../../lib/outline-core";
import type { AutosaveStatus, BriefSelection } from "./brief-types";
import { shortMoment } from "./detail-helpers";
import { MermaidDiagram } from "./MermaidDiagram";
import { pendingBlocks, type OutlineDraft } from "./use-outline-draft";

// ── 文案常量（集中在这里，不散落在 JSX） ─────────────────────────────
const COPY = {
  outline: "大纲",
  wholeOutline: "整份大纲",
  regen: "不好，重新生成",
  regenBySuggestion: (count: number) => `按建议重生成（${count}）`,
  confirm: "确认大纲",
  rewriting: "重写中",
  editHere: "改这里",
  redraw: "重画",
  other: "其他",
  default: "默认",
  strike: "勾掉",
  restore: "恢复",
  moveUp: "上移",
  moveDown: "下移",
  drag: "拖动排序",
  conflict: "大纲在别处更新过",
  loadLatest: "载入最新",
  suggestionPlaceholder: "一句建议，比如：更口语一点",
  collapse: "收起",
  clear: "清除",
  suggested: "已提建议",
  suggestionPrefix: "建议：",
  real: "真实场景",
  hypothetical: "假设场景",
  addPoint: "加一条",
  deletePoint: "删除",
  saveSaving: "保存中…",
  saveSaved: "已保存",
  saveFailed: "保存失败，重试",
  renderFailedSuggestion: "图渲染失败，请重画",
  titleOtherPlaceholder: "写一个自己的标题",
  customPlaceholder: "自己说",
  noSection: "小节",
  pointPlaceholder: "一个要点",
  pendingCount: (count: number) => `待重生成 ${count} 条`,
  pendingHint: "哪块不满意就写一句建议，攒齐了一起重生成",
  confirmWhileRewriting: (count: number) => `还有 ${count} 块在重写中，现在确认会以当前内容为准。继续吗？`,
  rewritingCount: (count: number) => `${count} 块重写中`,
  clearChip: "清掉这条建议",
};

const SECTION_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];

const DIAGRAM_STATUS: Record<OutlineDiagram["status"], string> = {
  draft: "草图",
  ok: "可以",
  redo: "待重画",
};

/** 读某个块的 feedback。 */
function getBlockFeedback(outline: OutlineV01, blockId: string): string {
  if (blockId === "all") return outline.feedback ?? "";
  if (blockId === "titles") return outline.titles.feedback ?? "";
  if (blockId === "corePoint") return outline.corePoint.feedback ?? "";
  if (blockId === "opening") return outline.opening.feedback ?? "";
  const section = outline.sections.find((item) => item.id === blockId);
  if (section) return section.feedback ?? "";
  const diagram = outline.diagrams.find((item) => item.id === blockId);
  if (diagram) return diagram.feedback ?? "";
  const question = outline.questions.find((item) => item.id === blockId);
  if (question) return question.feedback ?? "";
  return "";
}

/** 写某个块的 feedback（空串等价于没有，保存时服务端会删掉）。 */
function setBlockFeedback(outline: OutlineV01, blockId: string, value: string): void {
  if (blockId === "all") {
    outline.feedback = value;
    return;
  }
  if (blockId === "titles") {
    outline.titles.feedback = value;
    return;
  }
  if (blockId === "corePoint") {
    outline.corePoint.feedback = value;
    return;
  }
  if (blockId === "opening") {
    outline.opening.feedback = value;
    return;
  }
  const section = outline.sections.find((item) => item.id === blockId);
  if (section) {
    section.feedback = value;
    return;
  }
  const diagram = outline.diagrams.find((item) => item.id === blockId);
  if (diagram) {
    diagram.feedback = value;
    return;
  }
  const question = outline.questions.find((item) => item.id === blockId);
  if (question) question.feedback = value;
}

/** blockId → 底部栏 chip 上的块名。 */
function blockLabel(outline: OutlineV01, blockId: string): string {
  if (blockId === "all") return COPY.wholeOutline;
  if (blockId === "titles") return "标题";
  if (blockId === "corePoint") return "核心观点";
  if (blockId === "opening") return "开头";
  const section = outline.sections.find((item) => item.id === blockId);
  if (section) return section.heading.slice(0, 12) || COPY.noSection;
  if (outline.diagrams.some((item) => item.id === blockId)) return blockId;
  if (outline.questions.some((item) => item.id === blockId)) return `问题 ${blockId}`;
  return blockId;
}

/** 该块当前重写中时，小燕子收到的建议。 */
function regenSuggestion(selection: BriefSelection, blockId: string): string {
  const own = selection.regenerating.find((item) => item.blockId === blockId);
  const all = selection.regenerating.find((item) => item.blockId === "all");
  return (own ?? all)?.suggestion ?? "";
}

function toggleSuggest(draft: OutlineDraft, blockId: string): void {
  draft.setOpenSuggest((prev) => ({ ...prev, [blockId]: !prev[blockId] }));
}

function clearBlockFeedback(draft: OutlineDraft, blockId: string): void {
  draft.update((next) => setBlockFeedback(next, blockId, ""));
  draft.setOpenSuggest((prev) => ({ ...prev, [blockId]: false }));
}

/** 自动增高的 textarea：看起来像正文，不像表单。 */
function AutoTextarea({
  value,
  onChange,
  className,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  className: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      rows={1}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** 保存指示：复用简报页的样式与三态文案。 */
function OutlineSaveIndicator({ status, onRetry }: { status: AutosaveStatus | null; onRetry: () => void }) {
  if (!status) return null;
  if (status === "error") {
    return (
      <button type="button" className="db-save-indicator is-error" data-testid="outline-save" onClick={onRetry}>
        {COPY.saveFailed}
      </button>
    );
  }
  return (
    <span className="db-save-indicator" data-testid="outline-save">
      {status === "saving" ? COPY.saveSaving : COPY.saveSaved}
    </span>
  );
}

/** 块头：小标题 + 已提建议小标 +「不好，重新生成」；展开时给建议输入框。 */
function BlockHead({
  blockId,
  label,
  draft,
  selection,
}: {
  blockId: string;
  label: string;
  draft: OutlineDraft;
  selection: BriefSelection;
}) {
  const outline = draft.outline;
  if (!outline) return null;
  const locked = draft.locked(blockId);
  const feedback = getBlockFeedback(outline, blockId);
  const hasFeedback = feedback.trim() !== "";
  const open = Boolean(draft.openSuggest[blockId]);
  // feedback 非空时输入框常显，刷新后也能看到写了什么。
  const showSuggest = open || hasFeedback;
  const suggestion = regenSuggestion(selection, blockId);
  return (
    <>
      <div className="ol-block-head">
        <span className="ol-block-label">{label}</span>
        {!locked && hasFeedback && (
          <span className="ol-badge" data-testid={`outline-suggested-${blockId}`}>
            {COPY.suggested}
          </span>
        )}
        <span className="ol-block-head-spacer" />
        {locked ? (
          <span className="ol-badge is-locked">{COPY.rewriting}</span>
        ) : (
          <button type="button" className="ol-text-btn" onClick={() => toggleSuggest(draft, blockId)}>
            {COPY.regen}
          </button>
        )}
      </div>
      {locked
        ? suggestion && <p className="ol-locked-hint">{`${COPY.suggestionPrefix}${suggestion}`}</p>
        : showSuggest && <SuggestionRow blockId={blockId} draft={draft} />}
    </>
  );
}

/** 展开的建议输入行；有内容时按钮是「清除」，否则是「收起」。 */
function SuggestionRow({ blockId, draft }: { blockId: string; draft: OutlineDraft }) {
  const value = draft.outline ? getBlockFeedback(draft.outline, blockId) : "";
  const hasValue = value.trim() !== "";
  return (
    <div className="ol-suggest" data-testid={`outline-suggest-${blockId}`}>
      <input
        autoFocus
        className="ol-suggest-input"
        type="text"
        value={value}
        placeholder={COPY.suggestionPlaceholder}
        onChange={(event) => {
          const next = event.target.value;
          draft.update((outline) => setBlockFeedback(outline, blockId, next));
        }}
      />
      <button
        type="button"
        className="ol-text-btn"
        onClick={() => (hasValue ? clearBlockFeedback(draft, blockId) : toggleSuggest(draft, blockId))}
      >
        {hasValue ? COPY.clear : COPY.collapse}
      </button>
    </div>
  );
}

/** 标题候选：单选 chip + 其他自填。 */
function TitlesBlock({ outline, draft, selection }: { outline: OutlineV01; draft: OutlineDraft; selection: BriefSelection }) {
  const locked = draft.locked("titles");
  const [otherOpen, setOtherOpen] = useState(() => Boolean(outline.titles.custom));
  return (
    <section className="ol-block" data-block-id="titles" data-testid="outline-block-titles" data-locked={locked ? "true" : undefined}>
      <BlockHead blockId="titles" label="标题" draft={draft} selection={selection} />
      <div className="ol-chips" role="radiogroup" aria-label="标题候选">
        {outline.titles.options.map((option) => {
          const checked = outline.titles.selected === option.id && !otherOpen;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={checked}
              className={`ol-chip ${checked ? "is-on" : ""}`}
              data-testid={`outline-title-chip-${option.id}`}
              disabled={locked}
              onClick={() => {
                setOtherOpen(false);
                draft.update((next) => {
                  next.titles.selected = next.titles.selected === option.id ? null : option.id;
                });
              }}
            >
              {checked && <span className="ol-dot" aria-hidden="true" />}
              {option.text}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={otherOpen}
          className={`ol-chip ${otherOpen ? "is-on" : ""}`}
          data-testid="outline-title-other"
          disabled={locked}
          onClick={() => {
            setOtherOpen(true);
            draft.update((next) => {
              next.titles.selected = null;
            });
          }}
        >
          {otherOpen && <span className="ol-dot" aria-hidden="true" />}
          {COPY.other}
        </button>
      </div>
      {otherOpen && (
        <input
          className="ol-input"
          type="text"
          value={outline.titles.custom ?? ""}
          placeholder={COPY.titleOtherPlaceholder}
          disabled={locked}
          onChange={(event) => {
            const next = event.target.value;
            draft.update((draftOutline) => {
              draftOutline.titles.custom = next;
            });
          }}
        />
      )}
    </section>
  );
}

/** 核心观点：像正文一样的行内可编辑。 */
function CorePointBlock({ outline, draft, selection }: { outline: OutlineV01; draft: OutlineDraft; selection: BriefSelection }) {
  const locked = draft.locked("corePoint");
  return (
    <section className="ol-block" data-block-id="corePoint" data-testid="outline-block-corePoint" data-locked={locked ? "true" : undefined}>
      <BlockHead blockId="corePoint" label="核心观点" draft={draft} selection={selection} />
      <AutoTextarea
        className="ol-core"
        value={outline.corePoint.text}
        placeholder="一句话核心观点"
        disabled={locked}
        onChange={(value) => draft.update((next) => { next.corePoint.text = value; })}
      />
    </section>
  );
}

/** 开头：真实/假设场景切换 + 行内正文 + 来源行。 */
function OpeningBlock({ outline, draft, selection }: { outline: OutlineV01; draft: OutlineDraft; selection: BriefSelection }) {
  const locked = draft.locked("opening");
  const kind = outline.opening.kind;
  return (
    <section className="ol-block" data-block-id="opening" data-testid="outline-block-opening" data-locked={locked ? "true" : undefined}>
      <BlockHead blockId="opening" label="开头" draft={draft} selection={selection} />
      <div className="ol-seg" role="radiogroup" aria-label="开头类型">
        <button
          type="button"
          role="radio"
          aria-checked={kind === "real"}
          className={`ol-seg-btn ${kind === "real" ? "is-on" : ""}`}
          disabled={locked}
          onClick={() => draft.update((next) => { next.opening.kind = "real"; })}
        >
          {COPY.real}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={kind === "hypothetical"}
          className={`ol-seg-btn ${kind === "hypothetical" ? "is-on" : ""}`}
          disabled={locked}
          onClick={() => draft.update((next) => { next.opening.kind = "hypothetical"; })}
        >
          {COPY.hypothetical}
        </button>
      </div>
      <AutoTextarea
        className="ol-body"
        value={outline.opening.text}
        placeholder="开头的写法"
        disabled={locked}
        onChange={(value) => draft.update((next) => { next.opening.text = value; })}
      />
      {outline.opening.sources.length > 0 && (
        <p className="ol-sources">来源：{outline.opening.sources.join("；")}</p>
      )}
    </section>
  );
}

/** 拖动排序时重新计算 sections 顺序（diagrams 靠 anchor 自动跟随）。 */
function moveSection(sections: OutlineSection[], fromId: string, toId: string, after: boolean): void {
  const from = sections.findIndex((item) => item.id === fromId);
  let to = sections.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0 || from === to) return;
  const [item] = sections.splice(from, 1);
  if (from < to) to -= 1;
  const insert = after ? to + 1 : to;
  sections.splice(insert, 0, item);
}

type SectionDrag = {
  armed: boolean;
  active: boolean;
  dropSide?: "before" | "after";
  onArm: (armed: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (after: boolean) => void;
  onDrop: (after: boolean) => void;
};

/** 一节卡片 + 它锚定的配图。 */
function SectionCard({
  section,
  index,
  count,
  numeral,
  diagrams,
  draft,
  selection,
  drag,
}: {
  section: OutlineSection;
  index: number;
  count: number;
  numeral: string;
  diagrams: OutlineDiagram[];
  draft: OutlineDraft;
  selection: BriefSelection;
  drag: SectionDrag;
}) {
  const locked = draft.locked(section.id);
  const feedback = draft.outline ? getBlockFeedback(draft.outline, section.id) : "";
  const hasFeedback = feedback.trim() !== "";
  const showSuggest = Boolean(draft.openSuggest[section.id]) || hasFeedback;
  const suggestion = regenSuggestion(selection, section.id);

  return (
    <div
      className="ol-section-wrap"
      data-testid={`outline-section-${section.id}`}
      data-drop={drag.dropSide}
      onDragEnter={(event) => {
        if (!drag.active) return;
        event.preventDefault();
      }}
      onDragOver={(event) => {
        if (!drag.active) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        drag.onDragOver(event.clientY > rect.top + rect.height / 2);
      }}
      onDrop={(event) => {
        if (!drag.active) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        drag.onDrop(event.clientY > rect.top + rect.height / 2);
      }}
    >
      <section
        className={`ol-block ol-card ${section.keep ? "" : "is-off"}`}
        data-block-id={section.id}
        data-testid={`outline-block-${section.id}`}
        data-section={section.id}
        data-locked={locked ? "true" : undefined}
        draggable={drag.armed}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", section.id);
          drag.onDragStart();
        }}
        onDragEnd={drag.onDragEnd}
      >
        <div className="ol-card-head">
          <span className="ol-num" aria-hidden="true">
            {section.keep ? numeral : ""}
          </span>
          <input
            className="ol-section-title"
            type="text"
            value={section.heading}
            placeholder={COPY.noSection}
            disabled={locked}
            onChange={(event) => {
              const next = event.target.value;
              draft.update((outline) => {
                const target = outline.sections.find((item) => item.id === section.id);
                if (target) target.heading = next;
              });
            }}
          />
          <div className="ol-card-tools">
            <button
              type="button"
              className="ol-icon-btn ol-handle"
              aria-label={COPY.drag}
              title={COPY.drag}
              disabled={locked}
              onMouseDown={() => drag.onArm(true)}
            >
              <DotsSixVertical weight="bold" />
            </button>
            <button
              type="button"
              className="ol-icon-btn"
              aria-label={COPY.moveUp}
              title={COPY.moveUp}
              disabled={locked || index === 0}
              onClick={() => draft.update((outline) => { const [item] = outline.sections.splice(index, 1); outline.sections.splice(index - 1, 0, item); })}
            >
              <ArrowUp weight="bold" />
            </button>
            <button
              type="button"
              className="ol-icon-btn"
              aria-label={COPY.moveDown}
              title={COPY.moveDown}
              disabled={locked || index === count - 1}
              onClick={() => draft.update((outline) => { const [item] = outline.sections.splice(index, 1); outline.sections.splice(index + 1, 0, item); })}
            >
              <ArrowDown weight="bold" />
            </button>
            <button
              type="button"
              className="ol-text-btn ol-strike"
              disabled={locked}
              onClick={() => draft.update((outline) => { const target = outline.sections.find((item) => item.id === section.id); if (target) target.keep = !target.keep; })}
            >
              {section.keep ? COPY.strike : COPY.restore}
            </button>
            {!locked && hasFeedback && (
              <span className="ol-badge" data-testid={`outline-suggested-${section.id}`}>
                {COPY.suggested}
              </span>
            )}
            {locked ? (
              <span className="ol-badge is-locked">{COPY.rewriting}</span>
            ) : (
              <button type="button" className="ol-text-btn" onClick={() => toggleSuggest(draft, section.id)}>
                {COPY.regen}
              </button>
            )}
          </div>
        </div>
        {locked
          ? suggestion && <p className="ol-locked-hint">{`${COPY.suggestionPrefix}${suggestion}`}</p>
          : showSuggest && <SuggestionRow blockId={section.id} draft={draft} />}
        <ul className="ol-points">
          {section.points.map((point, pointIndex) => (
            <li key={pointIndex} className="ol-point">
              <AutoTextarea
                className="ol-point-text"
                value={point}
                placeholder={COPY.pointPlaceholder}
                disabled={locked}
                onChange={(value) =>
                  draft.update((outline) => {
                    const target = outline.sections.find((item) => item.id === section.id);
                    if (target) target.points[pointIndex] = value;
                  })
                }
              />
              <button
                type="button"
                className="ol-text-btn ol-point-delete"
                disabled={locked}
                onClick={() =>
                  draft.update((outline) => {
                    const target = outline.sections.find((item) => item.id === section.id);
                    if (target) target.points.splice(pointIndex, 1);
                  })
                }
              >
                {COPY.deletePoint}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="ol-text-btn ol-add-point"
          disabled={locked}
          onClick={() =>
            draft.update((outline) => {
              const target = outline.sections.find((item) => item.id === section.id);
              if (target) target.points.push("");
            })
          }
        >
          {COPY.addPoint}
        </button>
      </section>
      {diagrams.map((diagram) => (
        <DiagramBlock key={diagram.id} diagram={diagram} draft={draft} selection={selection} />
      ))}
    </div>
  );
}

/** 小节列表：拖动排序状态在列表层共享，才能跨卡片显示插入位置。 */
function SectionsBlock({ outline, kept, draft, selection }: { outline: OutlineV01; kept: OutlineSection[]; draft: OutlineDraft; selection: BriefSelection }) {
  const [handleId, setHandleId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);

  function endDrag() {
    setDragId(null);
    setDrop(null);
    setHandleId(null);
  }

  // 手柄「武装」后，鼠标在任意位置松开都取消，避免拖不起来或卡住。
  useEffect(() => {
    if (!handleId) return;
    const resetArm = () => setHandleId(null);
    window.addEventListener("mouseup", resetArm);
    return () => window.removeEventListener("mouseup", resetArm);
  }, [handleId]);

  return (
    <>
      {outline.sections.map((section) => {
        const index = outline.sections.findIndex((item) => item.id === section.id);
        const numeralIndex = kept.findIndex((item) => item.id === section.id);
        const numeral = SECTION_NUMERALS[numeralIndex] ?? String(numeralIndex + 1);
        const diagrams = outline.diagrams.filter((diagram) => diagram.anchor === section.id);
        return (
          <SectionCard
            key={section.id}
            section={section}
            index={index}
            count={outline.sections.length}
            numeral={numeral}
            diagrams={diagrams}
            draft={draft}
            selection={selection}
            drag={{
              armed: handleId === section.id,
              active: dragId !== null,
              dropSide: drop && drop.id === section.id ? (drop.after ? "after" : "before") : undefined,
              onArm: (armed) => setHandleId(armed ? section.id : null),
              onDragStart: () => setDragId(section.id),
              onDragEnd: endDrag,
              onDragOver: (after) => setDrop({ id: section.id, after }),
              onDrop: (after) => {
                if (dragId) draft.update((next) => moveSection(next.sections, dragId, section.id, after));
                endDrag();
              },
            }}
          />
        );
      })}
    </>
  );
}

/** 单张配图：mermaid 草图 + 状态 + 「改这里」常驻建议输入。 */
function DiagramBlock({ diagram, draft, selection }: { diagram: OutlineDiagram; draft: OutlineDraft; selection: BriefSelection }) {
  const locked = draft.locked(diagram.id);
  const suggestion = regenSuggestion(selection, diagram.id);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const status = diagram.status;
  return (
    <figure className={`ol-diagram ${status === "redo" ? "is-redo" : ""}`} data-block-id={diagram.id} data-testid={`outline-diagram-${diagram.id}`} data-locked={locked ? "true" : undefined}>
      <div className="ol-block-head">
        <span className="ol-fig-badge">{diagram.id}</span>
        <span className={`ol-diagram-status is-${status}`}>{DIAGRAM_STATUS[status]}</span>
        <button
          type="button"
          className={`ol-chip ol-diagram-toggle ${status === "ok" ? "is-on" : ""}`}
          aria-pressed={status === "ok"}
          disabled={locked}
          onClick={() =>
            draft.update((outline) => {
              const target = outline.diagrams.find((item) => item.id === diagram.id);
              if (target) target.status = target.status === "ok" ? "draft" : "ok";
            })
          }
        >
          {status === "ok" && <span className="ol-dot" aria-hidden="true" />}
          这张可以
        </button>
        <span className="ol-block-head-spacer" />
        {locked ? (
          <span className="ol-badge is-locked">{COPY.rewriting}</span>
        ) : (
          <button type="button" className="ol-text-btn" onClick={() => inputRef.current?.focus()}>
            {COPY.regen}
          </button>
        )}
      </div>
      <MermaidDiagram
        blockId={diagram.id}
        source={diagram.mermaid}
        onRedraw={() => draft.update((outline) => setBlockFeedback(outline, diagram.id, COPY.renderFailedSuggestion))}
      />
      <figcaption className="ol-caption">{diagram.caption}</figcaption>
      {!locked && (
        <div className="ol-suggest ol-suggest-always" data-testid={`outline-suggest-${diagram.id}`}>
          <span className="ol-suggest-label">{COPY.editHere}</span>
          <input
            ref={inputRef}
            className="ol-suggest-input"
            type="text"
            value={diagram.feedback ?? ""}
            placeholder={COPY.suggestionPlaceholder}
            onChange={(event) => {
              const next = event.target.value;
              draft.update((outline) => setBlockFeedback(outline, diagram.id, next));
            }}
          />
        </div>
      )}
      {locked && suggestion && <p className="ol-locked-hint">{`${COPY.suggestionPrefix}${suggestion}`}</p>}
    </figure>
  );
}

function isAnswerEmpty(answer: string | string[] | null): boolean {
  if (answer === null || answer === undefined) return true;
  if (Array.isArray(answer)) return answer.length === 0;
  return answer.trim() === "";
}

function isOptionSelected(question: OutlineQuestion, option: string): boolean {
  if (question.type === "multi") return Array.isArray(question.answer) && question.answer.includes(option);
  return question.answer === option;
}

function isDefaultOption(question: OutlineQuestion, option: string): boolean {
  if (question.type === "multi") {
    return Array.isArray(question.default) ? question.default.includes(option) : question.default === option;
  }
  return question.default === option;
}

/** 问题：single 单选、multi 多选、text 输入；选项与答案都支持「其他」自填。 */
function QuestionsBlock({ outline, draft, selection }: { outline: OutlineV01; draft: OutlineDraft; selection: BriefSelection }) {
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="ol-questions">
      {outline.questions.map((question) => {
        const locked = draft.locked(question.id);
        const resolved = resolveQuestionAnswer(question);
        const answerEmpty = isAnswerEmpty(question.answer);
        const customValue = (question.custom ?? "").trim();
        const hasCustom = customValue !== "";
        const options = question.options.filter((option) => option.trim() !== COPY.other);
        const otherOpen = Boolean(customOpen[question.id]) || hasCustom;
        return (
          <section key={question.id} className="ol-block ol-question" data-block-id={question.id} data-testid={`outline-block-${question.id}`} data-locked={locked ? "true" : undefined}>
            <BlockHead blockId={question.id} label={`问题 ${question.id}`} draft={draft} selection={selection} />
            <p className="ol-question-text">{question.text}</p>
            {question.type === "text" ? (
              <AutoTextarea
                className="ol-answer"
                value={typeof question.answer === "string" ? question.answer : ""}
                placeholder={typeof question.default === "string" ? question.default : COPY.customPlaceholder}
                disabled={locked}
                onChange={(value) =>
                  draft.update((outline) => {
                    const target = outline.questions.find((item) => item.id === question.id);
                    if (target) target.answer = value;
                  })
                }
              />
            ) : (
              <div className="ol-chips" role={question.type === "single" ? "radiogroup" : "group"} aria-label={question.text}>
                {options.map((option, optionIndex) => {
                  const selected = isOptionSelected(question, option);
                  const asDefault = answerEmpty && !hasCustom && isDefaultOption(question, option);
                  const on = selected || asDefault;
                  return (
                    <button
                      key={optionIndex}
                      type="button"
                      role={question.type === "single" ? "radio" : "checkbox"}
                      aria-checked={on}
                      className={`ol-chip ${on ? "is-on" : ""}`}
                      data-testid={`outline-question-${question.id}-chip-${optionIndex}`}
                      disabled={locked}
                      onClick={() => {
                        setCustomOpen((prev) => ({ ...prev, [question.id]: false }));
                        draft.update((outline) => {
                          const target = outline.questions.find((item) => item.id === question.id);
                          if (!target) return;
                          if (target.type === "multi") {
                            const list = Array.isArray(target.answer) ? target.answer : [];
                            target.answer = list.includes(option) ? list.filter((item) => item !== option) : [...list, option];
                          } else {
                            target.answer = target.answer === option ? null : option;
                          }
                        });
                      }}
                    >
                      {on && <span className="ol-dot" aria-hidden="true" />}
                      {option}
                      {asDefault && <span className="ol-default-tag">{COPY.default}</span>}
                    </button>
                  );
                })}
                <button
                  type="button"
                  role={question.type === "single" ? "radio" : "checkbox"}
                  aria-checked={otherOpen}
                  className={`ol-chip ${otherOpen ? "is-on" : ""}`}
                  data-testid={`outline-question-${question.id}-chip-other`}
                  disabled={locked}
                  onClick={() => {
                    const open = !otherOpen;
                    setCustomOpen((prev) => ({ ...prev, [question.id]: open }));
                    if (open && question.type === "single") {
                      draft.update((outline) => {
                        const target = outline.questions.find((item) => item.id === question.id);
                        if (target) target.answer = null;
                      });
                    }
                  }}
                >
                  {otherOpen && <span className="ol-dot" aria-hidden="true" />}
                  {COPY.other}
                </button>
              </div>
            )}
            {question.type !== "text" && otherOpen && (
              <input
                className="ol-input"
                type="text"
                value={question.custom ?? ""}
                placeholder={COPY.customPlaceholder}
                disabled={locked}
                onChange={(event) => {
                  const next = event.target.value;
                  draft.update((outline) => {
                    const target = outline.questions.find((item) => item.id === question.id);
                    if (target) target.custom = next;
                  });
                }}
              />
            )}
            <p className="ol-question-resolved" data-testid={`outline-question-${question.id}-resolved`}>
              当前：{resolved.text}
            </p>
          </section>
        );
      })}
    </div>
  );
}

/** 素材：紧凑列表，只显示 label，不可编辑、不重生成。 */
function MaterialsBlock({ outline }: { outline: OutlineV01 }) {
  if (outline.materials.length === 0) return null;
  return (
    <section className="ol-block ol-materials" data-testid="outline-block-materials">
      <div className="ol-block-head">
        <span className="ol-block-label">素材</span>
      </div>
      <ul className="ol-material-list">
        {outline.materials.map((material, index) => (
          <li key={index} className="ol-material" data-testid={`outline-material-${index}`}>
            {material.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

type EditorProps = {
  draft: OutlineDraft;
  selection: BriefSelection;
};

/** 结构化大纲编辑器（替换 outline_pending + outlineJson 时的 Markdown 大纲区）。 */
export function OutlineEditor({ draft, selection }: EditorProps) {
  const outline = draft.outline;
  if (!outline) return null;
  const meta = [selection.outlineBy, shortMoment(selection.outlineAt), `rev ${draft.rev}`].filter(Boolean).join(" · ");
  const allLocked = draft.locked("all");
  const kept = outline.sections.filter((section) => section.keep);
  const allSuggestion = regenSuggestion(selection, "all");

  return (
    <div className="ol-editor" data-testid="outline-editor">
      <section className="ol-block ol-head" data-block-id="all" data-testid="outline-block-all">
        <div className="ol-head-top">
          <div className="ol-head-identity">
            <span className="ol-block-label">{COPY.outline}</span>
            <span className="ol-meta">{meta}</span>
            <OutlineSaveIndicator status={draft.saveState} onRetry={draft.retrySave} />
          </div>
          <div className="ol-head-regen">
            <span className="ol-block-label">{COPY.wholeOutline}</span>
            {allLocked ? (
              <span className="ol-badge is-locked">{COPY.rewriting}</span>
            ) : (
              <button type="button" className="ol-text-btn" data-testid="outline-regenerate-all" onClick={() => toggleSuggest(draft, "all")}>
                {COPY.regen}
              </button>
            )}
          </div>
        </div>
        {allLocked
          ? allSuggestion && <p className="ol-locked-hint">{`${COPY.suggestionPrefix}${allSuggestion}`}</p>
          : Boolean(draft.openSuggest.all) && <SuggestionRow blockId="all" draft={draft} />}
        {draft.conflict !== null && (
          <div className="ol-conflict" role="alert" data-testid="outline-conflict">
            <span className="ol-conflict-text">{COPY.conflict}</span>
            <button type="button" className="db-btn" data-testid="outline-load-latest" onClick={draft.loadLatest}>
              {COPY.loadLatest}
            </button>
          </div>
        )}
      </section>

      <TitlesBlock outline={outline} draft={draft} selection={selection} />
      <CorePointBlock outline={outline} draft={draft} selection={selection} />
      <OpeningBlock outline={outline} draft={draft} selection={selection} />

      <div className="ol-sections">
        <SectionsBlock outline={outline} kept={kept} draft={draft} selection={selection} />
      </div>

      <QuestionsBlock outline={outline} draft={draft} selection={selection} />
      <MaterialsBlock outline={outline} />
    </div>
  );
}

/** 底部粘性栏：待重生成 chip + 重写中计数 + 两个按钮 + 错误行。 */
export function OutlineBar({ draft, selection }: { draft: OutlineDraft; selection: BriefSelection }) {
  const outline = draft.outline;
  if (!outline) return null;
  // 重写中的块不进待重生成列表，计数、chip、按钮里的 n 都用过滤后的。
  const blocks = pendingBlocks(outline, draft.locked);
  const regenerating = selection.regenerating.length;
  const regenDisabled = draft.barBusy || regenerating > 0 || blocks.length === 0;
  return (
    <div className="ol-bar" data-testid="outline-bar">
      <div className="ol-bar-feedback">
        {blocks.length > 0 ? (
          <>
            <span className="ol-bar-count">{COPY.pendingCount(blocks.length)}</span>
            <div className="ol-bar-chips">
              {blocks.map((block) => (
                <span key={block.blockId} className="ol-bar-chip" data-testid={`outline-bar-chip-${block.blockId}`}>
                  {blockLabel(outline, block.blockId)}
                  <button type="button" className="ol-bar-chip-clear" aria-label={COPY.clearChip} onClick={() => clearBlockFeedback(draft, block.blockId)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </>
        ) : (
          <span className="ol-bar-hint">{COPY.pendingHint}</span>
        )}
        {regenerating > 0 && <span className="ol-bar-rewriting">{COPY.rewritingCount(regenerating)}</span>}
      </div>
      <div className="ol-bar-actions">
        <button
          type="button"
          className="db-btn ol-btn-secondary"
          data-testid="outline-regenerate"
          disabled={regenDisabled}
          onClick={draft.regenerate}
        >
          {COPY.regenBySuggestion(blocks.length)}
        </button>
        <button
          type="button"
          className="db-btn db-btn-primary"
          data-testid="outline-confirm"
          disabled={draft.barBusy}
          onClick={() => {
            if (regenerating > 0 && !window.confirm(COPY.confirmWhileRewriting(regenerating))) return;
            draft.confirm();
          }}
        >
          {COPY.confirm}
        </button>
      </div>
      {draft.actionError && (
        <p className="ol-bar-error" role="alert" data-testid="outline-bar-error">
          {draft.actionError}
        </p>
      )}
    </div>
  );
}
