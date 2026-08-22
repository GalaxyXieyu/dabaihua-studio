---
name: visual
version: 1.2
updated: 2026-07-21
changelog:
  - v1.2 (2026-07-21): 公众号头条封面「中安全区」硬规则；GZH/B站封面拆分；生成器回退链；质检加裁切模拟
  - v1.1 (2026-07-21): 成品一律落在文章文件夹（covers/imgs/xhs），禁止默认写 visuals/
  - v1.0 (2026-07-17): 初始版本
description: Generates images for content across platforms. Platform determines aspect ratio, aesthetic, and image count. Use when asked to "配图", "做封面", "做小红书图", "做B站封面", "generate images", "illustrate article", "为文章配图".
---

# Visual

为内容生成配图。平台决定比例、风格、数量与安全区。

---

## 平台基础配置

| 平台 | 场景 | aspect_ratio | 实际规格 / 裁切 | 生成器优先 | 典型数量 |
|------|------|-------------|----------------|-----------|---------|
| **小红书 XHS** | 图文卡片系列 | `3:4` | 1080×1440px | Grok `image_gen` / image-this jimeng | 3–9 张 |
| **小红书 XHS** | 视频封面 | `9:16` | 1080×1920px | 同上 | 1 张 |
| **公众号 GZH** | 文章内配图 | `16:9` | 约 900px 宽 | 同上 | 2–5 张 |
| **公众号 GZH** | **头条封面（横版）** | `16:9` 生成 | **列表裁中间 ~2.35:1（约 900×383）** | 同上 | 1 张 |
| **公众号 GZH** | 次条封面（正方形） | `1:1` | 约 200×200 缩略 | 同上 | 1 张 |
| **B站** | 视频封面 | `16:9` | 全幅 1280×720 可见 | 同上 | 1 张 |

### 生成器回退链

1. **优先**：环境可用的图像工具（Grok `image_gen` / `image_edit`，或 `image-this` MCP）
2. **image-this 失败/额度空**：立刻切 Grok `image_gen`，不要空转重试
3. **jimeng 竖图错比例**：不要硬用；改 Grok 并钉死 `aspect_ratio`
4. **中文精确字**：标题越短越好；生成后用 Read 看图核对；错字时用已配置的 `image-this` 编辑能力修复，或用 HTML/CSS 叠字（卡片类走 `guizang-social-card-skill`）

---

## ⚠️ 公众号头条封面：中安全区（硬规则）

> **2026-07-21 实测**：标题放顶部 → 草稿箱缩略图裁切后标题偏上/像被切；**主副标题放画面正中** → 用户确认可用。

公众号生成 `16:9`，但列表/草稿卡片会 **从画面垂直中央裁一条矮横幅**（约 2.35:1 / 900×383 量级）。  
**上下边缘不是安全区**。设计时必须按「中间横条」构图，而不是按完整 16:9 构图。

```
┌──────────────────────────────────────┐  16:9 全图
│  上边距 ≈ 危险区（会被裁掉或极靠边）   │
│ ┌──────────────────────────────────┐ │
│ │  ★ 中安全区（约中间 55–60% 高度）  │ │  ← 列表实际可见
│ │    主标题 + 副标题 必须在这里     │ │
│ │    核心视觉左右可铺，但别抢字     │ │
│ └──────────────────────────────────┘ │
│  下边距 ≈ 危险区                     │
└──────────────────────────────────────┘
```

### 硬性约束（违反 = 重做）

| 规则 | 说明 |
|------|------|
| **主标题垂直居中** | 大字落在画布正中偏一点即可，**禁止「TOP 顶栏标题」** |
| **副标题贴主标题下方** | 仍在中安全区内，不要沉到下三分之一 |
| **水平居中** | 主副标题水平居中；左右视觉当背景，不要把字挤到一侧 |
| **字后压暗** | 标题背后加暗 vignette / 半透明暗底，保证白字高对比 |
| **字少且大** | 主标题 ≤12 字优先；副标题一行；禁止段落级封面字 |
| **四角不放关键信息** | 与 platform-specs 一致；角标 logo 可有可无，默认不要 |
| **交付前裁切自检** | 用眼或 `sips`/预览只看中间横条：标题是否仍完整、居中 |

