# 文章推送协议 `dabaihua.article-push/v1`

把本地写好的 Markdown 文章（Obsidian 等）推进站点「文章」库的约定。服务端
`PUT /api/articles/<slug>` 和 `superme article push|sync` 都按这份文档实现；改协议先改这里。

## 1. 归属与权限

- 每篇文章属于一个账号（`articles.owner_id`）。推送永远写到**调用者自己的账号**下。
- 认证：调用者自己的 API Key（`Authorization: Bearer topk_…`，`superme login` 生成）或站内登录会话
  （会话写请求必须同源，带 `Origin`）。任何角色的账号都能推送自己的文章。
- **助手 token**：`Authorization: Bearer <DABAIHUA_CARDS_ASSISTANT_TOKEN>`（与照照镜子卡片、简报管线共用同一个 token），
  请求体必填 `assistant`（助手名字，≤ 20 字）。用助手 token 推送时作者固定为
  `ARTICLES_OWNER_ACCOUNT`（按 `account_normalized` 匹配）或最早注册的管理员，不认调用者身份。
  助手**只能写草稿**：不能发布（`status: published` / `isPublic: true` 都会返回 `403 assistant_draft_only`）、
  不能改公开状态（新文章私密，已有文章保持原值）、本接口本来就没有删除。已被改成非草稿状态的文章
  （`changes-requested` 除外：那表示 Yu 审稿后要求修改，助手可以重推修订稿，重推后状态回到 `draft`）
  返回 `409 article_locked`；审稿通过（`approved`）后只允许 `--stage typeset` 推排版，状态保持 `approved`。
  `topk_` key 与会话的行为不受影响，也拿不到助手分支的能力。
- 私密文章（`is_public = 0`）的列表、详情、图片、审稿接口、公开开关只对**所有者**可见可用；
  其他账号（包括别的管理员）看到的是 404。公开文章所有人可读。
- `slug` 全站唯一，不按账号分命名空间（文章网址 `/articles/<slug>` 和审稿数据都按 slug 关联）。
  slug 已属于别的账号 → `409 slug_taken`；slug 是服务器目录导入的文章（非推送来源）→ `409 slug_managed`。
  都不会覆盖。

## 2. 一篇文章 = 一个 Markdown 文件

- 文件可选 YAML frontmatter（只认下面这些键，其余忽略）：

| 键 | 含义 |
| --- | --- |
| `slug` | 文章标识，`[A-Za-z0-9][A-Za-z0-9._-]{0,120}`。没有时客户端生成（见 §5） |
| `title` | 标题。没有时取正文第一个 `# ` 标题，再没有取文件名 |
| `tags` | 列表或逗号分隔字符串 |
| `status` | `draft` 或 `published`；`published` 等于公开 |
| `public` | `true` / `false`，显式指定公开与否（优先于 `status`） |
| `publish` | `false` 时客户端跳过这个文件 |
| `date` | `YYYY-MM-DD`，文章日期 |

- 正文（frontmatter 之后的部分）**原样存储**：服务端不改写、不过滤内容，渲染时统一转义 HTML。
  客户端只做 §4 的格式归一。

## 3. 请求

`PUT /api/articles/<slug>`，`Content-Type: application/json`：

```json
{
  "protocol": "dabaihua.article-push/v1",
  "title": "标题",
  "markdown": "正文 Markdown",
  "status": "draft",
  "isPublic": false,
  "tags": ["a", "b"],
  "date": "2026-10-02",
  "sourcePath": "相对路径/文章.md",
  "contentHash": "<64 位 hex>",
  "assets": [
    { "name": "images/<sha256 前 12 位>.png", "sha256": "<64 位 hex>", "base64": "..." }
  ],
  "articleHtml": "<section>…</section>",
  "qaReport": "## QA\n…",
  "boardTopicId": 12,
  "brief": { "date": "2026-10-01", "topicId": "t-quiet-desk-01" },
  "stage": { "name": "revised", "round": 2 },
  "covers": [
    { "role": "21x9", "path": "images/0123456789ab.png" },
    { "role": "1x1", "path": "images/2109876543ba.png" }
  ],
  "assistant": "尔康"
}
```

