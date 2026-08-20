#!/usr/bin/env bash
# =============================================================================
# Knot Kitchen — nightly backup script (cron-friendly)
# =============================================================================
# What this backs up:
#   1. deploy/.env               (the ONLY secret on the VPS)
#   2. Caddy /data volume         (ACME account key + issued certificates)
#   3. Local uploads volume       (only meaningful if MEDIA_STORAGE_PROVIDER=local)
#
# What this does NOT back up:
#   * MongoDB              — Atlas has its own continuous backup; DO enable it.
#   * Object storage       — R2 has versioning + lifecycle; DO enable them.
#   * Container images     — rebuilt on every deploy from the source repo.
#
# Recommended cron entry (as root):
#   17 3 * * *   /srv/knot/deploy/backup.sh >> /var/log/knot-backup.log 2>&1

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${KNOT_BACKUP_DIR:-/var/backups/knotkitchen}"
mkdir -p "$OUT_DIR"

echo "[$(date -Is)] backup starting"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. env file
cp "$REPO_ROOT/deploy/.env" "$TMP/env"

# 2. caddy_data volume (contains ACME certs + account key)
docker run --rm \
  -v knotkitchen_caddy_data:/data \
  -v "$TMP":/backup \
  alpine tar -C /data -czf /backup/caddy_data.tar.gz .

# 3. backend_uploads volume — may be tiny/empty when using R2
if docker volume inspect knotkitchen_backend_uploads >/dev/null 2>&1; then
  docker run --rm \
    -v knotkitchen_backend_uploads:/data \
    -v "$TMP":/backup \
    alpine tar -C /data -czf /backup/backend_uploads.tar.gz .
fi

# Bundle into one encrypted archive so it's safe to ship anywhere. Passphrase
# is provided via KNOT_BACKUP_PASSPHRASE — MUST be set in the crontab.
if [[ -z "${KNOT_BACKUP_PASSPHRASE:-}" ]]; then
  echo "KNOT_BACKUP_PASSPHRASE not set — refusing to write an unencrypted backup."
  exit 1
fi

OUT_FILE="$OUT_DIR/knot-$STAMP.tar.gz.gpg"
tar -C "$TMP" -czf - . | gpg --batch --yes --passphrase "$KNOT_BACKUP_PASSPHRASE" \
    --symmetric --cipher-algo AES256 -o "$OUT_FILE"

echo "[$(date -Is)] wrote $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Rotate: keep the last 14 nights.
find "$OUT_DIR" -type f -name 'knot-*.tar.gz.gpg' -mtime +14 -delete

echo "[$(date -Is)] backup complete"
