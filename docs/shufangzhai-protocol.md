# 漱芳斋写作协议（brief → 漱芳斋）

这份文档给写作助手（漱芳斋）看：它讲清「今日简报里的选题选中之后，怎么通知漱芳斋、
漱芳斋怎么把大纲和状态写回来」。所有真实密钥只存在于服务器环境变量，文档里不出现。

## 一、整体流程

1. 晴儿把当天简报导入 dabaihua（`daily_briefs`）。
2. Yu 在「今日简报」里点「就写这个」→ 选中一条选题。这一步会：
   - 保存 Yu 的 pick 回复（场景、回答都可选）；
   - 在选题看板（`topics`）建一张 `approved`（入选）卡片；
   - 给漱芳斋发一条 `select` webhook。
3. 漱芳斋读题、写大纲，通过写回接口提交大纲 → 状态变成 `outline_pending`（大纲待确认）。
4. Yu 确认大纲 → 状态变成 `drafting`（写稿中），发 `confirm_outline`。
5. 之后漱芳斋继续用写回接口推进状态（写稿中 / 待审 / 审稿中 / 排版中 / 已发）。
6. 如果 Yu 撤销选择 → 状态 `shelved`（搁置），发 `cancel`。再次选中会自动恢复。

数据落库永远优先：webhook 通知失败只是通知失败，选题决定不会被回滚，也不会抛错。

## 二、八个管线状态

数据库只存 code，标签只在 `lib/brief-pipeline-core.ts` 定义一次。

| 顺序 | code | 标签 | 谁能设 |
| --- | --- | --- | --- |
| 1 | `selected` | 已选 | 只有 Yu（`POST select`） |
| 2 | `outline_pending` | 大纲待确认 | 漱芳斋（提交大纲时自动进入） |
| 3 | `drafting` | 写稿中 | 漱芳斋；或 Yu 确认大纲时从 `outline_pending` 进入 |
| 4 | `pending_review` | 待审 | 漱芳斋 |
| 5 | `reviewing` | 审稿中 | 漱芳斋 |
| 6 | `typesetting` | 排版中 | 漱芳斋 |
| 7 | `published` | 已发 | 漱芳斋 |
| 8 | `shelved` | 搁置 | 只有 Yu（`POST undo`） |

写回接口接受 code 或中文标签。漱芳斋不能设 `selected` / `shelved`，也不能把
`outline_pending` 直接推到 `drafting`（那是 Yu 的「确认大纲」）。

## 三、出站 webhook（dabaihua → 漱芳斋）

服务器读三个环境变量：

| 变量 | 说明 |
| --- | --- |
| `SHUFANGZHAI_WEBHOOK_URL` | 必填才发送；不配置则本次通知状态为 `unconfigured`，不发请求 |
| `SHUFANGZHAI_WEBHOOK_SECRET` | 鉴权密钥 |
| `SHUFANGZHAI_WEBHOOK_AUTH_HEADER` | 可选。不配置时用 `Authorization: Bearer <secret>`；配置了自定义头名时，值为原始 `<secret>` |

请求：`POST`，`content-type: application/json`，额外请求头 `x-dabaihua-event: <event>`，
超时 8 秒。HTTP 2xx 记为 `delivered`，其余（含网络错误、超时）记为 `failed`，
都会写入 `brief_notify_log` 并把最近结果留在 `brief_selections`。

通知状态只有三种：`delivered` / `failed` / `unconfigured`。
没有自动重试——需要重发时由 Yu 调 `POST .../notify` 手动重发上一次事件。

事件只有四个：`select`、`confirm_outline`、`cancel`、`regenerate_outline`。

### 3.1 `select`（点「就写这个」）

```json
{
  "protocol": "dabaihua.brief-notify/v1",
  "event": "select",
  "eventId": "9f1c2b0e-4a7d-4e2a-8f5b-6c3d1e2f0a9b",
  "sentAt": "2026-10-03T21:10:00+08:00",
  "topic": {
    "id": "kb-3",
    "date": "2026-10-02",
    "type": "新闻题",
    "label": "新闻主选题",
    "title": "OpenAI 发布新的 Agent 框架",
    "summary": "一句话讲清这条选题",
    "detail": "更完整的背景、冲突和判断"
  },
  "scenario": { "kind": "preset", "index": 1, "text": "从一个具体使用场景切入" },
  "answers": [
    { "question": "这条能和你之前写的哪篇接上？", "answer": "可以接上上一篇的结论" }
  ],
  "outline": null,
  "status": { "code": "selected", "label": "已选" },
  "boardTopicId": 12,
  "links": {
    "topic": "https://superme.aigalaxy.top/content?view=brief&date=2026-10-02&topic=kb-3",
    "board": "https://superme.aigalaxy.top/content?view=board&card=12"
  }
}
```

