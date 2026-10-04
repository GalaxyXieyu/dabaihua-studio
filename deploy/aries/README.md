# Aries 部署操作手册

`dabaihua-studio` 通过 ssh 主机别名 `Aries`（用户 `ubuntu`）部署运行，Caddy 终止
TLS（`https://superme.aigalaxy.top`；旧域名 `topic.aigalaxy.top` 的浏览器页面 302 跳到新域名，`/api/*` 与非 GET/HEAD 请求照常代理）并反向代理到 `127.0.0.1:3210`。

## 目录布局

| 路径 | 用途 |
| --- | --- |
| `/home/ubuntu/dabaihua-studio` | 代码（从本机 rsync 同步，含 `dist/` 构建产物，`npm ci` 安装依赖） |
| `/home/ubuntu/dabaihua-data/state` | wrangler `--persist-to` 目录；D1 sqlite 位于 `state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite` |
| `/home/ubuntu/dabaihua-data/articles/<slug>/` | 文章目录（`meta.json`、`01-draft.md`、`02-final.md`、`qa-report.md`、`article.html`、`images/`） |
| `/home/ubuntu/dabaihua-data/feedback` | 选题审稿反馈导出目录 |
| `/home/ubuntu/dabaihua-data/prod.env` | 环境变量文件（`chmod 600`，**不在仓库中**） |

`prod.env` 为 `KEY=VALUE` 行，例如：

```
IMPORT_TOKEN=...
DABAIHUA_TRUSTED_PROXY_HOSTS=topic.aigalaxy.top,superme.aigalaxy.top
DABAIHUA_ALLOW_REGISTER=1
DABAIHUA_REGISTER_INVITE_CODE=...   # 可选
DABAIHUA_PUBLIC_BASE_URL=https://superme.aigalaxy.top  # 可选，周报 URL 用
DABAIHUA_CARDS_ASSISTANT_TOKEN=...  # 可选，照照镜子助手 token
ARTICLES_OWNER_ACCOUNT=...         # 可选，文章归属账号，默认最早的管理员
```

## systemd 单元

- `dabaihua-studio.service`：前台运行 `deploy/aries/run-server.sh`（`wrangler dev`）。
- `dabaihua-articles-watch.service`：运行 `deploy/aries/run-articles-watch.sh`，
  等待 D1 sqlite 出现后监听文章目录并同步进 D1。

两个单元都以 `ubuntu` 运行，`Restart=always`、`RestartSec=5`。监听单元通过
`After`/`Wants=dabaihua-studio.service` 排在服务之后（**没有** `PartOf`，停止服务
不会连带停止监听）。

## 安装 / 启用

```bash
sudo cp deploy/aries/*.service /etc/systemd/system/ && \
  sudo systemctl daemon-reload && \
  sudo systemctl enable --now dabaihua-studio dabaihua-articles-watch
```

## 重启

```bash
sudo systemctl restart dabaihua-studio
sudo systemctl restart dabaihua-articles-watch
```

## 查看日志

```bash
journalctl -u dabaihua-studio -f
journalctl -u dabaihua-articles-watch -f
```

## 重新部署

从本机仓库根目录：

```bash
rsync -az --delete \
  --exclude node_modules --exclude .wrangler --exclude .git \
  ./ Aries:/home/ubuntu/dabaihua-studio/
```

`package-lock.json` 有变化时再执行 `npm ci`：

```bash
ssh Aries 'cd /home/ubuntu/dabaihua-studio && npm ci'
```

然后重启服务：

```bash
ssh Aries 'sudo systemctl restart dabaihua-studio dabaihua-articles-watch'
```

> 代码需在本机先 `npm run build`，把 `dist/` 一起同步过去（`run-server.sh` 使用
> `dist/server/wrangler.json`）。

## 关闭注册

在 `prod.env` 中设置 `DABAIHUA_ALLOW_REGISTER=0`，然后：

```bash
ssh Aries 'sudo systemctl restart dabaihua-studio'
```

可选邀请码：设置 `DABAIHUA_REGISTER_INVITE_CODE=<code>` 并重启同一服务。

