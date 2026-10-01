/**
 * 测试用 D1 适配器：用 node:sqlite 的 :memory: 数据库模拟 D1Database。
 *
 * 支持 prepare(sql).bind(...args) → { first(), all(), run() } 和 batch(statements)
 * （batch 用 BEGIN / COMMIT 包住，出错 ROLLBACK 后抛出）。
 */

import { DatabaseSync } from "node:sqlite";

export function createFakeD1(sqlite = new DatabaseSync(":memory:")) {
  function statement(sql) {
    let params = [];
    const bound = {
      bind(...args) {
        params = args;
        return bound;
      },
      async first() {
        const row = sqlite.prepare(sql).get(...params);
        return row === undefined ? null : row;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...params) };
      },
      async run() {
        return bound.runSync();
      },
      runSync() {
        const info = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
      },
      _sql: sql,
    };
    return bound;
  }

  return {
    sqlite,
    prepare: statement,
    // 和 D1 一样整批原子：同步执行，中间不让出事件循环，别的请求插不进来。
    async batch(statements) {
      sqlite.exec("BEGIN");
      const results = [];
      try {
        for (const item of statements) results.push(item.runSync());
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      return results;
    },
  };
}
