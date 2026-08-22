# 内容项目

一个跨平台主题对应一个目录，作为定位、研究、主稿、衍生稿和共享素材的唯一工作区。

```text
content/projects/<content-slug>/
├── positioning.md
├── research.md
├── master.md
├── derived/
│   ├── video-script.md
│   ├── gzh.md
│   ├── xhs.md
│   └── x-thread.md
├── covers/
├── imgs/
├── xhs/
├── assets/
├── sources.md
├── qa.md
└── publish.md
```

渠道目录 `content/ghz/`、`content/bilibili/`、`content/xhs/` 只保存渠道发布快照、上传记录或渠道专属资产，并链接回此处的源项目。新项目从 `content/_templates/content-project.md` 开始。
