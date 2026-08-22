# dabaihua-studio Claude Entry

先读取 `AGENTS.md`，再读取：

1. `docs/product/itch-workflow.md`
2. `docs/architecture/sensemaking-model.md`
3. `/Volumes/DATABASE/Obsidian/KnowledgeBase/.planning/STATE.md`
4. `/Volumes/DATABASE/Obsidian/KnowledgeBase/.planning/pm/coder-context.json`

当前主任务是 PM T23。Phase 2 与 Phase 3 的运行能力已部署生产：心结、事件、多关系、多轮 exploration、研究产物、多个 candidate direction 和显式人工确认门均可通过 API/CLI 使用。下一门槛是真实研究证据与用户方向确认。

工作流顺序固定为：触发事件 → 心结 → 炼化/研究 → direction → 用户确认 → topic → 生产 → 反馈回流。Claude 可以写入 exploration、research 和 candidate direction，但不能调用确认动作替用户拍板。

内容生产约定见 `AGENTS.md` 的 `Content Production`。所有内容项目从 `content/projects/<content-slug>/` 开始；动态策略使用 `topics strategy`，项目级视觉与公众号发布 MCP 仅在用户明确确认写操作后使用。
