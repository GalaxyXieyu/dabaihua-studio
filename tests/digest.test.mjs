import test from "node:test";
import assert from "node:assert/strict";

import {
  UNREADABLE_SUMMARY,
  FAILED_SUMMARY,
  cleanSummary,
  checkSummaryNumbers,
  numberInSource,
  extractNumbers,
  isValidSummaryShape,
  validateSummary,
  summaryRetryHint,
  describeSummaryValidation,
  isTooThin,
  isBlockPage,
  parseGithubRepoUrl,
  extractHnId,
  renderItemMarkdown,
  SUMMARY_MAX_CHARS,
} from "../scripts/lib/digest-summary.mjs";
import { githubReadmeRawUrls } from "../scripts/lib/digest-fetch.mjs";
import { decodeUtf8Chunks } from "../scripts/lib/digest-text.mjs";

test("extractNumbers 忽略千分位逗号并保留小数", () => {
  assert.deepEqual(extractNumbers("公司估值 1,414 million，增长 4.14%，覆盖 3 个市场"),
    ["1414", "4.14", "3"]);
  assert.deepEqual(extractNumbers("没有数字"), []);
});

test("checkSummaryNumbers 通过：千分位与小数", () => {
  assert.deepEqual(checkSummaryNumbers("融资 1,414 million", "raised 1414 million total"), []);
  assert.deepEqual(checkSummaryNumbers("准确率 4.14", "accuracy 4.14 on the benchmark"), []);
});

test("checkSummaryNumbers 失败：正文里找不到的数字", () => {
  const offending = checkSummaryNumbers("增长 42%，达到 7.8 亿", "本季度增长很快", "某公司");
  assert.deepEqual(offending, ["42", "7.8"]);
});

test("checkSummaryNumbers 接受标题里的数字", () => {
  assert.deepEqual(checkSummaryNumbers("发布 3.0 版本", "正文没有版本号", "GPT 3.0 发布"), []);
});

test("cleanSummary 去掉代码围栏、标签和 URL", () => {
  const raw = "```markdown\n摘要：这是一段中文摘要，包含链接 https://example.com/a 和 www.foo.com/b。\n```";
  const cleaned = cleanSummary(raw);
  assert.equal(cleaned, "这是一段中文摘要，包含链接 和 。");
  assert.ok(!cleaned.includes("http"));
  assert.ok(!cleaned.includes("www."));
  assert.ok(!cleaned.startsWith("摘要"));
});

test("cleanSummary 保留未能读取原文", () => {
  assert.equal(cleanSummary(`\`\`\`\n${UNREADABLE_SUMMARY}\n\`\`\``), UNREADABLE_SUMMARY);
});

test("checkSummaryNumbers 按边界匹配数字，避免子串误判", () => {
  assert.equal(numberInSource("4", "414"), false);
  assert.deepEqual(checkSummaryNumbers("4 个模型", "这里有 414 个模型"), ["4"]);
  assert.equal(numberInSource("99", "99%"), true);
  assert.deepEqual(checkSummaryNumbers("命中 99%", "accuracy 99% achieved"), []);
  assert.equal(numberInSource("99", "99.5"), false);
  assert.deepEqual(checkSummaryNumbers("耗时 99", "耗时 99.5 秒"), ["99"]);
  assert.equal(numberInSource("1.4", "~1.4 LLM"), true);
  assert.deepEqual(checkSummaryNumbers("得分 1.4", "~1.4 LLM on the benchmark"), []);
  assert.equal(numberInSource("72", "72%"), true);
  assert.deepEqual(checkSummaryNumbers("覆盖 72%", "覆盖 72% 的用户"), []);
  assert.equal(numberInSource("2251", "2251"), true);
  assert.deepEqual(checkSummaryNumbers("用户 2,251", "2251 users"), []);
  assert.deepEqual(checkSummaryNumbers("增长 42%，达到 7.8 亿", "本季度增长很快", "某公司"), ["42", "7.8"]);
});

