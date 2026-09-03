#!/usr/bin/env bash
# Is Meridian up? Reports each launchd agent (running + last exit), the local
# listeners, and the public path end to end. Read top-to-bottom:
# agents → local ports → public. Modelled on everest/ops/status.sh.
set -uo pipefail
DOMAIN="gui/$(id -u)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "── launchd agents ─────────────────────────────"
for label in com.meridian.api com.meridian.web com.meridian.tunnel; do
  line="$(launchctl print "$DOMAIN/$label" 2>/dev/null | grep -E '^\s*(pid|state|last exit code) =' | tr -d '\t')"
  if [ -n "$line" ]; then
    printf '  %-22s %s\n' "$label" "$(echo "$line" | paste -sd' · ' -)"
  else
    printf '  %-22s NOT INSTALLED\n' "$label"
  fi
done

echo "── local listeners ────────────────────────────"
# Both must be loopback-only: the tunnel is the sole route in, and the API is
# not routed through it at all.
for port in 7010 7011; do
  addr="$(lsof -nP -iTCP:$port -sTCP:LISTEN 2>/dev/null | tail -1 | awk '{print $9}')"
  if [ -n "$addr" ]; then
    case "$addr" in
      127.0.0.1:*|\[::1\]:*) printf '  :%s  ✓ %s\n' "$port" "$addr" ;;
      *)                     printf '  :%s  ⚠ %s  NOT loopback-only\n' "$port" "$addr" ;;
    esac
  else
    printf '  :%s  ✗ nothing listening\n' "$port"
  fi
done

echo "── database ───────────────────────────────────"
DB="$ROOT/data/production.db"
if [ -f "$DB" ]; then
  printf '  %s  (%s bytes)\n' "$DB" "$(wc -c < "$DB" | tr -d ' ')"
  printf '  integrity : %s\n' "$(sqlite3 "$DB" 'PRAGMA quick_check' 2>&1 | head -1)"
  printf '  orgs      : %s   members: %s\n' \
    "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM organizations;' 2>/dev/null)" \
    "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM memberships;' 2>/dev/null)"
  # t7kit snapshots this nightly; if it is not listed there it is not backed up.
  if grep -q 'data/production.db' "$HOME/Project/ops/t7kit/config.sh" 2>/dev/null; then
    printf '  backup    : in t7kit DB_TARGETS\n'
  else
    printf '  backup    : ⚠ NOT in t7kit DB_TARGETS\n'
  fi
else
  printf '  ✗ no database at %s\n' "$DB"
fi

echo "── public (business.aurovie.com via Cloudflare) ─"
# curl prints 000 *and* exits non-zero when it cannot connect, so a `||`
# fallback would append to the code rather than replace it.
code() { curl -s -m 12 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null; }
printf '  login page            : HTTP %s\n' "$(code https://business.aurovie.com/login)"
printf '  / (unauthenticated)   : HTTP %s  (expect 307 → /login)\n' "$(code https://business.aurovie.com/)"
printf '  /api/e/crm.deals      : HTTP %s  (expect 401 — no session)\n' "$(code https://business.aurovie.com/api/e/crm.deals)"
echo
echo "  If the public checks are 000/530 but the local ones pass, the DNS record"
echo "  is missing: business CNAME c9831615-e39a-4f8c-89db-58ecd5c64b03.cfargotunnel.com"
