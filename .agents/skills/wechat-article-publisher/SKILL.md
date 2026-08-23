---
name: wechat-article-publisher
description: 以 Markdown 为唯一工作正文，统一处理微信公众号文章的 DOCX/PDF/文本归一化、爱格标点校订、手机端语意分行、主题组件渲染和可粘贴 HTML 交付。用户要求只改标点、公众号分行排版、套主题、生成公众号 HTML、一键完成公众号成品，或从历史 HTML 提炼个人主题时使用。
---

# 公众号文章生产

使用一个入口完成原稿到公众号 HTML 的生产。任何非 Markdown 输入必须先转成 Markdown；DOCX 只作为输入，不生成或回写中间 DOCX。

## 模式路由

- “只改标点”“爱格标点”：使用 `punctuation`。
- “只调分行”“调整留白”“手机端阅读”：使用 `mobile-layout`。
- “套主题”“生成公众号 HTML”“复制到公众号”：使用 `render`。
- “一键完成”“从原稿到公众号成品”：使用 `full`。
- 提供历史 HTML 并要求总结个人风格：使用 `extract-theme`。

请求同时命中多个模式时，固定执行 `normalize → punctuation → mobile-layout → render`。技术教程默认不套用爱格标点风格；爱格周记、人生感悟及相近散文在 `full` 模式中执行标点校订。

## Markdown 产物链

在 `content/projects/<content-slug>/` 中维护：

```text
source/原稿.ext
01-source.md
02-punctuation.md
03-layout.md
qa/punctuation-diff.md
output.html
output_预览.html
```

- `01-source.md`：输入归一化后的原文。
- `02-punctuation.md`：只修改标点；同时生成审校记录。
- `03-layout.md`：只修改空白、段落边界和 `<br>`；通过验证后即为唯一冻结正文。
- 不再生成内容相同的 `frozen.md`，也不生成标点或分行 DOCX。
- 某模式未执行时，下一步读取最近一个已验证的 Markdown。

## 修改权限

- `normalize`：只表达原有结构，不增删或改写实质内容。
- `punctuation`：只改标点；文字、语序、Markdown 结构和空白不变。
- `mobile-layout`：只改段落边界、空白和 `<br>`；所有非空白字符及标点不变。
- `render`：冻结正文，只添加 HTML 结构与样式；不得重新解释分行。
- `full`：不自动开放内容增强。`infer_headings`、`english_labels`、`signature`、`cta` 等仍须用户明确授权。

修改权限高于主题配方。主题要求新增封面文案、关键词、英文标签、签名或 CTA 时，未授权就省略，不能突破内容合同。

## 工作流

### 1. 输入归一化

完整读取 `references/format-normalize.md`。Markdown 输入复制为 `01-source.md`；DOCX 立即使用本 Skill 的提取器：

```bash
python3 scripts/extract_docx.py 原稿.docx -o 01-source.md
```

提取必须保留标题、粗体、下划线、列表、表格、图片、手动换行、空白段落、间距、对齐和缩进。PDF、纯文本与网页按参考文件归一化。后续所有语意判断均读取 `01-source.md`，原文件只作来源备查。

### 2. 标点校订

完整读取 `references/punctuation-editor.md` 和 `references/punctuation-style.md`。不得创建另一套规则；逐节把现有规则应用到 `01-source.md`，输出 `02-punctuation.md`。

同时生成 `qa/punctuation-diff.md`，逐项记录位置、原文、修改后和对应的既有规则。没有明确规则或两种写法都成立时保留原文。完成后运行：

```bash
python3 scripts/validate_content.py --mode punctuation 01-source.md 02-punctuation.md
```

验证只证明修改边界正确，不能代替语意复核。

### 3. 手机端语意分行

完整读取 `references/mobile-layout.md`。以 `02-punctuation.md` 为输入；未执行标点模式时使用 `01-source.md`。先识别完整语意组，再决定视觉呈现，输出 `03-layout.md`：

- Markdown 新段落：完整语意之间。
- `<br>`：同一语意组内部的视觉换行。
- `<!-- wechat:blank -->`：思想阶段之间的额外留白。

不得把原稿每个物理段落直接当作最终硬段落。完成后运行：

```bash
python3 scripts/validate_content.py --mode layout 02-punctuation.md 03-layout.md
```

若跳过标点阶段，将命令中的前件替换为 `01-source.md`。同时报告合并、拆分、软换行和留白的数量；四项不能用统一行距或段距冒充。

### 4. 冻结正文

执行分行模式时，确认 `03-layout.md` 的语意完整性和手机窄屏节奏，并将其作为唯一冻结正文。只执行 `render` 时，直接冻结已归一化并确认的 `01-source.md`。始终使用最近一个已验证的 Markdown，不再重新提取或生成内容相同的 `frozen.md`。

### 5. 主题渲染

读取 `references/rendering.md`、`references/theme-index.md`、选中主题文件及 `references/common-components.md`。只从组件库取 HTML，不临时发明组件；严格映射冻结 Markdown 的段落、`<br>` 和留白标记。

章节大标题统一采用“居中的序号—一个视觉空行—居中的标题”结构；该间距只存在于表现层，不写回冻结 Markdown。

输出正文必须是纯 `<section>…</section>` 片段。生成后运行：

```bash
python3 scripts/validate_content.py --mode render {冻结正文.md} output.html
python3 scripts/validate_gzh_html.py --allow-source-punctuation output.html
python3 scripts/wrap_preview.py output.html output_预览.html
```

若用户明确授权统一半角标点，去掉 `--allow-source-punctuation` 并处理警告。

### 6. 最终检查与返工

按手机窄屏从头滚动检查标题、长段落、排比、问答、章节和结尾。发现语意割裂时回到当前冻结 Markdown；执行过分行时即回到 `03-layout.md`。发现标点问题时回到 `02-punctuation.md`，再依次重跑后续验证。禁止只在 HTML 中打补丁。

修改归一化、标点、分行或渲染逻辑后，必须优先运行端到端 AI checkpoint。该命令会启动一个全新 Codex 盲跑原始 DOCX，再启动第二个全新 Codex 读取 checkpoint 与新产物进行语意评审：

```bash
python3 test/layout/run_ai_checkpoint.py
```

`test/layout/run_checkpoint.py` 只作为内容守恒、HTML 合规和固定结构的确定性底线校验，不能替代 AI 回测。只有用户明确确认新版效果更好时，才能替换 `test/layout/` 中的 expected 文件并更新哈希。

### 7. 从历史 HTML 提炼主题

运行：

```bash
python3 scripts/extract_theme_from_html.py 历史文章目录 --out /tmp/theme-profile.md
```

再读取 `references/theme-generator.md`，将设计变量、组件结构和文章骨架整理为 `references/theme-<id>.md`，登记到 `references/theme-index.md`，并运行 `python3 scripts/component_lint.py .`。不得写入历史正文、作者隐私或具体业务内容。

## 交付

简要报告执行模式、标点修改数、分行合并/拆分/软换行/留白数、开启的增强项、主题和验证结果，并交付冻结 Markdown、正文 HTML、预览页及必要的审校记录。
