#!/usr/bin/env bash
#
# deploy/aries/run-server.sh — Aries 上前台启动 dabaihua-studio（由 systemd 调用）。
#
# 从环境变量读取配置（systemd 通过 EnvironmentFile/Environment 提供），只为非空的
# worker 变量构造 `--var KEY:VALUE` 参数；密钥值绝不打印，只打印变量名。
set -euo pipefail

# 脚本位于 <repo>/deploy/aries/，始终从仓库根目录运行。
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
cd -- "${REPO_ROOT}"

# 需要转发给 wrangler 的变量白名单（值可能包含密钥）。
FORWARDED_VAR_KEYS=(IMPORT_TOKEN DABAIHUA_TRUSTED_PROXY_HOSTS DABAIHUA_ALLOW_REGISTER DABAIHUA_REGISTER_INVITE_CODE DABAIHUA_PUBLIC_BASE_URL DABAIHUA_CARDS_ASSISTANT_TOKEN SHUFANGZHAI_WEBHOOK_URL SHUFANGZHAI_WEBHOOK_SECRET SHUFANGZHAI_WEBHOOK_AUTH_HEADER)

vars=()
for key in "${FORWARDED_VAR_KEYS[@]}"; do
  value="${!key:-}"
  [[ -n "${value}" ]] || continue
  echo "passing worker var: ${key}" >&2
  vars+=(--var "${key}:${value}")
done

# `${vars[@]+"${vars[@]}"}` 在 set -u 下安全地处理空数组。
exec node node_modules/wrangler/bin/wrangler.js dev \
  -c dist/server/wrangler.json \
  --ip "${HOST:-127.0.0.1}" \
  --port "${PORT:-3210}" \
  --persist-to "${PERSIST_DIR:-/home/ubuntu/dabaihua-data/state}" \
  --show-interactive-dev-session=false \
  ${vars[@]+"${vars[@]}"}
