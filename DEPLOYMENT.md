# Knot Kitchen — Deployment Runbook

_Companion to `ARCHITECTURE.md`. Everything here assumes you already understand
the runtime topology described there._

---

## 0. Prerequisites (one-time)

| Requirement                              | Notes                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| Hostinger KVM VPS (Ubuntu 24.04 LTS)     | Minimum 2 vCPU / 4 GB RAM / 40 GB disk. Static IPv4.                           |
| Cloudflare account managing `knotkitchen.com` | With DNS + WAF + SSL enabled.                                             |
| MongoDB Atlas cluster                    | M10 or higher recommended for production. Enable continuous backup.            |
| Cloudflare R2 bucket                     | Public custom domain, e.g. `media.knotkitchen.com`.                            |
| GitHub repository                        | `main` branch triggers deploy. Set the secrets listed in step 4.                |

---

## 1. VPS bootstrap

Run as `root` on a fresh VPS.

```bash
apt update && apt upgrade -y

# Docker (official Docker Inc. repo)
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

# Common utilities
apt install -y git ufw fail2ban gpg

# Firewall — publish only 22 (SSH), 80, 443. Nothing else must ever be exposed.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Create a dedicated user for the deploy workflow.
useradd -m -s /bin/bash deploy
usermod -aG docker deploy
mkdir -p /srv/knot && chown -R deploy:deploy /srv/knot

# Add the CI SSH public key (see step 4) to /home/deploy/.ssh/authorized_keys
```

Log in as `deploy` for everything below.

---

## 2. Cloudflare DNS

In the Cloudflare zone for `knotkitchen.com` create the records listed in
`ARCHITECTURE.md` §3. All records must be **proxied** (orange cloud) — that's
what gives you DDoS protection and free edge TLS.

Then create an API token:

1. **My Profile → API Tokens → Create Token**.
2. Use the **Custom token** template with:
   * Permissions: `Zone → DNS → Edit`, `Zone → Zone → Read`
   * Zone Resources: **Include → Specific zone → knotkitchen.com**
3. Copy the token — you'll paste it into `deploy/.env` as `CLOUDFLARE_API_TOKEN`.

Finally, set **SSL/TLS mode = Full (strict)** in the zone's SSL/TLS panel. This
requires that Caddy present a valid cert, which it does using the DNS-01
challenge configured in `deploy/Caddyfile`.

---

## 3. First deploy (on the VPS)

```bash
sudo -iu deploy
cd /srv
git clone https://github.com/knotkitchenpos/knotkitchen.git knot
cd knot

# 3a. Configure the environment
cp deploy/.env.production.example deploy/.env
$EDITOR deploy/.env       # fill in EVERY value that isn't sample text

# 3b. Bring the stack up. First build takes ~5 min (xcaddy compiles Caddy).
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build --pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d

# 3c. Watch the health checks
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f caddy pos-api
```

After ~30 seconds `curl -I https://api.knotkitchen.com/health` should return
200. If TLS fails, check `docker compose logs caddy` — the Cloudflare API token
is almost always the cause.

---

## 4. GitHub Actions setup

Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret              | Value                                                     |
| ------------------- | --------------------------------------------------------- |
| `DEPLOY_SSH_HOST`   | VPS IPv4 or hostname                                       |
| `DEPLOY_SSH_USER`   | `deploy`                                                   |
| `DEPLOY_SSH_KEY`    | Private OpenSSH key (multi-line) matching `deploy@vps`     |
| `DEPLOY_APP_PATH`   | `/srv/knot`                                                |
| `CI_JWT_SECRET`     | Any 32+ char string used only by CI                        |
| `CI_REFRESH_SECRET` | Any 32+ char string used only by CI                        |

Generate the SSH key on your workstation:

```bash
ssh-keygen -t ed25519 -f knot_deploy -C 'github-actions@knotkitchen'
# Public key -> /home/deploy/.ssh/authorized_keys on the VPS
# Private key -> paste as DEPLOY_SSH_KEY in GitHub
```

