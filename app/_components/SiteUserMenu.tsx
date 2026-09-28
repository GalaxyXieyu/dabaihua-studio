"use client";

import { useEffect, useState } from "react";
import { Bell, CaretDown, SignOut, User } from "@phosphor-icons/react";

export type SiteUser = {
  id: number;
  account: string;
  nickname: string;
  avatarUrl: string | null;
  role: "user" | "admin" | string;
};

type Notification = {
  id: number;
  type: "annotation_reply" | "profile_message" | "profile_like" | string;
  actorNickname: string;
  actorAvatarUrl: string | null;
  isRead: number | boolean;
  createdAt: string;
};

const NOTIFICATION_TEXT: Record<string, string> = {
  annotation_reply: "回复了你的批注",
  profile_message: "给你的主页留言",
  profile_like: "赞了你的主页",
};

function when(value: string) {
  const timestamp = new Date(value).getTime();
  const elapsed = Date.now() - timestamp;
  if (!Number.isFinite(timestamp) || elapsed < 0) return "刚刚";
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function UserAvatar({ user, size }: { user: { nickname: string; avatarUrl: string | null }; size?: "small" }) {
  return (
    <span className={`user-avatar ${size ?? ""}`} aria-hidden="true">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user.nickname || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * 顶栏右侧账号区：通知 + 头像菜单。独立内容/成长子页共用，
 * 与 DeskApp 顶栏使用同一套 .global-user-wrap / .notification-menu 类名。
 */
export function SiteUserMenu({ user }: { user: SiteUser }) {
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".global-user-wrap")) {
        setNotificationOpen(false);
        setUserMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => {
      setLoading(true);
      fetch("/api/notifications", { cache: "no-store" })
        .then((response) => response.json() as Promise<{ notifications?: Notification[] }>)
        .then((data) => { if (active) setNotifications(data.notifications ?? []); })
        .catch(() => undefined)
        .finally(() => { if (active) setLoading(false); });
    };
    load();
    const timer = window.setInterval(load, 45_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  async function markAllRead() {
    if (!unreadCount) return;
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
    } catch {
      /* 静默失败，下次打开通知时重新拉取 */
    }
  }

  function openNotification(notification: Notification) {
    setNotificationOpen(false);
    if (notification.isRead) return;
    setNotifications((current) =>
      current.map((candidate) => (candidate.id === notification.id ? { ...candidate, isRead: true } : candidate)),
    );
    fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationId: notification.id }),
    }).catch(() => undefined);
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      window.location.href = "/login";
    } finally {
      setBusy(false);
    }
  }

  const account = user.nickname || user.account;

  return (
    <div className="global-user-wrap">
      <div className="global-notification-wrap">
        <button
          className={`global-notification ${notificationOpen ? "active" : ""}`}
          type="button"
          aria-label={unreadCount ? `通知，${unreadCount} 条未读` : "通知"}
          aria-expanded={notificationOpen}
          onClick={() => {
            setNotificationOpen((open) => !open);
            setUserMenuOpen(false);
          }}
        >
          <Bell size={18} weight={unreadCount ? "fill" : "regular"} aria-hidden="true" />
          {unreadCount > 0 && <span className="unread-dot" />}
        </button>
        {notificationOpen && (
          <div className="notification-menu" role="dialog" aria-label="通知">
            <header>
              <div>
                <strong>通知</strong>
                {unreadCount > 0 && <span>{unreadCount} 条未读</span>}
              </div>
              <button type="button" disabled={!unreadCount} onClick={markAllRead}>全部已读</button>
            </header>
            <div className="notification-list">
              {loading && notifications.length === 0 && <div className="notification-loading"><i /><i /><i /></div>}
              {!loading && notifications.length === 0 && <p className="notification-empty">暂时没有新消息</p>}
              {notifications.map((notification) => (
                <button
                  className={notification.isRead ? "read" : "unread"}
                  type="button"
                  key={notification.id}
                  onClick={() => openNotification(notification)}
                >
                  <UserAvatar user={{ nickname: notification.actorNickname, avatarUrl: notification.actorAvatarUrl }} size="small" />
                  <span>
                    <strong>{notification.actorNickname}</strong>
                    <small>{NOTIFICATION_TEXT[notification.type] ?? "有新的动态"}</small>
                    <time>{when(notification.createdAt)}</time>
                  </span>
                  {!notification.isRead && <em aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button
        className={`global-user ${unreadCount ? "has-unread" : ""}`}
        type="button"
        aria-expanded={userMenuOpen}
        onClick={() => {
          setUserMenuOpen((open) => !open);
          setNotificationOpen(false);
        }}
      >
        <UserAvatar user={user} size="small" />
        <span>{account}</span>
        <CaretDown size={11} weight="bold" aria-hidden="true" />
      </button>
      {userMenuOpen && (
        <div className="user-menu global-user-menu" role="menu">
          <a role="menuitem" href="/profile"><User size={15} aria-hidden="true" />个人主页</a>
          <button role="menuitem" type="button" disabled={busy} onClick={logout}><SignOut size={15} aria-hidden="true" />退出登录</button>
        </div>
      )}
    </div>
  );
}