## 周报（weekly report）

`superme daily publish` 通过下面的接口把自包含 HTML 周报上传到站点，`/weekly/<week>/`
在登录后提供阅读页面。

- `PUT /api/weekly/<YYYY-Www>`：`Authorization: Bearer <topk key>`，`Content-Type: text/html`，
  最大 5 MB；首次写入返回 `201`，覆盖返回 `200`，响应体为 `{url, week, bytes, updated_at}`。
- `GET /api/weekly`：列出当前账号的周报（Bearer）。
- `DELETE /api/weekly/<YYYY-Www>`：删除当前账号的周报（Bearer，管理员可删任意）。
- `GET /weekly/<week>/`：需要登录，带 `Cache-Control: private, no-store` 和严格 CSP。

`DABAIHUA_PUBLIC_BASE_URL` 用来拼响应里的周报 URL；不设置时回退到请求的 origin。
反向代理终止 TLS 时通常应显式设置，例如 `https://superme.aigalaxy.top`。

## 照照镜子 /api/cards

`DABAIHUA_CARDS_ASSISTANT_TOKEN` 给助手用一个 Bearer token：助手只能 `GET /api/cards*`
和 `POST /api/cards`（只能写成「待确认」）。确认 / 拒绝 / 编辑 / 替换 / 过期 / 删除 /
恢复只认 Yu 的 admin 会话或 `topk_` key。写请求带 `expectedVersion`，版本不对返回 `409`。

- `GET /api/cards?kind=mirror&category=&status=&deleted=1`：列出卡片。
- `GET /api/cards/:id`、`GET /api/cards/:id/history`：单卡与历史。
- `POST /api/cards`、`PATCH /api/cards/:id`：新增 / 直接改。
- `POST /api/cards/:id/supersede|expire|restore|confirm|reject`、`DELETE /api/cards/:id`（软删）。

## 日报 / 职业数据

`/daily` 与 `/career` 的私密数据只在运行时从 D1 的 `private_datasets` 表读取；构建
产物不再包含这些数据，部署也不再需要它们。

在本机上传日报（`DAILY_DIR` / `GIT_DAILY_DIR` 环境变量照旧生效）：

```bash
npm run daily:upload
```

同时上传职业数据（默认 `content/career/career.json`）：

```bash
scripts/upload-daily.sh --career
```

`scripts/upload-daily.sh` 支持 `--endpoint URL`（本次调用覆盖服务端地址）和 `--dry-run`
（只在本机校验并打印大小 / 条数，不联网）。上传凭证为 admin 会话、`topk_` API key，
或 `x-import-token`（`IMPORT_TOKEN`）。查看已上传的数据：

```bash
public/cli/superme data status
```

## 回滚到旧的 qingliu-reader

服务器上保留有回滚脚本：

```bash
ssh Aries 'bash ~/backup/rollback-qingliu.sh'
```

该脚本会停用 `dabaihua-studio` 并重新启用 `qingliu.service`。

## publish-review CLI

本机推送一篇文章到 Aries 并触发导入，然后等待页面可访问：

```bash
npm run publish-review -- <slug> [--host Aries] [--dry-run] [--no-wait]
```

- `--host`：ssh 主机别名（默认取 `PUBLISH_REVIEW_HOST`，否则 `Aries`）。
- `--dry-run`：只打印将要执行的 rsync/ssh 命令，不实际执行。
- `--no-wait`：触发导入后立即返回，不轮询线上页面。

环境变量覆盖：

| 变量 | 默认值 |
| --- | --- |
| `PUBLISH_REVIEW_HOST` | `Aries` |
| `PUBLISH_REVIEW_REMOTE_ARTICLES` | `/home/ubuntu/dabaihua-data/articles` |
| `PUBLISH_REVIEW_BASE_URL` | `https://superme.aigalaxy.top` |
| `ARTICLES_DIR`（本地） | `/workspace/projects/articles` |

脚本只使用 Node 内置模块；保护服务器上已有的 `review-feedback-*` 反馈文件不被
`--delete` 删除，并在本地 `meta.json` 不含审稿历史时合并服务器上的审稿字段。
