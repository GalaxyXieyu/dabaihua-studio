> 本文是小燕子的结构化大纲草案（v0 起草，后按讨论更新到 v0.1），已被 `docs/shufangzhai-protocol.md` 第五章取代；两边有出入时以第五章为准。
> 相对最初 v0 的主要变化：`version` 固定为 `outline/v0.1`；新增服务器管理的 `rev`（写入用条件更新，不匹配回 409 `rev_conflict`）；`titles.options` 改成 `{id, text}`、`selected` 存候选 id、`custom` 存自填标题；`questions` 增加 `answer` 与 `custom`（single/text 存字符串，multi 存数组）；各块增加可选 `feedback`；`corePoint` 去掉 `editable`。

# 结构化大纲 outline/v0.1（小燕子提，秃头渲染；2026-10-04 按秃头意见定稿）

大纲以 outlineJson 为准；Markdown 由服务器从 JSON 重新生成兼容版。小燕子 PATCH 时可以两样都发，冲突时以 JSON 为准。

```json
{
  "version": "outline/v0.1",
  "rev": 3,
  "titles": {
    "id": "titles",
    "options": [ { "id": "t1", "text": "标题1" }, { "id": "t2", "text": "标题2" } ],
    "selected": "t1",
    "custom": null
  },
  "corePoint": { "id": "corePoint", "text": "核心观点一句话" },
  "opening": { "id": "opening", "kind": "real | hypothetical", "text": "开头场景", "sources": ["素材名"] },
  "sections": [
    { "id": "s1", "heading": "小节标题", "points": ["要点1", "要点2"], "keep": true }
  ],
  "diagrams": [
    { "id": "fig-1", "caption": "这张图想说明什么（一句话）", "anchor": "s2",
      "mermaid": "flowchart LR\n  A[开始] --> B[结束]", "status": "draft | ok | redo" }
  ],
  "questions": [
    { "id": "q1", "text": "要 Yu 拍板的问题", "type": "single | multi | text",
      "options": ["选项A", "选项B", "其他"], "default": "选项A",
      "answer": null, "custom": null }
  ],
  "materials": [ { "label": "素材名", "path": "/workspace/..." } ]
}
```

## 字段规则

- **稳定 id**：每块都有 id，重生成时 id 不变。blockId 取值：`titles`、`corePoint`、`opening`、`s1…`、`fig-1…`、`q1…`，`all` 表示整份。
- **titles**：options 是 `{id, text}` 数组（id 为 t1、t2…）；selected 存选中的 id；custom 存 Yu 自填的标题，非空时以它为准。
- **questions.answer**：single 和 text 存字符串，multi 存字符串数组；选了「其他」时自填内容放 custom。default 是 Yu 不作答时小燕子按什么写。
- **rev**：服务器管，每次保存加一。小燕子 PATCH 带上事件里的 baseRev；回 409 说明 Yu 中间改过，先 GET 最新的，在最新版上重做再 PATCH。
- **diagrams**：status 为 draft（草图）、ok（Yu 确认）、redo（要重画）。mermaid 必须能过严格模式（securityLevel strict，不用 click、不用 HTML 标签）。anchor 指它放在哪个小节。Yu 确认过的图由尔康按 id 画成正式配图（金色 #BA9500 风格），网页上的 mermaid 只是草图。
- **materials 和 opening.sources**：网页上只显示名字，不显示路径。
- **上限**：outlineJson 不超过 64KB，小节最多 12 个，图最多 6 张。

## 事件

- `regenerate_outline`：`{ blocks: [{ blockId, suggestion }], outlineJson, baseRev }`，一次可带多块。小燕子只重写列出的块，其余原样保留，再带 baseRev PATCH 回去。
- `confirm_outline`：带 Yu 改过的完整 outlineJson。写全文以它为准（选中的标题或 custom、answer、keep=false 的小节不写、status=ok 的图）。

## 页面交互建议

- 标题候选和问题做成单选或多选按钮，带「其他」自填。
- 每个小节一张卡片：可改字、可勾掉（keep=false）、可拖动排序。
- 每张图用 mermaid 渲染，图下有「改这里」输入框。
- 每块都有「不好，重新生成」加一句建议；底部有「按建议重生成」（可多块一起提交）和「确认大纲」。

## 过渡期

页面上线前，小燕子照常发 Markdown，可顺带 outlineJson，秃头那边先存下不报错。上线后福伦通知再全面切换。
