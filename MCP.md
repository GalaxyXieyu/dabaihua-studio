# Project MCP

This project uses only two project-scoped MCP servers:

- `image-this` — image generation and editing
- `wenyan-mcp` — 公众号图片上传和文章发布

## Pi

Pi loads the local `.mcp.json`. The real file is ignored because it contains credentials. Copy the tracked `.mcp.example.json` to `.mcp.json` and provide the credential values through your secure local setup.

## Codex

Codex loads `.codex/config.toml` for trusted projects. The real file is ignored because it contains credentials. Copy `.codex/config.example.toml` to `.codex/config.toml`, then set the environment variables named by `env_http_headers` before starting Codex.

Do not add these two MCP servers to user-global Pi, Codex, Cursor, or Claude configuration. Do not commit MCP tokens or API keys.
