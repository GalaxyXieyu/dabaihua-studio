#!/usr/bin/env bash
#
# deploy/aries/run-articles-watch.sh — Aries 上前台运行文章目录监听（由 systemd 调用）。
#
# 服务器先启动并创建 D1 sqlite，本脚本最多等待 120s 找到它，然后 exec
# `node scripts/sync-articles.mjs --watch`。
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
cd -- "${REPO_ROOT}"

export ARTICLES_DIR="${ARTICLES_DIR:-/home/ubuntu/dabaihua-data/articles}"
export FEEDBACK_DIR="${FEEDBACK_DIR:-/home/ubuntu/dabaihua-data/feedback}"

if [[ -z "${DIGEST_D1_PATH:-}" ]]; then
  PERSIST_DIR="${PERSIST_DIR:-/home/ubuntu/dabaihua-data/state}"
  D1_DIR="${PERSIST_DIR}/v3/d1/miniflare-D1DatabaseObject"
  deadline=$((SECONDS + 120))
  candidate=""
  while :; do
    candidate="$(find "${D1_DIR}" -maxdepth 1 -type f -name '*.sqlite' ! -name 'metadata.sqlite' 2>/dev/null | sort | head -n 1 || true)"
    [[ -n "${candidate}" ]] && break
    if ((SECONDS >= deadline)); then
      echo "等待 ${D1_DIR} 下的 D1 sqlite 超过 120s，仍未出现" >&2
      exit 1
    fi
    sleep 2
  done
  export DIGEST_D1_PATH="${candidate}"
fi

echo "[articles-watch] ARTICLES_DIR=${ARTICLES_DIR} FEEDBACK_DIR=${FEEDBACK_DIR} DIGEST_D1_PATH=${DIGEST_D1_PATH}" >&2

exec node scripts/sync-articles.mjs --watch
