#!/usr/bin/env bash
#
# scripts/serve-prod.sh — run the BUILT Cloudflare Worker in production mode locally.
#
#   start | stop | restart | status | logs
#
# Runs `wrangler dev` against the build output (dist/server/wrangler.json, produced
# by `npm run build`) in the background and prints the local URL once it answers.
#
# NOTE: `--persist-to .wrangler/state` points wrangler at the SAME local D1/Miniflare
# state directory used by the `npm run dev` server. Data written by one is visible in
# the other (they cannot run on the same port at the same time, but they share storage).
#
# Environment:
#   PORT   listen port                  (default: 3100)
#   HOST   bind address                 (default: 0.0.0.0)
#   BUILD  1 = force `npm run build` first (also runs if the build output is missing)
#
# Optional worker vars (for running behind an HTTPS reverse proxy/tunnel):
#   DABAIHUA_TRUSTED_PROXY_HOSTS   comma-separated trusted host patterns (e.g.
#                                  "*.trycloudflare.com") whose forwarded https
#                                  requests should be treated as https.
#   DABAIHUA_ALLOW_REGISTER        "0/false/no/off/closed" disables registration;
#                                  anything else (or unset) leaves it open.
#   DABAIHUA_REGISTER_INVITE_CODE  when set, registration requires this invite code.
# These are read from the current shell env first, then from the optional file
# `.wrangler/prod/prod.env` (KEY=VALUE lines, `#` comments, gitignored). Only
# non-empty values are forwarded to wrangler as `--var KEY:VALUE`; secret values
# are never printed (only their key names are logged).

set -euo pipefail

# Always operate from the repo root (this script lives in <repo>/scripts).
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd -- "${REPO_ROOT}"

PORT="${PORT:-3100}"
HOST="${HOST:-0.0.0.0}"

PROD_DIR=".wrangler/prod"
LOG_FILE="${PROD_DIR}/server.log"
PID_FILE="${PROD_DIR}/server.pid"
WATCH_LOG_FILE="${PROD_DIR}/articles-watch.log"
WATCH_PID_FILE="${PROD_DIR}/articles-watch.pid"
WRANGLER_LOG_PATH_ENV=".wrangler/prod/wrangler.log"
WRANGLER_CONFIG="dist/server/wrangler.json"
PROD_ENV_FILE="${PROD_DIR}/prod.env"

# Worker vars that may be forwarded to wrangler (values stay out of the logs).
FORWARDED_VAR_KEYS=(DABAIHUA_TRUSTED_PROXY_HOSTS DABAIHUA_ALLOW_REGISTER DABAIHUA_REGISTER_INVITE_CODE DABAIHUA_PUBLIC_BASE_URL)

mkdir -p -- "${PROD_DIR}"

# Reads KEY=VALUE from $PROD_ENV_FILE (trimmed, `#` comments and blank lines ignored,
# optional surrounding single/double quotes stripped). Prints the value, or nothing.
env_file_value() {
  local key="$1"
  [[ -f "${PROD_ENV_FILE}" ]] || return 0
  local line
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" =~ ^[[:space:]]*$ ]] && continue
    [[ "${line}" == *=* ]] || continue
    local entry_key="${line%%=*}"
    entry_key="$(printf '%s' "${entry_key}" | tr -d '[:space:]')"
    [[ "${entry_key}" == "${key}" ]] || continue
    local value="${line#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ ${#value} -ge 2 ]]; then
      local first="${value:0:1}" last="${value: -1}"
      if [[ ("${first}" == '"' || "${first}" == "'") && "${last}" == "${first}" ]]; then
        value="${value:1:${#value}-2}"
      fi
    fi
    printf '%s' "${value}"
    return 0
  done < "${PROD_ENV_FILE}"
}

# Shell env wins over the optional prod.env file.
resolve_var() {
  local key="$1" shell_value
  shell_value="$(printenv "${key}" 2>/dev/null || true)"
  if [[ -n "${shell_value}" ]]; then
    printf '%s' "${shell_value}"
    return 0
  fi
  env_file_value "${key}"
}

is_running() {
  [[ -f "${PID_FILE}" ]] || return 1
  local pid
  pid="$(cat -- "${PID_FILE}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  kill -0 -- "${pid}" 2>/dev/null
}

current_pid() {
  cat -- "${PID_FILE}" 2>/dev/null || true
}

watch_is_running() {
  [[ -f "${WATCH_PID_FILE}" ]] || return 1
  local pid
  pid="$(cat -- "${WATCH_PID_FILE}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  kill -0 -- "${pid}" 2>/dev/null
}

start_watcher() {
  if watch_is_running; then
    echo "articles watcher already running: pid $(cat -- "${WATCH_PID_FILE}")" >&2
    return 0
  fi
  echo "starting articles watcher (node scripts/sync-articles.mjs --watch)..."
  setsid nohup node scripts/sync-articles.mjs --watch >"${WATCH_LOG_FILE}" 2>&1 &
  local watch_pid=$!
  echo "${watch_pid}" > "${WATCH_PID_FILE}"
  echo "articles watcher: pid ${watch_pid}, log ${WATCH_LOG_FILE}"
}

