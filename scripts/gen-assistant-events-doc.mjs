#!/usr/bin/env node
/**
 * gen-assistant-events-doc.mjs — 从 lib/assistant-events.ts 注册表生成
 * docs/assistant-events.md（对外文档）。
 *
 * Node >= 22.18 自带 TypeScript 类型擦除，可直接 import ../lib/assistant-events.ts
 * （和 tests 一样）；更老的 22.x 需要 --experimental-strip-types。
 *
 * 用法：npm run events:doc（或 node scripts/gen-assistant-events-doc.mjs）。
 * renderAssistantEventsDoc() 是纯函数；测试用它比对仓库里的文档是否过期。
 */

import { realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ASSISTANT_EVENTS, WEBHOOK_TARGETS } from "../lib/assistant-events.ts";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOC_PATH = join(REPO_ROOT, "docs", "assistant-events.md");

/** 单元格：缺失值写 "-"，转义表格竖线。 */
function cell(value) {
  const text = value === undefined || value === null || value === "" ? "-" : String(value);
  return text.replaceAll("|", "\\|");
}

function code(value) {
  const text = cell(value);
  return text === "-" ? text : "`" + text + "`";
}

/** 纯函数：返回 docs/assistant-events.md 的完整内容（以换行结尾）。 */
export function renderAssistantEventsDoc() {
  const lines = [];
  lines.push("# 助手事件");
  lines.push("");
  lines.push(
    "Yu 在网页上做的、需要助手接手的决定，都登记在 `lib/assistant-events.ts` 注册表里：新增事件 = 加一条配置。本文由 `scripts/gen-assistant-events-doc.mjs` 从注册表生成（`npm run events:doc`），勿手改。",
  );
  lines.push("");
  lines.push("## 命名约定");
  lines.push("");
  lines.push(
    "- 注册表键一律 `domain.action`：domain 是页面 / 业务域（`brief`、`article`、`topic`、`cards`、`itch`，以后的英语页按画饼规格取名，如 `speaking`），action 用过去式或名词短语描述 Yu 做了什么（`review_submitted`、`response_decided`）。",
  );
  lines.push(
    "- 线上事件名（payload.event / `x-dabaihua-event`）新事件与键的 action 部分一致（`article_review_submitted`）；简报四个老事件 `select` / `confirm_outline` / `regenerate_outline` / `cancel` 作为别名保留，线上名与 payload 不变。",
  );
  lines.push("");
  lines.push("## Webhook 目标");
  lines.push("");
  lines.push("只列 env 变量名；发送规则：POST JSON + `x-dabaihua-event`，默认 `Authorization: Bearer <secret>`（配置了自定义头则原样发 secret），8 秒超时。");
  lines.push("");
  lines.push("| 目标 | URL 环境变量 | Secret 环境变量 | Auth 头环境变量 |");
  lines.push("| --- | --- | --- | --- |");
  for (const [name, target] of Object.entries(WEBHOOK_TARGETS)) {
    lines.push(
      `| ${code(name)} | ${code(target.urlEnv)} | ${code(target.secretEnv)} | ${code(target.authHeaderEnv)} |`,
    );
  }
  lines.push("");
  lines.push("## 事件");
  lines.push("");
  lines.push(
    "| key | event | protocol | 页面 / 接口 | 目标 | handoff | cc | 启用 | payload 字段 | 读命令 | 写回 | 备注 |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const def of ASSISTANT_EVENTS) {
    const remark = def.aliasOf ? `线上名为旧别名（\`${def.aliasOf}\`）` : "";
    const cells = [
      code(def.key),
      code(def.event),
      code(def.protocol),
      cell(def.page),
      def.target ? code(def.target) : "-",
      cell(def.handoff),
      def.cc && def.cc.length ? cell(def.cc.join("、")) : "-",
      def.enabled ? "是" : "否",
      cell(def.payloadFields.join(", ")),
      cell(def.read),
      cell(def.writeBack),
      cell(remark),
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// 作为主模块运行时写出文档；被测试 import 时只提供纯函数。
const invoked = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : null;
if (invoked && invoked === import.meta.url) {
  writeFileSync(DOC_PATH, renderAssistantEventsDoc(), "utf8");
  console.log(`已生成 ${DOC_PATH}`);
}