From that point on, **every push to `main`** deploys automatically:

```
git commit -am "Change X"
git push origin main
```

The workflow writes the previous SHA to `/srv/knot/deploy/.previous` before
moving, so a bad deploy can be undone with:

```bash
ssh deploy@vps 'cd /srv/knot && ./deploy/rollback.sh'
```

---

## 5. Creating restaurants — the automatic subdomain flow

Once the platform is live, adding a restaurant requires **only** an Admin Panel
action (or one API call). No infrastructure change is needed.

1. Admin logs into `https://admin.knotkitchen.com`.
2. Creates a new Store — e.g. "Burger House".
3. The backend:
   * generates a unique 6-digit `storeId` (`services/storeIdGenerator.js`)
   * generates a URL-safe unique `slug` (`services/slugService.js`)
   * calls `provisionWebsiteForStore` which creates the `WebsiteSettings`
     document with the store's theme, branding, opening hours, etc.
4. Because DNS carries a wildcard `*.knotkitchen.com` A record and Caddy
   holds a wildcard cert for the same, `https://burger-house.knotkitchen.com`
   is instantly reachable — no DNS or TLS action was needed.
5. The customer-web SPA reads the hostname, calls
   `GET /api/public/store/by-domain/burger-house`, and renders the store.

---

## 6. Rotating secrets

```bash
# JWT / refresh secrets — invalidates ALL active sessions when replaced.
$EDITOR /srv/knot/deploy/.env
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d pos-api admin-api
```

Cloudflare API token and R2 keys can be rotated the same way — restart is
scoped to `caddy` and `pos-api` respectively.

---

## 7. Backups & restore

Nightly encrypted backup — add to root's crontab on the VPS:

```
KNOT_BACKUP_PASSPHRASE=<long-random>
17 3 * * *   /srv/knot/deploy/backup.sh >> /var/log/knot-backup.log 2>&1
```

To restore an env file after a disaster:

```bash
gpg -d /var/backups/knotkitchen/knot-YYYYMMDDTHHMMSSZ.tar.gz.gpg | tar -xzf - -C /tmp/restore
cp /tmp/restore/env /srv/knot/deploy/.env
```

MongoDB and R2 data have their own vendor-side backups; see
`ARCHITECTURE.md` §8.

---

## 8. Monitoring

Cheap first-pass monitoring using Uptime Kuma / Better Uptime:

* Poll `https://api.knotkitchen.com/health` every 60 s
* Poll `https://pos.knotkitchen.com/healthz` every 60 s
* Poll `https://admin.knotkitchen.com/healthz` every 60 s
* Poll `https://<demo-slug>.knotkitchen.com/healthz` every 60 s

Container-level health is visible via
`docker compose -f deploy/docker-compose.yml ps` — every service ships with a
`HEALTHCHECK` directive.

---

## 9. Common failure modes

| Symptom                                       | Likely cause                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Caddy loops trying to obtain a cert           | `CLOUDFLARE_API_TOKEN` missing / wrong scope. Fix env, `docker compose restart caddy`. |
| `pos-api` exits with `[FATAL] JWT_SECRET missing` | The `.env` is not being read. Confirm the path in `--env-file`.             |
| Customer sites 404 for every slug             | DNS wildcard record missing OR Cloudflare not proxying `*.knotkitchen.com`.    |
| POS cannot login after deploy                 | You rotated a JWT secret. Users must sign in again — expected.                 |
| CORS errors from a store subdomain            | `CORS_WILDCARD_DOMAINS=knotkitchen.com` not set in `.env` (see docker-compose). |

---

## 10. Removing / suspending a store

* Suspend: Admin Panel → mark Store as `suspended`. The storefront resolver
  refuses to serve it and Socket.IO drops any lingering POS session for it.
* Delete: soft-delete via `isDeleted=true`. No records are removed from
  Mongo/R2 for auditability. To hard-delete, run
  `pos-backend/scripts/mergeStoreDatabases.js` in a maintenance window.
