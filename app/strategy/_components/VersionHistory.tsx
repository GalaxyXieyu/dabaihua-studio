"use client";

import { useState, useCallback } from "react";

type VersionEntry = {
  id: number;
  version: number;
  note: string;
  isActive: number | boolean;
  createdAt: string;
};

export function VersionHistory({ versions: initialVersions }: { versions: VersionEntry[] }) {
  const [versions, setVersions] = useState<VersionEntry[]>(initialVersions);
  const [activating, setActivating] = useState<number | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const showToast = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleActivate = async (version: number) => {
    setActivating(version);
    try {
      const res = await fetch("/api/strategy/versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "激活失败");
      }
      setVersions((prev) => prev.map((v) => ({ ...v, isActive: v.version === version ? 1 : 0 })));
      showToast("ok", `已激活 v${version}`);
    } catch (e) {
      showToast("err", (e as Error).message);
    } finally {
      setActivating(null);
    }
  };

  return (
    <div className="strat-history">
      {/* Toast */}
      {toast && (
        <div className={`strat-toast ${toast.kind === "err" ? "err" : "ok"}`}>
          {toast.msg}
        </div>
      )}

      <h2>版本历史</h2>
      <div className="strat-history-list">
        {versions.length === 0 && (
          <div className="strat-history-empty">暂无版本</div>
        )}
        {versions.map((v) => {
          const active = Boolean(v.isActive);
          return (
            <div key={v.id} className="strat-history-item">
              <div className="strat-history-head">
                <span className="strat-history-version">v{v.version}</span>
                {active ? (
                  <span className="strat-history-active">激活中</span>
                ) : (
                  <button
                    disabled={activating !== null}
                    onClick={() => handleActivate(v.version)}
                    className="strat-btn-text"
                  >
                    {activating === v.version ? "激活中…" : "激活"}
                  </button>
                )}
              </div>
              {v.note && (
                <p className="strat-history-note">{v.note}</p>
              )}
              <p className="strat-history-date">
                {new Date(v.createdAt).toLocaleString("zh-CN")}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
