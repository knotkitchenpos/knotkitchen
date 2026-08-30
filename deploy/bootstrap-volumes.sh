#!/usr/bin/env bash
# =============================================================================
# Knot Kitchen — create the external Docker volumes
# =============================================================================
# The volumes listed here are declared `external: true` in docker-compose.yml
# so that `docker compose down -v` and `docker volume prune` cannot destroy
# them. The cost of that protection is that Compose will not create them for
# you: `docker compose up` fails with "volume ... declared as external, but
# could not be found" until they exist.
#
# This script closes that gap. It is idempotent — creating a volume that
# already exists is a no-op and NEVER touches its contents — so it is safe to
# run on every deploy, which is exactly what .github/workflows/deploy.yml does.
#
# Run it by hand before the first `docker compose up` on a new host:
#   ./deploy/bootstrap-volumes.sh
#
# NOTE: these names are absolute, not project-prefixed. They match the
# identifiers Compose used when the volumes were project-managed (project
# "knotkitchen" + volume name), so an existing deployment keeps its data.

set -euo pipefail

VOLUMES=(
  knotkitchen_csd_documents
  knotkitchen_onboard_data
  knotkitchen_onboard_uploads
)

created=0
for vol in "${VOLUMES[@]}"; do
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    echo "  ok       $vol (exists)"
  else
    docker volume create "$vol" >/dev/null
    echo "  CREATED  $vol"
    created=$((created + 1))
  fi
done

if [[ "$created" -gt 0 ]]; then
  echo "Created $created volume(s). If this was NOT a fresh host, check that no"
  echo "existing data was expected in them — a rename or a project-name change"
  echo "would show up exactly like this."
fi
