# 清流工作室

一个可自行部署的阅读、心结与内容发现工作台。它聚合 RSS、X 与微信公众号，也把反复出现的个人问题记录为心结，供 Agent、CLI 和后续内容工作流持续炼化。

![清流工作室预览](public/og-community.png)

## 功能

- 聚合 RSS、X 作者和微信公众号内容
- 今日阅读流、预计阅读时间、已读和收藏状态
- 来源发现、关注、取消关注和导入队列
- 文章批注、回复、通知与个人主页
- 心结捕捉、再次触发、材料关联、探索研究和候选方向确认
- D1 持久化和 R2 媒体存储
- 可选的 Cloudflare Workers AI 中文处理
- Cloudflare Worker 定时同步 RSS 与 X
- 可选的本机微信公众号采集流程

## 技术栈

- Next.js 16、React 19、TypeScript
- vinext、Vite、Cloudflare Workers
- Drizzle ORM、Cloudflare D1、R2

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
git clone https://github.com/GalaxyXieyu/dabaihua-studio.git
cd dabaihua-studio
npm install
npm run dev
```

本地开发会使用项目配置的本地 D1。首次打开时注册一个账号即可使用。仓库不包含任何生产用户数据、第三方文章正文或微信公众号图片。

没有 AI 绑定时，RSS 收集、中文内容、收藏和批注仍可工作；需要翻译的外文条目会保留原文并等待处理。

## 验证

```bash
npm run lint
npm test
npm run db:generate
```

`npm test` 会先执行生产构建，再运行项目测试。

## 部署

项目面向 Cloudflare Workers 运行时，并在 `.openai/hosting.json` 中声明以下逻辑绑定：

- `DB`：Cloudflare D1 数据库
- `MEDIA`：Cloudflare R2 存储桶
- `AI`：可选的 Workers AI binding

部署自己的副本时，请创建独立的 D1 和 R2 资源，不要复用他人的项目标识或生产数据。数据库结构位于 `db/schema.ts`，迁移位于 `drizzle/`。

远程导入接口使用 `IMPORT_TOKEN` 保护。请在托管平台生成高强度随机值并作为 secret 配置，不要提交到 Git。`.env.example` 只列出变量名称和示例。

## 微信公众号采集

微信公众号采集是可选能力，依赖本机 Python 采集脚本和有效的公众号登录状态。配置这些环境变量后运行：

```bash
export RSS_AI_ENDPOINT=http://localhost:3000
export WECHAT_WIZARD=/absolute/path/to/wechat_wizard.py
export WECHAT_DOWNLOADER=/absolute/path/to/wechat_downloader.py
npm run sync:wechat
```

macOS 定时任务模板位于 `scripts/com.dabaihua-studio.wechat-sync.plist`。使用前必须把其中的占位路径替换为自己机器上的绝对路径。请只导入你有权保存和使用的内容。

## 数据与版权

本仓库只提供软件代码，不附带抓取的文章正文、用户数据或第三方媒体。使用者需要自行确认订阅、存储和展示内容的合法性，并遵守内容来源的服务条款和版权要求。

## License

[MIT](LICENSE)

## topics CLI（多端命令行客户端）

在任何电脑读取订阅流、心结与选题库：

```bash
curl -fsSL https://raw.githubusercontent.com/GalaxyXieyu/dabaihua-studio/main/public/cli/topics -o ~/bin/topics && chmod +x ~/bin/topics
topics login        # 账号密码换本机 API Key（密码不落盘）；或 topics login --token topk_xxx
topics inbox        # 统一收件箱；topics open <id> 阅读全文（默认标记已读）
topics sources      # 订阅源总览；topics sources set <id> --interval 30m 调整每源拉取间隔
topics sub <RSS地址|X主页|公众号文章链接> --category ai   # 一条命令添加订阅
topics sub <公众号名>                                     # 按名字提交，采集端自动处理
topics unsub <id>   # 取消关注；--delete 删除自己贡献的源
topics imports      # 公众号导入队列进度
topics itch "Agent时代灵感枯竭怎么办"  # 记录心结；再次输入会累计触发
topics itch list                          # 查看开放心结
topics itch show <id>                     # 查看触发历史与关联
topics itch feel <id> "今天为什么又想到它"
topics itch link <id> --item <文章ID>     # 关联阅读材料
topics itch refine <id> --file exploration.json
topics itch research <id> --exploration <探索ID> --file research.json
topics itch direction <id> --file direction.json  # 只创建 candidate
topics itch directions <id>                # 比较多个候选方向
topics itch confirm <id> --direction <方向ID> --note "我的判断"
topics itch archive <id>
```

`exploration.json` 保存四问字段 `triggerContext`、`coreConflict`、`personalStake`、`desiredChange`。`research.json` 保存 `questionTree`、`materialMap`、`counterEvidence`、`evidenceGaps`；`direction.json` 保存 `claim`、`audience`、`tension`、`personalConnection`、正反证据与信心。Agent 和 Deep Research 可以写探索与候选方向，但不能在创建时把方向标记为 `confirmed`。

API Key 在「个人 API」接口体系下管理（`topics token list/create/revoke`）。服务端对应实现：`app/api/tokens/`，所有 API 同时接受会话 Cookie 与 `Authorization: Bearer topk_*`。
