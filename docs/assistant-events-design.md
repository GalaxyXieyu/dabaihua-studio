# 助手事件注册表（设计）

Yu 在网页上做的决定，凡是需要助手接手的，都登记在一张注册表里：新增一个事件 = 加一条配置。
本文是设计；实现后注册表在 `lib/assistant-events.ts`，对外文档 `docs/assistant-events.md` 由
`node scripts/gen-assistant-events-doc.mjs` 从注册表生成（测试会校验生成结果与仓库里的文件一致）。

## 1. 注册表条目

```ts
type AssistantEventDef = {
  key: string;            // 注册表键，如 "article.review_submitted"
  event: string;          // 线上事件名：payload.event 与请求头 x-dabaihua-event
  protocol: string;       // payload.protocol，如 "dabaihua.review-notify/v1"
  page: string;           // Yu 在哪个页面 / 接口做决定
  target: string | null;  // webhook 目标键（见 §2）；null = 目标 TBD
  handoff: string;        // 实际该谁接手；固定名字或 "rule:<说明>"
  enabled: boolean;       // false：不发送（发送函数返回 state "disabled"）
  payloadFields: string[];// payload 顶层字段，文档与测试都用它
  read: string;           // 助手重新读取状态的 superme 命令 / 接口
  writeBack?: string;     // 助手做完后的写回命令（可选）
};
```

## 2. webhook 目标

```ts
const WEBHOOK_TARGETS = {
  shufangzhai: { urlEnv: "SHUFANGZHAI_WEBHOOK_URL", secretEnv: "SHUFANGZHAI_WEBHOOK_SECRET", authHeaderEnv: "SHUFANGZHAI_WEBHOOK_AUTH_HEADER" },
};
```

- 今天只有漱芳斋（小燕子）一个目标；其他助手的事件也发给她，由 payload 的 `handoff` 字段说明该转给谁。
- 以后某个助手有自己的 webhook：在 `WEBHOOK_TARGETS` 加一项（`<NAME>_WEBHOOK_URL/_SECRET/_AUTH_HEADER`），
  把相关事件的 `target` 改过去即可，调用方不用改。
- 发送规则不变：POST JSON，`x-dabaihua-event: <event>`，默认 `Authorization: Bearer <secret>`（配置了自定义头则原样发 secret），
  8 秒超时；2xx = delivered，其余 = failed，没有 URL = unconfigured，条目 disabled = disabled。永不抛出，调用方的写库决定必须成功。
  日志 / 落库只存 host，不存完整 URL 和 secret。

## 3. 发送与记录

- `sendAssistantEvent(env, key, payload)`（`lib/assistant-notify.ts`）：查注册表 → 选目标 → 发送 → 返回 `{ state, httpStatus?, error?, at }`，
  并写一行通用日志 `assistant_notify_log`（key、event、ref、state、http_status、error、duration_ms、target_host、created_at）。
- 各业务仍把「最近一次通知」写回自己的表：简报 → `brief_selections.notify_*` 与 `brief_notify_log`（保持现状）；
  文章审稿 → `review_rounds.notify_*`（新增列）。
- 简报四个事件迁到注册表后 **payload 与请求头逐字节不变**（`buildNotifyPayload` 不动，只换发送函数）。

## 4. 本次启用的新事件：`article.review_submitted`

- 触发：文章审稿页提交（`approved` / `changes_requested` / `comments`）。审稿写库成功后再发；失败只记录。
- payload（`dabaihua.review-notify/v1`）：`protocol, event, eventId, sentAt, article{slug,title,status,sourcePath,articleDir,assistant,brief,boardTopicId,revisedForRound}, review{round,verdict,overallComment,reviewer{nickname},submittedAt,contentHash,counts,marks[]}, handoff{assistant,reason}, links{review,feedback}`。
  `marks[]` 每条：`type`（good/change）、`quote`（原文）、`comment`、`prefix/suffix`、`blockIndex`。
- handoff 规则：`approved` → 尔康（排版定稿）；`changes_requested` / `comments` → 紫薇，除非所有非空意见都只谈排版配图
  （命中「排版|配图|图片|封面|字号|行距|间距|样式|版式」且不含文字类词）→ 尔康。规则写在注册表旁，测试覆盖。
- 审稿页提交后显示通知状态（已通知助手 · handoff 名字 / 通知失败 + 重试 / 未配置通知），重试接口
  `POST /api/review/article/<slug>/notify`（仅文章所有者会话）。
- 助手读反馈：`GET /api/review/article/<slug>/feedback[?round=N]` 接受助手 token（只读，仅 article）；
  `superme article feedback <slug> [--round N] [--json]`。
- 写回：`superme article push <dir> --assistant 紫薇 --round N` → 请求体 `revisedForRound: N`，服务端记
  `meta_json.revisedForRound/revisedAt`，状态回到 draft，审稿页显示「已按第 N 轮改完」。

## 5. 先登记、暂不启用的事件

`topic.review_decision`、`cards.decision`、`itch.status`、`brief.response`：目标助手不明确，条目 `enabled: false`、
`target: null`，不接调用点。启用时：定目标 → 改条目 → 在对应路由写库成功后调 `sendAssistantEvent`。
