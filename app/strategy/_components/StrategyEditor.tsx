"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formatShanghaiDateTime } from "../../../lib/datetime";
import { StrategyDocument } from "./StrategyDocument";
import { StrategyEditable } from "./StrategyEditable";
import { VersionHistory } from "./VersionHistory";
import {
  TABS,
  normalizeStrategyData,
  type Retrospective,
  type StrategyData,
  type Tab,
  type VersionEntry,
} from "./strategy-model";

export function StrategyEditor({
  initialVersion,
  initialNote,
  initialData,
  versions,
  updatedAt: initialUpdatedAt,
}: {
  initialVersion: number;
  initialNote: string | null;
  initialData: unknown;
  versions: VersionEntry[];
  updatedAt: string | null;
}) {
  const initial = useMemo(() => normalizeStrategyData(initialData), [initialData]);

  const [tab, setTab] = useState<Tab>("平台路由");
  const [data, setData] = useState<StrategyData>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initial));
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [version, setVersion] = useState(initialVersion);
  const [versionNote, setVersionNote] = useState(initialNote || "");
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"ok" | "err">("ok");

  const [retros, setRetros] = useState<Retrospective[]>([]);
  const [retrosLoaded, setRetrosLoaded] = useState(false);
  const loadingRetros = useRef(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  const dirty = JSON.stringify(data) !== savedSnapshot;

  const loadRetros = useCallback(async () => {
    if (loadingRetros.current) return;
    loadingRetros.current = true;
    try {
      const resp = await fetch("/api/retrospectives");
      const json = (await resp.json()) as { retrospectives?: Retrospective[] };
      setRetros(json.retrospectives || []);
      setRetrosLoaded(true);
    } catch {
      /* ignore */
    } finally {
      loadingRetros.current = false;
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    historyButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKeyDown);
    drawerCloseRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, closeDrawer]);

  const startEdit = () => {
    setMessage("");
    setEditing(true);
  };

  const exitEdit = useCallback(() => {
    setData(JSON.parse(savedSnapshot) as StrategyData);
    setNote("");
    setEditing(false);
  }, [savedSnapshot]);

  const cancelEdit = () => {
    if (dirty && typeof window !== "undefined" && !window.confirm("有未保存的修改，确定放弃吗？")) return;
    exitEdit();
  };

  const saveStrategy = async () => {
    setSaving(true);
    setMessage("");
    const content = JSON.stringify(data);
    const versionNoteToSave = note || "更新策略";
    try {
      const resp = await fetch("/api/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, note: versionNoteToSave }),
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message || "保存失败");
      }
      const json = (await resp.json().catch(() => ({}))) as { version?: number };
      if (typeof json.version === "number") setVersion(json.version);
      setVersionNote(versionNoteToSave);
      setUpdatedAt(new Date().toISOString());
      setSavedSnapshot(content);
      setNote("");
      setEditing(false);
      setMessageKind("ok");
      setMessage("已保存为新版本");
    } catch (error) {
      setMessageKind("err");
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const showError = useCallback((text: string) => {
    setMessageKind("err");
    setMessage(text);
  }, []);

  return (
    <div className="strat-column">
      <header className="strat-head">
        <div className="strat-head-row">
          <p className="strat-kicker">内容 · 策略</p>
          <h1 className="strat-title">策略</h1>
          <div className="strat-head-actions">
            <button
              type="button"
              ref={historyButtonRef}
              className="strat-btn-quiet"
              onClick={() => setDrawerOpen(true)}
            >
              版本历史
            </button>
            {editing ? (
              <button
                type="button"
                className="strat-btn-quiet primary"
                onClick={saveStrategy}
                disabled={saving}
              >
                完成
              </button>
            ) : (
              <button type="button" className="strat-btn-quiet primary" onClick={startEdit}>
                编辑
              </button>
            )}
          </div>
          <p className="strat-meta">
            <span>
              当前版本 v<span className="strat-num">{version}</span>
            </span>
            {versionNote ? (
              <>
                <span className="strat-sep">·</span>
                <span className="strat-meta-note">{versionNote}</span>
              </>
            ) : null}
            {updatedAt ? (
              <>
                <span className="strat-sep">·</span>
                <span className="strat-num strat-meta-time">{formatShanghaiDateTime(updatedAt)}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="strat-double-rule" />
      </header>

      <div className="strat-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => {
              setTab(item);
              if (item === "复盘记录") void loadRetros();
            }}
            className={`strat-tab ${tab === item ? "active" : ""}`}
          >
            {item}
          </button>
        ))}
      </div>

      {message ? <p className={`strat-message ${messageKind}`}>{message}</p> : null}

      <div className="strat-body">
        {editing ? (
          <StrategyEditable
            tab={tab}
            data={data}
            setData={setData}
            retros={retros}
            retrosLoaded={retrosLoaded}
            reloadRetros={loadRetros}
            onError={showError}
          />
        ) : (
          <StrategyDocument tab={tab} data={data} retros={retros} retrosLoaded={retrosLoaded} />
        )}
      </div>

      {editing ? (
        <div className="strat-editbar">
          <input
            className="strat-editbar-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="版本说明"
            aria-label="版本说明"
          />
          <button type="button" className="strat-btn-primary" onClick={saveStrategy} disabled={saving}>
            保存为新版本
          </button>
          <button type="button" className="strat-btn-secondary" onClick={cancelEdit}>
            取消
          </button>
        </div>
      ) : null}

      {drawerOpen ? (
        <div className="strat-drawer-layer">
          <button
            type="button"
            className="strat-scrim"
            aria-label="关闭版本历史"
            onClick={closeDrawer}
          />
          <aside
            className="strat-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="strat-history-title"
          >
            <button
              type="button"
              ref={drawerCloseRef}
              className="strat-drawer-close"
              aria-label="关闭版本历史"
              onClick={closeDrawer}
            >
              ×
            </button>
            <VersionHistory versions={versions} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
