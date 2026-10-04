"use client";

// 页内当场盖章（规范第 0 节第 3 条、8.5、8.6 后三行）：阅读 / 审稿 / 镜子等
// 页内写操作成功后，立刻把章写进本设备的 seen 和 stampLog（今天页不再补盖、
// 明天进昨日回放），再按需加载播放器，在全局 stageLock 里演一次盖章。
// 任何异常都吞掉：印章绝不能影响主流程。
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { readStore, writeStore } from "./useSealQueue.ts";
import { STORE_KEY, parseStore, recordInPageStamp, shanghaiDate } from "./seal-store.ts";
import { stageLock } from "./seal-lock.ts";
import type { SealKind } from "./seal-tokens.ts";
import type { PlayerCtx } from "./seal-player.ts";

export type InPageStampInput = { key: string; slotId?: string };

export type UseInPageStampResult = {
  /** 从 localStorage 订阅的 seen（读不到为空集合）；stamp 成功后同步更新 */
  seen: Set<string>;
  /** 在页内写操作的成功回调里调用；key 已盖过直接 resolve（不重盖，规范 8.6） */
  stamp(input: InPageStampInput): Promise<void>;
};

/** 印位不在页面上时给 playStamp 的临时离屏印位：印痕落在屏幕外，只让角色做动作 */
function tempOffscreenSlot(size: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "seal-slot";
  el.dataset.state = "pending";
  el.setAttribute("aria-hidden", "true");
  el.style.position = "fixed";
  el.style.left = `-${size + 8}px`;
  el.style.top = `-${size + 8}px`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  document.body.appendChild(el);
  return el;
}

// ---------- seen 的 external store：读 localStorage 原始字符串 + 模块级缓存 ----------
// useSyncExternalStore 每次渲染都会调 getSnapshot：原始字符串没变就必须返回同一个
// Set，否则会无限重渲染；缓存放在模块级，同页多个 hook 实例共享。

/** 服务端快照和“读不到”时的空集合常量 */
const EMPTY_SEEN: Set<string> = new Set<string>();
/** 本模块的订阅者：stamp 写回后手动通知（storage 事件只在别的标签页触发） */
const seenListeners = new Set<() => void>();
// 上次读到的原始字符串和解析出的 Set（模块级缓存）
let seenRaw: string | null = null;
let seenCache: Set<string> = EMPTY_SEEN;

/** 解析原始字符串里的 seen；没有数据 / 坏 JSON 都返回空集合常量 */
function parseSeen(raw: string | null): Set<string> {
  if (raw == null) return EMPTY_SEEN;
  try {
    const store = parseStore(raw);
    if (store && store.seen.length > 0) return new Set(store.seen);
  } catch {
    // 坏 JSON 当空集合
  }
  return EMPTY_SEEN;
}

/** 客户端快照：读原始字符串，没变就返回上次缓存的同一个 Set */
function getSeenSnapshot(): Set<string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORE_KEY);
  } catch {
    // localStorage 本身不可用：返回当前缓存（初始为空集合；本会话盖过的章仍在内存里）
    return seenCache;
  }
  if (raw === seenRaw) return seenCache;
  seenRaw = raw;
  seenCache = parseSeen(raw);
  return seenCache;
}

/** 服务端快照：恒为空集合常量（localStorage 只在客户端） */
function getSeenServerSnapshot(): Set<string> {
  return EMPTY_SEEN;
}

/** 订阅：本标签页由 notifySeen 通知，别的标签页由 window 的 storage 事件通知 */
function subscribeSeen(onStoreChange: () => void): () => void {
  seenListeners.add(onStoreChange);
  const onStorage = (): void => {
    onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    seenListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** stamp 写回 localStorage 之后调用：让所有订阅者重读快照 */
function notifySeen(): void {
  for (const listener of seenListeners) listener();
}

export function useInPageStamp(opts: { kind: SealKind; actorId: string; size: number }): UseInPageStampResult {
  const { kind, actorId, size } = opts;
  // seen 直接订阅 localStorage：渲染时同步读到最新值，stamp 写回后自动更新
  const seen = useSyncExternalStore(subscribeSeen, getSeenSnapshot, getSeenServerSnapshot);
  // 回调里读最新 seen：stamp 是 memoized 的，不能靠闭包里的 state
  const seenRef = useRef<Set<string>>(EMPTY_SEEN);
  useEffect(() => {
    seenRef.current = seen;
  }, [seen]);

  const stamp = useCallback(
    async (input: InPageStampInput): Promise<void> => {
      try {
        if (seenRef.current.has(input.key)) return; // 已盖过，不重盖
        // 当场写进 seen 和 stampLog：今天页的补盖会跳过、明天进昨日回放（规范 8.6）
        const store = recordInPageStamp(
          readStore(),
          { key: input.key, seal: kind, at: new Date().toISOString() },
          shanghaiDate(new Date()),
        );
        writeStore(store);
        // 模块缓存同步前进并通知订阅者（storage 事件不会在本标签页触发）；
        // 写失败时内存里也要前进，本会话仍能看到这枚章（与原实现一致）
        try {
          seenRaw = window.localStorage.getItem(STORE_KEY);
        } catch {
          // 读不回就维持原 raw，只用缓存
        }
        seenCache = new Set(store.seen);
        seenRef.current = seenCache;
        notifySeen();

        const player = await import("./seal-player"); // 按需加载，不进首屏包
        await stageLock.run(async () => {
          const actor = document.getElementById(actorId);
          if (!actor) return; // 角色不在页面上：数据已记录，只跳过演出
          const signal = new AbortController().signal;
          const ctx: PlayerCtx = { signal, reduced: player.prefersReducedMotion(), track: (a) => a };
          const slot = input.slotId ? document.getElementById(input.slotId) : null;
          const temp = slot ? null : tempOffscreenSlot(size);
          try {
            const target = slot ?? temp;
            if (target) {
              await player.playStamp(
                actor,
                target,
                { kind, streak: store.streak ?? 1, size, spread: true, nod: true },
                ctx,
              );
            }
          } finally {
            temp?.remove();
          }
        });
      } catch (error) {
        console.warn("seal inpage stamp skipped", error);
      }
    },
    [kind, actorId, size],
  );

  return { seen, stamp };
}
