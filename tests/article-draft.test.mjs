import test from "node:test";
import assert from "node:assert/strict";

import {
  imageSize,
  computeCrops,
  validateFields,
  extractImgSrcs,
  sameExceptImgSrc,
  buildToolArgs,
} from "../scripts/article-draft.mjs";

function tinyPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([signature, ihdr]);
}

test("imageSize 读取 PNG IHDR 的宽高", () => {
  const size = imageSize(tinyPng(1280, 544));
  assert.deepEqual(size, { width: 1280, height: 544, type: "png" });
});

test("computeCrops 对 1280x544：2.35 近似原图，1:1 居中裁方", () => {
  const crops = computeCrops(1280, 544);
  assert.equal(crops.crop235, "0_0_1_1");
  assert.equal(crops.crop1x1, "0.2875_0_0.7125_1");
});

test("computeCrops 对 1000x1000：2.35 为居中横条，1:1 即全图", () => {
  const crops = computeCrops(1000, 1000);
  assert.equal(crops.crop235, "0_0.287234_1_0.712766");
  assert.equal(crops.crop1x1, "0_0_1_1");
});

test("validateFields：33 字标题报错，allowLongTitle 后仅提醒", () => {
  const long = "字".repeat(33);
  const strict = validateFields({ title: long });
  assert.equal(strict.errors.length, 1);
  assert.match(strict.errors[0], /超过公众号 32 字上限/);
  const allowed = validateFields({ title: long, allowLongTitle: true });
  assert.equal(allowed.errors.length, 0);
  assert.equal(allowed.warnings.length, 1);
});

test("validateFields：65 字标题即使 allowLongTitle 也报错", () => {
  const tooLong = "字".repeat(65);
  const result = validateFields({ title: tooLong, allowLongTitle: true });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /超过公众号 64 字/);
});

test("validateFields：作者与摘要上限", () => {
  const result = validateFields({ author: "A".repeat(17), digest: "B".repeat(121) });
  assert.equal(result.errors.length, 2);
});

test("extractImgSrcs 支持双引号与单引号", () => {
  const html = '<img src="images/a.png" style="x"><img src=\'images/b.png\' />';
  assert.deepEqual(extractImgSrcs(html), ["images/a.png", "images/b.png"]);
});

test("sameExceptImgSrc：仅 img src 不同视为一致", () => {
  const a = '<img src="a.png" style="vertical-align: middle"><p style="x">hi</p>';
  const b = '<img src="https://mmbiz.qpic.cn/b.png" style="vertical-align: middle"><p style="x">hi</p>';
  assert.equal(sameExceptImgSrc(a, b), true);
});

test("sameExceptImgSrc：样式不同则不一致", () => {
  const a = '<img src="a.png" style="width: 100%" />';
  const b = '<img src="b.png" style="width: 50%" />';
  assert.equal(sameExceptImgSrc(a, b), false);
});

test("buildToolArgs：schema 不含 dryRun 且非 upload 时拒绝（含无属性声明）", () => {
  const desired = { html: "<p>hi</p>", title: "t" };
  for (const schemaProperties of [{ html: {}, title: {} }, {}, undefined]) {
    const { args, dropped, error } = buildToolArgs(desired, schemaProperties, { upload: false });
    assert.ok(error, `schemaProperties=${JSON.stringify(schemaProperties)} 应返回 error`);
    assert.match(error, /不含 dryRun/);
    assert.deepEqual(args, {});
    assert.deepEqual(dropped, []);
  }
});

test("buildToolArgs：schema 含 dryRun 且非 upload 时 args.dryRun 为 true", () => {
  const { args, dropped, error } = buildToolArgs(
    { html: "<p>hi</p>", title: "t", dryRun: false },
    { html: {}, title: {}, dryRun: {} },
    { upload: false },
  );
  assert.equal(error, null);
  assert.deepEqual(dropped, []);
  assert.equal(args.dryRun, true);
  assert.equal(args.html, "<p>hi</p>");
});

test("buildToolArgs：未知键被丢弃，dryRun 不会被丢弃", () => {
  const { args, dropped, error } = buildToolArgs(
    { html: "<p>hi</p>", title: "t", mystery: 1, dryRun: true },
    { html: {}, dryRun: {} },
    { upload: true },
  );
  assert.equal(error, null);
  assert.deepEqual(dropped, ["title", "mystery"]);
  assert.equal("title" in args, false);
  assert.equal("mystery" in args, false);
  assert.equal(args.dryRun, false);
});
