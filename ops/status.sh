#!/usr/bin/env bash
# Is Meridian up? Reports each launchd agent (running + last exit), the local
# listeners, and the public path end to end. Read top-to-bottom:
# agents → local ports → public. Modelled on everest/ops/status.sh.
set -uo pipefail
DOMAIN="gui/$(id -u)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# What this installation is. Read from the running server rather than from
# the file, because the file can have been edited since the last restart.
printf '── edition ────────────────────────────────────\n'
running="$(curl -s -m 5 http://127.0.0.1:7011/api/health 2>/dev/null | sed -n 's/.*"edition":"\([^"]*\)".*/\1/p')"
configured="$(grep -E '^EDITION=' server/.env.production 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)"
printf '  serving    : %s\n' "${running:-unknown (api not answering)}"
printf '  configured : %s\n' "${configured:-full (unset)}"
if [ -n "$running" ] && [ -n "$configured" ] && [ "$running" != "$configured" ]; then
  printf '  ⚠ the file says %s and the process is serving %s — restart to apply\n' \
    "$configured" "$running"
fi

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
#
# The code alone cannot separate "down" from "up but challenged". The
# aurovie.com zone carries a zone-wide Cloudflare managed challenge, so every
# non-browser client -- this script included -- is answered 403 with a
# cf-mitigated: challenge header by the edge, while browsers pass through to
# the origin. Reading that 403 as an outage sends you hunting a second bug
# that does not exist, so the header decides the verdict, not the code.
# Symptoms seen, so the notes below can be printed for the ones that happened
# rather than for all of them at once. Guidance shown unprompted reads as a
# diagnosis, and a healthy run that ends in a wall of red is its own false
# alarm -- the second bug that does not exist.
saw_unreachable=0
saw_challenge=0

probe() {
  url="$1"; want="$2"; label="$3"
  hdrs="$(mktemp)"
  code="$(curl -s -m 12 -o /dev/null -D "$hdrs" -w '%{http_code}' "$url" 2>/dev/null)"
  if grep -qi '^cf-mitigated:[[:space:]]*challenge' "$hdrs"; then challenged=1; else challenged=0; fi
  rm -f "$hdrs"

  if [ "$code" = "000" ]; then
    saw_unreachable=1
    printf '  %-22s ✗ unreachable — no answer at all (DNS or connectivity)\n' "$label"
  elif [ "$challenged" = 1 ]; then
    saw_challenge=1
    printf '  %-22s ⚠ HTTP %s — edge challenge; origin never reached\n' "$label" "$code"
  elif [ "$code" = "$want" ]; then
    printf '  %-22s ✓ HTTP %s\n' "$label" "$code"
  else
    printf '  %-22s ⚠ HTTP %s  (expected %s)\n' "$label" "$code" "$want"
  fi
}
probe https://business.aurovie.com/login           200 "login page"
probe https://business.aurovie.com/                307 "/ (unauth)"
probe https://business.aurovie.com/api/e/crm.deals 401 "/api/e/crm.deals"

if [ "$saw_unreachable" = 1 ]; then
  echo
  echo "  ✗ unreachable → first rule out a stale negative DNS cache on THIS mac:"
  echo "      dig +short @1.1.1.1 business.aurovie.com"
  echo "    If the public resolvers answer but this box does not, the record is"
  echo "    fine and only the local stub cache is behind. Clear it with"
  echo "    sudo killall -HUP mDNSResponder, or wait out the 1800s negative TTL."
  echo "    If nobody resolves it, the CNAME is genuinely gone. Re-add it as:"
  echo "      business  CNAME  c9831615-e39a-4f8c-89db-58ecd5c64b03.cfargotunnel.com  (proxied)"
  echo "    Two traps when re-adding it with cloudflared, both of which bind the"
  echo "    name somewhere wrong while reporting success:"
  echo "      1. the origin cert decides the ZONE. Scoped to quantnepal.com it"
  echo "         creates business.aurovie.com.quantnepal.com instead. Select the"
  echo "         zone per invocation rather than swapping cert.pem about:"
  echo "           --origincert ~/.cloudflared/cert.aurovie.pem     (aurovie.com)"
  echo "           --origincert ~/.cloudflared/cert.quantnepal.pem  (quantnepal.com)"
  echo "      2. the default config.yml decides the TUNNEL, not the argument you"
  echo "         pass. Without --config it binds 527f3618 (quantnepal). Both"
  echo "         guards together, verified idempotent:"
  echo "         cloudflared --config ~/.cloudflared/business.yml tunnel --origincert ~/.cloudflared/cert.aurovie.pem route dns --overwrite-dns business business.aurovie.com"
fi

if [ "$saw_challenge" = 1 ]; then
  echo
  echo "  ⚠ edge challenge → DNS and the tunnel are both fine. The zone-wide"
  echo "    managed challenge is answering on our behalf; scope it away from"
  echo "    business.aurovie.com or add a WAF skip, or real API clients are"
  echo "    blocked exactly like this script is."
fi

if [ "$saw_unreachable" = 0 ] && [ "$saw_challenge" = 0 ]; then
  echo
  echo "  ✓ the public path is whole: DNS, tunnel and both origins answering."
fi
