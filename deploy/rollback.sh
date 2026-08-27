#!/usr/bin/env bash
# =============================================================================
# Knot Kitchen — rollback to the previously-deployed revision
# =============================================================================
# Deploy writes the current SHA to deploy/.previous BEFORE moving to the new
# revision, so this script re-checkouts that SHA and rebuilds. Data in MongoDB
# and external object storage is untouched — a rollback of code does not roll
# back user data.
#
# Usage on the VPS:
#   cd /srv/knot
#   ./deploy/rollback.sh          # roll back to whatever .previous contains
#   ./deploy/rollback.sh SHA123    # roll back to a specific SHA/tag
#
# Exit codes:
#   0  rolled back and health check passed
#   1  no previous SHA / requested ref cannot be found
#   2  containers rebuilt but /health never returned 200

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  if [[ ! -f deploy/.previous ]]; then
    echo "No deploy/.previous file found — cannot auto-rollback."
    echo "Pass a git SHA/tag explicitly:  $0 <sha-or-tag>"
    exit 1
  fi
  TARGET="$(cat deploy/.previous)"
fi

echo "==> Rolling back to $TARGET"
git fetch --tags --prune origin
git checkout "$TARGET"

echo "==> Rebuilding + restarting containers"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build --pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --remove-orphans

echo "==> Waiting for backend to become healthy"
for i in $(seq 1 30); do
  if docker compose -f deploy/docker-compose.yml exec -T pos-api \
       wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "Rollback complete. Backend healthy after ${i} attempts."
    exit 0
  fi
  sleep 2
done

echo "Backend never became healthy after rollback. Inspect logs:"
echo "  docker compose -f deploy/docker-compose.yml logs --tail=200 pos-api"
exit 2
