# 助手事件

Yu 在网页上做的、需要助手接手的决定，都登记在 `lib/assistant-events.ts` 注册表里：新增事件 = 加一条配置。本文由 `scripts/gen-assistant-events-doc.mjs` 从注册表生成（`npm run events:doc`），勿手改。

漏收 webhook 时用 `superme events --follow-state` 拉取事件日志（含 payload）。

## 命名约定

- 注册表键一律 `domain.action`：domain 是页面 / 业务域（`brief`、`article`、`topic`、`cards`、`itch`，以后的英语页按画饼规格取名，如 `speaking`），action 用过去式或名词短语描述 Yu 做了什么（`review_submitted`、`response_decided`）。
- 线上事件名（payload.event / `x-dabaihua-event`）新事件与键的 action 部分一致（`article_review_submitted`）；简报四个老事件 `select` / `confirm_outline` / `regenerate_outline` / `cancel` 作为别名保留，线上名与 payload 不变。

## Webhook 目标

只列 env 变量名；发送规则：POST JSON + `x-dabaihua-event`，默认 `Authorization: Bearer <secret>`（配置了自定义头则原样发 secret），8 秒超时。

| 目标 | URL 环境变量 | Secret 环境变量 | Auth 头环境变量 |
| --- | --- | --- | --- |
| `shufangzhai` | `SHUFANGZHAI_WEBHOOK_URL` | `SHUFANGZHAI_WEBHOOK_SECRET` | `SHUFANGZHAI_WEBHOOK_AUTH_HEADER` |

## 事件

| key | event | protocol | 页面 / 接口 | 目标 | handoff | cc | 启用 | payload 字段 | 读命令 | 写回 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `brief.select` | `select` | `dabaihua.brief-notify/v1` | 简报页 POST /api/briefs/<date>/topics/<topicId>/select | `shufangzhai` | 小燕子 | - | 是 | protocol, event, eventId, sentAt, topic, scenario, answers, outline, status, boardTopicId, links | superme brief pipeline <date> <topicId> | PATCH /api/briefs/<date>/topics/<topicId>/pipeline | 线上名 `select` 为旧别名，payload 不变 |
| `brief.confirm_outline` | `confirm_outline` | `dabaihua.brief-notify/v1` | 简报页 POST /api/briefs/<date>/topics/<topicId>/confirm-outline | `shufangzhai` | 小燕子 | - | 是 | protocol, event, eventId, sentAt, topic, scenario, answers, outline, outlineJson, baseRev, status, boardTopicId, links | superme brief pipeline <date> <topicId> | PATCH /api/briefs/<date>/topics/<topicId>/pipeline | 线上名 `confirm_outline` 为旧别名，payload 不变 |
| `brief.regenerate_outline` | `regenerate_outline` | `dabaihua.brief-notify/v1` | 简报页 POST /api/briefs/<date>/topics/<topicId>/regenerate-outline | `shufangzhai` | 小燕子 | - | 是 | protocol, event, eventId, sentAt, topic, scenario, answers, outline, outlineJson, baseRev, blocks, status, boardTopicId, links | superme brief pipeline <date> <topicId> | PATCH /api/briefs/<date>/topics/<topicId>/pipeline | 线上名 `regenerate_outline` 为旧别名，payload 不变 |
| `brief.cancel` | `cancel` | `dabaihua.brief-notify/v1` | 简报页 POST /api/briefs/<date>/topics/<topicId>/undo | `shufangzhai` | 小燕子 | - | 是 | protocol, event, eventId, sentAt, topic, scenario, answers, outline, status, boardTopicId, links | superme brief pipeline <date> <topicId> | PATCH /api/briefs/<date>/topics/<topicId>/pipeline | 线上名 `cancel` 为旧别名，payload 不变 |
| `brief.response_decided` | `response_decided` | `dabaihua.brief-response/v1` | 今日简报「不要」/ 清空决定（POST /api/briefs/<date>/responses，decision 变化时） | `shufangzhai` | 晴儿 | 晴儿 | 是 | protocol, event, eventId, sentAt, date, topicId, decision, rejectReason, rating, ratingComment, scenario, answers, cc, links | superme brief responses --date <date> | - | - |
| `article.review_submitted` | `article_review_submitted` | `dabaihua.review-notify/v1` | 文章审稿页 POST /api/review/article/<slug>/submit | `shufangzhai` | rule:Yu 手选优先；自动：结构性意见→小燕子，纯排版配图→尔康，其余文字修改→紫薇；通过→尔康 | - | 是 | protocol, event, eventId, sentAt, article, review, handoff, links | superme article feedback <slug> --round N --assistant <名字> | superme article push <文章目录> --assistant <handoff> --stage revised\|rewritten\|typeset --round N | - |
| `topic.review_decision` | `topic_review_decision` | `dabaihua.topic-notify/v1` | 选题看板 POST /api/topics/<id>/reviews | - | TBD | - | 否 | topicId, decision, comment | superme board | - | - |
| `cards.decision` | `cards_decision` | `dabaihua.cards-notify/v1` | 照照镜子 POST /api/cards/<id>/confirm\|reject | - | TBD | - | 否 | cardId, action, reason, version | GET /api/cards | - | - |
| `itch.status` | `itch_status` | `dabaihua.itch-notify/v1` | 心结页 PATCH /api/itches/<id> | - | TBD | - | 否 | itchId, status, note | superme itch | - | - |
| `brief.responses_digest` | `responses_digest` | `dabaihua.brief-response/v1` | 简报页打分 / 评语 / 答案（逐字段自动保存） | - | 晴儿 | - | 否 | date, responses | superme brief responses --date <date> | - | - |
| `brief.diagram_reviewed` | `diagram_reviewed` | `dabaihua.brief-notify/v1` | 简报页大纲配图 diagrams.status ok/redo | - | 尔康 | - | 否 | date, topicId, diagrams | superme brief pipeline <date> <topicId> | - | - |

## 助手写回与读取（入站）

出站事件之外，助手用下面这些命令 / 接口写回和读取状态（也来自 `lib/assistant-events.ts` 的 `ASSISTANT_INBOUND` 注册表）：

| key | 命令 | API | 效果 |
| --- | --- | --- | --- |
| `article.stage` | `superme article push <dir> --assistant <名字> --stage drafted\|revised\|rewritten\|typeset [--round N]` | `PUT /api/articles/<slug>（body.stage）` | 记 meta.stage 与 stageHistory，审稿页显示阶段徽标与进度 |
| `article.feedback` | `superme article feedback <slug> [--round N] [--json]` | `GET /api/review/article/<slug>/feedback` | 助手 token 只读，含 round、overallComment、marks（good/change，quote+comment） |
| `brief.responses` | `superme brief responses [--date D \| --since ISO]` | `GET /api/briefs/responses` | 助手 token 只读 |
| `brief.pipeline` | `superme brief pipeline <date> <topicId>` | `GET/PATCH /api/briefs/<date>/topics/<topicId>/pipeline` | 读状态 / 写回状态与大纲 |
| `events.log` | `superme events [--after-id N] [--key k] [--follow-state]` | `GET /api/assistant-events` | 拉取事件日志（含 payload），漏收 webhook 时兜底 |