test("decodeUtf8Chunks 正确拼接跨 chunk 的多字节字符", () => {
  const bytes = Buffer.from("古代", "utf8");
  // 3 字节的「古」被切成两段：1 字节 + 2 字节
  const split = [new Uint8Array([bytes[0]]), new Uint8Array([bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]])];
  assert.equal(decodeUtf8Chunks(split), "古代");
  assert.equal(decodeUtf8Chunks([]), "");
  assert.equal(decodeUtf8Chunks([Buffer.from("普通文本", "utf8")]), "普通文本");
});

test("extractNumbers 把版本号当作一个点分 token", () => {
  assert.deepEqual(extractNumbers("升级到 v0.24.0"), ["0.24.0"]);
  assert.deepEqual(extractNumbers("1.2.3 与 4.5"), ["1.2.3", "4.5"]);
});

test("checkSummaryNumbers 支持版本号，但拒绝被嵌入的点分数字", () => {
  assert.deepEqual(checkSummaryNumbers("升级到 v0.24.0", "release v0.24.0 notes"), []);
  assert.deepEqual(checkSummaryNumbers("升级到 0.24.0", "release note without version"), ["0.24.0"]);
  assert.deepEqual(checkSummaryNumbers("升级到 0.24", "release v0.24.0 notes"), ["0.24"]);
  assert.equal(numberInSource("24.0", "v0.24.0"), false);
  assert.equal(numberInSource("0.24.0", "v0.24.0"), true);
});

test("checkSummaryNumbers 放行由日期派生的数字", () => {
  const title = "Note on 24th September 2026";
  const source = "Source text without the date digits.";
  assert.deepEqual(checkSummaryNumbers("2026 年 9 月 24 日发布", source, title, "2026-09-24"), []);
  // 无日期、无英文月份时仍然严格
  assert.deepEqual(checkSummaryNumbers("2026 年 9 月 24 日发布", source, "Note"), ["2026", "9", "24"]);
  // date 参数单独也能放行年/月/日（含去零）
  assert.deepEqual(checkSummaryNumbers("9 月 9 日", "no digits here", "", "2026-09-09"), []);
});

test("validateSummary 返回具体失败原因", () => {
  assert.deepEqual(validateSummary("短"), { ok: false, reason: "too_short" });
  assert.deepEqual(validateSummary("a".repeat(30)), { ok: false, reason: "no_cjk" });
  const long = "中".repeat(SUMMARY_MAX_CHARS + 1);
  assert.deepEqual(validateSummary(long), { ok: false, reason: "too_long", length: long.length });
  assert.deepEqual(
    validateSummary("这是一段长度足够的中文摘要，但里面出现了正文没有的 42。", "正文没有任何数字", "标题"),
    { ok: false, reason: "numbers", offending: ["42"] },
  );
  assert.deepEqual(
    validateSummary("这是一段长度足够的中文摘要，只陈述正文里出现的事实。", "正文包含数字 3", "标题"),
    { ok: true },
  );
});

test("summaryRetryHint / describeSummaryValidation 说明具体原因", () => {
  const tooLong = summaryRetryHint({ ok: false, reason: "too_long", length: 501 });
  assert.ok(tooLong.includes("501"));
  assert.ok(tooLong.includes(String(SUMMARY_MAX_CHARS)));
  const numbers = summaryRetryHint({ ok: false, reason: "numbers", offending: ["42", "7.8"] });
  assert.ok(numbers.includes("42、7.8"));
  assert.equal(describeSummaryValidation({ ok: false, reason: "too_long", length: 501 }), "too_long（501 字）");
  assert.equal(describeSummaryValidation({ ok: false, reason: "numbers", offending: ["42"] }), "numbers（42）");
  assert.equal(describeSummaryValidation({ ok: true }), "ok");
});

