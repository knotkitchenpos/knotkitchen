# Knot Kitchen — Hostinger Deployment Runbook

_Companion to `ARCHITECTURE.md`. Everything here targets a **Hostinger KVM VPS
with public IPv4 `93.127.194.80`** running the `knotkitchen.online` platform.
No Cloudflare. No external CDN. Caddy on the VPS terminates TLS directly using
Let's Encrypt HTTP-01._

---

## 0. Prerequisites (one-time)

| Requirement | Value / Notes |
| --- | --- |
| Hostinger KVM VPS | `93.127.194.80` — Ubuntu 24.04 LTS, ≥ 2 vCPU / 4 GB RAM / 40 GB disk |
| Domain in Hostinger DNS | `knotkitchen.online` (no CDN, no Cloudflare, no proxy) |
| MongoDB | Atlas M10+ **or** self-hosted `mongo:7` in the same compose file |
| Object storage (optional) | S3-compatible (AWS/Wasabi/B2/DO Spaces/MinIO) **or** Cloudinary. Default = `local` |
| GitHub repo | `main` triggers deploy (or clone + `git pull` manually) |
| SMS OTP | Fast2SMS account + API key |

---

## 1. Public hostname map

| Purpose | Hostname | Backed by |
| --- | --- | --- |
| Landing page + storefront | `knotkitchen.online` | `customer-web` |
| Storefront (customer-facing) | `csd.knotkitchen.online` | `customer-web` |
| POS SPA | `business.knotkitchen.online` | `pos-web` |
| Super-admin / onboarding SPA | `onboard.knotkitchen.online` | `admin-web` |
| POS backend API | `api.knotkitchen.online` | `pos-api` |
| Super-admin backend API | `admin-api.knotkitchen.online` | `admin-api` |
| Partner onboarding / agreement portal | `agreement.knotkitchen.online` | `onboard-portal` (separate repo: `knotkitchenpos/onboard`, cloned to `/srv/onboard`) |
| Per-store customer website | `<store_id>.knotkitchen.online` (any subdomain not listed above) | `customer-web`, resolved by hostname via `resolveStorefront()` |

Only `caddy` publishes host ports 80/443. Everything else is on the internal
`knot` Docker network and is only reachable through Caddy.

DNS for `knotkitchen.online` is hosted on **Cloudflare, in "DNS only" (grey
cloud) mode** — Cloudflare never proxies traffic; Caddy on the VPS still
terminates TLS directly, exactly as before. The only thing Cloudflare adds is
letting Caddy obtain a real `*.knotkitchen.online` wildcard cert via DNS-01
(`caddy-dns/cloudflare` plugin, `CLOUDFLARE_API_TOKEN` in `deploy/.env`) —
every named hostname above still gets its cert the old way, via plain HTTP-01.


---

## 2. Hostinger DNS records

In **hPanel → Domains → knotkitchen.online → DNS / Nameservers → DNS Zone**,
delete any conflicting default records and create these seven A records —
every value is the same VPS IP:

| Type | Name (host) | Points to       | TTL |
| ---- | ----------- | --------------- | --- |
| A    | `@`         | `93.127.194.80` | 300 |
| A    | `www`       | `93.127.194.80` | 300 |
| A    | `csd`       | `93.127.194.80` | 300 |
| A    | `business`  | `93.127.194.80` | 300 |
| A    | `onboard`   | `93.127.194.80` | 300 |
| A    | `api`       | `93.127.194.80` | 300 |
| A    | `admin-api` | `93.127.194.80` | 300 |

Do **not** enable Hostinger's CDN toggle on any of these records — Caddy must
terminate TLS itself for Let's Encrypt HTTP-01 to succeed.

Verify from any laptop before continuing:

