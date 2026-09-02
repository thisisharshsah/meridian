#!/usr/bin/env bash
# Fills the local database with a demo business you can click around.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data
cd server && cargo run --quiet -- seed
