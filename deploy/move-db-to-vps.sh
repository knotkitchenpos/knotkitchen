#!/usr/bin/env bash
# =============================================================================
# Knot Kitchen — move the database from MongoDB Atlas to this VPS (one time)
# =============================================================================
# Run as root on the VPS, in two goes:
#
#   1. BEFORE pushing the commit that adds the `mongo` service (its deploy
#      needs the two new secrets in deploy/.env, or `compose up` refuses):
#        copy this script to /tmp on the VPS, then
#        bash /tmp/move-db-to-vps.sh --prepare
#   2. After that deploy has run (the empty `mongo` container is then up):
#        cd /srv/knot && bash deploy/move-db-to-vps.sh
#
# What it does, in order. It stops at the first problem, and until step 6
# the live site still uses Atlas, so stopping early changes nothing for users.
#   1. Adds MONGO_ROOT_PASSWORD / MONGO_KEYFILE_SECRET to deploy/.env (new,
#      random, never printed) if they are not there yet.
#   2. Starts the empty `mongo` container and waits until it is ready.
#   3. Stops pos-api and kkmdm (the only two services that write to the
#      database), so nothing changes while it is copied. Downtime starts here.
#   4. Copies everything from Atlas with mongodump, keeping the dump in
#      /var/backups/knotkitchen/ as a safety copy.
#   5. Restores it into the VPS database and compares the number of records in
#      every collection. Any difference: pos-api and kkmdm are started again on
#      Atlas and the script stops.
#   6. Points MONGODB_URI at the VPS database (the Atlas address is kept as
#      MONGODB_URI_ATLAS) and starts pos-api and kkmdm. Downtime ends here.
#
# Going back: deploy/move-db-back-to-atlas.sh. Atlas is not changed or deleted
# by this script; keep it until the VPS database has run well for a while.
# =============================================================================
set -euo pipefail

cd "${KNOT_DIR:-/srv/knot}"
ENV_FILE=deploy/.env
C="docker compose -f deploy/docker-compose.yml --env-file $ENV_FILE"
NET=knotkitchen_knot
BACKUP_DIR="${KNOT_BACKUP_DIR:-/var/backups/knotkitchen}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

