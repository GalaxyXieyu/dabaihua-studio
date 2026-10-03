# 每日选题简报 JSON 结构

简报是每天一份的规范化 JSON，存在 `daily_briefs.data_json`。导入时走
`validateBrief`（`lib/daily-brief-core.ts`）：未知字段直接丢弃，缺失的可选字段补空值，
每个问题都以中文 + 字段路径报错。当前 `version` 固定为 `1`。

> 从 2026-10-04 的简报开始，晴儿可以给每条选题加两个可选的来源数组
> `scenarioSources` 和 `questionSources`。旧简报不带这两个字段，照常工作。

## 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 固定 `1` |
| `date` | string | `YYYY-MM-DD`，必填 |
| `title` | string | 简报标题，可空 |
| `intro` | string | 开场说明，可空 |
| `recommendation` | `{ topicId, reason }` \| null | 今日推荐，`topicId` 必须在 `topics` 里 |
| `topics` | array | 至少 1 条，最多 30 条 |
| `notes` | string | 备注，可空 |
| `sources` | string[] | 简报级来源，可空 |

## 选题（topics[]）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 1–40 位字母、数字、`_`、`-`，当天内唯一 |
| `type` | string | 只能是 `落地题` 或 `新闻题` |
| `label` | string | 例如「新闻主选题」，可空 |
| `title` | string | 必填 |
| `oneLiner` | string | 一句话摘要（通知里的 `summary`） |
| `detail` | string | 更完整的背景与判断（通知里的 `detail`） |
| `scenarios` | string[] | 可选场景；没有场景时是 `[]` |
| `scenarioSources` | string[] | 与 `scenarios` 下标一一对应 |
| `questions` | string[] | 想问 Yu 的问题 |
| `questionSources` | string[] | 与 `questions` 下标一一对应 |
| `materials` | array | 素材列表 |
| `note` | string | 备注，可空 |

`scenarios` / `questions` 是普通字符串数组（非字符串条目会被丢掉）。

### scenarioSources / questionSources 规则

- 与 `scenarios` / `questions` **按下标对齐**，长度永远等于对应数组的长度。
- 对应项缺失 → 补 `""`；多出来的项直接忽略。
- 非字符串 → `""`。
- 每项去首尾空白，最多 200 字。
- 两个数组整个缺失（旧简报）→ 全部为 `""`，长度与对应数组一致。

例如：

```json
{
  "id": "kb-3",
  "type": "新闻题",
  "title": "OpenAI 发布新的 Agent 框架",
  "scenarios": ["从一个使用场景切入", "从行业竞争切入"],
  "scenarioSources": ["某篇报道", ""],
  "questions": ["和你之前写的哪篇能接上？"],
  "questionSources": [""]
}
```

## 素材（topics[].materials[]）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 素材标题 |
| `summary` | string | 摘要 |
| `url` | string | 必须是 http(s)，可空 |
| `links` | array | 附加链接，每项 `{ label, url }`，`url` 必须是 http(s) |

## 回复（daily_brief_responses）

Yu 对某条选题的回复按 `(date, topic_id, user_id)` 唯一。字段：`rating`、
`rating_comment`、`decision`（`pick` / `reject` / null）、`scenario_index`、
`scenario_text`、`scenario_custom`（「都不是，我自己说」的自由文本）、`answers_json`、
`reject_reason`。`scenario_index` 与 `scenario_custom` 互斥，设置一个会清掉另一个；
场景是可选的，选 `pick` 时可以不指定场景。
