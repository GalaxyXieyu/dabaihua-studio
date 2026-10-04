// 印章 IP 静态组件测试（seal-svg 字符串真源 / Seal / StampMark / StampSlot / seal.css / 导航方章）。
// 核心断言：角色和 phase-1 印痕的 svg/ 目录几何逐字出现在 sealSvg / markSvg 的输出里；
// v3 定稿印痕（fang/yuan/hulu/yinshou）的 svg/v3/ 几何逐字出现在输出里，
// id 加 prefix 后不重复、url(#) 引用有效、没有 <style> 块和 emoji。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cssId, markSvg, sealSvg } from "../app/_components/seal/seal-svg.ts";
import { SEAL_KINDS } from "../app/_components/seal/seal-tokens.ts";
import { V3_MARKS } from "../app/_components/seal/seal-marks-v3.ts";
import { renderSealMarksModule } from "../scripts/gen-seal-marks.mjs";

const SVG_DIR = new URL("../app/_components/seal/svg/", import.meta.url);
const read = (name) => readFileSync(new URL(name, SVG_DIR), "utf8");
const V3_DIR = new URL("v3/", SVG_DIR);
const readV3 = (name) => readFileSync(new URL(name, V3_DIR), "utf8");
// 已接入 v3 定稿印痕的 kind；其余（tuoyuan）仍走 phase-1
const V3_KINDS = SEAL_KINDS.filter((k) => V3_MARKS[k]);

// emoji 粗查（含常见区块；印章图形只用 ASCII 路径，不该出现任何 emoji）
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

// ---------- 几何逐字对照 ----------

