#!/usr/bin/env bash
# 上传本机日报 / 职业数据到站点 D1。
#
# 用法：
#   scripts/upload-daily.sh [--career] [--career-file PATH] [--endpoint URL] [--dry-run]
#
# 日报先由 scripts/build-daily.mjs 汇总到临时 JSON，再通过仓库内的
# public/cli/superme 上传；站点构建不再读取 content/daily 或 content/career。
# DAILY_DIR / GIT_DAILY_DIR 环境变量照旧传给 build-daily.mjs。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$REPO_ROOT/public/cli/superme"

CAREER=0
CAREER_FILE=""
ENDPOINT=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --career)
      CAREER=1
      shift
      ;;
    --career-file)
      [ $# -ge 2 ] || { echo "$1 缺少参数" >&2; exit 2; }
      CAREER_FILE="$2"
      shift 2
      ;;
    --endpoint)
      [ $# -ge 2 ] || { echo "$1 缺少参数" >&2; exit 2; }
      ENDPOINT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$CAREER_FILE" ]; then
  CAREER_FILE="$REPO_ROOT/content/career/career.json"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

run_put() {
  local name="$1"
  local file="$2"
  local args=("$CLI" data put "$name" "$file")
  if [ -n "$ENDPOINT" ]; then args+=(--endpoint "$ENDPOINT"); fi
  if [ "$DRY_RUN" -eq 1 ]; then args+=(--dry-run); fi
  python3 "${args[@]}"
}

node "$REPO_ROOT/scripts/build-daily.mjs" --out "$TMP/daily.json"
run_put daily "$TMP/daily.json"

if [ "$CAREER" -eq 1 ]; then
  if [ ! -f "$CAREER_FILE" ]; then
    echo "找不到职业数据文件: $CAREER_FILE" >&2
    exit 1
  fi
  run_put career "$CAREER_FILE"
fi
