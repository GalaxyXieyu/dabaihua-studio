# Content Workspace

内容生产以 `content/projects/<content-slug>/` 为唯一源工作区。定位、研究、主稿、衍生版本、图片素材、QA 和发布记录都跟同一个内容项目走。

```text
content/
├── _config/       # 项目级规格与作者声音
├── _templates/    # 新内容项目模板
├── projects/      # 跨平台内容项目的源工作区
├── ghz/           # 公众号发布快照与渠道专属资产
├── bilibili/      # B站发布快照与渠道专属资产
└── xhs/           # 小红书发布快照与渠道专属资产
```

## 策略来源

- `topics strategy` 是动态策略真源，管理选题路由、标题公式、CTA 和禁用模式；离线时可使用 `topics strategy --cached`。
- `content/_config/platform-specs.json` 是项目内、可版本控制的平台结构规格与离线兜底。
- `content/_config/author-voice.md` 是作者声音的当前基线；只有用户确认的成稿可成为样本。

不在这里存放 secrets、生产用户数据或无授权的第三方原始素材。公众号发布需要用户明确确认后才使用项目级 `wenyan-mcp`。
