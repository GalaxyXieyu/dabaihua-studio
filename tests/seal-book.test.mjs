// 印谱式版面纯计算测试（seal-book.ts）：行均衡、半列居中、光学尺寸、中文数字、释文归类。
// SealBookGrid 只消费这些函数，所以这里不渲染 DOM。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BOOK,
  balancedRows,
  bookLayout,
  cnCount,
  cnDateText,
  eventCaption,
  opticalScale,
} from "../app/_components/seal/seal-book.ts";

// ---------- balancedRows：行数 = ceil(n/perRow)，相差最多 1，多的行在上 ----------

test("balancedRows：每行不超过 perRow，行与行最多差 1，多的行在上", () => {
  assert.deepEqual(balancedRows(1, 6), [1]);
  assert.deepEqual(balancedRows(3, 6), [3]);
  assert.deepEqual(balancedRows(6, 6), [6]);
  assert.deepEqual(balancedRows(7, 6), [4, 3]);
  assert.deepEqual(balancedRows(8, 6), [4, 4]);
  assert.deepEqual(balancedRows(12, 6), [6, 6]);
  assert.deepEqual(balancedRows(7, 3), [3, 2, 2]);
  assert.deepEqual(balancedRows(8, 3), [3, 3, 2]);
});

test("balancedRows：空集和越界输入", () => {
  assert.deepEqual(balancedRows(0, 6), []);
  for (const rows of [balancedRows(7, 6), balancedRows(8, 3)]) {
    for (const r of rows) assert.ok(r > 0, "不该出现空行");
  }
});

// ---------- bookLayout：半列网格，每行整行居中 ----------

test("bookLayout：7 per 6 → 8 列，上行 1/3/5/7，下行 2/4/6", () => {
  const { cols, cells } = bookLayout(7, 6);
  assert.equal(cols, 8);
  const byRow = (row) => cells.filter((c) => c.row === row).map((c) => c.col);
  assert.deepEqual(byRow(1), [1, 3, 5, 7]);
  assert.deepEqual(byRow(2), [2, 4, 6]);
  // 每行都居中：行首左侧留白 === 行尾右侧留白（半列数）
  for (const row of [1, 2]) {
    const cs = byRow(row);
    assert.equal(cs[0] - 1, cols - (cs[cs.length - 1] + 1));
  }
  // first 只标每行第一格
  assert.deepEqual(cells.filter((c) => c.first).map((c) => c.row), [1, 2]);
});

test("bookLayout：1 per 6 → 2 列，格在 1，跨 2 列居中", () => {
  const { cols, cells } = bookLayout(1, 6);
  assert.equal(cols, 2);
  assert.equal(cells.length, 1);
  assert.deepEqual(cells[0], { row: 1, col: 1, first: true });
});

test("bookLayout：整除时所有行同宽同位（8 per 6 → 4+4）", () => {
  const { cols, cells } = bookLayout(8, 6);
  assert.equal(cols, 8);
  const byRow = (row) => cells.filter((c) => c.row === row).map((c) => c.col);
  assert.deepEqual(byRow(1), [1, 3, 5, 7]);
  assert.deepEqual(byRow(2), [1, 3, 5, 7]);
});

// ---------- 光学尺寸 ----------

test("opticalScale：方章满白文最小，引首最大", () => {
  assert.ok(Math.abs(opticalScale("fang") - 0.92 * 0.96) < 1e-9);
  assert.equal(opticalScale("yuan"), 1);
  assert.equal(opticalScale("hulu"), 1.1);
  // 半通印本来就该比方章小一半，不再放大
  assert.equal(opticalScale("tuoyuan"), 1);
  assert.equal(opticalScale("yinshou"), 1.18);
});

test("BOOK：桌面 6×12、手机 3×9，孤品放大 1.35", () => {
  assert.deepEqual(BOOK.desktop, { perRow: 6, max: 12, cap: 124, imp: 56 });
  assert.deepEqual(BOOK.phone, { perRow: 3, max: 9, cap: 104, imp: 46 });
  assert.equal(BOOK.singleScale, 1.35);
});

// ---------- 中文数字 ----------

test("cnCount：一…十、十一…九十九", () => {
  assert.equal(cnCount(1), "一");
  assert.equal(cnCount(6), "六");
  assert.equal(cnCount(9), "九");
  assert.equal(cnCount(10), "十");
  assert.equal(cnCount(11), "十一");
  assert.equal(cnCount(19), "十九");
  assert.equal(cnCount(20), "二十");
  assert.equal(cnCount(21), "二十一");
  assert.equal(cnCount(30), "三十");
  assert.equal(cnCount(31), "三十一");
  assert.equal(cnCount(99), "九十九");
});

test("cnDateText：月、日都用中文（「近七日」格子的日期行）", () => {
  assert.equal(cnDateText("2026-10-03"), "十月三日");
  assert.equal(cnDateText("2026-12-31"), "十二月三十一日");
  assert.equal(cnDateText("2026-01-20"), "一月二十日");
  assert.equal(cnDateText("2026-10-10"), "十月十日");
  assert.equal(cnDateText("2026-01-01"), "一月一日");
});

// ---------- 释文归类 ----------

test("eventCaption：按键前缀归类，认不出的都叫盖章", () => {
  assert.equal(eventCaption("git:2026-10-03"), "提交");
  assert.equal(eventCaption("read:abc123"), "阅读");
  assert.equal(eventCaption("review:xyz"), "审稿");
  assert.equal(eventCaption("mirror:2026-10-04"), "照镜");
  assert.equal(eventCaption("note:whatever"), "盖章");
  assert.equal(eventCaption("unknown"), "盖章");
});
