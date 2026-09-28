"use client";

/* eslint-disable @next/next/no-html-link-for-pages */
import { useState, type FormEvent } from "react";
import { BRAND_NAME } from "../../lib/brand";
import "./login.css";

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
    <div className="login-a">
      <div className="login-a-panel">
        <header className="login-a-brand">
          <h1 className="login-a-name">{BRAND_NAME}</h1>
          <p className="login-a-note">登录后即可进入手机审稿页审阅草稿</p>
        </header>
        <div className="login-a-double-rule" />
        <form onSubmit={submit} className="login-a-form">
          <div className="login-a-field">
            <label htmlFor="account" className="login-a-label">账号</label>
            <input
              id="account"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              autoComplete="username"
              required
              className="login-a-input"
            />
          </div>
          <div className="login-a-field">
            <label htmlFor="password" className="login-a-label">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="login-a-input"
            />
          </div>
          {error ? <p className="login-a-error">{error}</p> : null}
          <button type="submit" disabled={busy} className="login-a-submit">
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
        <div className="login-a-foot">
          <a href="/" className="login-a-back">← 返回首页</a>
        </div>
      </div>
    </div>
  );
}
