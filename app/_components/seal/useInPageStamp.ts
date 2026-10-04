"use client";

// 页内当场盖章（规范第 0 节第 3 条、8.5、8.6 后三行）：阅读 / 审稿 / 镜子等
// 页内写操作成功后，立刻把章写进本设备的 seen 和 stampLog（今天页不再补盖、
// 明天进昨日回放），再按需加载播放器，在全局 stageLock 里演一次盖章。
// 任何异常都吞掉：印章绝不能影响主流程。
import { useCallback, useEffect, useRef, useState } from "react";
import { readStore, writeStore } from "./useSealQueue.ts";
import { recordInPageStamp, shanghaiDate } from "./seal-store.ts";
import { stageLock } from "./seal-lock.ts";
import type { SealKind } from "./seal-tokens.ts";
import type { PlayerCtx } from "./seal-player.ts";

export type InPageStampInput = { key: string; slotId?: string };

export type UseInPageStampResult = {
  /** 挂载时从 localStorage 读的 seen（读不到为空集合）；stamp 成功后同步更新 */
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

export function useInPageStamp(opts: { kind: SealKind; actorId: string; size: number }): UseInPageStampResult {
  const { kind, actorId, size } = opts;
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  // 回调里读最新 seen：挂载读取可能晚于第一次盖章，不能靠闭包里的 state
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // 挂载时读一次本设备的 seen（localStorage 不可用 → 空集合）
    try {
      const store = readStore();
      if (store && store.seen.length > 0) {
        const next = new Set(store.seen);
        seenRef.current = next;
        setSeen(next);
      }
    } catch {
      // 读不到就当空集合
    }
  }, []);

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
        const next = new Set(seenRef.current);
        next.add(input.key);
        seenRef.current = next;
        setSeen(next);

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
