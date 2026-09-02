#!/usr/bin/env bash
# Runs the API and the web app together. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

API_PORT=8787
WEB_PORT=3100

cleanup() {
  trap - INT TERM EXIT
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $API_PORT is already in use. Stop that process, or set BIND_ADDR." >&2
  exit 1
fi

mkdir -p data

echo "→ building the API server (first run compiles the dependency tree)…"
(cd server && cargo build --quiet)

echo "→ starting API on http://127.0.0.1:$API_PORT"
(cd server && cargo run --quiet) &
API_PID=$!

for _ in $(seq 1 100); do
  curl -sf -m 1 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.3
done

echo "→ starting web app on http://localhost:$WEB_PORT"
(cd apps/web && ./node_modules/.bin/next dev -p "$WEB_PORT") &
WEB_PID=$!

echo
echo "  Meridian is running:  http://localhost:$WEB_PORT"
echo "  API:                  http://127.0.0.1:$API_PORT/api/health"
echo
wait
