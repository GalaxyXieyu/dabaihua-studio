// 一屏一个主动效（规范 7.4 第 8 条）：同屏同时最多演一段。
// 纯 TS，不碰 DOM，node 可测。stageLock 是页面全局唯一的一把锁，
// 后提交的 run 会排队等前一个结束（前一个抛错也放行），busy() 反映当前是否有一段在演。

export type StageLock = {
  run<T>(fn: () => Promise<T>): Promise<T>;
  busy(): boolean;
};

export function createStageLock(): StageLock {
  let tail: Promise<unknown> = Promise.resolve();
  // 排队中或执行中都算忙（一屏一个主动效：排队期间也不许开下一段）
  let pending = 0;

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      pending++;
      // 先等链尾落地（成败都放行），再执行本次 fn
      const turn = tail.then(
        () => undefined,
        () => undefined,
      );
      const p = turn.then(() => fn());
      // 链尾无论成败都接上下一个；调用者拿到的是带结果的原始 promise（会抛错）
      tail = p.then(
        () => {
          pending--;
        },
        () => {
          pending--;
        },
      );
      return p;
    },
    busy(): boolean {
      return pending > 0;
    },
  };
}

/** 页面全局唯一的锁：SealStage 的整次编排都跑在里面 */
export const stageLock = createStageLock();
