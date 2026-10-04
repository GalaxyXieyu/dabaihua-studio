# 助手事件注册表（设计）

Yu 在网页上做的决定，凡是需要助手接手的，都登记在一张注册表里：新增一个事件 = 加一条配置。
本文是设计；实现后注册表在 `lib/assistant-events.ts`，对外文档 `docs/assistant-events.md` 由
`node scripts/gen-assistant-events-doc.mjs` 从注册表生成（测试会校验生成结果与仓库里的文件一致）。

## 0. 命名约定

- 注册表键一律 `domain.action`：domain 是页面 / 业务域（`brief`、`article`、`topic`、`cards`、`itch`，以后的英语页按画饼规格取名，如 `speaking`），
  action 用过去式或名词短语描述 Yu 做了什么（`review_submitted`、`response_decided`）。
- 线上事件名（payload.event / `x-dabaihua-event`）新事件与键的 action 部分一致（`article_review_submitted`）；
  简报四个老事件 `select` / `confirm_outline` / `regenerate_outline` / `cancel` 作为别名保留，线上名与 payload 不变。

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
- handoff：Yu 在提交面板可手选「交给：自动 / 紫薇 / 小燕子 / 尔康」（提交体 `handoff`），手选优先；自动规则见 §4.1。
- 写回（统一的阶段机制，§4.2）。

### 4.1 自动 handoff 规则

1. `approved` → 尔康（排版定稿）。
2. 收集总体意见与所有「要改」标记的意见（非空）。任一条命中结构词（重写|换观点|改观点|改结构|推翻|整段|重来|换角度|换个角度）→ 小燕子。
3. 全部命中排版词（排版|配图|图片|插图|封面|字号|行距|间距|样式|版式|配色|layout）且都不含文字词 → 尔康。
4. 其余 → 紫薇。

### 4.2 阶段写回 `stage`

- 推送请求体可选 `stage: { name, round? }`，name ∈ `drafted`（初稿完成）、`revised`（已按第 N 轮改完）、`rewritten`（已按第 N 轮重写）、
  `typeset`（排版完成，待审；带 round 时为「已按第 N 轮改完排版」）。`revised` / `rewritten` 必须带 round；带 round 时第 N 轮必须已提交审稿（否则 422 `round_not_reviewed`）。
- 服务端：`meta.stage = { name, round, label, assistant, at }`，`meta.stageHistory` 追加同一条（跨推送保留，最多 20 条）；状态规则不变（助手写 draft）。
  contentHash 在存在时追加扩展行 `stage:<name>:<round 或空>`，所以只改阶段也算 changed。
- CLI：`superme article push <dir> --stage <name> [--round N]`；只写 `--round N` 等同 `--stage revised --round N`。
- 审稿页页头显示当前阶段徽标，页头下方「进度」列出最近几条历史。

### 4.3 封面

- 文章目录里的 `images/cover-21x9.*`、`images/cover-1x1.*` 或 meta.json 的 cover 字段，CLI 作为资产上传，请求体
  `covers: [{ role: "21x9"|"1x1"|"cover", path: "images/<sha12>.<ext>" }]`；contentHash 扩展行 `cover:<role>:<path>`（只换封面也算 changed）。
- 服务端存 `meta.covers`，审稿页标题下显示封面。

## 5. 简报反馈（晴儿）

- `brief.response_decided`（启用）：`POST /api/briefs/<d>/responses` 里 decision 实际变化（pick / reject / 清空）时发，target shufangzhai，
  handoff 晴儿，payload `protocol: dabaihua.brief-response/v1, event, eventId, sentAt, date, topicId, decision, rejectReason, rating, ratingComment, scenario{index,custom}, answers, cc: ["晴儿"], links`。
- 读：`GET /api/briefs/responses?date=|since=` 接受助手 token（只读）；`superme brief responses [--date D | --since ISO]`。
- 打分 / 评语 / 答案是逐字段自动保存，不逐次推送；`brief.responses_digest` 记为 next（disabled）。

## 6. 先登记、暂不启用的事件

`topic.review_decision`、`cards.decision`、`itch.status`、`brief.responses_digest`、`brief.diagram_reviewed`：目标助手不明确，条目 `enabled: false`、
`target: null`，不接调用点。启用时：定目标 → 改条目 → 在对应路由写库成功后调 `sendAssistantEvent`。
