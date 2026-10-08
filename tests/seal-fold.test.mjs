// 规范 10.1「新盖的章」默认收起的测试：sheetOpen 存储、foldCountText、收起行源码结构。
// 数据全部虚构。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseStore, serializeStore, pruneStore, recordInPageStamp, markSeen, touchVisit,
  newDeviceStore, isSheetOpen, withSheetOpen,
} from "../app/_components/seal/seal-store.ts";

const TODAY = "2026-10-08";

// ---------- sheetOpen：parseStore ----------

test("parseStore 保留布尔 sheetOpen（true / false）", () => {
  const base = JSON.stringify({ firstSeenDate: "2026-09-01", seen: [], stampLog: [] });
  assert.equal(parseStore(`${base.slice(0, -1)},"sheetOpen":true}`).sheetOpen, true);
  assert.equal(parseStore(`${base.slice(0, -1)},"sheetOpen":false}`).sheetOpen, false);
});

test("parseStore 丢掉非布尔 sheetOpen（不写字段）", () => {
  for (const bad of [1, "true", null, {}]) {
    const base = JSON.stringify({ firstSeenDate: "2026-09-01", seen: [], stampLog: [] });
    const s = parseStore(`${base.slice(0, -1)},"sheetOpen":${JSON.stringify(bad)}}`);
    assert.ok(s);
    assert.equal("sheetOpen" in s, false);
  }
});

// ---------- isSheetOpen / withSheetOpen ----------

test("isSheetOpen：null 或缺字段 → false", () => {
  assert.equal(isSheetOpen(null), false);
  assert.equal(isSheetOpen(parseStore('{"firstSeenDate":"2026-09-01","seen":[],"stampLog":[]}')), false);
});

test("withSheetOpen：不可变，null 进 null 出", () => {
  const s = parseStore('{"firstSeenDate":"2026-09-01","seen":[],"stampLog":[]}');
  const open = withSheetOpen(s, true);
  assert.equal(open.sheetOpen, true);
  assert.equal(s.sheetOpen, undefined); // 原对象不动
  assert.equal(serializeStore(open).includes('"sheetOpen":true'), true);
  assert.equal(withSheetOpen(null, true), null);
});

// ---------- 其他函数不丢 sheetOpen ----------

test("pruneStore / touchVisit / markSeen / recordInPageStamp 之后 sheetOpen 还在", () => {
  const s = withSheetOpen(
    parseStore('{"firstSeenDate":"2026-09-01","seen":["git:2026-10-07"],"stampLog":[{"key":"read:x","seal":"yuan","at":"2026-10-07T10:00:00Z"}]}'),
    true,
  );
  assert.equal(pruneStore(s, TODAY).sheetOpen, true);
  assert.equal(touchVisit(s, { now: "2026-10-08T09:00:00+08:00", generatedAt: null }).sheetOpen, true);
  assert.equal(markSeen(s, ["git:2026-10-08"]).sheetOpen, true);
  assert.equal(
    recordInPageStamp(s, { key: "read:y", seal: "yuan", at: "2026-10-08T10:00:00Z" }, TODAY).sheetOpen,
    true,
  );
});

test("newDeviceStore 没有 sheetOpen（新设备 = 收起）", () => {
  assert.equal("sheetOpen" in newDeviceStore(["git:2026-10-08"], { today: TODAY, now: "2026-10-08T09:00:00+08:00", generatedAt: null }), false);
});

// ---------- foldCountText ----------

import { foldCountText, foldSlots } from "../app/_components/seal/seal-book.ts";

