# qingliu-studio Agent Contract

qingliu-studio 是心结驱动的个人阅读、研究和内容发现工作台，运行在 Next.js/vinext、Cloudflare Workers、D1、R2 和 Drizzle 上。

## Domain Rules

- `itch` 是与 `topic` 同级的一等领域对象，必须同时有数据库、API 和 `topics` CLI 入口。
- 心结是长期母问题，不会被一个 topic 消费掉；一个心结可以关联多个触发、item、批注、探索、direction 和 topic。
- `item` 是材料，`direction` 是研究后形成的判断，`topic` 是 direction 的一次内容生产表达。
- 文章评分只能产生触发推荐或待确认候选，不能绕过心结与 direction 直接创建最终 topic。
- 重复记录同一心结必须保留为事件历史，不能只覆盖 note 或 updated_at。
- qingliu 保存状态、关系和来源链；Agent 负责对话与研究；Content/Coding Harness 负责生产。

## Change Rules

- 数据模型变更必须同步 `db/schema.ts`、`lib/store.ts` 的运行时 schema、Drizzle migration、领域服务、API、CLI 和测试。
- 所有用户数据查询必须按 session user id 隔离；API 同时保持 Cookie 和 `topk_*` Bearer token 支持。
- 先读现有实现和 `.planning/STATE.md`，再修改；不得覆盖其他会话的未提交改动。
- 不将 secrets、tokens 或用户数据写入源码、规划文档或命令输出。
- 不在本项目内引入独立图数据库，除非 GSD Phase 5 的数据门槛和决策检查点通过。

## Verification

从 `/Volumes/DATABASE/Obsidian/KnowledgeBase` 进入 PM；代码验证在本目录运行：

- `npm run lint`
- `npm test`
- `npm run db:generate`
- `python3 -m py_compile public/cli/topics`

生产部署和 Git commit 都需要用户明确要求或当前计划明确授权。

## Sources Of Truth

- 产品流程：`docs/product/itch-workflow.md`
- 领域架构：`docs/architecture/sensemaking-model.md`
- PM 任务：KnowledgeBase T23
- GSD 当前入口：`/Volumes/DATABASE/Obsidian/KnowledgeBase/.planning/STATE.md` 和 `.planning/phases/03-sensemaking/03-01-PLAN.md`