test("githubReadmeRawUrls 按文件名顺序生成 HEAD 候选链接", () => {
  const urls = githubReadmeRawUrls("owner", "repo");
  assert.deepEqual(urls, [
    "https://raw.githubusercontent.com/owner/repo/HEAD/README.md",
    "https://raw.githubusercontent.com/owner/repo/HEAD/readme.md",
    "https://raw.githubusercontent.com/owner/repo/HEAD/README.MD",
    "https://raw.githubusercontent.com/owner/repo/HEAD/README.rst",
    "https://raw.githubusercontent.com/owner/repo/HEAD/README.txt",
    "https://raw.githubusercontent.com/owner/repo/HEAD/README",
  ]);
});

test("isValidSummaryShape 要求 20-420 字且含中文", () => {
  assert.equal(isValidSummaryShape("短"), false);
  assert.equal(isValidSummaryShape("a".repeat(30)), false);
  assert.equal(
    isValidSummaryShape("这是一段足够长的中文摘要，用来验证长度与中文字符判断是否正常工作。"),
    true,
  );
});

test("isTooThin 判断少于 300 个有效字符", () => {
  assert.equal(isTooThin("太短了"), true);
  assert.equal(isTooThin("有效内容 ".repeat(90)), false);
});

test("isBlockPage 识别常见拦截页", () => {
  assert.equal(isBlockPage("Just a moment... Enable JavaScript and cookies to continue"), true);
  assert.equal(isBlockPage("Access Denied. Reference #18."), true);
  assert.equal(
    isBlockPage(`Attention Required! ${"正常文章内容 ".repeat(300)}`),
    false,
  );
  assert.equal(isBlockPage("这只是一篇正常的长文章，没有拦截提示。"), false);
});

test("parseGithubRepoUrl 只解析仓库根地址", () => {
  assert.deepEqual(parseGithubRepoUrl("https://github.com/langchain-ai/langchain"), {
    owner: "langchain-ai",
    repo: "langchain",
  });
  assert.deepEqual(parseGithubRepoUrl("https://github.com/owner/repo.git"), {
    owner: "owner",
    repo: "repo",
  });
  assert.equal(parseGithubRepoUrl("https://github.com/owner/repo/tree/main"), null);
  assert.equal(parseGithubRepoUrl("https://example.com/owner/repo"), null);
});

test("extractHnId 从摘要或 URL 中提取讨论 id", () => {
  assert.equal(extractHnId("…讨论 https://news.ycombinator.com/item?id=123456"), "123456");
  assert.equal(extractHnId("https://news.ycombinator.com/item?id=987"), "987");
  assert.equal(extractHnId("https://example.com"), null);
});

test("renderItemMarkdown：摘要在原文链接之前（ok）", () => {
  const out = renderItemMarkdown({
    index: 1,
    title: "中文标题",
    body: "这是摘要正文。",
    tag: "Agent",
    material: {
      title: "Source Title",
      url: "https://example.com/a",
      source: "OpenAI",
      date: "2026-09-28",
      summary: "",
    },
  });
  const lines = out.split("\n");
  assert.equal(lines[0], "### 1. 中文标题");
  assert.ok(out.indexOf("这是摘要正文。") < out.indexOf("- 原文："));
  assert.ok(out.includes("- 原文：[Source Title](https://example.com/a)"));
  assert.ok(out.includes("- 来源：OpenAI · 2026-09-28"));
  assert.ok(out.includes("- 标签：Agent"));
});

test("renderItemMarkdown：未能读取原文 / 摘要生成失败 仍在链接之前", () => {
  for (const body of [UNREADABLE_SUMMARY, FAILED_SUMMARY]) {
    const out = renderItemMarkdown({
      index: 2,
      title: "标题",
      body,
      tag: "",
      material: {
        title: "T",
        url: "https://example.com/b",
        source: "Hacker News",
        date: "",
        summary: "讨论 https://news.ycombinator.com/item?id=42",
      },
    });
    assert.ok(out.indexOf(body) >= 0);
    assert.ok(out.indexOf(body) < out.indexOf("- 原文："));
    assert.ok(out.includes("- HN 讨论：https://news.ycombinator.com/item?id=42"));
    assert.ok(out.includes("- 标签：未分类"));
  }
});