stop_watcher() {
  if ! watch_is_running; then
    rm -f -- "${WATCH_PID_FILE}"
    return 0
  fi
  local watch_pid
  watch_pid="$(cat -- "${WATCH_PID_FILE}")"
  echo "stopping articles watcher pid ${watch_pid} (process group -${watch_pid})..."
  kill -TERM -- "-${watch_pid}" 2>/dev/null || kill -TERM -- "${watch_pid}" 2>/dev/null || true
  for _ in {1..10}; do
    if ! kill -0 -- "${watch_pid}" 2>/dev/null; then
      rm -f -- "${WATCH_PID_FILE}"
      echo "articles watcher stopped"
      return 0
    fi
    sleep 1
  done
  echo "articles watcher still alive after SIGTERM, sending SIGKILL" >&2
  kill -KILL -- "-${watch_pid}" 2>/dev/null || kill -KILL -- "${watch_pid}" 2>/dev/null || true
  rm -f -- "${WATCH_PID_FILE}"
  echo "articles watcher stopped"
}

start() {
  start_watcher
  if is_running; then
    echo "already running: pid $(current_pid), port ${PORT}" >&2
    return 1
  fi

  if [[ "${BUILD:-0}" == "1" || ! -f "${WRANGLER_CONFIG}" ]]; then
    echo "building production worker (npm run build)..."
    npm run build
  fi

  echo "starting production worker on ${HOST}:${PORT}..."
  local wrangler_vars=()
  local key value
  for key in "${FORWARDED_VAR_KEYS[@]}"; do
    value="$(resolve_var "${key}")"
    [[ -n "${value}" ]] || continue
    echo "passing worker var: ${key}"
    wrangler_vars+=(--var "${key}:${value}")
  done
  setsid env WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH_ENV}" \
    npx wrangler dev \
      -c "${WRANGLER_CONFIG}" \
      --port "${PORT}" \
      --ip "${HOST}" \
      --persist-to .wrangler/state \
      --show-interactive-dev-session=false \
      "${wrangler_vars[@]}" \
      >"${LOG_FILE}" 2>&1 &
  local pid=$!
  echo "${pid}" > "${PID_FILE}"

  local url="http://127.0.0.1:${PORT}/"
  local ready=0
  for _ in {1..30}; do
    if curl -fs -o /dev/null --max-time 2 "${url}" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 -- "${pid}" 2>/dev/null; then
      echo "server exited during startup; see ${LOG_FILE}" >&2
      rm -f -- "${PID_FILE}"
      return 1
    fi
    sleep 1
  done

  if [[ "${ready}" == "1" ]]; then
    echo "running: pid ${pid}"
    echo "url: ${url}"
    return 0
  fi

  echo "not responding after 30s; see ${LOG_FILE}" >&2
  return 1
}

stop() {
  stop_watcher
  if ! is_running; then
    echo "stopped: port ${PORT}"
    rm -f -- "${PID_FILE}"
    return 0
  fi

  local pid
  pid="$(current_pid)"
  echo "stopping pid ${pid} (process group -${pid})..."
  # Kill ONLY the process group created by setsid for this pid — never pkill by name,
  # because a separate dev server may be running on port 3000.
  kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM -- "${pid}" 2>/dev/null || true

  for _ in {1..10}; do
    if ! kill -0 -- "-${pid}" 2>/dev/null; then
      rm -f -- "${PID_FILE}"
      echo "stopped: port ${PORT}"
      return 0
    fi
    sleep 1
  done

  echo "still alive after SIGTERM, sending SIGKILL" >&2
  kill -KILL -- "-${pid}" 2>/dev/null || kill -KILL -- "${pid}" 2>/dev/null || true
  rm -f -- "${PID_FILE}"
  echo "stopped: port ${PORT}"
}

status() {
  if is_running; then
    echo "running: pid $(current_pid), port ${PORT}, url http://127.0.0.1:${PORT}/"
  else
    rm -f -- "${PID_FILE}"
    echo "stopped: port ${PORT}"
  fi
  if watch_is_running; then
    echo "articles watcher: running: pid $(cat -- "${WATCH_PID_FILE}"), log ${WATCH_LOG_FILE}"
  else
    rm -f -- "${WATCH_PID_FILE}"
    echo "articles watcher: stopped"
  fi
}

logs() {
  if [[ ! -f "${LOG_FILE}" ]]; then
    echo "no log file at ${LOG_FILE}" >&2
    return 1
  fi
  tail -n 200 -f -- "${LOG_FILE}"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart)
    stop
    start
    ;;
  status) status ;;
  logs) logs ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs}" >&2
    exit 2
    ;;
esac