`scenario` 的三种形态：

- 预设场景：`{ "kind": "preset", "index": 1, "text": "…" }`
- 「都不是，我自己说」：`{ "kind": "custom", "text": "我自己补充的场景" }`
- 没选场景：`null`

`answers` 只包含非空回答，并按题目配对；没有回答时是 `[]`。

### 3.2 `confirm_outline`（Yu 确认大纲）

字段与 `select` 相同，事件名和大纲字段不同：`outline` 是大纲全文，`status` 已是
`drafting`（写稿中）。

```json
{
  "protocol": "dabaihua.brief-notify/v1",
  "event": "confirm_outline",
  "eventId": "3c8a1d6f-2b4e-4a90-9d17-5e6f7a8b9c0d",
  "sentAt": "2026-10-04T10:05:00+08:00",
  "topic": {
    "id": "kb-3",
    "date": "2026-10-02",
    "type": "新闻题",
    "label": "新闻主选题",
    "title": "OpenAI 发布新的 Agent 框架",
    "summary": "一句话讲清这条选题",
    "detail": "更完整的背景、冲突和判断"
  },
  "scenario": { "kind": "custom", "text": "我自己补充的场景" },
  "answers": [],
  "outline": "# 大纲\n1. 用一个具体场景开头\n2. 交代这件事的来龙去脉\n3. 给出我的判断",
  "outlineJson": {
    "version": "outline/v0.1",
    "rev": 3,
    "titles": { "options": [{ "id": "t1", "text": "一个标题" }], "selected": "t1", "custom": null, "allowCustom": true },
    "corePoint": { "text": "核心观点" },
    "opening": { "kind": "real", "text": "开头场景", "sources": [] },
    "sections": [{ "id": "s1", "heading": "一节", "points": ["要点"], "keep": true }],
    "diagrams": [],
    "questions": [],
    "materials": []
  },
  "baseRev": 3,
  "status": { "code": "drafting", "label": "写稿中" },
  "boardTopicId": 12,
  "links": {
    "topic": "https://superme.aigalaxy.top/content?view=brief&date=2026-10-02&topic=kb-3",
    "board": "https://superme.aigalaxy.top/content?view=board&card=12"
  }
}
```

### 3.3 `cancel`（Yu 撤销选择）

```json
{
  "protocol": "dabaihua.brief-notify/v1",
  "event": "cancel",
  "eventId": "6d2f9a10-7c3b-4e58-8a21-0b1c2d3e4f50",
  "sentAt": "2026-10-04T12:30:00+08:00",
  "topic": {
    "id": "kb-3",
    "date": "2026-10-02",
    "type": "新闻题",
    "label": "新闻主选题",
    "title": "OpenAI 发布新的 Agent 框架",
    "summary": "一句话讲清这条选题",
    "detail": "更完整的背景、冲突和判断"
  },
  "scenario": null,
  "answers": [],
  "outline": null,
  "status": { "code": "shelved", "label": "搁置" },
  "boardTopicId": 12,
  "links": {
    "topic": "https://superme.aigalaxy.top/content?view=brief&date=2026-10-02&topic=kb-3",
    "board": "https://superme.aigalaxy.top/content?view=board&card=12"
  }
}
```

### 3.4 `regenerate_outline`（Yu 点「按建议重生成」）

Yu 在页面上给若干块写「不好，重新生成」的建议后，服务器发一条事件，附带要重写的
块和当前完整大纲。`baseRev` 是本次保存后的 rev，小燕子只重写列出的块、其余原样
保留，完成后带这个 `baseRev` PATCH 回去；若回 409 `rev_conflict`，说明 Yu 中间又
改过，先 GET 最新的、在最新版上重做再写。

