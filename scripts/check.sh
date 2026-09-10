#!/usr/bin/env bash
# Everything that has to pass, in one command.
#
# It exists so "did I break anything" has a single answer. Three separate
# commands means the one you skipped is the one that was failing, and CI runs
# exactly this file so a green machine and a green laptop mean the same thing.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
step() {
  printf '\n── %s\n' "$1"
  shift
  if "$@"; then
    printf '   ok\n'
  else
    printf '   FAILED\n'
    fail=1
  fi
}

# Deliberately not `cargo fmt --check`. This codebase has never been run
# through rustfmt and doing so touches 43 files and ~4,800 lines -- a decision
# for whoever owns the code, not a side effect of adding a gate. Turn it on in
# its own commit if you want it.
step "rust: build" cargo build --manifest-path server/Cargo.toml --quiet
step "rust: tests" cargo test --manifest-path server/Cargo.toml --quiet
step "web: words" node scripts/i18n-lint.mjs
# Invoked exactly as package.json does, from apps/web: run from the root
# with --project instead and tsc resolves paths differently and fails.
step "web: types" bash -c 'cd apps/web && ./node_modules/.bin/tsc --noEmit'
step "web: build" bash -c 'cd apps/web && ./node_modules/.bin/next build >/dev/null'

# Counts are measured, never remembered: print what is actually there rather
# than trusting a number somebody typed into a readme months ago.
printf '\n── counts\n'
printf '   entities : %s\n' "$(grep -rc 'r.add(EntityDef' server/src/modules/*.rs | awk -F: '{s+=$2} END {print s}')"
printf '   tests    : %s\n' "$(cargo test --manifest-path server/Cargo.toml 2>/dev/null | grep -oE '[0-9]+ passed' | head -1)"
printf '   migrations: %s\n' "$(ls server/migrations/*.sql | wc -l | tr -d ' ')"
printf '   phrases  : %s\n' "$(grep -c '": "' apps/web/src/lib/i18n.ts | tr -d ' ')"

if [[ $fail -ne 0 ]]; then
  printf '\n✗ something above failed\n' >&2
  exit 1
fi
printf '\n✓ all green\n'
