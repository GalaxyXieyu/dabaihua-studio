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
        const err = await res.json().catch(() => ({}));
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
    <div className="lg:sticky lg:top-24">
      {/* Toast */}
      {toast && (
        <div className={`fixed right-6 top-20 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${toast.kind === "ok" ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          {toast.msg}
        </div>
      )}

      <div className="rounded-lg border border-[var(--line)] bg-[var(--paper)]">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-sm font-bold">📜 版本历史</h2>
        </div>
        <div className="max-h-[calc(100vh-200px)] space-y-1 overflow-y-auto p-2">
          {versions.length === 0 && (
            <div className="px-3 py-8 text-center text-xs text-[var(--faint)]">暂无版本</div>
          )}
          {versions.map((v) => {
            const active = Boolean(v.isActive);
            return (
              <div
                key={v.id}
                className={`rounded-lg border px-3 py-2.5 ${active ? "border-green-300 bg-green-50" : "border-[var(--line)] bg-[var(--canvas)]"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                      v{v.version}
                    </span>
                    {active && <span className="text-[10px] font-bold text-green-600">激活中</span>}
                  </div>
                  {!active && (
                    <button
                      disabled={activating !== null}
                      onClick={() => handleActivate(v.version)}
                      className="rounded px-2 py-1 text-[10px] font-bold text-[var(--green)] hover:bg-[var(--green-soft)] disabled:opacity-50"
                    >
                      {activating === v.version ? "激活中..." : "激活"}
                    </button>
                  )}
                </div>
                {v.note && (
                  <p className="mt-1.5 text-xs text-[var(--muted)]">{v.note}</p>
                )}
                <p className="mt-1 text-[10px] text-[var(--faint)]">
                  {new Date(v.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