```json
{
  "protocol": "dabaihua.brief-notify/v1",
  "event": "regenerate_outline",
  "eventId": "5e6f7a80-1b2c-4d3e-9f40-6a7b8c9d0e1f",
  "sentAt": "2026-10-04T11:20:00+08:00",
  "topic": {
    "id": "kb-3",
    "date": "2026-10-02",
    "type": "新闻题",
    "label": "新闻主选题",
    "title": "OpenAI 发布新的 Agent 框架",
    "summary": "一句话讲清这条选题",
    "detail": "更完整的背景、冲突和判断"
  },
  "scenario": null,
  "answers": [],
  "blocks": [{ "blockId": "s2", "suggestion": "这一节太空，补一个具体例子" }],
  "outlineJson": { "version": "outline/v0.1", "rev": 4, "sections": [{ "id": "s2", "heading": "展开", "points": ["一个要点"], "keep": true }], "titles": { "options": [], "selected": null, "custom": null, "allowCustom": true }, "corePoint": { "text": "核心观点" }, "opening": { "kind": "real", "text": "开头场景", "sources": [] }, "diagrams": [], "questions": [], "materials": [] },
  "baseRev": 4,
  "outline": "# 大纲\n一、展开\n- 一个要点",
  "status": { "code": "outline_pending", "label": "大纲待确认" },
  "boardTopicId": 12,
  "links": {
    "topic": "https://superme.aigalaxy.top/content?view=brief&date=2026-10-02&topic=kb-3",
    "board": "https://superme.aigalaxy.top/content?view=board&card=12"
  }
}
```

`blocks` 里的 `blockId` 取值见第五章；一次最多 30 块。小燕子给 diagram 块重写后，
重画时先用 `draft`，Yu 确认后改成 `ok`，要求重画改成 `redo`。

## 四、漱芳斋写回（漱芳斋 → dabaihua）

### 4.1 接口

```
GET   https://superme.aigalaxy.top/api/briefs/<date>/topics/<topicId>/pipeline
PATCH https://superme.aigalaxy.top/api/briefs/<date>/topics/<topicId>/pipeline
```

路径参数：

- `<date>`：简报日期，`YYYY-MM-DD`，例如 `2026-10-04`。
- `<topicId>`：简报里的选题 id，例如 `kb-3`。

鉴权：请求头 `Authorization: Bearer <助手 token>`。这个 token 就是服务器环境变量
`DABAIHUA_CARDS_ASSISTANT_TOKEN`，和照照镜子助手用的是同一个；由 Yu 分发，绝不进仓库。
（网站 admin 会话或 `topk_` key 也能调，但规则和助手一样。）

### 4.2 GET：读取当前状态

返回 `{ "selection": …, "response": … }`。还没被选中时返回 `{ "selection": null }`。

```bash
curl -sS \
  -H "Authorization: Bearer $DABAIHUA_CARDS_ASSISTANT_TOKEN" \
  https://superme.aigalaxy.top/api/briefs/2026-10-04/topics/kb-3/pipeline
```

`selection` 里能看到 `status` / `statusLabel` / `outlineMd` / `outlineBy` /
`statusBy` / `boardTopicId` 等；`response` 里能看到 Yu 选的 `scenario`、
`scenarioCustom` 和配对的 `answers`。

### 4.3 PATCH：写回状态和/或大纲

body：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `assistant` | 用助手 token 时必填 | 助手名字，≤ 20 字，记进 `status_by` / `outline_by` |
| `status` | 否 | code 或中文标签；未知值报 422 `bad_status` |
| `outline` | 否 | 大纲全文，≤ 20000 字 |
| `outlineJson` | 否 | 结构化大纲 outline/v0.1（见第五章）；形状错误报 422 `outline_json_invalid`（带 `field`） |
| `baseRev` | 否 | 已知的 `outlineRev`；给了就做并发检查，不匹配 409 `rev_conflict`（带当前 `rev`），缺省不检查 |

只允许改 `status` 和 `outline` / `outlineJson`，没有删除接口，也不能调用选 / 撤销 / 确认大纲。

规则：

- 选题必须已经被选中，且不能是 `shelved`，否则 409 `not_selected` / `shelved`。
- 不能设 `selected` / `shelved`，也不能把 `outline_pending` 推到 `drafting` → 403 `owner_only`。
- `outline_pending` 必须有大纲（本次或已存），否则 422 `outline_required`。
- 只传 `outline`、不传 `status`，且当前是 `selected` → 自动进入 `outline_pending`。
- 其余状态前进、后退都允许。
- 带 `outlineJson` 时：保存 JSON 并 `outline_rev + 1`；如果带 `baseRev` 就先比对，
  不匹配 409 `rev_conflict`（响应带当前 `rev`，助手应重新 GET、在最新版上重做再写）。
  保存成功后服务器把「重写中」清空，并清掉那些块上的 feedback。
- 同时只带 `outlineJson`、不带 `outline` 时，服务器用 `outlineToMarkdown` 生成 Markdown
  写入 `outline_md`，因此也能让 `selected` 自动进入 `outline_pending`。

