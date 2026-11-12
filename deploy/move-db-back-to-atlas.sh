#!/usr/bin/env bash
# =============================================================================
# Knot Kitchen — go back to MongoDB Atlas after deploy/move-db-to-vps.sh
# =============================================================================
# Points MONGODB_URI back at the Atlas address that move-db-to-vps.sh kept as
# MONGODB_URI_ATLAS, and restarts pos-api, pos-api-2 and kkmdm.
#
# WARNING: anything written since the move (orders, chats, edits) is only in
# the VPS database, and Atlas does not have it. This script leaves the VPS
# database and its volume alone, so nothing is deleted, but copying those
# newer records to Atlas is a separate job.
#
#   cd /srv/knot && bash deploy/move-db-back-to-atlas.sh
# =============================================================================
set -euo pipefail

cd "${KNOT_DIR:-/srv/knot}"
ENV_FILE=deploy/.env
C="docker compose -f deploy/docker-compose.yml --env-file $ENV_FILE"

ATLAS_URI="$(sed -n 's/^MONGODB_URI_ATLAS=//p' "$ENV_FILE" | head -1)"
[[ -n "$ATLAS_URI" ]] || { echo "No MONGODB_URI_ATLAS in $ENV_FILE — nothing to go back to." >&2; exit 1; }

cp -p "$ENV_FILE" "$ENV_FILE.before-db-back.$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp)"; chmod 600 "$tmp"
grep -v '^MONGODB_URI=' "$ENV_FILE" > "$tmp" || true
printf 'MONGODB_URI=%s\n' "$ATLAS_URI" >> "$tmp"
cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
echo "MONGODB_URI points at Atlas again; restarting pos-api, pos-api-2 and kkmdm"

$C up -d pos-api pos-api-2 kkmdm
for i in $(seq 1 40); do
  if $C exec -T pos-api wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "pos-api healthy on Atlas."
    exit 0
  fi
  sleep 3
done
echo "pos-api did not become healthy — check: $C logs --tail 50 pos-api" >&2
exit 1
