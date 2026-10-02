# 文章推送协议 `dabaihua.article-push/v1`

把本地写好的 Markdown 文章（Obsidian 等）推进站点「文章」库的约定。服务端
`PUT /api/articles/<slug>` 和 `superme article push|sync` 都按这份文档实现；改协议先改这里。

## 1. 归属与权限

- 每篇文章属于一个账号（`articles.owner_id`）。推送永远写到**调用者自己的账号**下。
- 认证：调用者自己的 API Key（`Authorization: Bearer topk_…`，`superme login` 生成）或站内登录会话
  （会话写请求必须同源，带 `Origin`）。任何角色的账号都能推送自己的文章。
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
  ]
}
```

- `title` 必填，单行，≤ 200 字符；`markdown` 必填，≤ 1 MB（UTF-8）。
- `status` 可选，`draft` | `published`，缺省 `draft`。
- `isPublic` 可选：给了就按它；没给时 `status = published` 视为 `true`，否则新文章私密、已有文章保持原状。
- `tags` ≤ 20 个，每个 ≤ 40 字符，不含换行和制表符。`date` 可选。
- `sourcePath` 可选，≤ 300 字符，只作记录。客户端只传**相对路径**（相对同步根目录），不传本机绝对路径。
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
asset:<name> <sha256>        ← 按 name 排序，每张一行，没有图片则没有这行
                             ← 一个空行
<markdown 原文>
```

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
  `n-<路径 sha256 前 10 位>`。路径 → slug、上次 contentHash、已上传图片 hash 记在
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
  `400 hash_mismatch`、`409 slug_taken`、`409 slug_managed`、`413 too_large`、
  `422 missing_assets`（附 `"missingAssets": ["images/…"]`）。

## 7. 存储

图片存在站点自己的 `article_assets` 表里，由 `/api/articles/<slug>/assets/<path>` 提供，私密文章的图片同样只给所有者。
服务端通过 `lib/article-assets.ts` 的 `ArticleAssetStore` 接口读写（`list / get / put / remove / urlFor`），
以后换对象存储（如阿里云 OSS）只需要换实现，协议和正文里的 `images/<sha12>.<ext>` 写法不变。