提交大纲（自动进入「大纲待确认」）：

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $DABAIHUA_CARDS_ASSISTANT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"assistant":"小燕子","outline":"# 大纲\n1. 开头\n2. 正文\n3. 结论"}' \
  https://superme.aigalaxy.top/api/briefs/2026-10-04/topics/kb-3/pipeline
```

设为「待审」：

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $DABAIHUA_CARDS_ASSISTANT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"assistant":"小燕子","status":"pending_review"}' \
  https://superme.aigalaxy.top/api/briefs/2026-10-04/topics/kb-3/pipeline
```

`status` 也可以用中文标签：`{"assistant":"小燕子","status":"待审"}`。

### 4.4 错误码

| HTTP | `error` | 含义 |
| --- | --- | --- |
| 400 | `请求体不是合法 JSON` 等 | body 不合法 |
| 401 | `unauthorized` | 没有有效凭证 |
| 403 | `owner_only` / `forbidden` | 助手不能做的操作；或缺权限 |
| 409 | `not_selected` | 这条选题还没被选中 |
| 409 | `shelved` | 这条选题已搁置 |
| 422 | `bad_status` | 状态 code/标签不认识 |
| 422 | `outline_required` | 要进 `outline_pending` 但没有大纲 |
| 422 | `outline_too_long` | 大纲超过 20000 字 |
| 422 | `assistant_required` | 用助手 token 但没传合法 `assistant` 名字 |
| 422 | `outline_json_invalid` | 结构化大纲形状不合法（响应可带 `field`） |
| 422 | `outline_json_too_large` | 结构化大纲超过 64KB |
| 422 | `too_many_sections` / `too_many_diagrams` | 小节超 12 / 配图超 6 |
| 409 | `rev_conflict` | `baseRev` 与服务器当前 `outlineRev` 不一致（响应带当前 `rev`） |
| 422 | `bad_base_rev` | `baseRev` 不是非负整数 |
| 422 | `base_rev_required` | Yu 页面自动保存没带 `baseRev` |
| 409 | `not_outline_pending` | 当前状态不是 `outline_pending` |
| 409 | `outline_json_required` | 还没有结构化大纲，不能存草稿 / 重生成 |
| 409 | `regenerating` | 已有一批块在重写中，一次只能一批 |
| 409 | `nothing_to_regenerate` | 重发 `regenerate_outline` 时没有重写中的块 |
| 422 | `bad_block_id` / `duplicate_block` | 重生成块 id 不存在 / 重复 |
| 422 | `suggestion_required` / `suggestion_too_long` | 重生成建议为空 / 超过 500 字 |

## 五、结构化大纲 outline/v0.1

结构化大纲存在 `brief_selections.outline_json` 里；`brief_selections.outline_md` 由服务器
用 `outlineToMarkdown()` 从 JSON 重新生成（确认时以 JSON 为准）。Yu 的页面改的是 JSON，
小燕子写回时两样都可以发，冲突以 JSON 为准。

字段（完整形状，省略号的都是必填块）：

```json
{
  "version": "outline/v0.1",
  "rev": 3,
  "titles": {
    "options": [{ "id": "t1", "text": "标题甲" }],
    "selected": "t1",
    "custom": null,
    "allowCustom": true,
    "feedback": "标题太软"
  },
  "corePoint": { "text": "核心观点一句话", "feedback": "再具体点" },
  "opening": { "kind": "real", "text": "开头场景", "sources": ["素材名"], "feedback": null },
  "sections": [{ "id": "s1", "heading": "小节标题", "points": ["要点一"], "keep": true, "feedback": null }],
  "diagrams": [
    {
      "id": "fig-1",
      "caption": "这张图想说明什么",
      "anchor": "s1",
      "mermaid": "flowchart LR\n  A --> B",
      "status": "draft",
      "feedback": null
    }
  ],
  "questions": [
    {
      "id": "q1",
      "text": "要 Yu 拍板的问题",
      "type": "single",
      "options": ["选项A", "选项B"],
      "default": "选项A",
      "answer": null,
      "custom": null,
      "feedback": null
    }
  ],
  "materials": [{ "label": "素材名", "path": "/workspace/…" }],
  "feedback": "整体再紧凑一点"
}
```

字段规则：

- **version** 必须是 `outline/v0.1`；**rev** 由服务器管理，请求里带的值一律忽略，响应里的
  `outlineJson.rev` 与 `outlineRev` 一致。