say() { echo "[$(date +%H:%M:%S)] $*"; }
envget() { sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
envset() { # replace or append KEY=VALUE without printing the value
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"; chmod 600 "$tmp"
  grep -v "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
# Runs mongosh / mongodump / mongorestore in a throwaway container on the app
# network. Connection strings go in through the environment, never the command
# line, so they do not show in `ps`.
tool() { docker run --rm -i --network "$NET" -e SRC -e DST -e WHICH mongo:8.0 "$@"; }

# --- 0. Preflight ------------------------------------------------------------
PREPARE=0; [[ "${1:-}" == "--prepare" ]] && PREPARE=1
[[ -f "$ENV_FILE" ]] || { echo "No $ENV_FILE here — run from /srv/knot." >&2; exit 1; }
if [[ "$PREPARE" == 0 ]]; then
  grep -q '^  mongo:' deploy/docker-compose.yml || { echo "docker-compose.yml has no mongo service — git pull first." >&2; exit 1; }
fi
ATLAS_URI="$(envget MONGODB_URI)"
[[ -n "$ATLAS_URI" ]] || { echo "MONGODB_URI is empty in $ENV_FILE." >&2; exit 1; }
if [[ "$ATLAS_URI" == *"@mongo:27017"* ]]; then
  echo "MONGODB_URI already points at the VPS database — nothing to move." >&2; exit 0
fi
# The database name the apps use: the path of the Atlas URI (default "test",
# which is what the driver would use with no path).
DB_NAME="$(printf '%s' "$ATLAS_URI" | sed -E 's#^mongodb(\+srv)?://[^/]*/?##; s#\?.*$##')"
DB_NAME="${DB_NAME:-test}"
say "database name the apps use: $DB_NAME"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
docker pull -q mongo:8.0 >/dev/null

# --- 1. Secrets --------------------------------------------------------------
cp -p "$ENV_FILE" "$ENV_FILE.before-db-move.$STAMP"; chmod 600 "$ENV_FILE.before-db-move.$STAMP"
[[ -n "$(envget MONGO_ROOT_USER)" ]] || envset MONGO_ROOT_USER knot
[[ -n "$(envget MONGO_ROOT_PASSWORD)" ]] || envset MONGO_ROOT_PASSWORD "$(openssl rand -hex 32)"
[[ -n "$(envget MONGO_KEYFILE_SECRET)" ]] || envset MONGO_KEYFILE_SECRET "$(openssl rand -base64 756 | tr -d '\n')"
USER_="$(envget MONGO_ROOT_USER)"; PASS_="$(envget MONGO_ROOT_PASSWORD)"
LOCAL_URI="mongodb://${USER_}:${PASS_}@mongo:27017/${DB_NAME}?authSource=admin&replicaSet=rs0"
say "secrets in place (saved .env copy: $ENV_FILE.before-db-move.$STAMP)"
if [[ "$PREPARE" == 1 ]]; then
  say "--prepare: only the secrets were added; the site still uses Atlas."
  exit 0
fi

# --- 2. Start the VPS database ------------------------------------------------
bash deploy/bootstrap-volumes.sh >/dev/null
$C up -d mongo
for i in $(seq 1 40); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' knotkitchen-mongo-1 2>/dev/null)" == healthy ]] && break
  sleep 3
done
[[ "$(docker inspect -f '{{.State.Health.Status}}' knotkitchen-mongo-1)" == healthy ]] || { echo "mongo never became healthy:" >&2; docker logs --tail 30 knotkitchen-mongo-1 >&2; exit 1; }
export DST="$LOCAL_URI" SRC="$ATLAS_URI"
EXISTING="$(tool mongosh --nodb --quiet --eval '
  const m = new Mongo(process.env.DST);
  print(m.getDB("admin").adminCommand({ listDatabases: 1 }).databases.filter(d => !["admin","config","local"].includes(d.name)).length)')"
[[ "$EXISTING" == "0" ]] || { echo "The VPS database already holds $EXISTING database(s) — refusing to copy over it." >&2; exit 1; }
say "VPS database is up, primary, and empty"

# Counts of every collection, one "db.collection count" per line, sorted.
# A collection that deletes its own expired records (a TTL index: login codes,
# sessions…) prints "expiring" instead of a count, since either side may drop a
# few between the two counts; it still has to exist on both.
counts() { WHICH="$1" tool mongosh --nodb --quiet --eval '
  const m = new Mongo(process.env[process.env.WHICH]);
  const out = [];
  for (const d of m.getDB("admin").adminCommand({ listDatabases: 1 }).databases) {
    if (["admin","config","local"].includes(d.name) || d.name.startsWith("sample_")) continue;
    const db = m.getDB(d.name);
    for (const c of db.getCollectionInfos({ type: "collection" })) {
      if (c.name.startsWith("system.")) continue;
      const coll = db.getCollection(c.name);
      const ttl = coll.getIndexes().some(i => i.expireAfterSeconds !== undefined);
      out.push(d.name + "." + c.name + " " + (ttl ? "expiring" : coll.countDocuments({})));
    }
  }
  print(out.sort().join("\n"))'; }

restart_on_atlas() {
  say "starting pos-api and kkmdm again on Atlas (nothing was switched)"
  $C up -d pos-api kkmdm
}

# --- 3. Stop the writers ------------------------------------------------------
say "stopping pos-api and kkmdm — downtime starts"
$C stop pos-api kkmdm
trap 'echo "FAILED — see above." >&2; restart_on_atlas' ERR

# --- 4. Dump Atlas ------------------------------------------------------------
# One database at a time (the POS one, KKMDM's, and any other; not Atlas's
# sample_* demo data), never the
# admin/config/local system ones: Atlas does not let you dump those, and the
# VPS database has its own. The path is taken off the URI because mongodump
# would otherwise copy only the database it names.
export SRC_BASE DST_BASE
SRC_BASE="$(printf '%s' "$ATLAS_URI" | sed -E 's#^(mongodb(\+srv)?://[^/?]*)/?[^?]*#\1/#')"
DST_BASE="mongodb://${USER_}:${PASS_}@mongo:27017/?authSource=admin&replicaSet=rs0"
DBS="$(tool mongosh --nodb --quiet --eval '
  const m = new Mongo(process.env.SRC);
  print(m.getDB("admin").adminCommand({ listDatabases: 1, nameOnly: true }).databases
    .map(d => d.name).filter(n => !["admin","config","local"].includes(n) && !n.startsWith("sample_")).join(" "))')"
[[ -n "$DBS" ]] || { echo "Atlas lists no databases" >&2; false; }
say "databases to copy: $DBS"
DUMP_DIR="$BACKUP_DIR/atlas-final-$STAMP"
mkdir -p "$DUMP_DIR"; chmod 700 "$DUMP_DIR"
for db in $DBS; do
  say "copying $db from Atlas…"
  docker run --rm -i --network "$NET" -e SRC_BASE -e DB="$db" mongo:8.0 sh -c \
    'umask 077; printf "uri: \"%s\"\n" "$SRC_BASE" > /tmp/c.yml; exec mongodump --config=/tmp/c.yml --db="$DB" --archive --gzip --quiet' \
    > "$DUMP_DIR/$db.archive.gz"
  [[ -s "$DUMP_DIR/$db.archive.gz" ]] || { echo "dump of $db is empty" >&2; false; }
done
chmod 600 "$DUMP_DIR"/*.archive.gz
say "dump OK ($(du -sh "$DUMP_DIR" | cut -f1)) in $DUMP_DIR"

# --- 5. Restore and compare ---------------------------------------------------
for db in $DBS; do
  say "restoring $db into the VPS database…"
  OUT="$(docker run --rm -i --network "$NET" -e DST_BASE mongo:8.0 sh -c \
    'umask 077; printf "uri: \"%s\"\n" "$DST_BASE" > /tmp/c.yml; exec mongorestore --config=/tmp/c.yml --archive --gzip' \
    < "$DUMP_DIR/$db.archive.gz" 2>&1 | sed -E 's#mongodb(\+srv)?://[^ ]*#mongodb://<redacted>#g')"
  SUMMARY="$(printf '%s\n' "$OUT" | grep -E 'document\(s\) restored successfully' | tail -1)"
  say "  $(printf "%s" "$SUMMARY" | sed -E "s/^[^[:space:]]+[[:space:]]+//")"
  if ! printf '%s' "$SUMMARY" | grep -q ' 0 document(s) failed'; then
    printf '%s\n' "$OUT" | tail -20 >&2
    echo "restore of $db reported failures" >&2
    false
  fi
done
A="$(counts SRC)"
B="$(counts DST)"
if [[ -z "$A" ]]; then echo "Atlas returned no collections — refusing to switch." >&2; false; fi
if [[ "$A" != "$B" ]]; then
  echo "Record counts differ between Atlas and the VPS copy:" >&2
  diff <(echo "$A") <(echo "$B") >&2 || true
  false
fi
say "every collection matches: $(echo "$A" | wc -l) collections, $(echo "$A" | awk '{s+=$2} END {print s}') records"

# --- 6. Switch -----------------------------------------------------------------
envset MONGODB_URI_ATLAS "$ATLAS_URI"
envset MONGODB_URI "$LOCAL_URI"
trap - ERR
say "MONGODB_URI now points at the VPS database; starting pos-api and kkmdm"
$C up -d pos-api kkmdm
for i in $(seq 1 40); do
  $C exec -T pos-api wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 3
done
if ! $C exec -T pos-api wget -qO- http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "pos-api is not healthy on the VPS database. To go back right away:" >&2
  echo "  bash deploy/move-db-back-to-atlas.sh" >&2
  $C logs --tail 40 pos-api >&2
  exit 1
fi
say "pos-api healthy on the VPS database — downtime over"
say "done. Atlas is untouched; the final Atlas copy is in $DUMP_DIR"
