# Project Skills

Place reusable project-specific Agent Skills here, one directory per skill:

```text
.agents/skills/
└── <skill-name>/
    ├── SKILL.md
    ├── scripts/       # optional helpers
    ├── references/    # optional supporting material
    └── assets/        # optional templates or static assets
```

Each `SKILL.md` must use Agent Skills frontmatter with a lowercase, hyphenated `name` and a specific `description`.

Both Pi and Codex can discover project skills from `.agents/skills/`. Keep these skills scoped to this repository; machine-wide skills belong in each tool's global skill location.

## Content Production Skills

The project content workflow is defined in `AGENTS.md` and uses `content/projects/<content-slug>/` as the source workspace. Skills must read dynamic publishing rules from `topics strategy` (or `topics strategy --cached` offline) and use `content/_config/platform-specs.json` only for version-controlled structural specifications. Do not reintroduce the legacy `raw/content/` layout.
