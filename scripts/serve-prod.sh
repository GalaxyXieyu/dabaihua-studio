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
WRANGLER_LOG_PATH_ENV=".wrangler/prod/wrangler.log"
WRANGLER_CONFIG="dist/server/wrangler.json"

mkdir -p -- "${PROD_DIR}"

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

start() {
  if is_running; then
    echo "already running: pid $(current_pid), port ${PORT}" >&2
    return 1
  fi

  if [[ "${BUILD:-0}" == "1" || ! -f "${WRANGLER_CONFIG}" ]]; then
    echo "building production worker (npm run build)..."
    npm run build
  fi

  echo "starting production worker on ${HOST}:${PORT}..."
  setsid env WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH_ENV}" \
    npx wrangler dev \
      -c "${WRANGLER_CONFIG}" \
      --port "${PORT}" \
      --ip "${HOST}" \
      --persist-to .wrangler/state \
      --show-interactive-dev-session=false \
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