### 公众号封面 prompt 必写段（英文，贴进每条封面 prompt）

```
CRITICAL FOR WECHAT CROP: Keep ALL titles and key visuals in the absolute
vertical CENTER of the frame (middle safe band ~2.35:1). Do NOT put the
title at the top or bottom. Title and subtitle must be dead-center
horizontally and vertically. Soft dark vignette behind text for contrast.
```

### 对照：B 站封面 ≠ 公众号封面

| | 公众号头条 | B站封面 |
|--|-----------|---------|
| 可见区域 | **中间矮横条** | **完整 16:9** |
| 标题位置 | **正中** | 可顶部/左上（风格 A 可用） |
| 副标题 | 紧贴主标题下方（中区） | 可主标题下或色块内 |
| 失败模式 | 顶栏标题 → 列表里偏/空 | 字太小缩略不可读 |

**禁止**把「B站顶部大字」模板直接当公众号封面用。

---

## 封面风格选择

### 风格 A：截图写实风（**优先 B站**；公众号要用须改标题位）

**适用**：技术教程 / 工具实战 / Agent 项目演示  
**构成**：左代码 terminal + 右结果 UI + **大字标题**  
**颜色**：深色底 + 白主标题 + 黄/青副标题  

- **B站**：标题可在 **TOP**  
- **公众号**：同一分屏视觉，但标题必须移到 **CENTER**（见上节）

```
# B站可用
TOP: large bold white title, yellow subtitle.

# 公众号必须改成
CENTER: large bold white title + subtitle, dead-center, dark vignette behind text.
```

### 风格 B：光效抽象风

**适用**：系列封面 / 方法论 / 品牌统一  
**构成**：发光节点 / 抽象状态图 + 居中大字  
**颜色**：深海军蓝黑 + 电青/绿色光晕 + 白字  

### 风格 C：暗色科技叙事风（**公众号 Agent/工程文推荐**，2026-07-21 过审）

**适用**：多 Agent / 编排 / 崩溃 vs 恢复 / 架构选型  
**构成**：
- 左：红色破碎节点 / 失败态（可虚化）
- 右：绿色看板 / 有序任务卡 / 地铁线连接
- 中：主副标题 **正中叠字** + 暗底保证可读
**颜色**：炭黑代码底 + 红/绿单一对比 + 纯白字  
**项目内留档**：通过的封面与失败版本都保存在对应 `content/projects/<content-slug>/covers/`，便于后续复盘裁切效果。

```
prompt 骨架（公众号 16:9）：
WeChat OA headline cover, 16:9, dark tech, high contrast.
CRITICAL FOR WECHAT CROP: titles dead-center (middle safe band), not top.
Large bold white Chinese title centered: "主标题"
Smaller subtitle under it, still center band: "副标题"
Left (background): red broken node network, soft blur.
Right (background): green kanban cards + metro-line links.
Dark vignette behind text. No watermark, no extra text.
```

---

## 审美路由（内容类型 × 平台）

| 内容类型 | 小红书 | 公众号封面 | B站封面 | 公众号文内配图 |
|---------|-------|-----------|---------|--------------|
| **技术教程 / 工具** | notion + dense | **C 或 A′（居中字）** | **A（可顶栏）** | blueprint |
| **Agent / 工程** | bold + sparse | **C 暗色科技叙事** | A 或 C | minimal |
| **数据分析** | warm + balanced | B 或 C | B | editorial |
| **步骤教学** | chalkboard + flow | A′ 居中 | A | sketch-notes |
| **方法论** | study-notes | B / C | B | framework |
| **热点 / 情绪** | cute / pop | scene | scene | scene |

> B站实测：截图写实 CTR 高（2026-07-17）。  
> 公众号实测：列表缩略只认 **中区大字**（2026-07-21）。

