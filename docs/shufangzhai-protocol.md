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

事件只有三个：`select`、`confirm_outline`、`cancel`。

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

只允许改 `status` 和 `outline`，没有删除接口，也不能调用选 / 撤销 / 确认大纲。

规则：

- 选题必须已经被选中，且不能是 `shelved`，否则 409 `not_selected` / `shelved`。
- 不能设 `selected` / `shelved`，也不能把 `outline_pending` 推到 `drafting` → 403 `owner_only`。
- `outline_pending` 必须有大纲（本次或已存），否则 422 `outline_required`。
- 只传 `outline`、不传 `status`，且当前是 `selected` → 自动进入 `outline_pending`。
- 其余状态前进、后退都允许。

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
