#!/usr/bin/env bash
# =============================================================================
# Knot Kitchen — verify the backup setup is actually complete
# =============================================================================
# `backup.sh` can exit 0 having produced an archive that is still one host
# failure away from being worthless: encrypted with a passphrase that exists
# only on this machine, never copied offsite, monitored by nothing. Those are
# configuration gaps, not script failures, so the backup itself cannot report
# them.
#
# This script checks them. Run it after setting the backup up, and any time you
# want to answer "is my data actually safe?" without reasoning it out again.
#
#   bash deploy/verify-backup-setup.sh
#
# It reads the same environment backup.sh does, so run it the same way cron
# does if you want a true picture:
#
#   sudo -i; set -a; . /etc/knot-backup.env; set +a; bash deploy/verify-backup-setup.sh
#
# Exit 0 = everything required is in place. Exit 1 = at least one REQUIRED
# check failed. Recommendations warn but do not fail.

set -uo pipefail   # deliberately NOT -e: we want every check to run

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${KNOT_BACKUP_DIR:-/var/backups/knotkitchen}"

fails=0
warns=0

ok()   { echo "  [ OK ]   $1"; }
bad()  { echo "  [FAIL]   $1"; fails=$((fails + 1)); }
warn() { echo "  [WARN]   $1"; warns=$((warns + 1)); }

echo "Knot Kitchen — backup setup verification"
echo "========================================"
echo
echo "Tooling"

command -v gpg       >/dev/null 2>&1 && ok "gpg installed" || bad "gpg missing — archives cannot be encrypted"
command -v docker    >/dev/null 2>&1 && ok "docker installed" || bad "docker missing — volumes cannot be archived"

if [[ "${KNOT_BACKUP_SKIP_MONGO:-false}" == "true" ]]; then
  warn "KNOT_BACKUP_SKIP_MONGO=true — the database is NOT in the backup."
  warn "  Correct ONLY if the Atlas cluster has its own verified snapshots."
elif command -v mongodump >/dev/null 2>&1; then
  ok "mongodump installed"
else
  bad "mongodump missing — apt-get install -y mongodb-database-tools"
fi

echo
echo "Secrets"

if [[ -n "${KNOT_BACKUP_PASSPHRASE:-}" ]]; then
  if [[ "${#KNOT_BACKUP_PASSPHRASE}" -lt 20 ]]; then
    warn "KNOT_BACKUP_PASSPHRASE is short (${#KNOT_BACKUP_PASSPHRASE} chars). Use 32+."
  else
    ok "KNOT_BACKUP_PASSPHRASE set (${#KNOT_BACKUP_PASSPHRASE} chars)"
  fi
  echo "           ! Cannot verify you have a copy OFF this machine."
  echo "           ! deploy/.env is inside the encrypted backup, so without an"
  echo "           ! external copy of this passphrase a host loss leaves you"
  echo "           ! holding archives you cannot open. Put it in a password"
  echo "           ! manager now if you have not."
else
  bad "KNOT_BACKUP_PASSPHRASE not set — backup.sh will refuse to run"
fi

if [[ -f "$REPO_ROOT/deploy/.env" ]]; then
  if grep -q '^MONGODB_URI=' "$REPO_ROOT/deploy/.env"; then
    ok "MONGODB_URI present in deploy/.env"
  else
    bad "MONGODB_URI missing from deploy/.env — mongodump cannot run"
  fi
else
  bad "deploy/.env not found at $REPO_ROOT/deploy/.env"
fi

echo
echo "Offsite"

if [[ -n "${KNOT_BACKUP_REMOTE:-}" ]]; then
  if command -v rclone >/dev/null 2>&1; then
    ok "KNOT_BACKUP_REMOTE set ($KNOT_BACKUP_REMOTE)"
    remote_name="${KNOT_BACKUP_REMOTE%%:*}"
    if rclone listremotes 2>/dev/null | grep -qx "${remote_name}:"; then
      ok "rclone remote '${remote_name}:' is configured"
      if rclone lsd "$KNOT_BACKUP_REMOTE" >/dev/null 2>&1; then
        ok "remote is reachable and authenticates"
      else
        bad "remote '$KNOT_BACKUP_REMOTE' did not respond — check credentials/bucket"
      fi
    else
      bad "rclone has no remote named '${remote_name}:' — run: rclone config"
    fi
  else
    bad "KNOT_BACKUP_REMOTE set but rclone is not installed"
  fi
else
  bad "KNOT_BACKUP_REMOTE not set — backups never leave this VPS."
  echo "           A host failure would take the data AND every backup of it."
fi

echo
echo "Monitoring"

if [[ -n "${KNOT_BACKUP_HEARTBEAT_URL:-}" ]]; then
  ok "KNOT_BACKUP_HEARTBEAT_URL set"
  command -v curl >/dev/null 2>&1 && ok "curl installed (pings can be sent)" \
    || bad "curl missing — heartbeat pings cannot be sent"
else
  warn "KNOT_BACKUP_HEARTBEAT_URL not set — a cron job that stops running"
  warn "  will not be noticed until you need the backup."
fi

echo
echo "Protected volumes"

for vol in knotkitchen_csd_documents knotkitchen_onboard_data knotkitchen_onboard_uploads; do
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    ok "$vol exists"
  else
    bad "$vol missing — run: bash deploy/bootstrap-volumes.sh"
  fi
done

echo
echo "Last successful run"

if [[ -f "$OUT_DIR/.last-success" ]]; then
  last="$(cat "$OUT_DIR/.last-success")"
  last_epoch="$(date -d "$last" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  if [[ "$last_epoch" -gt 0 ]]; then
    age_h=$(( (now_epoch - last_epoch) / 3600 ))
    if [[ "$age_h" -le 26 ]]; then
      ok "last success ${age_h}h ago ($last)"
    else
      bad "last success was ${age_h}h ago ($last) — backups are not running"
    fi
  else
    warn "could not parse $OUT_DIR/.last-success ($last)"
  fi
else
  warn "no successful run recorded yet — run: bash deploy/backup.sh"
fi

echo
echo "Restore drill"
echo "           ! Not checkable from here. An untested backup is a hypothesis."
echo "           ! Restore one volume and the mongodump into a scratch target"
echo "           ! once — see DEPLOYMENT.md §10."

echo
echo "========================================"
if [[ "$fails" -gt 0 ]]; then
  echo "RESULT: $fails required check(s) FAILED, $warns warning(s)."
  echo "Your data is not yet protected the way this repo assumes it is."
  exit 1
fi
echo "RESULT: all required checks passed, $warns warning(s)."
exit 0