---

## 与社交卡 Skill 的分工

- `visual`：用于 1 张或少量 AI 位图、普通技术示意图、B站封面、公众号文内图，重点是比例、裁切安全区、图像内容和中文文字核对。
- `guizang-social-card-skill`：用于 5–9 张小红书组图、HTML/CSS 信息卡、公众号 `21:9 + 1:1` 封面对，重点是版式叙事、真实截图编排和成套视觉系统。
- 同一个发布位只选一种主生产方式。若先用 `visual` 生成背景或插图，再用社交卡 Skill 排版，必须明确它们各自承担的角色，避免输出两套互相竞争的封面。
- 架构图或流程图应从实际界面、任务状态、依赖关系、日志或已确认的数据出发。优先白底/中性色底、黑灰正文、细线框和克制强调色；不要用渐变标题条、卡通装饰或泛化图标替代真实信息。

## 工作流

### Step 1：确认三个参数

1. **目标平台**：小红书 / 公众号封面 / 公众号文内图 / B站封面  
2. **内容类型** → 路由风格（公众号封面默认检查是否应用中安全区）  
3. **数量**与**文章 slug**（成品路径依赖文章目录）

### Step 2：风格锚（system_instruction / 共用前缀）

全系列统一一段英文风格描述。**公众号封面额外强制拼接「CRITICAL FOR WECHAT CROP」段。**

### Step 3：写 prompt

**公众号头条封面（1 张）**：
- 主副标题原文写进 prompt，要求 exact Chinese
- 明确 **dead-center**，禁止 top title
- 左右叙事可保留，但字在中

**B站封面（1 张）**：
- 可用顶栏大字 + 分屏
- 缩略图可辨

**小红书系列**：
- P1 hook 稀疏；P2–N 一点一页；末页 CTA

**公众号文内配图**：
- 2–5 张，补结构不补废话；比例 16:9

### Step 4：生成

按「生成器回退链」调用；钉死 `aspect_ratio`。

### Step 5：落盘 + 展示

**红线：成品跟文章走，不进 `visuals/`。**

```
content/projects/<content-slug>/
├── covers/
│   ├── gzh-16x9.jpg           # 当前采用
│   ├── gzh-16x9-vN-*.jpg      # 迭代备份（可选）
│   ├── gzh-1x1.jpg
│   └── bilibili-16x9.jpg
├── imgs/                      # 文内图（PNG）
├── xhs/                       # 小红书 3:4
└── diagrams/                  # 源 SVG 等
```

**展示**：`![[content/projects/<content-slug>/covers/gzh-16x9.jpg]]`  
不要甩远程 artifact URL。

### Step 6：公众号封面质检（必做）

1. Read 图片，确认中文无乱码  
2. **中安全区检查**：主副标题是否在画面垂直中央  
3. 想象裁成矮横条后，标题是否仍完整  
4. 对比度过关（白字 + 暗底）  
5. 不通过 → `image_edit` 或重生成，**禁止**把顶栏版当终稿

---

## 质检清单

- [ ] 平台比例正确（XHS 3:4 / GZH·B站 16:9 / 次条 1:1）
- [ ] **公众号封面：标题正中，非顶部**（中安全区）
- [ ] 中文标题与用户给定一致（无增删字）
- [ ] 高对比、缩略图可辨
- [ ] 路径在 `content/projects/<content-slug>/{covers,imgs,xhs}/`
- [ ] 未默认写入 `visuals/`
- [ ] 系列风格锚统一
- [ ] 公众号文内图：16:9，非竖图

---

## 与发布链路衔接

- 公众号发布前，将封面与文内图整理到对应内容项目目录；需要发布时使用项目级 `wenyan-mcp`。
- 文内 SVG 须先转 PNG；远程 `wenyan-mcp` 不能直接读取本机路径。
- 发布是显式用户动作，先上传图片，再调用 `wenyan-mcp_gzh_article_publish`。