test("foldSlots：桌面 / 手机名额、隐藏与 +N（0 / 3 / 5 / 7 / 10 枚 × 有无昨日）", () => {
  // 0 枚：什么都不显示、不写 +N（昨日小印位占名额但不占事件）
  assert.deepEqual(foldSlots(0, false), { deskFrom: 0, phoneHideBefore: 0, plusD: 0, plusM: 0 });
  assert.deepEqual(foldSlots(0, true), { deskFrom: 0, phoneHideBefore: 0, plusD: 0, plusM: 0 });
  // 3 枚：桌面 / 手机名额内，全显示
  assert.deepEqual(foldSlots(3, false), { deskFrom: 0, phoneHideBefore: 0, plusD: 0, plusM: 0 });
  assert.deepEqual(foldSlots(3, true), { deskFrom: 0, phoneHideBefore: 0, plusD: 0, plusM: 0 });
  // 5 枚有昨日（审查例）：桌面名额 7 全显示，手机名额 3 藏前 2、+2 ——
  // 旧算法按名额差藏前 4 枚只剩 1 枚，就是这条要抓的错
  assert.deepEqual(foldSlots(5, true), { deskFrom: 0, phoneHideBefore: 2, plusD: 0, plusM: 2 });
  // 7 枚：无昨日全显示；有昨日手机藏前 4、+4
  assert.deepEqual(foldSlots(7, false), { deskFrom: 0, phoneHideBefore: 3, plusD: 0, plusM: 3 });
  assert.deepEqual(foldSlots(7, true), { deskFrom: 0, phoneHideBefore: 4, plusD: 0, plusM: 4 });
  // 10 枚：桌面各取最近名额枚，剩下的写 +N；phoneHideBefore 相对 slice 之后的 foldEvents（fix2）
  assert.deepEqual(foldSlots(10, false), { deskFrom: 2, phoneHideBefore: 4, plusD: 2, plusM: 6 });
  assert.deepEqual(foldSlots(10, true), { deskFrom: 3, phoneHideBefore: 4, plusD: 3, plusM: 7 });
});

test("foldSlots 不变式：手机实际显示 = min(total, 手机名额)，桌面 = min(total, 桌面名额)", () => {
  for (let total = 0; total <= 20; total++) {
    for (const hasYday of [false, true]) {
      const r = foldSlots(total, hasYday);
      const deskSlots = hasYday ? 7 : 8;
      const phoneSlots = hasYday ? 3 : 4;
      assert.equal(
        (total - r.deskFrom) - r.phoneHideBefore,
        Math.min(total, phoneSlots),
        `total=${total} hasYday=${hasYday}: 手机实际显示枚数应等于 min(total, 手机名额)`,
      );
      assert.equal(
        total - r.deskFrom,
        Math.min(total, deskSlots),
        `total=${total} hasYday=${hasYday}: 桌面实际渲染枚数应等于 min(total, 桌面名额)`,
      );
    }
  }
});

test("foldCountText：空 / 单一种 / 多种", () => {
  assert.equal(foldCountText([]), "近七日 · 还没有章");
  assert.equal(foldCountText(["fang", "fang", "fang", "fang", "fang"]), "近七日 · 五枚");
  const mixed = ["fang", "fang", "fang", "yuan", "hulu", "tuoyuan", "tuoyuan"];
  assert.equal(foldCountText(mixed), "事 3 · 习 1 · 力 1 · 日 2");
});

test("foldCountText：顺序固定，输入乱序结果一样", () => {
  const shuffled = ["tuoyuan", "hulu", "yuan", "fang", "fang", "tuoyuan", "fang"];
  assert.equal(foldCountText(shuffled), "事 3 · 习 1 · 力 1 · 日 2");
});

test("foldCountText：收官字样", () => {
  assert.equal(foldCountText(["yinshou", "fang"]), "事 1 · 收官 1");
});

// ---------- 源码结构（规范 10.1） ----------

const TODAY_SEALS = readFileSync(new URL("../app/_components/seal/TodaySeals.tsx", import.meta.url), "utf8");

test("TodaySeals：整行一个 disclosure 按钮，h2 包 button，按钮里没有链接", () => {
  assert.match(TODAY_SEALS, /<h2[^>]*>\s*<button/);
  assert.ok(TODAY_SEALS.includes("aria-expanded={open}"));
  assert.ok(TODAY_SEALS.includes('aria-controls="seal-fold-sheet"'));
  assert.ok(TODAY_SEALS.includes('id="seal-fold-sheet"'));
  assert.ok(TODAY_SEALS.includes('open ? "收起" : "展开"'), "展开 / 收起文案");
  const btn = /<button[^>]*>([\s\S]*?)<\/button>/.exec(TODAY_SEALS)?.[1] ?? "";
  assert.ok(btn.length > 0, "应找到按钮块");
  assert.ok(!btn.includes("<a "), "按钮里不能嵌链接");
});

