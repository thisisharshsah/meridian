#!/usr/bin/env bash
# Launchd entry point for the web app. Binds loopback only: the Cloudflare
# tunnel is the sole route in.
set -euo pipefail
cd "$(dirname "$0")/../apps/web"

export NODE_ENV=production
export API_URL="${API_URL:-http://127.0.0.1:7011}"
exec ./node_modules/.bin/next start -p "${WEB_PORT:-7010}" -H 127.0.0.1
