"use client";

/* eslint-disable @next/next/no-html-link-for-pages */
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", account, password }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "登录失败，请稍后再试");
      const requested = new URLSearchParams(window.location.search).get("next") || "";
      const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
      window.location.href = next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败，请稍后再试");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-10 text-[var(--ink)]">
      <div className="w-full max-w-[380px]">
        <div className="mb-5 text-center">
          <div className="mb-2 text-2xl">🌊</div>
          <h1 className="text-lg font-bold">登录清流工作室</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">登录后即可进入手机审稿页审阅草稿</p>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 shadow-sm">
          <div>
            <label htmlFor="account" className="mb-1 block text-xs font-bold text-[var(--muted)]">账号</label>
            <input
              id="account"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              autoComplete="username"
              required
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-bold text-[var(--muted)]">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-sm outline-none focus:border-[var(--green)]"
            />
          </div>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">{error}</p> : null}
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-[var(--green)] py-3 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
        <div className="mt-4 text-center">
          <a href="/" className="text-sm font-bold text-[var(--muted)] hover:text-[var(--green)]">← 返回首页</a>
        </div>
      </div>
    </div>
  );
}