test("五个角色文件的每个 d 路径都能在 sealSvg 输出里找到", () => {
  for (const kind of SEAL_KINDS) {
    const file = read(`${kind}.svg`);
    const out = sealSvg(kind, { size: 48, prefix: "test" });
    const ds = [...file.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ds.length >= 4, `${kind}.svg 应有多条路径`);
    for (const d of ds) assert.ok(out.includes(`d="${d}"`), `${kind} 缺少路径 ${d}`);
  }
});
test("五个角色文件的 circle/rect 几何属性都能在 sealSvg 输出里找到", () => {
  for (const kind of SEAL_KINDS) {
    const file = read(`${kind}.svg`);
    const out = sealSvg(kind, { size: 48, prefix: "test" });
    // 抽出标签的几何属性（保持文件里的出现顺序），拼成子串比对
    const tags = [...file.matchAll(/<(circle|rect|ellipse)((?:\s+[a-zA-Z:.-]+="[^"]*")*)\s*\/>/g)];
    for (const [, tag, attrs] of tags) {
      const geo = [...attrs.matchAll(/\s+([a-zA-Z:.-]+)="([^"]*)"/g)]
        .filter(([, k]) => ["cx", "cy", "r", "rx", "ry", "x", "y", "width", "height"].includes(k))
        .map(([, k, v]) => `${k}="${v}"`)
        .join(" ");
      assert.ok(geo, `${kind}.svg 的 <${tag}> 应有几何属性`);
      assert.ok(out.includes(geo), `${kind} 缺少 <${tag}> ${geo}`);
    }
  }
});

test("phase-1 印痕（未接 v3 的 kind）的每个 d 路径和几何属性都能在 markSvg 输出里找到", () => {
  for (const kind of SEAL_KINDS.filter((k) => !V3_MARKS[k])) {
    const file = read(`stamp-mark-${kind}.svg`);
    const out = markSvg(kind, { size: 48, prefix: "test" });
    for (const m of file.matchAll(/\sd="([^"]+)"/g)) {
      assert.ok(out.includes(`d="${m[1]}"`), `mark-${kind} 缺少路径 ${m[1]}`);
    }
    for (const t of file.matchAll(/<(circle|rect|ellipse)((?:\s+[a-zA-Z:.-]+="[^"]*")*)\s*\/>/g)) {
      const geo = [...t[2].matchAll(/\s+([a-zA-Z:.-]+)="([^"]*)"/g)]
        .filter(([, k]) => ["cx", "cy", "r", "rx", "ry", "x", "y", "width", "height"].includes(k))
        .map(([, k, v]) => `${k}="${v}"`)
        .join(" ");
      assert.ok(geo && out.includes(geo), `mark-${kind} 缺少 ${geo}`);
    }
  }
});

// ---------- v3 最终印痕 ----------

test("v3 印痕：大文件路径都在 size 48 输出里，小文件路径都在 size 24 输出里且无 filter", () => {
  for (const kind of V3_KINDS) {
    const large = readV3(`stamp-mark-${kind}.svg`);
    const small = readV3(`stamp-mark-${kind}-small.svg`);
    const out48 = markSvg(kind, { size: 48, prefix: "t" });
    const out24 = markSvg(kind, { size: 24, prefix: "t" });
    assert.ok(out48.includes('width="48" height="48"'));
    assert.ok(out24.includes('width="24" height="24"'));
    assert.ok(out48.includes('aria-hidden="true"'));
    assert.ok(out48.includes('focusable="false"'));
    assert.ok(out48.includes('class="seal-mark-svg"'));
    assert.notEqual(out48, out24, `${kind} 大小两档输出应不同`);
    for (const m of large.matchAll(/\sd="([^"]+)"/g)) {
      assert.ok(out48.includes(`d="${m[1]}"`), `v3 large ${kind} 缺少路径 ${m[1]}`);
    }
    for (const m of small.matchAll(/\sd="([^"]+)"/g)) {
      assert.ok(out24.includes(`d="${m[1]}"`), `v3 small ${kind} 缺少路径 ${m[1]}`);
    }
    // 小尺寸（<= 28）用干净版：不带纹理 filter
    assert.ok(!out24.includes("<filter"), `v3 small ${kind} 不该有 filter`);
    // title 插在开标签后面
    const titled = markSvg(kind, { size: 48, prefix: "t", title: "印痕<方章>" });
    assert.ok(titled.includes("<title>印痕&lt;方章&gt;</title>"));
  }
});

test("v3 印痕的 id 都带 prefix，两个 prefix 无交集，url(#) 引用都在同一字符串里", () => {
  for (const kind of V3_KINDS) {
    for (const size of [48, 24]) {
      const a = markSvg(kind, { size, prefix: "pa" });
      const b = markSvg(kind, { size, prefix: "pb" });
      const ia = [...a.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      assert.ok(ia.length >= 1, `${kind} 应至少有一个 id`);
      for (const id of ia) assert.ok(id.startsWith("pa-"), `${kind} id ${id} 应带 prefix`);
      const ib = new Set([...b.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      assert.equal(ia.filter((x) => ib.has(x)).length, 0, `${kind} 两个 prefix 的 id 有交集`);
      const ids = new Set(ia);
      for (const ref of a.matchAll(/url\(#([^)]+)\)/g)) {
        assert.ok(ids.has(ref[1]), `${kind} 引用了不存在的 id ${ref[1]}`);
      }
    }
  }
});

test("v3 印痕 dry 用 --seal-dry，不再有 --seal-red", () => {
  for (const kind of V3_KINDS) {
    for (const size of [48, 24]) {
      const dry = markSvg(kind, { size, prefix: "t", dry: true });
      assert.ok(dry.includes("var(--seal-dry,#906752)"), `${kind} size ${size} 缺 dry 色`);
      assert.ok(!dry.includes("var(--seal-red"), `${kind} size ${size} dry 后不该有 seal-red`);
    }
  }
});

test("tuoyuan 印痕（带/不带 date）仍是 phase-1 输出，逐字不变", () => {
  const noDate = markSvg("tuoyuan", { size: 48, prefix: "t" });
  assert.equal(
    noDate,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false" class="seal-mark-svg"><g id="t-impression"><ellipse style="fill:none;stroke:var(--seal-red,#B23A2B);stroke-width:2.5;stroke-linejoin:round" cx="24" cy="24" rx="17.75" ry="12.75"/><g id="t-glyph" style="fill:none;stroke:var(--seal-red,#B23A2B);stroke-width:2;stroke-linecap:square;stroke-linejoin:miter"><path d="M17.5 16.5H30.5V31.5H17.5ZM17.5 24H30.5"/></g></g></svg>',
  );
  const withDate = markSvg("tuoyuan", { size: 48, prefix: "t", date: "10·03" });
  assert.equal(
    withDate,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false" class="seal-mark-svg"><g id="t-impression"><ellipse style="fill:none;stroke:var(--seal-red,#B23A2B);stroke-width:2.5;stroke-linejoin:round" cx="24" cy="24" rx="17.75" ry="12.75"/><g id="t-glyph" style="fill:none;stroke:var(--seal-red,#B23A2B);stroke-width:1.75;stroke-linecap:square;stroke-linejoin:miter"><path transform="translate(10.9 19.5)" d="M1 1.4L2.25 0V9"/><path transform="translate(17.2 19.5)" d="M0 0H4.5V9H0Z"/><path transform="translate(23.5 19.5)" d="M0.5 4.5H0.5"/><path transform="translate(26.3 19.5)" d="M0 0H4.5V9H0Z"/><path transform="translate(32.6 19.5)" d="M0 0H4.5V9H0M0 4.5H4.5"/></g></g></svg>',
  );
  // 带字母 glyph 的旧占位几何（重刻前保持不变）
  assert.ok(noDate.includes('d="M17.5 16.5H30.5V31.5H17.5ZM17.5 24H30.5"'));
});

test("seal-marks-v3.ts 与 svg/v3/ 源文件同步（renderSealMarksModule 重放一致）", () => {
  const files = {};
  for (const kind of SEAL_KINDS) {
    try {
      files[kind] = {
        large: readV3(`stamp-mark-${kind}.svg`),
        small: readV3(`stamp-mark-${kind}-small.svg`),
      };
    } catch {
      // 还没定稿的 kind（两个文件缺一）跳过
    }
  }
  const committed = readFileSync(new URL("../app/_components/seal/seal-marks-v3.ts", import.meta.url), "utf8");
  assert.equal(renderSealMarksModule(files), committed, "seal-marks-v3.ts 与 svg/v3/ 不同步，跑 npm run seal:marks");
});

// ---------- id 前缀与引用 ----------

test("同一个 kind 两个 prefix 的 id 不重复", () => {
  for (const kind of SEAL_KINDS) {
    const a = sealSvg(kind, { size: 48, prefix: "p1" });
    const b = sealSvg(kind, { size: 48, prefix: "p2" });
    const ids = (s) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const ia = ids(a), ib = ids(b);
    assert.ok(ia.length >= 4);
    assert.equal(ia.filter((x) => ib.includes(x)).length, 0, `${kind} 两份输出 id 有交集`);
  }
  const a = markSvg("fang", { size: 48, prefix: "p1" });
  const b = markSvg("fang", { size: 48, prefix: "p2" });
  assert.notEqual(a, b);
});

test("输出里所有 url(#x) 都指向输出里存在的 id，且带 prefix", () => {
  for (const kind of SEAL_KINDS) {
    // 角色 SVG 用 clipPath，印痕不用；两份都检查引用有效性
    const actor = sealSvg(kind, { size: 48, prefix: "t" });
    const actorRefs = [...actor.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(actorRefs.length >= 1, `${kind} 角色应有 clipPath 引用`);
    for (const out of [actor, markSvg(kind, { size: 48, prefix: "t" })]) {
      const ids = new Set([...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      for (const ref of out.matchAll(/url\(#([^)]+)\)/g)) {
        assert.ok(ids.has(ref[1]), `${kind} 引用了不存在的 id ${ref[1]}`);
        assert.ok(ref[1].startsWith("t-"), `id ${ref[1]} 应带 prefix`);
      }
    }
  }
});

test("cssId 把 useId 的非法字符清掉", () => {
  assert.match(cssId(":r1:"), /^[a-zA-Z0-9_-]+$/);
  assert.equal(cssId(":r12:"), "r12");
  assert.equal(cssId("«r1»"), "r1");
  assert.match(cssId(""), /^[a-zA-Z0-9_-]+$/);
});

// ---------- 结构约束 ----------

test("输出里没有 <style 块，没有 emoji", () => {
  for (const kind of SEAL_KINDS) {
    for (const out of [sealSvg(kind, { size: 48, prefix: "t" }), markSvg(kind, { size: 48, prefix: "t", tier: 3 })]) {
      assert.ok(!out.includes("<style"), `${kind} 不该有 style 块`);
      assert.ok(!EMOJI_RE.test(out), `${kind} 输出里有 emoji`);
    }
  }
});

test("角色 SVG 的尺寸、class 和分层 id", () => {
  const out = sealSvg("fang", { size: 24, prefix: "t" });
  assert.ok(out.includes('viewBox="0 0 48 48"'));
  assert.ok(out.includes('width="24" height="24"'));
  assert.ok(out.includes('class="seal-svg"'));
  assert.ok(out.includes('aria-hidden="true"'));
  assert.ok(out.includes('focusable="false"'));
  assert.ok(out.includes('id="t-body"'));
  assert.ok(out.includes('class="seal-face"'));
  assert.ok(out.includes('id="t-outline"'));
  assert.equal((out.match(/class="seal-eye"/g) || []).length, 2);
  assert.ok(out.includes('clip-path="url(#t-fang-clip)"'));
  // 颜色走 CSS 变量带回退
  assert.ok(out.includes("var(--seal-body,#FBF8F1)"));
  assert.ok(out.includes("var(--seal-red,#B23A2B)"));
  assert.ok(out.includes("var(--seal-line,#1B1915)"));
  assert.ok(out.includes("var(--seal-stroke,1.5)"));
  // 单色：印身透明、线和印面同色
  const mono = sealSvg("fang", { size: 24, prefix: "t", mono: true });
  assert.ok(mono.includes("fill:transparent"));
  assert.equal((mono.match(/var\(--seal-line/g) || []).length, 0, "mono 不该再用 --seal-line");
});

// ---------- 印痕档位 ----------

test("tier 0 没有纸色线，tier 1/2/3 的段数递增（1/2/4）", () => {
  const t0 = markSvg("fang", { size: 48, prefix: "t" });
  assert.ok(!t0.includes("var(--paper"));
  const t1 = markSvg("fang", { size: 48, prefix: "t", tier: 1 });
  assert.ok(t1.includes('stroke="var(--paper,#FBF8F1)"') || t1.includes("var(--paper,#FBF8F1)"));
  const segs = (s) => (s.match(/M/g) || []).length;
  const paper = (s) => [...s.matchAll(/<path style="fill:none;stroke:var\(--paper,#FBF8F1\);stroke-width:1\.2" d="([^"]+)"\/>/g)].map((m) => m[1]).join("");
  assert.equal(segs(paper(t1)), 1);
  const t2 = markSvg("fang", { size: 48, prefix: "t", tier: 2 });
  assert.equal(segs(paper(t2)), 2);
  const t3 = markSvg("fang", { size: 48, prefix: "t", tier: 3 });
  assert.equal(segs(paper(t3)), 4);
  assert.ok(paper(t3).includes("M9 30L15 24M33 12L39 8M30 40L36 36M8 14L12 11"));
});

test("dry 用 --seal-dry，正常印痕用 --seal-red", () => {
  const dry = markSvg("yuan", { size: 48, prefix: "t", dry: true });
  assert.ok(dry.includes("var(--seal-dry,#906752)"));
  assert.ok(!dry.includes("var(--seal-red"));
  const wet = markSvg("yuan", { size: 48, prefix: "t" });
  assert.ok(wet.includes("var(--seal-red,#B23A2B)"));
  assert.ok(!wet.includes("var(--seal-dry"));
  // phase-1 印痕（tuoyuan）笔画 2、边框 2.5 的老规格不变
  const p1 = markSvg("tuoyuan", { size: 48, prefix: "t" });
  assert.ok(p1.includes("stroke-width:2.5"));
  assert.ok(p1.includes("stroke-width:2;"));
  // v3 印痕的笔画宽度来自源文件（yuan 大号 2.4/1.9），不应被改写
  assert.ok(wet.includes("stroke-width:2.4"));
  assert.ok(wet.includes("stroke-width:1.9"));
});

// ---------- 日期章 ----------

test("markSvg 的日期章和样张的 5 个 translate 数值一致", () => {
  const out = markSvg("tuoyuan", { size: 48, prefix: "t", date: "10·03" });
  assert.ok(out.includes('class="seal-mark-svg"'));
  const got = [...out.matchAll(/translate\(([\d.]+) ([\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(got.length, 5);
  const refFile = read("stamp-mark-date-example.svg");
  const ref = [...refFile.matchAll(/translate\(([\d.]+) ([\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(ref.length, 5);
  for (let i = 0; i < 5; i++) assert.deepEqual(got[i], ref[i]);
  // 框不变（椭圆），笔画 1.75
  assert.ok(out.includes('rx="17.75" ry="12.75"'));
  assert.ok(out.includes("stroke-width:1.75"));
  // 样张的数字路径也在输出里
  for (const m of refFile.matchAll(/\sd="(M[^"]+)"/g)) assert.ok(out.includes(`d="${m[1]}"`));
  // date 只给 tuoyuan 用：别的 kind 传 date 也不该出现 translate
  const other = markSvg("fang", { size: 48, prefix: "t", date: "10·03" });
  assert.ok(!other.includes("translate("));
});

// ---------- favicon ----------

test("public/favicon.svg 与组件目录的 favicon.svg 内容相同", () => {
  const pub = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
  assert.equal(pub, read("favicon.svg"));
  // 由 v3 小号方章独立成文件：无 CSS 变量、颜色写死、带 superme 标题
  assert.ok(!pub.includes("var("), "favicon 不该有 CSS 变量");
  assert.ok(pub.includes("#B23A2B"));
  assert.ok(pub.includes('<title>superme · 方章白文 · 事</title>'));
  assert.ok(pub.includes('role="img"'));
  assert.ok(pub.includes('aria-label="superme"'));
  assert.ok(pub.includes('width="48" height="48"'));
  assert.ok(!pub.includes("aria-hidden"), "favicon 不该藏起来");
  // 路径与 v3 小号方章逐字一致
  const small = readV3("stamp-mark-fang-small.svg");
  for (const m of small.matchAll(/\sd="([^"]+)"/g)) {
    assert.ok(pub.includes(`d="${m[1]}"`), `favicon 缺少路径 ${m[1]}`);
  }
});

// ---------- 源码断言（导航方章 / 服务端组件 / css 接入） ----------

test("SiteAppBar 和 DeskApp 的 global-brand 里放了 24px 方章", () => {
  for (const f of ["app/_components/SiteAppBar.tsx", "app/_components/DeskApp.tsx"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(src.includes('<Seal kind="fang" size={24} pose="stamped" />'), `${f} 缺少导航方章`);
    assert.ok(src.includes('className="global-brand"'));
  }
});

test("Seal / StampMark / StampSlot 都是服务端组件（没有 use client）", () => {
  for (const f of ["Seal.tsx", "StampMark.tsx", "StampSlot.tsx", "index.ts"]) {
    const src = readFileSync(new URL(`../app/_components/seal/${f}`, import.meta.url), "utf8");
    assert.ok(!src.includes('"use client"'), `${f} 不该是客户端组件`);
  }
});

test("layout.tsx 在 globals.css 之后 import 了 seal.css", () => {
  const src = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const gi = src.indexOf('import "./globals.css";');
  const si = src.indexOf('import "./_components/seal/seal.css";');
  assert.ok(gi >= 0, "globals.css import 缺失");
  assert.ok(si > gi, "seal.css 应在 globals.css 之后");
});

test("seal.css：变量、姿态、reduced-motion、收起态隐藏方章", () => {
  const css = readFileSync(new URL("../app/_components/seal/seal.css", import.meta.url), "utf8");
  assert.ok(!EMOJI_RE.test(css), "seal.css 里有 emoji");
  for (const v of ["--seal-red: #B23A2B", "--seal-dry: #906752", "--seal-body: #FBF8F1", "--seal-line: #1B1915"]) {
    assert.ok(css.includes(v), `seal.css 缺少 ${v}`);
  }
  assert.ok(css.includes("transform-origin:50% 92%") || css.includes("transform-origin: 50% 92%"));
  assert.ok(css.includes('[data-pose="idle"]'));
  assert.ok(css.includes('[data-pose="pending"]'));
  assert.ok(css.includes('[data-pose="rest"]'));
  assert.ok(css.includes('[data-pose="offline"]'));
  assert.ok(css.includes("seal-breath-idle"));
  assert.ok(css.includes("3400ms"));
  assert.ok(css.includes("4800ms"));
  assert.ok(css.includes('[data-state="pending"]::before'));
  assert.ok(css.includes("html[data-seal-paused] .seal-breath"));
  assert.ok(css.includes("prefers-reduced-motion: reduce"));
  assert.ok(css.includes('html[data-nav="collapsed"] .global-brand .seal-actor'));
});