- `title` 必填，单行，≤ 200 字符；`markdown` 必填，≤ 1 MB（UTF-8）。
- `status` 可选，`draft` | `published`，缺省 `draft`。
- `isPublic` 可选：给了就按它；没给时 `status = published` 视为 `true`，否则新文章私密、已有文章保持原状。
- `tags` ≤ 20 个，每个 ≤ 40 字符，不含换行和制表符。`date` 可选。
- `sourcePath` 可选，≤ 300 字符，只作记录。客户端只传**相对路径**（相对同步根目录），不传本机绝对路径。
- `articleHtml` 可选，字符串，≤ 1 MB（UTF-8）：成品排版 HTML（如 `article.html`）。服务端清洗后存入
  `articles.article_html`，渲染时优先于 Markdown。相对图片 `images/<sha12>.<ext>` 保持相对写法，
  渲染时再映射到 `/api/articles/<slug>/assets/…`。没给 → NULL（与 Markdown 一样是整体替换语义）。
- `qaReport` 可选，字符串，≤ 256KB（UTF-8）：QA 报告（如 `qa-report.md`），存入 `articles.qa_report`。没给 → NULL。
- `boardTopicId` 可选，正整数：看板 topic id，存入 `articles.topic_id`。新建时没给 → NULL；**更新时没给则保留原值**。
- `brief` 可选，`{ "date": "YYYY-MM-DD", "topicId": "…" }`，`topicId` 匹配
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$`：这篇文章出自哪个简报的哪个选题，写进 `meta_json.brief`。
- `stage` 可选，`{ "name": "drafted" | "revised" | "rewritten" | "typeset", "round": 正整数 }`（助手事件设计 §4.2 的
  阶段写回）：写进 `meta_json.stage`（`{ name, round, label, assistant, at }`，`label` 由服务端生成）并追加到
  `meta_json.stageHistory`（跨推送保留，最多 20 条；没带 `stage` 的推送也把旧历史带过去，但 `meta.stage` 只在本次带时写）。
  `revised` / `rewritten` 必须带 `round`；带 `round` 时要求那一轮已经提交过审稿（`articles.review_round > round`，
  新文章不行），否则 `422 round_not_reviewed`。name / round 不合法 → `422 invalid_stage`。
- `covers` 可选，≤ 3 条 `[{ "role": "21x9" | "1x1" | "cover", "path": "…" }]`（§4.3 的封面）：`path` 必须等于
  本次 `assets` 里的某个 `name`，`role` 不能重复，否则 `422 invalid_covers`。存 `meta_json.covers`；
  **没带 `covers` 的推送不保留旧封面**（封面跟着内容走）。
- `assistant` 只在助手 token 请求里有意义（§1）：助手名字，必填，≤ 20 字，不含换行；其他认证方式忽略它。
  `assistant` **不参与 contentHash**。
- `assets`：本次文章引用的全部本地图片，≤ 50 个。
  - `name` 必须是 `images/<sha256 前 12 位>.<ext>`，`ext` ∈ `png jpg jpeg gif webp svg`。
  - `sha256` 是图片字节的完整 sha256。
  - `base64` 可省略：服务端已经有同名同 hash 的图片就直接复用；没有就在 `missingAssets` 里报回来，客户端带上字节重发。
  - 单张图片 ≤ 2 MB（解码后）。
- 请求体总大小 ≤ 32 MB。

### contentHash

客户端和服务端用同一个算法，服务端以自己算出的值为准；客户端给的值对不上返回 `400 hash_mismatch`。
对下面这段 UTF-8 文本取 sha256（hex 小写），`\n` 为换行：

```
dabaihua.article-push/v1
title:<title>
status:<生效的 status>
public:<true|false，没给 isPublic 时为空>
date:<date，没有为空>
tags:<tags 用 \t 连接>
board:<boardTopicId 十进制>        ← 可选扩展行，只在字段给出时出现，顺序固定如下
brief:<brief.date>\t<brief.topicId>
html:<articleHtml 的 UTF-8 字节 sha256，hex 小写>
qa:<qaReport 的 UTF-8 字节 sha256，hex 小写>
stage:<name>:<round 十进制，没有为空>   ← stage 给出时才出现
cover:<role>:<path>        ← 每个封面一行，按 role 排序；covers 给出时才出现
asset:<name> <sha256>        ← 按 name 排序，每张一行，没有图片则没有这行
                             ← 一个空行