- **titles**：`options` 是 `{id, text}` 数组（≤ 8）；`selected` 存选中的 id（可为 null）；
  `custom` 存 Yu 自填标题，非空时优先；`allowCustom` 总是规范化成 `true`。
- **corePoint / opening**：必填。`opening.kind` 只能是 `real`（真实场景）或
  `hypothetical`（假设场景）；`opening.sources` 是字符串数组，页面上只显示名字。
- **sections**：必填、至少 1 节、最多 12 节；`id` 形如 `s1`、`s2`；`keep` 缺省 `true`，
  页面上勾掉即 `false`，Markdown 里不输出被勾掉的小节及其配图。
- **diagrams**：最多 6 张；`id` 形如 `fig-1`；`anchor` 必须是某个 section 的 id；
  `status` 缺省 `draft`，只能是 `draft` / `ok` / `redo`。
- **questions**：最多 12 个；`id` 形如 `q1`；`type` 为 `single` / `multi` / `text`；
  `single` 和 `text` 的 `default` / `answer` 是字符串，`multi` 是字符串数组（给单个字符串
  会被规范化为数组）；`custom` 存「其他」里自填的内容。
- **materials**：最多 30 个 `{label, path}`。
- **feedback**：可选，页面侧（Yu）写的「不好，重新生成」建议；空串等价于没有，保存时删掉。
  顶层 `feedback` 对应 blockId `all`。
- **上限**：整份 JSON ≤ 64KB（UTF-8 字节）、小节 ≤ 12、配图 ≤ 6、标题候选 ≤ 8、问题 ≤ 12、
  每节要点 ≤ 20、素材 ≤ 30、单条文本 ≤ 2000 字、mermaid ≤ 8000 字、feedback ≤ 500 字。
- **blockId**：`titles`、`corePoint`、`opening`、`s1…`、`fig-1…`、`q1…`、`all`（整份）。

### 5.1 并发与「重写中」

- 所有写 JSON 的请求都用 `outline_rev` 条件更新；不匹配时回 409 `rev_conflict`，响应体
  带当前 `rev`。助手收到后应重新 GET `pipeline`、在最新版上重做再写。
- PATCH 不带 `baseRev` 时不检查并发。
- PATCH 带 `outlineJson` 成功后，服务器会清空 `outline_regen_json`，并清掉原来在重写中的
  那些块上的 `feedback`。
- GET `pipeline` 返回的 `selection` 里有 `outlineJson`、`outlineRev` 和 `regenerating`
  （当前重写中的 `[{blockId, suggestion}]`）。

### 5.2 `/confirm-outline` 与 JSON

`POST /api/briefs/<date>/topics/<topicId>/confirm-outline` 的 body 可选带
`{ "outlineJson": …, "baseRev": … }`。给了就先保存 JSON，再用 JSON 生成 `outline_md`
覆盖（`outline_by` 记 `Yu`）；只要库里有 JSON，确认时都以 JSON 为准。
没有 JSON 的老流程保持原样：`outline_md` 非空才能确认。

### 5.3 Yu 侧两个新接口（不认助手 token）

这两个接口只给网站 admin 会话 / `topk_` key 用，需要 `assertSameOrigin`：

```
PUT  /api/briefs/<date>/topics/<topicId>/outline-draft
POST /api/briefs/<date>/topics/<topicId>/regenerate-outline
```

- `PUT outline-draft`：body `{ outlineJson, baseRev }`，`baseRev` 必填。只在
  `outline_pending` 且已有 `outline_json` 时允许；只保存 JSON（保留 feedback），
  不动 Markdown、不发通知、不改 `outline_by`。
- `POST regenerate-outline`：body `{ outlineJson?, baseRev?, blocks }`，`blocks` 必填。
  只在 `outline_pending` 且已有 `outline_json` 时允许；若已有块在重写中回 409
  `regenerating`。流程：先存 `outlineJson`（可选，带 rev 条件更新）、校验 `blocks`、
  把 diagram 块标 `redo`，写 `outline_regen_json`，再发 `regenerate_outline` 通知
  （`blocks`、`outlineJson`、`baseRev` = 新 rev）。通知失败不回滚。
- 手动重发：`POST .../notify` 传 `{ "event": "regenerate_outline" }` 可重发，取
  `outline_regen_json`；为空时 409 `nothing_to_regenerate`。`confirm_outline` /
  `regenerate_outline` 重发时都会带上 `outlineJson` 与 `baseRev`。
