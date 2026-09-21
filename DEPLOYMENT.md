# Knot Kitchen — Hostinger Deployment Runbook

_Companion to `ARCHITECTURE.md`. Everything here targets a **Hostinger KVM VPS
with public IPv4 `93.127.194.80`** running the `knotkitchen.com` platform.
No Cloudflare. No external CDN. Caddy on the VPS terminates TLS directly using
Let's Encrypt HTTP-01._

---

## 0. Prerequisites (one-time)

| Requirement | Value / Notes |
| --- | --- |
| Hostinger KVM VPS | `93.127.194.80` — Ubuntu 24.04 LTS, ≥ 2 vCPU / 4 GB RAM / 40 GB disk |
| Domain in Hostinger DNS | `knotkitchen.com` (no CDN, no Cloudflare, no proxy) |
| MongoDB | Atlas M10+ **or** self-hosted `mongo:7` in the same compose file |
| Object storage (optional) | S3-compatible (AWS/Wasabi/B2/DO Spaces/MinIO) **or** Cloudinary. Default = `local` |
| GitHub repo | `main` triggers deploy (or clone + `git pull` manually) |
| SMS OTP | Fast2SMS account + API key |

---

## 1. Public hostname map

| Purpose | Hostname | Backed by |
| --- | --- | --- |
| Landing page + storefront | `knotkitchen.com` | `customer-web` |
| Support desk / internal admin | `csd.knotkitchen.com` | `csd-web` |
| POS SPA | `business.knotkitchen.com` | `pos-web` |
| POS backend API | `api.knotkitchen.com` | `pos-api` |
| Partner onboarding / agreement portal | `agreement.knotkitchen.com` | `onboard-portal` (`onboard/` in this repo) |
| Per-store customer website | `<store_id>.knotkitchen.com` (any subdomain not listed above) | `customer-web`, resolved by hostname via `resolveStorefront()` |

Only `caddy` publishes host ports 80/443. Everything else is on the internal
`knot` Docker network and is only reachable through Caddy.

DNS for `knotkitchen.com` is hosted on **Cloudflare, in "DNS only" (grey
cloud) mode** — Cloudflare never proxies traffic; Caddy on the VPS still
terminates TLS directly, exactly as before. The only thing Cloudflare adds is
letting Caddy obtain a real `*.knotkitchen.com` wildcard cert via DNS-01
(`caddy-dns/cloudflare` plugin, `CLOUDFLARE_API_TOKEN` in `deploy/.env`) —
every named hostname above still gets its cert the old way, via plain HTTP-01.


---

## 2. Hostinger DNS records

In **hPanel → Domains → knotkitchen.com → DNS / Nameservers → DNS Zone**,
delete any conflicting default records and create these seven A records —
every value is the same VPS IP:

| Type | Name (host) | Points to       | TTL |
| ---- | ----------- | --------------- | --- |
| A    | `@`         | `93.127.194.80` | 300 |
| A    | `www`       | `93.127.194.80` | 300 |
| A    | `csd`       | `93.127.194.80` | 300 |
| A    | `business`  | `93.127.194.80` | 300 |
| A    | `api`       | `93.127.194.80` | 300 |

Do **not** enable Hostinger's CDN toggle on any of these records — Caddy must
terminate TLS itself for Let's Encrypt HTTP-01 to succeed.

Verify from any laptop before continuing:

```powershell
nslookup api.knotkitchen.com 8.8.8.8
nslookup business.knotkitchen.com 8.8.8.8
nslookup csd.knotkitchen.com 8.8.8.8
nslookup knotkitchen.com 8.8.8.8
```

Every answer must show `93.127.194.80`. If not, wait 5–15 min for TTL to
expire and re-check.

---

## 3. VPS bootstrap (as `root` over SSH)

```bash
ssh root@93.127.194.80

apt update && apt -y upgrade
apt install -y git ufw fail2ban curl gpg

# Docker
curl -fsSL https://get.docker.com | sh

# Firewall — publish ONLY 22 / 80 / 443
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Dedicated deploy user
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /srv/knot && chown -R deploy:deploy /srv/knot
```

Add your SSH public key to `/home/deploy/.ssh/authorized_keys` and disable
root SSH login (`PermitRootLogin no` in `/etc/ssh/sshd_config`).

---

## 3a. GitHub access for the VPS (read-only deploy key)

The repo is private, so `/srv/knot` cannot `git pull` without a key. Generate the
key **on the VPS** so the private half never leaves it, and register only the
public half as a **read-only** deploy key — the server only ever pulls.