<markdown 原文>
```

六个可选扩展行（`board:`、`brief:`、`html:`、`qa:`、`stage:`、`cover:`）插在 `tags:` 与 `asset:` 之间，
按上面列出的顺序出现，**只在对应字段给出时才有那一行**（`undefined` / `null` / `""` 都算没给；
`covers: []` 算给出但没有行）。`html:` / `qa:` 存的是原文（清洗前）的字节 sha256。没有这六个字段时，
输出与旧算法**逐字节相同**，旧客户端算出的 hash 不变；`assistant` 永远不参与 hash。
`stage:` / `cover:` 行意味着只改阶段或只换封面也算内容变化（不会返回 `unchanged`）。

## 4. 图片与链接（客户端归一）

- 本地图片引用 `![alt](相对路径)`、`![[文件名.png]]`、`![[文件名.png|300]]`：在文件所在目录、同步根目录、
  Obsidian 附件目录里查找，按内容 hash 重命名成 `images/<sha12>.<ext>`，正文里的链接改成
  `![alt](images/<sha12>.<ext>)`。站点把它渲染为 `/api/articles/<slug>/assets/images/<sha12>.<ext>`。
- 远程图片 `![](https://…)` 原样保留，不下载。
- 同一张图被引用多次只上传一次（同 hash 同名）。超过 2 MB 的图片客户端先尝试压缩（macOS `sips`），
  仍然过大或找不到文件时保留原文本并给出警告，不中断推送。
- `[[笔记]]` / `[[笔记|别名]]`：已推送过的笔记改成 `[别名](/articles/<slug>)`，否则保留为纯文本别名。
  `![[笔记]]`（嵌入笔记）同样处理成链接。
- `%%注释%%` 删除；`==高亮==` 改成 `**高亮**`。

## 5. 同 slug 覆盖与去重

- 同一账号同一 slug 再推送 = 覆盖：标题、正文、状态、标签、图片集合按本次请求整体替换，
  本次没引用的旧图片删除。审稿数据（轮次、标记、反馈）不动。
- 算出的 contentHash 和库里一样 → 不写库，返回 `unchanged`。
- 客户端没写 `slug` 时，从标题生成 ASCII slug（小写字母数字和 `-`）；标题没有可用的 ASCII 字符时用
  `n-<sha256("<上级目录名>/<文件名>") 前 10 位>`（旧的按相对路径生成会让所有 `02-final.md` 撞 slug）。
  路径 → slug、上次 contentHash、已上传图片 hash 记在
  `~/.config/topics-cli/articles.json`，`sync` 只推有变化的文件。

## 6. 响应

- `201` 新建 / `200` 更新或未变：

```json
{ "ok": true, "result": "created|updated|unchanged", "slug": "…", "url": "/articles/…",
  "contentHash": "…", "isPublic": false,
  "assets": { "stored": 1, "reused": 2, "removed": 0 } }
```

- 错误统一 `{ "error": "中文说明", "code": "…" }`：
  `401 unauthorized`、`403 forbidden`（会话写请求不同源）、`400 invalid`（字段不合法）、
  `400 hash_mismatch`、`403 assistant_draft_only`（助手试图发布 / 公开）、
  `409 slug_taken`、`409 slug_managed`、`409 article_locked`（附 `"status": "…"`，助手想覆盖
  已被改成非草稿状态的文章）、`413 too_large`、`422 missing_assets`（附 `"missingAssets": ["images/…"]`）、
  `422 assistant_required`（助手 token 推送没带 assistant 名字）、`422 invalid_stage`
  （`stage` 的 name / round 不合法，或 `revised` / `rewritten` 缺 `round`）、`422 round_not_reviewed`
  （`第 N 轮还没有提交审稿`：stage 带的 `round` 还没提交过审稿）、`422 invalid_covers`（`covers` 的
  role 不合法 / 重复、条数超过 3，或 path 不在本次 `assets` 里）、
  `503 owner_unavailable`（文章归属账号解析不出来）。

## 7. 存储

图片存在站点自己的 `article_assets` 表里，由 `/api/articles/<slug>/assets/<path>` 提供，私密文章的图片同样只给所有者。
服务端通过 `lib/article-assets.ts` 的 `ArticleAssetStore` 接口读写（`list / get / put / remove / urlFor`），
以后换对象存储（如阿里云 OSS）只需要换实现，协议和正文里的 `images/<sha12>.<ext>` 写法不变。

## 8. 文章目录（meta.json）

「一篇文章 = 一个 Markdown 文件」（§2）之外的另一种单位：同步根目录下某个子目录（或推送目标本身）
里有 `meta.json` 时，**整个目录是一篇文章**。字段来源（`meta.` 指 `meta.json` 里的键）：

- `slug` = `meta.slug`（不合法则跳过并报错）> 目录名（合法时）> state 里记录的 slug > 从标题生成
  （§5，hash 键用 `<目录名>/<正文文件名>`）；
- `title` = `meta.title`，没有再按 §2 的规则（frontmatter / 第一个 `# ` / 文件名）；
- `date` = `meta.brief_date`，没有再 `meta.date`；非 `YYYY-MM-DD` 不传；
- `markdown`：回退链 `meta.final` → `02-final.md` → `meta.draft` → `01-draft.md`，取第一个存在的
  （定稿前也能先推初稿，定稿后自然换成 `02-final.md`），都不存在则跳过并报错；正文照旧解析 frontmatter
  （tags 生效）、按 §4 归一；
- `status` 固定 `draft`（`meta.json` 里的 `status` 如 `ready-for-review` 不是协议状态，忽略）；
  `--public`（非助手模式）时另传 `isPublic: true`；
- `articleHtml` = `meta.layout.html`（字符串时）或 `article.html` 的内容，其中 `<img src="images/…">` 等
  本地图片按内容 hash 改写成 `images/<sha12>.<ext>` 并作为 assets 一起上传（找不到或路径不支持则
  保留原值并给警告）；
- `qaReport` = `meta.qa_report`（字符串时）或 `qa-report.md` 的内容；
- `brief` = `{ date: meta.brief_date, topicId: str(meta.topic_id) }`，两者都有才带；
- `boardTopicId` = `meta.board_topic_id`（正整数才带）；
- `sourcePath` = `<目录名>/<正文文件名>`（相对，绝不传本机绝对路径）。

父目录推送（push/sync 一个包含多个文章目录的目录）时，每个含 `meta.json` 的子目录各算一篇且不进入其
内部；其余普通 `.md` 照旧按 §2 单文件推送；文章目录内部的其它 `.md` 不推送。图片重写、上传、
contentHash 都按 §3 / §4 的规则。

## 9. 助手用法（CLI）

`superme article push` 用助手 token 推送整篇文章目录，例如：

```sh
set -a; . ~/.config/handbook/env; set +a; SUPERME_TOKEN="$HANDBOOK_TOKEN" superme article push <文章目录> --assistant 尔康 --stage typeset
```

排版完成推 `--stage typeset`；初稿推 `--stage drafted`，按第 N 轮反馈改稿 / 重写 / 改排版推
`--stage revised|rewritten|typeset --round N`（阶段语义与反馈读取见 §10）。

`HANDBOOK_TOKEN` 就是 `DABAIHUA_CARDS_ASSISTANT_TOKEN`，由 Yu 分发，绝不进仓库。

- 助手名字来自 `--assistant <名字>` 或环境变量 `SUPERME_ASSISTANT`，1–20 个字符，随请求体 `assistant`
  字段发送（不参与 contentHash）。助手模式强制 `status: draft`、不传 `isPublic`，与 `--public` 互斥；
  frontmatter 里的 `published` / `public: true` 被忽略并给警告。
- `SUPERME_TOKEN` 非空时优先于 config 里的 token（普通模式与助手模式都生效）；助手模式下没有
  `SUPERME_TOKEN` 时依次回退 `DABAIHUA_CARDS_ASSISTANT_TOKEN`、`HANDBOOK_TOKEN`。
- `SUPERME_ENDPOINT` 非空时覆盖 config 的 endpoint。
- `--dry-run` 只在本机预览：不联网、不写 state。文章目录模式逐项打印 slug、标题、日期、状态/公开、
  正文文件、article.html（有/无及改写图片数）、qa-report（有/无）、brief、boardTopicId、助手名字、
  每个 asset 一行 `images/<sha12>.<ext> ← <本地相对文件名> <KB> 上传|已上传`（按 state 判断）
  以及全部警告；单文件模式保持一行式摘要。

## 10. 审稿反馈与阶段写回（助手）

Yu 在审稿页提交反馈后，会按 `docs/shufangzhai-protocol.md` §3.5 的 `article_review_submitted`
事件通知漱芳斋，由 `handoff` 字段转交给紫薇 / 小燕子 / 尔康。被转交的助手用本节的接口读反馈、
改稿、带阶段写回。

### 10.1 读审稿反馈（只读）

助手 token（`Authorization: Bearer $HANDBOOK_TOKEN`）只读，仅对 article 生效：

```
GET /api/review/article/<slug>/feedback?round=N    # 某一轮完整反馈（缺省最新已提交轮）
GET /api/review/article/<slug>/rounds               # 已提交轮次列表（含每轮 notify 结果）
```

其他审稿接口（提交、标记、重试通知）仍需登录会话 / 文章所有者，不认助手 token。
`feedback` 返回 `{ feedback: … }`，字段（`dabaihua.review-feedback/v1`）：

| 字段 | 说明 |
| --- | --- |
| `round` | 轮次，正整数 |
| `verdict` | `approved` 确认通过 / `changes_requested` 要求修改 / `comments` 批注 |
| `overallComment` | 总体意见 |
| `reviewer.nickname` | 审稿人昵称（不带 id / 邮箱） |
| `submittedAt` | 提交时间 |
| `contentHash` | 被审那一版的 contentHash（对应哪一稿） |
| `marks[]` | 每条：`type`（`good` 写得好 / `change` 要改）、`quote` 被标原文、`comment` 意见、`prefix` / `suffix` 前后文（用它在本地稿里定位） |
| `counts` | `good` / `change` 数量 |

CLI（`superme article feedback <slug> [--round N] [--json] [--assistant 名字]`）：

```sh
set -a; . ~/.config/handbook/env; set +a
SUPERME_TOKEN="$HANDBOOK_TOKEN" superme article feedback <slug> --round 2 --assistant 紫薇
```

输出示例：

```
《示例稿》 第 2 轮 · 要求修改   审稿人 Yu · 2026-10-04T22:29:00+08:00
总体意见：开头两段铺垫太长，直接从场景切入
要改（1）
  1. 「在我看来这个框架的核心不是工具」
     → 这句判断太弱，给出理由
写得好（1）
  1. 「这一段把机制讲清楚了」
     → 写得好，别动
contentHash: 3e2f1a0b…
```

`--json` 原样输出服务端返回的 JSON（quote 不截断，带 prefix / suffix）。

### 10.2 阶段写回 `--stage`

改完稿子用 `superme article push <文章目录> --assistant <名字> --stage <name> [--round N]`
推送（请求体 `stage`，见 §3）；四种取值：

| `--stage` | 页面标签 | 何时用 | `--round` |
| --- | --- | --- | --- |
| `drafted` | 初稿完成 | 小燕子第一次交稿 | 不带 |
| `revised` | 已按第 N 轮改完 | 紫薇按第 N 轮反馈改稿后 | 必带 |
| `rewritten` | 已按第 N 轮重写 | 小燕子按第 N 轮反馈重写后 | 必带 |
| `typeset` | 排版完成，待审 / 已按第 N 轮改完排版 | 尔康排版完成 / 按第 N 轮改排版 | 可选 |

- 只写 `--round N` 等同 `--stage revised --round N`。
- 带 `round` 时那一轮必须已提交过审稿，否则 `422 round_not_reviewed`（新文章不能带 round）。
- 阶段写进 `meta.stage`（`{ name, round, label, assistant, at }`）、追加到 `meta.stageHistory`
  （跨推送保留，最多 20 条）；审稿页页头显示阶段徽标，页头下方「进度」列最近几条历史。
- 阶段行参与 contentHash（`stage:<name>:<round>`），只改阶段也算 changed，不会返回 `unchanged`。

### 10.3 封面

文章目录里放 `images/cover-21x9.*`（21:9 横版）与 `images/cover-1x1.*`（1:1 方版），
CLI 自动作为封面资产上传（请求体 `covers`，见 §3）；或用 `meta.json` 的 `cover` 字段显式指定
（优先于自动发现；字符串 = role `cover`，对象 = `{21x9/1x1/cover: 路径}`，路径相对文章目录）。
封面存 `meta.covers`，显示在审稿页标题下；封面行参与 contentHash
（`cover:<role>:<path>`），只换封面也算 changed。**没带 `covers` 的推送不保留旧封面**
（封面跟着内容走），重推正文时记得连封面一起放回目录。