```powershell
nslookup api.knotkitchen.online 8.8.8.8
nslookup business.knotkitchen.online 8.8.8.8
nslookup onboard.knotkitchen.online 8.8.8.8
nslookup csd.knotkitchen.online 8.8.8.8
nslookup knotkitchen.online 8.8.8.8
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
BASE_DOMAIN=knotkitchen.online
ACME_EMAIL=<your email — Let's Encrypt notifications>

MONGODB_URI=<Atlas SRV URI, or mongodb://user:pass@mongo:27017/knotkitchen?authSource=admin>

# Generate each with:  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=<64+ hex chars>
REFRESH_TOKEN_SECRET=<64+ hex chars>
ADMIN_JWT_SECRET=<64+ hex chars>

SUPERADMIN_EMAIL=admin@knotkitchen.online
SUPERADMIN_PASSWORD=<long random passphrase>

FAST2SMS_API_KEY=<your production key>

# Media: leave as `local` for a small deployment
MEDIA_STORAGE_PROVIDER=local
MEDIA_PUBLIC_BASE_URL=https://api.knotkitchen.online/uploads
```

Then bring the stack up (first build is ~5 min):

```bash
cd /srv/knot
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build --pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f caddy pos-api admin-api
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
curl.exe -I https://api.knotkitchen.online/health
curl.exe -I https://admin-api.knotkitchen.online/health
curl.exe -I https://business.knotkitchen.online/healthz
curl.exe -I https://onboard.knotkitchen.online/healthz
curl.exe -I https://csd.knotkitchen.online/healthz
curl.exe -I https://knotkitchen.online/healthz
```

All six MUST return `HTTP/2 200`. Then open
`https://onboard.knotkitchen.online` and sign in with `SUPERADMIN_EMAIL` /
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

---

## 8. Creating a store (no infra change)

1. Log into `https://onboard.knotkitchen.online`.
2. Create a Store (e.g. "Burger House"). The backend generates a unique
   6-digit `storeId` and URL-safe `slug`, and `provisionWebsiteForStore`
   creates the `WebsiteSettings` document.
3. Customers reach the storefront at
   `https://csd.knotkitchen.online/s/<slug>` immediately — no DNS or cert
   work required because `csd.knotkitchen.online` already exists.

If you later want dedicated `<slug>.knotkitchen.online` subdomains per
store, add a wildcard `*` A record in Hostinger + a Caddy `on_demand_tls`
block + a `/api/public/storefront/tls-ask` allow-list endpoint. Not needed
for the default path-based layout above.

---

## 9. Rotating secrets

```bash
$EDITOR /srv/knot/deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d pos-api admin-api
```

Rotating `JWT_SECRET` / `REFRESH_TOKEN_SECRET` invalidates every active
session — users have to sign back in. Expected.

---

## 10. Backups & restore

Add to root's crontab on the VPS:

```
KNOT_BACKUP_PASSPHRASE=<long random>
17 3 * * *   /srv/knot/deploy/backup.sh >> /var/log/knot-backup.log 2>&1
```

Restore an env file:

```bash
gpg -d /var/backups/knotkitchen/knot-YYYYMMDDTHHMMSSZ.tar.gz.gpg \
    | tar -xzf - -C /tmp/restore
cp /tmp/restore/env /srv/knot/deploy/.env
```

MongoDB has its own backup story (Atlas continuous snapshots, or a
`mongodump` cron on the self-hosted `mongo` container).

---

## 11. Monitoring

Cheap uptime coverage with Uptime Kuma or Better Uptime — poll each of:

* `https://api.knotkitchen.online/health`
* `https://admin-api.knotkitchen.online/health`
* `https://business.knotkitchen.online/healthz`
* `https://onboard.knotkitchen.online/healthz`
* `https://csd.knotkitchen.online/healthz`
* `https://knotkitchen.online/healthz`

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
| Login OK but POS says "Invalid Store ID" | `admin-api` and `pos-api` are pointing at different `MONGODB_URI` values. They MUST share a database. |

---

## 13. Removing / suspending a store

* **Suspend** — Onboarding UI → mark Store as `suspended`. The storefront
  resolver refuses to serve it and Socket.IO drops any lingering POS
  session for it.
* **Delete** — soft-delete via `isDeleted=true`. Records stay in Mongo for
  audit; run `pos-backend/scripts/mergeStoreDatabases.js` in a maintenance
  window for a hard delete.