```bash
# on the VPS
ssh-keygen -t ed25519 -f ~/.ssh/github_knotkitchen -N '' -C "$(hostname)-knotkitchen-deploy"
cat ~/.ssh/github_knotkitchen.pub
```

Register it (read-only, scoped to this repo alone):

```bash
gh api repos/knotkitchenpos/knotkitchen/keys -X POST   -f title="$(hostname) VPS deploy (read-only)" -f key="$(cat ~/.ssh/github_knotkitchen.pub)" -F read_only=true
```

The remote uses the alias `github.com-knotkitchen`, so the VPS needs it in
`~/.ssh/config` (chmod 600) or every pull fails with
`Could not resolve hostname github.com-knotkitchen`:

```
Host github.com-knotkitchen
    HostName github.com
    User git
    IdentityFile ~/.ssh/github_knotkitchen
    IdentitiesOnly yes
```

Seed `~/.ssh/known_hosts` from GitHub's **published** host keys rather than a
blind `ssh-keyscan` (which trusts whatever answers on first contact):

```bash
gh api meta --jq '.ssh_keys[]' | sed 's/^/github.com /' >> ~/.ssh/known_hosts
```

Verify with `ssh -T git@github.com-knotkitchen` (expect "successfully
authenticated") and `git -C /srv/knot pull --ff-only`.

If the private key is ever lost, the deploy key left on GitHub is orphaned —
revoke it (`gh api -X DELETE repos/knotkitchenpos/knotkitchen/keys/<id>`) rather
than leaving a credential registered that nothing on the server holds.

---

## 4. First deploy

```bash
sudo -iu deploy
cd /srv
git clone https://github.com/<your-org>/knotkitchen.git knot
cd knot

# 4a. Environment
cp deploy/.env.production.example deploy/.env
nano deploy/.env
```

Fill in **at minimum** these values:

```env
BASE_DOMAIN=knotkitchen.com
ACME_EMAIL=<your email — Let's Encrypt notifications>

MONGODB_URI=<Atlas SRV URI, or mongodb://user:pass@mongo:27017/knotkitchen?authSource=admin>

# Generate each with:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=<64+ hex chars>
REFRESH_TOKEN_SECRET=<64+ hex chars>

SUPERADMIN_EMAIL=admin@knotkitchen.com
SUPERADMIN_PASSWORD=<long random passphrase>

FAST2SMS_API_KEY=<your production key>

# Media: leave as `local` for a small deployment
MEDIA_STORAGE_PROVIDER=local
MEDIA_PUBLIC_BASE_URL=https://api.knotkitchen.com/uploads
```

Create the external volumes. The KYC and onboarding volumes are declared
`external: true` in `docker-compose.yml` so a stray `docker compose down -v` or
`docker volume prune` cannot destroy them — the trade-off is that Compose will
not create them for you, and `up` fails with *"volume ... declared as external,
but could not be found"* until they exist:

```bash
bash deploy/bootstrap-volumes.sh
```

It is idempotent and never touches the contents of a volume that already
exists, so it is safe to re-run. The deploy workflow and `rollback.sh` both
call it automatically; you only need this by hand on a brand-new host.

Then bring the stack up (first build is ~5 min):

```bash
cd /srv/knot
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build --pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f caddy pos-api
```

Within ~30 s Caddy prints one `certificate obtained successfully` per
hostname (six in total). If any cert fails, 99 % of the time it is one of:

1. That subdomain's A record is missing / still points somewhere else.
2. Port 80 is blocked (double-check `ufw status` and Hostinger's own
   firewall panel).
3. Rate limits from Let's Encrypt if you retry too aggressively — wait 1 h.

---

## 5. Smoke tests

From any laptop:

```powershell
curl.exe -I https://api.knotkitchen.com/health
curl.exe -I https://business.knotkitchen.com/healthz
curl.exe -I https://csd.knotkitchen.com/healthz
curl.exe -I https://knotkitchen.com/healthz
```

All six MUST return `HTTP/2 200`. Then open
`https://csd.knotkitchen.com` and sign in with `SUPERADMIN_EMAIL` /
`SUPERADMIN_PASSWORD`.



---

## 6. (Optional) Self-hosted MongoDB on the same VPS

If you don't want Atlas, add the following to `deploy/docker-compose.yml`
under `services:` (and add `mongo_data:` under `volumes:`):

```yaml
  mongo:
    image: mongo:7
    restart: unless-stopped
    networks: [knot]
    volumes: [mongo_data:/data/db]
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_ROOT_USER}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_ROOT_PASSWORD}
```

Then in `deploy/.env`:

```env
MONGO_ROOT_USER=knotadmin
MONGO_ROOT_PASSWORD=<long random>
MONGODB_URI=mongodb://knotadmin:<long random>@mongo:27017/knotkitchen?authSource=admin
```

---

## 7. Everyday operations

```bash
# Redeploy after a git pull
cd /srv/knot
git pull --ff-only
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build --pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d

# Tail service logs
docker compose -f deploy/docker-compose.yml logs -f pos-api
docker compose -f deploy/docker-compose.yml logs -f caddy

# Restart a single service (e.g. after rotating a secret)
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d pos-api

# Rollback to the previous SHA
./deploy/rollback.sh
```

### Counter apps (no VPS change)

Both apps are shells around `business.knotkitchen.com`, so a deploy of
`pos-frontend` updates them with no reinstall. The shells themselves update
over the air from two public GitHub releases that CI refreshes from `main`:

- Windows: [desktop-latest](https://github.com/knotkitchenpos/knotkitchen/releases/tag/desktop-latest) (pos-desktop/README.md)
- Android: [android-latest](https://github.com/knotkitchenpos/knotkitchen/releases/tag/android-latest)
  (ShellUpdater.java). Published only once the release key exists: run
  `bash pos-frontend/android/setup-release-signing.sh` once and back up the
  folder it writes.

Install from those once; the apps update themselves after that. Never delete
or move those tags: the VPS deploy fetches tags and refuses a moved one.

### A note on `down -v`

`docker compose down -v` and `docker volume prune` destroy volumes. The three
holding irreplaceable data — `knotkitchen_csd_documents`,
`knotkitchen_onboard_data`, `knotkitchen_onboard_uploads` — are declared
`external: true` precisely so **both of those commands skip them**. That is a
deliberate guardrail against a 2am incident, not an accident of configuration.

It is not a licence to run either command casually: `down -v` still wipes
`caddy_data` (you re-issue certs, and can hit Let's Encrypt rate limits) and
`backend_uploads` (you lose menu media). To stop the stack, use `down` without
`-v`.

To genuinely delete a protected volume you must name it explicitly —
`docker volume rm knotkitchen_csd_documents` — which is the point: it cannot
happen as a side effect of a command aimed at something else.

---

## 8. Creating a store (no infra change)

1. Log into `https://csd.knotkitchen.com`.
2. Create a Store (e.g. "Burger House"). The backend generates a unique
   6-digit `storeId` and URL-safe `slug`, and `provisionWebsiteForStore`
   creates the `WebsiteSettings` document.
3. Customers reach the storefront at
   `https://csd.knotkitchen.com/s/<slug>` immediately — no DNS or cert
   work required because `csd.knotkitchen.com` already exists.

If you later want dedicated `<slug>.knotkitchen.com` subdomains per
store, add a wildcard `*` A record in Hostinger + a Caddy `on_demand_tls`
block + a `/api/public/storefront/tls-ask` allow-list endpoint. Not needed
for the default path-based layout above.

---

## 9. Rotating secrets

```bash
$EDITOR /srv/knot/deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d pos-api
```

Rotating `JWT_SECRET` / `REFRESH_TOKEN_SECRET` invalidates every active
session — users have to sign back in. Expected.

---

## 10. Backups & restore

Add to root's crontab on the VPS:

```
KNOT_BACKUP_PASSPHRASE=<long random>
KNOT_BACKUP_REMOTE=r2:knot-backups
KNOT_BACKUP_HEARTBEAT_URL=https://hc-ping.com/<your-uuid>
17 3 * * *   /srv/knot/deploy/backup.sh >> /var/log/knot-backup.log 2>&1
```

`KNOT_BACKUP_HEARTBEAT_URL` is a dead-man's switch. The script pings
`<url>/start` when it begins, `<url>` on success and `<url>/fail` on any
failure; the monitor alerts when an expected ping **doesn't arrive**. That is
what catches the failures logging cannot — the VPS being down, cron disabled,
the disk full before the script runs. [Healthchecks.io](https://healthchecks.io)
has a free tier; create a check on a daily schedule with a few hours' grace and
paste its ping URL here.

A monitoring outage never fails the backup: a ping that cannot be sent logs a
warning and the run continues. `$KNOT_BACKUP_DIR/.last-success` is also stamped
on every successful run, so `stat` answers "when did a backup last actually
work?" without trusting the monitor or parsing logs.

**This matters most right now.** While the Atlas cluster is on a tier without
its own snapshots, the `mongodump` in this archive is the only database backup
that exists — so a silently dead cron is the difference between having a
business and not.

`KNOT_BACKUP_PASSPHRASE` is required — the script refuses to write an
unencrypted archive. **Keep a copy of it somewhere other than this VPS.** It
lives in `deploy/.env`, and `deploy/.env` is inside the encrypted backup, so
losing the host without an external copy of the passphrase leaves you holding
archives you cannot decrypt.

`KNOT_BACKUP_REMOTE` is an [rclone](https://rclone.org/install/) remote. It is
optional but strongly recommended: without it the backup never leaves the
machine it is protecting, and the script warns about that on every run. With it
set, a failed copy aborts the run non-zero so cron mails you. Set it up with:

```bash
apt-get install -y rclone
rclone config          # create a remote named e.g. "r2"
rclone lsd r2:         # verify it authenticates
```

The archive is encrypted before it is uploaded, so the destination needs to be
durable, not trusted. Set a lifecycle rule on the bucket for remote retention —
the script only rotates its own **local** copies (14 nights).

What is captured: `deploy/.env`, every stateful Docker volume — `caddy_data`,
`backend_uploads`, `csd_documents`, `onboard_data`, `onboard_uploads` — and a
full `mongodump` of the Atlas cluster. Note that `onboard_data` holds the
onboarding portal's `database.json`, a primary datastore with no Atlas
equivalent.

The dump requires the MongoDB Database Tools on the VPS:

```bash
apt-get install -y mongodb-database-tools
```

The script **exits non-zero if `mongodump` is missing or fails**, rather than
writing an archive without the database. That is deliberate: on an Atlas M0
(free) cluster there are no snapshots of any kind, so this dump is the only
database backup in existence. Once the cluster is on a tier with its own
verified snapshots, set `KNOT_BACKUP_SKIP_MONGO=true` to stop duplicating them.

Restore the database:

```bash
mongorestore --uri="$MONGODB_URI" --archive=/tmp/restore/mongodump.archive.gz --gzip
```

### Verify the setup

`backup.sh` can exit 0 having produced an archive that is still one host
failure from worthless — encrypted with a passphrase that exists only on this
machine, never copied offsite, monitored by nothing. Those are configuration
gaps, so the backup itself cannot report them. This does:

```bash
sudo -i
set -a; . /etc/knot-backup.env; set +a     # same env cron uses
bash /srv/knot/deploy/verify-backup-setup.sh
```

Exit 0 means every required piece is in place. It checks tooling, the
passphrase, `MONGODB_URI`, that the rclone remote actually authenticates, the
heartbeat, the three protected volumes, and how long ago the last successful
run was. Run it after any change to the backup configuration.

Restore an env file:

```bash
gpg -d /var/backups/knotkitchen/knot-YYYYMMDDTHHMMSSZ.tar.gz.gpg \
    | tar -xzf - -C /tmp/restore
cp /tmp/restore/env /srv/knot/deploy/.env
```

Restore a volume (example: the KYC documents):

```bash
docker run --rm -v knotkitchen_csd_documents:/data -v /tmp/restore:/backup \
    alpine sh -c 'rm -rf /data/* && tar -C /data -xzf /backup/knotkitchen_csd_documents.tar.gz'
```

MongoDB has its own backup story (Atlas continuous snapshots, or a
`mongodump` cron on the self-hosted `mongo` container).

---

## 11. Monitoring

Cheap uptime coverage with Uptime Kuma or Better Uptime — poll each of:

* `https://api.knotkitchen.com/health`
* `https://business.knotkitchen.com/healthz`
* `https://csd.knotkitchen.com/healthz`
* `https://knotkitchen.com/healthz`

Container-level health: `docker compose -f deploy/docker-compose.yml ps`
shows the `HEALTHCHECK` state of every service.

---

## 12. Common failure modes

| Symptom | Likely cause |
| --- | --- |
| Caddy loops trying to obtain a cert | DNS still stale or the record isn't `93.127.194.80`. Confirm with `dig +short <host> @8.8.8.8`. |
| `pos-api` exits with `[FATAL] JWT_SECRET missing` | `.env` file not being read. Verify `--env-file deploy/.env`. |
| CORS errors from the POS / onboarding UI | Hostname not in `FRONTEND_URLS`. Rebuild with the corrected env. |
| Media upload 500s | `MEDIA_STORAGE_PROVIDER=s3` set but the `S3_*` fields are blank. Either fill them or switch to `local`. |
| Let's Encrypt "too many requests" | You retried too fast. Wait 1 hour, then bring the stack up again. |

---

## 13. Removing / suspending a store

* **Suspend** — Onboarding UI → mark Store as `suspended`. The storefront
  resolver refuses to serve it and Socket.IO drops any lingering POS
  session for it.
* **Delete** — soft-delete via `isDeleted=true`. Records stay in Mongo for
  audit; run `pos-backend/scripts/mergeStoreDatabases.js` in a maintenance
  window for a hard delete.