test("TodaySeals：seal-yesterday-card 按收起 / 展开二选一", () => {
  // 收起时 id 给小印位；展开时小印位不写 id，大卡在展开区里带 id
  assert.ok(TODAY_SEALS.includes('id={open ? undefined : "seal-yesterday-card"}'));
  const sheetBlock = /id="seal-fold-sheet"[\s\S]*/.exec(TODAY_SEALS)?.[0] ?? "";
  assert.ok(/\{open && cardState !== "hidden"[\s\S]*?id="seal-yesterday-card"/.test(sheetBlock), "大卡只在展开时渲染");
  assert.ok(/\{open && stripState !== "hidden"[\s\S]*?seal-strip-/.test(sheetBlock), "印条只在展开时渲染");
});

test("SealBookGrid 有 withIds；StampSlot 的 targetId 可选", () => {
  const grid = readFileSync(new URL("../app/_components/seal/SealBookGrid.tsx", import.meta.url), "utf8");
  assert.ok(grid.includes("withIds?: boolean"));
  assert.ok(grid.includes("targetId={withIds ? item.targetId : undefined}"));
  const slot = readFileSync(new URL("../app/_components/seal/StampSlot.tsx", import.meta.url), "utf8");
  assert.ok(/targetId\?:\s*string/.test(slot), "targetId 应是可选属性");
});

test("SealStage 在 strip 缺失时调用 playBow；seal-player 有 seal-fold-yday 分支", () => {
  const stage = readFileSync(new URL("../app/_components/seal/SealStage.tsx", import.meta.url), "utf8");
  assert.ok(stage.includes("await playBow(actor, stampSize, ctx)"), "印条不在时角色照常鞠躬");
  assert.ok(stage.includes('"seal-strip-"'));
  const player = readFileSync(new URL("../app/_components/seal/seal-player.ts", import.meta.url), "utf8");
  assert.ok(player.includes('seal-fold-yday'), "回放收进小印位的分支");
  assert.ok(/card\.classList\.contains\("seal-fold-yday"\)/.test(player));
});

test("seal.css：seal-fold 一组存在，无阴影 / 渐变", () => {
  const css = readFileSync(new URL("../app/_components/seal/seal.css", import.meta.url), "utf8");
  assert.ok(/\.seal-fold-bar \{/.test(css));
  assert.ok(/\.seal-fold-bar \{[\s\S]*?height: 48px/.test(css), "收起行高 48px");
  assert.ok(/\.seal-fold-bar \{[\s\S]*?var\(--canvas/.test(css), "底色用 --canvas（不用 --paper）");
  const phone = [...css.matchAll(/@media \(max-width: 640px\)\s*\{([\s\S]*?)(?=@media|$)/g)].map((m) => m[1]).join("\n");
  assert.ok(/\.seal-fold-bar \{[\s\S]*?height: 64px/.test(phone), "手机整块高 64px");
  // 新增部分只有发丝线，没有阴影 / 渐变
  const foldBlock = /\/\* ---------- 收起那一行[\s\S]*?\/\* ---------- 昨日纸/.exec(css)?.[0] ?? "";
  assert.ok(foldBlock.length > 0, "应找到 seal-fold 新增段");
  assert.ok(!foldBlock.includes("box-shadow"));
  assert.ok(!/gradient/.test(foldBlock));
  // 审查第 2-5 条：无 border-top（紧贴刊头双线）；收起时下一条 .td-a-row 去掉 border-top（不双线）；
  // 展开时 marks 不占位；手机不用 gap 简写（会覆盖 row-gap）
  const barBlock = /\.seal-fold-bar \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.ok(!/border-top:/.test(barBlock), "收起行不该有 border-top（刊头双线是上边界）");
  assert.ok(css.includes('.seal-fold[data-open="false"] + .td-a-row {\n  border-top: 0;\n}'));
  assert.ok(css.includes('.seal-fold[data-open="true"] .seal-fold-marks {\n  display: none;\n}'));
  const barPhone = /\.seal-fold-bar \{[^}]*\}/.exec(phone)?.[0] ?? "";
  assert.ok(!/(?<![a-z-])gap:/.test(barPhone), "手机规则不该用 gap 简写覆盖 row-gap");
  assert.ok(/column-gap: 12px/.test(barPhone), "手机列间距 12px");
  // TodaySeals 用 foldSlots 算名额 / 隐藏 / +N（不再自己拍脑袋）
  assert.ok(TODAY_SEALS.includes("foldSlots("));
  assert.ok(TODAY_SEALS.includes("fold.phoneHideBefore"));
  assert.ok(TODAY_SEALS.includes("fold.deskFrom"));
});
