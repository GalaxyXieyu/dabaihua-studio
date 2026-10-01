# topic-kb — 选题素材知识库

把「大白话讲AI」收过的选题素材做成本地知识库：新素材进来时先检索以前收过的同类内容，再把多篇合并成选题，最后转成简报页可读的 JSON。

## 组成

- SQLite 单文件（Node 22 内置 `node:sqlite`）：`docs` / `sightings` / `topic_refs` / FTS5（trigram，支持中文子串）/ `entities` + `entity_edges`（规则抽取的实体共现图）。
- 本地嵌入：`Xenova/multilingual-e5-small`（q8，约 130MB，CPU，零 token）。
- 检索：全文 BM25 + 向量 + 实体重叠（概念词全权重、机构/专名 0.4 权重），RRF 融合；同一机构最多 2 条，往期选题最多 2 条，同名题去重。
- 合并：每天一次调用 `pi -p --no-session --no-tools --mode json --model ${DIGEST_MODEL:-opencode-go/deepseek-v4.1-flash}`；校验 ≥2 机构、≥1 往期 P*、≥1 当天首见 N*、数字可在素材原文找到、禁用表达；有效题 <3 时重试 1 次。

## 数据位置

| 路径 | 内容 |
| --- | --- |
| `$DIGEST_OUT_DIR/candidates/<date>.json` | digest 候选素材的**永久追加归档**（`.cache` 只留最新一天，这里只增不改） |
| `$TOPIC_KB_DIR/topic-kb.sqlite` | 知识库主文件（含 docs / sightings / FTS / 嵌入） |
| `$TOPIC_KB_DIR/out/<date>-prompt*.md` | merge 的 prompt（含 dry-run 与重试版本） |
| `$TOPIC_KB_DIR/out/<date>-kb-topics*.{json,md}` | merge 出的合并选题 |
| `$TOPIC_KB_DIR/out/<date>-related.{md,json}` | related 的检索结果 |
| `$TOPIC_KB_MODELS` | 召回模型缓存，默认 `~/.cache/topic-kb/models/`（模型需预先放好） |

默认值：`DIGEST_OUT_DIR=/workspace/projects/daily-topics`，`TOPIC_KB_DIR=$DIGEST_OUT_DIR/kb`，`YU_DAILY_DIR=/workspace/daily`。

## 每日命令顺序

从仓库根运行：

```bash
npm run kb:install                 # 第一次：安装 @huggingface/transformers（不跑 npm install）
npm run kb:ingest -- --until 2026-10-01   # 可选：手动入库（digest 结束会自动跑）
npm run kb:merge -- --date 2026-10-01 --dry-run   # 只看 prompt 和 N/P 数量
npm run kb:merge -- --date 2026-10-01             # 调模型，产出 kb-topics.json
npm run kb:brief -- --date 2026-10-01             # 转成简报页 JSON
node scripts/brief.mjs validate /workspace/projects/daily-topics/2026-10-01-topics.json
```

一条命令跑完全天：`npm run topics:daily -- --date 2026-10-01`，等价于 ingest → 检查 N 素材 → merge → to-brief → validate。

## 各命令参数

- `ingest.mjs [--since D] [--until D] [--no-archive] [--db PATH]`
  默认 `SINCE=2000-01-01`、`UNTIL=$(shanghaiToday)`。解析 `DT` 下的日报 / 选题板 / news / `topics.json`、`<DT>/.cache/*.json`、`<DT>/candidates/*.json`、collector 归档。
  **「入过的不会被覆盖」**：同一 key 的文档只补空字段（summary 取更长的），sightings 用 `INSERT OR IGNORE` 追加，`first_seen` 永远取所有 sightings 里最小的 day。
- `related.mjs --date D [--k 5] [--json]`：当天新素材 × 以前收过的同类条目。
- `merge.mjs --date D [--k 4] [--dry-run] [--model M] [--focus "id:N1,P2@主线;…"] [--tag v2]`
  合并出题；调 pi 时把 `OPENCODE_API_KEY` 只注入子进程 env，`--focus` 模式每组固定出 1 题。
- `to-brief.mjs --date D [--in <kb-topics.json>] [--out <file>] [--keep-news-from <brief.json>] [--force]`
  默认 `--in = <kb>/out/D-kb-topics.json`、`--out = DT/D-topics.json`。目标已存在且没给 `--force` 时报错退出 3；没有 valid 题退出 4；校验不过退出 1。
- `daily.mjs --date D [--out <file>] [--force] [--skip-ingest] [--keep-news-from <file>] [--dry-run]`
  完整编排。没有当天 `D.md` 或知识库里没有当天 N 素材时退出 2，提示先跑 digest。

## 厂商上限（每日）

同一家厂商每天最多 `DIGEST_VENDOR_CAP`（默认 2）条：

- digest：`buildPrompt` 写明规则；`validateResult` 与命中缓存后的结果都用 `capByVendor` 截断，miss 的写进 WARN。
- merge：prompt 规则里加「全天所有题合计，同一 org 的素材最多 2 篇；org 为空/未知、kind 为 topic/hot 的不算」；`validateDay` 按题顺序累计每个 org 用到的不同 doc id，超限的题标 invalid 并写「厂商超限：<org> 全天已用 N 篇」。
- 厂商识别统一走 `scripts/lib/vendor.mjs` 的 `vendorOf(url, source)`。

## 简报字段映射

`to-brief.mjs` 把 merge 的每题映射成简报 `topics[]`：

| 简报字段 | 来源 |
| --- | --- |
| `id` / `label` | `kb-<i>` / `选题<i>`（新闻题保持原样放在最前） |
| `title` / `oneLiner` | merge 题的 title / oneLiner |
| `detail` | `## 变化`（before/now/why）、`## 方法论`、`## 判断标准`（when → then（依据））、`## 多篇对照`（question/consensus/divergence + compare 逐条） |
| `scenarios` | yuAngle 非空则 `[yuAngle]`，否则 `[]` |
| `questions` | merge 的 questions，最多 2 个 |
| `materials` | `{ title: "MM-DD · org · 标题", summary: 摘要截 300 字, url }`；无 http(s) url 的（往期）不写 url；按新素材 → 重复 → 往期排序 |
| `note` | `合并 n 篇：当天新 a、往期 b；首见 最早 ~ 最晚` |
| 顶层 `notes` | 未通过校验的题（标题 + problems 前两条）+ 模型 / token 用量 |

正文里的 `N*` / `P*` 会换成人能看懂的名字：一般位置换成 org（org 为空用标题前 16 字），`依据：` 里换成 `MM-DD org《标题前 24 字》`（多个用「；」连接），`Yu YYYY-MM-DD 日报` 原样保留。
