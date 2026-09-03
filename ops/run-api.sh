#!/usr/bin/env bash
# Launchd entry point for the API. Sourced env rather than plist
# EnvironmentVariables so JWT_SECRET stays in one 0600 file and never lands in
# a plist that ends up in a backup.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-server/.env.production}"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if [[ -z "${JWT_SECRET:-}" || "${JWT_SECRET}" == "change-me-in-production" ]]; then
  echo "JWT_SECRET unset or placeholder; refusing to serve" >&2
  exit 1
fi

mkdir -p data
# exec, so launchd supervises the server itself and not this shell.
exec ./server/target-release/suite-server
