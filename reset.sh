#!/usr/bin/env bash
# Deletes the local database. Everything in it is lost.
set -euo pipefail
cd "$(dirname "$0")"
read -r -p "Delete data/suite.db and everything in it? [y/N] " reply
[[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "Cancelled."; exit 0; }
rm -f data/suite.db data/suite.db-shm data/suite.db-wal
echo "Deleted. The next run will create a fresh database."
