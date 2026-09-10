#!/usr/bin/env bash
# Build, install and restart Meridian, then prove the thing now serving is the
# thing just built.
#
# The install is a staged copy plus an atomic rename, never a copy over the
# live file. launchd holds the running binary mapped, and writing into it in
# place leaves a half-written image that the kernel kills on exec with no
# output at all -- a corrupted deploy that looks like a mysterious crash.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${CARGO_TARGET_DIR:-$HOME/.cargo/target}/release/suite-server"
DST="server/target-release/suite-server"
DOMAIN="gui/$(id -u)"

# The package this box serves. Read from the same file the server will read,
# so the line printed here is the line that takes effect rather than a guess.
EDITION_LINE="$(grep -E '^EDITION=' server/.env.production 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)"
echo "→ deploying ${EDITION_LINE:-full}"

echo "→ building the API"
(cd server && cargo build --release --quiet)
[[ -f "$SRC" ]] || { echo "no binary at $SRC" >&2; exit 1; }

echo "→ building the web app"
(cd apps/web && ./node_modules/.bin/next build >/dev/null)

echo "→ installing the binary"
mkdir -p "$(dirname "$DST")"
cp "$SRC" "$DST.new"
chmod +x "$DST.new"
cmp -s "$SRC" "$DST.new" || { echo "staged copy differs from the build; refusing" >&2; rm -f "$DST.new"; exit 1; }
mv -f "$DST.new" "$DST"
cmp -s "$SRC" "$DST" || { echo "installed binary differs from the build" >&2; exit 1; }

echo "→ restarting"
launchctl kickstart -k "$DOMAIN/com.meridian.api" >/dev/null
launchctl kickstart -k "$DOMAIN/com.meridian.web" >/dev/null

echo "→ waiting for both to answer"
curl -sf --retry 40 --retry-delay 1 --retry-connrefused -m 5 -o /dev/null http://127.0.0.1:7011/api/health \
  || { echo "the API did not come back" >&2; exit 1; }
curl -sf --retry 40 --retry-delay 1 --retry-connrefused -m 5 -o /dev/null http://127.0.0.1:7010/login \
  || { echo "the web app did not come back" >&2; exit 1; }

echo "✓ deployed. ops/status.sh for the full picture."
