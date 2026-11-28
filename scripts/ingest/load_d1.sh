#!/usr/bin/env bash
# Load the SQL batches produced by the ingest scripts into D1.
#   scripts/ingest/load_d1.sh local            # wrangler dev's local database
#   scripts/ingest/load_d1.sh remote           # the deployed database
#   scripts/ingest/load_d1.sh remote out/sql parcels_0115.sql   # resume at a file
#   DB_NAME=onesense-p-west scripts/ingest/load_d1.sh remote out/sql-07   # a shard
# Files use INSERT OR REPLACE, so re-running any file is safe.
set -euo pipefail

MODE="${1:-local}"
SQL_DIR="${2:-out/sql}"
RESUME_AT="${3:-}"
DB_NAME="${DB_NAME:-onesense}"

case "$MODE" in
  local)  FLAG="--local" ;;
  remote) FLAG="--remote" ;;
  *) echo "usage: $0 [local|remote] [sql-dir] [resume-at-basename]"; exit 2 ;;
esac

shopt -s nullglob
files=("$SQL_DIR"/*.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "no .sql files in $SQL_DIR — run the ingest scripts first" >&2
  exit 1
fi

echo "loading ${#files[@]} file(s) into D1 ($MODE)…"
i=0
skipping=${RESUME_AT:+1}
for f in "${files[@]}"; do
  i=$((i+1))
  if [ -n "${skipping:-}" ]; then
    if [ "$(basename "$f")" = "$RESUME_AT" ]; then skipping=""; else continue; fi
  fi
  attempt=1
  until npx wrangler d1 execute "$DB_NAME" "$FLAG" --file "$f" >/dev/null 2>&1; do
    if [ $attempt -ge 5 ]; then
      echo "FAILED after 5 attempts: $f — resume with: $0 $MODE $SQL_DIR $(basename "$f")" >&2
      exit 1
    fi
    sleep $((attempt * 15))
    attempt=$((attempt+1))
  done
  echo "  [$i/${#files[@]}] $f"
  sleep 1  # pace API calls; bulk loads can trip per-IP rate limits
done
echo "done"
