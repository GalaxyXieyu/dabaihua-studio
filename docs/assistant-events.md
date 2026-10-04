# 助手事件

Yu 在网页上做的、需要助手接手的决定，都登记在 `lib/assistant-events.ts` 注册表里：新增事件 = 加一条配置。本文由 `scripts/gen-assistant-events-doc.mjs` 从注册表生成（`npm run events:doc`），勿手改。

## Webhook 目标

只列 env 变量名；发送规则：POST JSON + `x-dabaihua-event`，默认 `Authorization: Bearer <secret>`（配置了自定义头则原样发 secret），8 秒超时。

| 目标 | URL 环境变量 | Secret 环境变量 | Auth 头环境变量 |
| --- | --- | --- | --- |
| `shufangzhai` | `SHUFANGZHAI_WEBHOOK_URL` | `SHUFANGZHAI_WEBHOOK_SECRET` | `SHUFANGZHAI_WEBHOOK_AUTH_HEADER` |

## 事件

| key | event | protocol | 页面 / 接口 | 目标 | handoff | 启用 | payload 字段 | 读命令 | 写回 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `brief.select` | `select` | `dabaihua.brief-notify/v1` | 简报页 POST /api/briefs/<date>/topics/<topicId>/select | `shufangzhai` | 小燕子 | 是 | protocol, event, eventId, sentAt, topic, scenario, answers, outline, status, boardTopicId, links | superme brief pipeline <date> <topicId> | PATCH /api/briefs/<date>/topics/<topicId>/pipeline |
| `brief.confirm_outline` | `confirm_outline` | `dabaihua.brief-notify/v1` | 简报页 POST /api/briefs/<date>/topics/<topicId>/confirm-outline | `shufangzhai` | 小燕子 | 是 | protocol, event, eventId, sentAt, topic, scenario, answers, outline, outlineJson, baseRev, status, boardTopicId, links | superme brief pipeline <date> <topicId> | PATCH /api/briefs/<date>/topics/<topicId>/pipeline |
| `brief.regenerate_outline` | `regenerate_outline` | `dabaihua.brief-notify/v1` | 简报页 POST /api/briefs/<date>/topics/<topicId>/regenerate-outline | `shufangzhai` | 小燕子 | 是 | protocol, event, eventId, sentAt, topic, scenario, answers, outline, outlineJson, baseRev, blocks, status, boardTopicId, links | superme brief pipeline <date> <topicId> | PATCH /api/briefs/<date>/topics/<topicId>/pipeline |
| `brief.cancel` | `cancel` | `dabaihua.brief-notify/v1` | 简报页 POST /api/briefs/<date>/topics/<topicId>/undo | `shufangzhai` | 小燕子 | 是 | protocol, event, eventId, sentAt, topic, scenario, answers, outline, status, boardTopicId, links | superme brief pipeline <date> <topicId> | PATCH /api/briefs/<date>/topics/<topicId>/pipeline |
| `article.review_submitted` | `article_review_submitted` | `dabaihua.review-notify/v1` | 文章审稿页 POST /api/review/article/<slug>/submit | `shufangzhai` | rule:要求修改/批注→紫薇（全是排版配图意见→尔康）；通过→尔康 | 是 | protocol, event, eventId, sentAt, article, review, handoff, links | superme article feedback <slug> [--round N] | superme article push <文章目录> --assistant 紫薇 --round N |
| `topic.review_decision` | `topic_review_decision` | `dabaihua.topic-notify/v1` | 选题看板 POST /api/topics/<id>/reviews | - | TBD | 否 | topicId, decision, comment | superme board | - |
| `cards.decision` | `cards_decision` | `dabaihua.cards-notify/v1` | 照照镜子 POST /api/cards/<id>/confirm\|reject | - | TBD | 否 | cardId, action, reason, version | GET /api/cards | - |
| `itch.status` | `itch_status` | `dabaihua.itch-notify/v1` | 心结页 PATCH /api/itches/<id> | - | TBD | 否 | itchId, status, note | superme itch | - |
| `brief.response` | `brief_response` | `dabaihua.brief-response-notify/v1` | 简报页 POST /api/briefs/<date>/responses | - | TBD | 否 | date, topicId, rating, decision, rejectReason | - | - |
