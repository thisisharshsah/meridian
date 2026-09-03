#!/usr/bin/env bash
# Production runner. Both processes bind to loopback only — the Cloudflare
# tunnel is the sole way in, so nothing is exposed on the LAN.
set -euo pipefail
cd "$(dirname "$0")"

API_PORT="${API_PORT:-7011}"
WEB_PORT="${WEB_PORT:-7010}"
ENV_FILE="${ENV_FILE:-server/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy server/.env.example and set a real JWT_SECRET:" >&2
  echo "  openssl rand -hex 32" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if [[ "${JWT_SECRET:-}" == "change-me-in-production" || -z "${JWT_SECRET:-}" ]]; then
  echo "JWT_SECRET is unset or still the placeholder. Refusing to serve." >&2
  exit 1
fi

cleanup() {
  trap - INT TERM EXIT
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

mkdir -p data logs

echo "→ API   127.0.0.1:$API_PORT"
BIND_ADDR="127.0.0.1:$API_PORT" \
  ./server/target-release/suite-server >> logs/api.log 2>&1 &
API_PID=$!

for _ in $(seq 1 100); do
  curl -sf -m 1 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.3
done

echo "→ Web   127.0.0.1:$WEB_PORT"
( cd apps/web && NODE_ENV=production API_URL="http://127.0.0.1:$API_PORT" \
    ./node_modules/.bin/next start -p "$WEB_PORT" -H 127.0.0.1 ) >> logs/web.log 2>&1 &
WEB_PID=$!

echo
echo "  Serving. The tunnel should point at http://127.0.0.1:$WEB_PORT"
echo "  Logs: logs/api.log, logs/web.log"
wait
