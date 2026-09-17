# Knot Kitchen — Production Architecture

_Last reviewed: 2026-08-30_

This document is the authoritative reference for how Knot Kitchen is deployed
to **`knotkitchen.com`** on a Hostinger KVM VPS. It supersedes any inline
notes in individual services.

> **On Cloudflare.** DNS for the zone is hosted at Cloudflare in **"DNS only"
> (grey cloud)** mode. Traffic does **not** pass through Cloudflare's edge —
> Caddy on the VPS terminates TLS directly, and there is no Cloudflare WAF or
> DDoS layer in the request path. The Cloudflare API token exists for exactly
> one purpose: the DNS-01 challenge that issues the `*.knotkitchen.com`
> wildcard certificate. Every other hostname uses plain HTTP-01.
>
> The base domain is not hardcoded anywhere — it is the `BASE_DOMAIN` variable
> in `deploy/.env`, consumed by both `docker-compose.yml` and the `Caddyfile`.
> Hostnames below are written out in full for readability.

---

## 1. Audit summary of the pre-existing codebase

Before any changes were made, a full audit was performed. Knot Kitchen was
already substantially production-ready. This section records what was found so
future maintainers understand what was inherited vs. what was added by the
production-hosting effort.

### 1.1 Applications discovered

| App                          | Path                      | Type                | Dev port |
| ---------------------------- | ------------------------- | ------------------- | -------- |
| POS Backend API              | `pos-backend/`            | Node.js + Express   | `8000`   |
| POS / Restaurant Frontend    | `pos-frontend/`           | React + Vite (SPA)  | `5173`   |

Package manager: **npm** everywhere (lockfiles present).

Two further applications were added after the original audit and are now part
of the deployed system. They are listed here so this table stays the complete
inventory:

| App                          | Path                      | Type                | Dev port |
| ---------------------------- | ------------------------- | ------------------- | -------- |
| Customer website             | `customer-web/`           | React + Vite (SPA)  | `5176`   |
| CSD / support desk           | `csd-web/`                | React + Vite (SPA)  | `5175`   |

The full dev-port allocation is now `5173` pos-frontend · `5175` csd-web ·
`5176` customer-web (the `5174` admin frontend went with the removed
`knotkitchen-admin/` on 2026-08-30). Keep them distinct: `customer-web` sets
`strictPort: true` (a wildcard-subdomain app that silently moved ports would
break the `*.localhost` URLs a developer has open), so a clash is a hard
startup failure rather than a fallback. Until 2026-08-30 it and csd-web both
requested `5175` and could not be run at the same time.

`csd-web` is an **internal staff tool** (support desk + platform admin, which
replaced the deleted `knotkitchen-admin/` super-admin app). It has no backend
of its own — it talks to `pos-backend` under `/api/csd` with an email +
password session (bcrypt-hashed, signed by `CSD_JWT_SECRET`) seeded from the
`SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` env vars.

One more service is built by `deploy/docker-compose.yml` but does **not** live
in this repository:

| App                | Source                              | Type              | Dev port |
| ------------------ | ----------------------------------- | ----------------- | -------- |
| Onboarding portal  | separate repo, cloned as `../onboard` | Node.js + Express | `3000` |

The compose file references it as `context: ../../onboard`, so a checkout of
this repo alone **cannot** `docker compose build` without that sibling clone
present on the VPS at `/srv/onboard`.

### 1.2 Multi-tenant plumbing already in place

The codebase is already a true multi-tenant SaaS. In particular:

* **Store identity model** — `pos-backend/models/storeModel.js` enforces a
  unique **6-digit `storeId`** (numeric, `/^\d{6}$/`) with a Mongo unique index
  and a lazy backfill in `config/database.js`.
* **Slug + storefront config** — `pos-backend/models/websiteSettingsModel.js`
  holds the customer-website settings (`slug`, `subdomain`, `customDomain`,
  branding, theme, ordering, opening hours). Slug and storeId are unique, and
  the `subdomain` / `customDomain` fields are already indexed.
* **Store ID generator** — `services/storeIdGenerator.js` retries until unique.
* **Slug generator** — `services/slugService.js` slugifies, enforces a
  reserved-word blocklist, guarantees uniqueness, and is idempotent so
  re-provisioning the same store never churns its public URL.
* **Automatic provisioning** — `services/websiteProvisioningService.js` creates
  a `WebsiteSettings` document (with slug + subdomain + defaults) whenever a
  Store comes into existence. Idempotent, race-safe.
* **Tenant resolution** — `services/tenantContext.js` derives `storeId` /
  `restaurantId` **only** from the authenticated user, never from client input.
  `tenantFilter()` returns `null` for anonymous callers (deny-by-default).
* **Storefront resolver** — `services/storefrontResolver.js` maps
  `customDomain → subdomain → slug → 6-digit storeId` into a fully-loaded
  storefront context and enforces store status (`pending`, `suspended`,
  `closed_temporarily`, `closed_until`, `deleted`).

### 1.3 Security posture already in place

* **CORS** is a strict allow-list (`app.js`); the previous `origin: true`
  wildcard was already replaced.
* **Trust proxy** is set to `1` for Cloudflare / reverse-proxy IP handling.
* **Security headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy`, `COOP`, `CORP`, and
  HSTS in production.
* **Static uploads** carry `nosniff` + a restrictive CSP.
* **Secrets** — `config/config.js` refuses to boot in production if
  `JWT_SECRET` or `REFRESH_TOKEN_SECRET` are missing / < 32 chars, and
  auto-generates an ephemeral secret in development (so a leaked source code
  never leaks a valid signing key).
* **JWT** — HS256 pinned in `middlewares/tokenVerification.js`; token carries
  a session `jti` that is re-verified against the user's session list; tenant
  claims are cross-checked against the DB row, so a tampered token cannot IDOR
  into another tenant.
* **OTP** — `services/otpService.js` uses `crypto.randomInt` (not
  `Math.random`), bcrypt-hashes the code, masks phone numbers in logs, and
  enforces per-tenant expiry + attempt caps.  A demo OTP is available **only**
  in development, gated on `!config.isProduction && ALLOW_DEV_OTP !== "false"`.
  Production **cannot** accidentally enable it.
* **Rate limiting** — dependency-free per-process limiter with dedicated
  buckets for login, OTP-send, OTP-verify, password reset, store lookup, and
  storefront read / order.
* **WebSockets** — Socket.IO handshake is authenticated from the same HTTP-only
  access-token cookie, and clients only join **their own** tenant rooms
  (`store:<storeId>`, `restaurant:<id>`, `outlet:<id>`). A rogue client that
  emits `joinRestaurant` cannot widen its scope.
* **Media uploads** — `services/imageValidator.js` sniffs magic bytes (rejects
  SVG-XSS and `.php.png` disguises), sanitizes file names against path
  traversal, and caps size to 5 MB.
* **Storefront isolation tests** — `tests/storefrontIsolation.test.js` proves
  tenant filtering, slug rules, upload security, and business-hour logic.

### 1.4 Public / customer-website API already in place

`app.js` mounts:

* `/api/public` — legacy public store-by-numeric-id endpoint.
* `/api/storefront` — the **modern** customer-website API used by the storefront
  React theme. Every route resolves the tenant via `resolveStorefront()`; a
  `storeId` in the body is always ignored. Pricing is recomputed server-side.
* `/api/website` — authenticated storefront-config editor (POS / admin).
* `/api/media` — authenticated media library.
* `/api/online-orders` — POS view of website orders.

### 1.5 Gaps found (and closed by this deployment work)

| # | Gap                                                                | Fix                                                                                                                    |
| - | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 1 | Only one React app served both POS and the customer storefront.    | Introduced a dedicated **`customer-web`** application (still shares the backend + the theme layer).                    |
| 2 | Hostname-based store resolution was implemented on the backend but not exercised by any frontend. | Added `resolveStoreFromHostname()` utility + `by-domain` public endpoint, wired both apps.                             |
| 3 | Root domain CORS did not know about `*.knotkitchen.com`.        | Added `CORS_WILDCARD_DOMAINS` support so subdomains are validated by pattern.                                          |
| 4 | No `/health` or `/ready` endpoint.                                 | Added both.                                                                                                            |
| 5 | No graceful SIGTERM/SIGINT handling.                                | Added a shared shutdown handler that closes HTTP, Socket.IO, and Mongoose in order.                                    |
| 6 | No Dockerfiles / compose / reverse proxy.                          | Added production-grade Dockerfiles for all four apps + a Caddy reverse proxy with wildcard TLS.                        |
| 7 | No CI pipeline.                                                    | Added `.github/workflows/ci.yml` (lint + tests) and `deploy.yml` (SSH-based deploy).                                   |
| 8 | Deployment / rollback / backup not documented.                     | See `DEPLOYMENT.md` and this file's §8-10.                                                                              |

Nothing that already worked was replaced or rewritten.

---

## 2. Runtime topology

```
                       INTERNET
                          │
                          │  Cloudflare hosts DNS only (grey cloud).
                          │  Traffic does NOT traverse Cloudflare's edge.
                          ▼
              ┌───────────────────────────┐
              │  Hostinger KVM VPS        │
              │  Ubuntu 24.04 LTS         │
              │  Docker + docker compose  │
              └────────────┬──────────────┘
                           │  ports 80/443 only
                           ▼
              ┌───────────────────────────┐
              │  Caddy reverse proxy      │
              │  terminates TLS itself    │
              │  HTTP-01 per hostname,    │
              │  DNS-01 for the wildcard  │
              └────────────┬──────────────┘
                internal Docker network `knot`
   ┌──────────┬──────────┬──────────────┬───────────┐
   ▼          ▼          ▼              ▼           ▼
 pos-web  csd-web  customer-web  onboard-portal   pos-api
  :80       :80        :80          :3000          :8000
                                                     │
                                                     ▼
                                             MongoDB Atlas
                                            (shared cluster,
                                             one DB per env)

                                               Media storage
                                        (default: local Docker volume;
                                         S3/R2/Cloudinary optional — §7)
```

Rules that come out of this topology:

* Only the **Caddy** container publishes ports (80/443) to the host.
* All Node containers listen on the **internal** Docker network only.
* **Caddy terminates public TLS.** `trust proxy = 1` in every Express app
  handles that single hop. There is no second proxy in front of it, so
  `X-Forwarded-For` has exactly one hop worth of trust — do not raise it.
* Because Cloudflare is not proxying, there is **no WAF and no DDoS
  scrubbing** in front of the VPS. The application-level rate limiters in
  `middlewares/rateLimiter.js` are the only such protection. Turning the
  orange cloud on later would require raising `trust proxy` to `2`.

---

## 3. DNS

Create these records in Cloudflare. **All must be "DNS only" (grey cloud)** —
proxying them would break Caddy's HTTP-01 challenges and put an untrusted
extra hop in front of `trust proxy = 1`.

| Type | Name                             | Value        | Serves          |
| ---- | -------------------------------- | ------------ | --------------- |
| A    | `knotkitchen.com`             | `<VPS IPv4>` | customer-web    |
| A    | `business.knotkitchen.com`    | `<VPS IPv4>` | pos-web (POS SPA) |
| A    | `csd.knotkitchen.com`         | `<VPS IPv4>` | csd-web (support desk) |
| A    | `agreement.knotkitchen.com`   | `<VPS IPv4>` | onboard-portal  |
| A    | `api.knotkitchen.com`         | `<VPS IPv4>` | pos-api         |
| A    | `*.knotkitchen.com`           | `<VPS IPv4>` | **Wildcard** — customer-web, one vhost per store |

The wildcard record is what makes new stores available *automatically* — no
per-restaurant DNS change is ever required.

TLS: every named hostname above gets its certificate by ordinary **HTTP-01**.
Only the `*.knotkitchen.com` wildcard uses a **DNS-01 ACME challenge with
Cloudflare**, because a wildcard cert cannot be issued over HTTP-01. That is
the sole reason `CLOUDFLARE_API_TOKEN` exists; scope it to Zone:DNS:Edit on
this zone only. See `DEPLOYMENT.md`.

> **Historical note.** Earlier revisions of this document described
> `knotkitchen.com` with `pos.` / `admin.` / `app.` hostnames behind a proxied
> (orange-cloud) Cloudflare. None of that was ever deployed. `deploy/Caddyfile`
> is the authority for what hostnames exist.

---

## 4. Multi-tenant identity

Every store has **three** identifiers that never change once assigned:

* `storeId` — 6-digit numeric (e.g. `483921`). Permanent. Shown in POS logins.
* `_id` — internal Mongo `ObjectId`. Never leaked to the customer website.
* `slug` — URL-safe (`burger-house`). May be renamed by the owner. Reserved
  words are blocked (`admin`, `api`, `pos`, …).

Public URL:  `https://<slug>.knotkitchen.com`
Numeric URL: `https://<storeId>.knotkitchen.com` — `storefrontResolver`
accepts a 6-digit subdomain, which keeps printed QR codes working across a
slug rename.
Legacy URL: `https://business.knotkitchen.com/store/<slug>` — the POS SPA
still serves the storefront at its `/store/:slug` route.

A store may also be reached on its own `customDomain`, which is checked before
subdomain and slug. See the resolution order in §1.2.

### Tenant isolation invariants

1. Every tenant-owned model carries `storeId` and/or `restaurantId`.
2. `services/tenantContext.js::resolveTenantFromUser` is the **only** way any
   authenticated controller learns "who is the caller?". Body/query/header
   `storeId` values are ignored.
3. `services/storefrontResolver.js::resolveStorefront` is the **only** way any
   public controller learns "which store is being visited?".
4. Socket.IO rooms are named `store:<storeId>` / `restaurant:<id>`; the
   handshake authenticates and joins the caller's own rooms. Restaurant A can
   never receive Restaurant B's realtime events.
5. Tests: `pos-backend/tests/storefrontIsolation.test.js` and
   `pos-backend/tests/tenantIsolation.test.js` fail the build on regressions.

---

## 5. Ports (recap)

| Container      | Internal port | Published? | Public URL                            |
| -------------- | ------------- | ---------- | ------------------------------------- |
| caddy          | 80, 443       | ✅ yes      | *(the only public entry point)*       |
| pos-api        | 8000          | ❌ no       | `api.knotkitchen.com`              |
| pos-web        | 80            | ❌ no       | `business.knotkitchen.com`         |
| csd-web        | 80            | ❌ no       | `csd.knotkitchen.com`              |
| onboard-portal | 3000          | ❌ no       | `agreement.knotkitchen.com`        |
| customer-web   | 80            | ❌ no       | `knotkitchen.com` + `*.knotkitchen.com` |

Dev ports `5173` (pos-web), `5175` (csd-web), `5176`
(customer-web) and `8000` (pos-api) remain unchanged for
local development.

---

## 6. Environment variables

See `.env.example` files in each app. The consolidated production file lives at
`deploy/.env.production.example`; copy it to `deploy/.env` on the VPS before
`docker compose up`.

---

## 7. Object storage

`pos-backend/services/storage/` implements a driver-based abstraction selected
by `MEDIA_STORAGE_PROVIDER`:

| Value                | Driver                  | Notes                                   |
| -------------------- | ----------------------- | --------------------------------------- |
| `local` *(default)*  | `localProvider.js`      | Files on disk, served by `express.static` |
| `s3` / `r2`          | `s3Provider.js`         | R2 is S3-API compatible — same driver, custom endpoint |
| `cloudinary`         | `cloudinaryProvider.js` | —                                       |

**As deployed today the provider is `local`**, not R2. `docker-compose.yml`
defaults it (`${MEDIA_STORAGE_PROVIDER:-local}`) and media lands in the
`backend_uploads` Docker volume, published at
`https://api.knotkitchen.com/uploads`. MongoDB stores only metadata
(`imageUrl`, `storageKey`, `fileName`, `mimeType`, `size`, `storeId`).

Consequences of being on `local`, which you are accepting until you switch:

* Media lives on **one VPS disk**. It is not replicated, and it grows without
  a lifecycle policy. It is included in the backup (§8) — verify the tarball
  size stays sane as restaurants upload menu photos.
* It pins the deployment to a single host. Horizontal scaling of `pos-api`
  (§10) requires moving to `s3`/`r2` first, or two instances will serve
  different subsets of the images.

Switching is an env-var change plus a one-time copy of the existing volume
into the bucket — no code change.

Restaurant KYC/compliance documents are deliberately **not** in this system.
They use a separate `csd_documents` volume mounted at `/app/csd-documents`,
which nothing serves statically; the files stream through an authenticated CSD
route. Keeping them off `/app/uploads` is what stops `express.static` from
publishing customer identity documents.

---

## 8. Backups

* **MongoDB Atlas** — *what you get depends entirely on the cluster tier, and
  the free tier gives you nothing.*

  | Tier            | Backup                                    |
  | --------------- | ----------------------------------------- |
  | **M0 (free)**   | **None.** No snapshots, no restore, at all |
  | Paid shared     | Scheduled snapshots                       |
  | M10+ dedicated  | Continuous backup + point-in-time restore |

  The target configuration is M10+ with continuous backup, 7 daily snapshots
  and 4 weekly, restoring point-in-time. **Verify which tier this deployment
  is actually on before relying on any of that** — an earlier revision of this
  document instructed the reader to "enable continuous cloud backup" without
  noting that the instruction is impossible to follow on M0, where orders,
  menus, stores, users and payments have no second copy anywhere.

  While on a tier without snapshots, `deploy/backup.sh` runs a nightly
  `mongodump` into the encrypted archive and **that dump is the only database
  backup that exists**. It is fatal-by-default in the script for that reason.
  Once the cluster has verified snapshots of its own, set
  `KNOT_BACKUP_SKIP_MONGO=true` to stop duplicating them.

  Note the free tier also caps connections at 500 — see the pool sizing note
  in §10.
* **VPS** — `deploy/backup.sh` writes a **GPG-symmetric-encrypted tarball**
  (AES256) to `${KNOT_BACKUP_DIR:-/var/backups/knotkitchen}` and deletes its
  own local output older than **14 days**. It refuses to run without
  `KNOT_BACKUP_PASSPHRASE`, so it can never silently write plaintext. Run it
  from cron. It captures `deploy/.env` plus every stateful Docker volume:

  | Volume                        | Contents                                    |
  | ----------------------------- | ------------------------------------------- |
  | `knotkitchen_caddy_data`      | ACME account key + issued certificates      |
  | `knotkitchen_backend_uploads` | menu media (when `MEDIA_STORAGE_PROVIDER=local`) |
  | `knotkitchen_csd_documents`   | restaurant KYC / GST / FSSAI / agreements   |
  | `knotkitchen_onboard_data`    | onboard portal `database.json` — **a primary datastore**, not mirrored in Atlas |
  | `knotkitchen_onboard_uploads` | KYC documents uploaded via the portal       |

  A volume that does not exist yet is skipped with a warning; a volume that
  exists and fails to archive aborts the run, because a silently partial
  backup is worse than an obviously missing one.

  **Offsite is opt-in and you must set it up.** Set `KNOT_BACKUP_REMOTE` to an
  rclone remote (e.g. `r2:knot-backups`) and each archive is copied there after
  it is written; a failure to copy exits non-zero so cron mails you. Leave it
  unset and the script warns on every run that the backup lives only on the
  machine it is protecting. The archive is already encrypted, so the
  destination needs to be durable, not trusted. Remote retention is the
  bucket's lifecycle rule — the script never deletes remotely.

  `deploy/.env` holds `KNOT_BACKUP_PASSPHRASE` itself, and the passphrase is
  what decrypts the backup containing that env file. Store the passphrase
  somewhere outside this VPS or a host loss leaves you with archives you
  cannot open.

  **Monitoring.** Set `KNOT_BACKUP_HEARTBEAT_URL` to a dead-man's-switch
  endpoint (Healthchecks.io et al). The script pings `/start`, success, and
  `/fail`, so the monitor alerts on a ping that never arrives — catching the
  VPS being down, cron disabled, or a full disk, none of which a log file can
  report. A ping that fails only warns; it never fails the backup itself.
  `$KNOT_BACKUP_DIR/.last-success` is stamped on every good run.

* **Volume protection** — `csd_documents`, `onboard_data` and
  `onboard_uploads` are declared `external: true` in `docker-compose.yml`, so
  `docker compose down -v` and `docker volume prune` cannot destroy them.
  Those hand-typed commands are the realistic threat to data that exists
  nowhere else. The cost is that the volumes must pre-exist;
  `deploy/bootstrap-volumes.sh` creates them idempotently and both
  `deploy.yml` and `rollback.sh` run it automatically.
* **Media** — covered by the `backend_uploads` volume above while the provider
  is `local` (§7). If you move to `s3`/`r2`, enable bucket versioning with a
  lifecycle rule expiring non-current versions after 30 days, and drop the
  volume from the tarball.
* **GitHub** — the deploy workflow records the previous SHA to
  `deploy/.previous` before moving (§9), and that file is the practical
  recovery source.

---

## 9. Rollback

How it actually works today:

* `.github/workflows/deploy.yml` fires on **every push to `main`**, and also
  accepts a `ref` input via `workflow_dispatch` for deploying a specific
  branch, tag or SHA.
* Before it moves, the deploy script writes the outgoing SHA to
  `/srv/knot/deploy/.previous`.
* `deploy/rollback.sh` checks out `deploy/.previous` (or an explicit
  `<sha-or-tag>` argument), rebuilds, restarts, then polls `/health` up to 30
  times and exits non-zero if the backend never comes up. Data is not touched —
  Atlas is external, and media is in a Docker volume the rebuild does not
  recreate.

> **Deviation from the intended policy.** This document previously stated
> "production deploy is always from a signed tag; never deploy from a moving
> branch." That is *not* the current configuration — `main` is a moving branch
> and every push to it deploys. `deploy/.previous` gives you a one-step
> rollback, but there is no immutable tag per release. If you want the stated
> policy, change `deploy.yml`'s trigger to `push: tags: ['production-*']` and
> tag each release; nothing else needs to change.

---

## 10. Scalability

Adding a store requires **only** a single database insert (Admin Panel →
Create Store). No new container, no new build, no DNS change. The system is
designed for 10,000+ stores on the same infrastructure.

Vertical growth path:

* **Mind the connection pool.** Both Node apps pin `maxPoolSize` in their
  `config/database.js` (POS 20, admin 10, override with
  `MONGO_MAX_POOL_SIZE`) instead of taking the driver's default of 100. The
  budget is per *process*: every additional instance multiplies it, and an
  Atlas free/shared tier caps the cluster at 500 connections. Recalculate this
  before scaling out, or you will exhaust the cluster long before you exhaust
  CPU — and it presents as intermittent timeouts, not a clean error.
* Move the in-process rate limiter (`middlewares/rateLimiter.js`) to Redis
  when running > 1 Node instance per app.
* Move Socket.IO to a Redis adapter for horizontal scale.
* Front all three Node apps with a second Caddy replica behind Hostinger's
  load balancer if traffic requires it. Nothing in the code assumes a single
  instance.

## 11. Code map: where things live

The repository is five apps and one deploy folder. Each app keeps a flat,
responsibility-named layout; there is no `src/` indirection on the backend and
no per-feature folder tree on the frontends, on purpose: the tree is small
enough that a name says what a file is.

### pos-backend (Express + Mongoose)

| Folder | Holds | Rule |
|---|---|---|
| `routes/*Route.js` | one router per URL prefix; middleware, rate limits and the controller call only | no DB work in a route |
| `controllers/*Controller.js` | request parsing, tenant scoping, the response (`qrController.js` is the diner's table-QR API) | business rules that two controllers share go to a service |
| `services/` | business rules and integrations: `price.js` (menu maths and `computeTotals`, the one order-total rule), `orderPricingService.js` (storefront pricing, delegates totals to it), `gst.js`, `money.js` (`round2`, paise: the only rounding), `idempotency.js` (`findOrCreate`: the one once-only pattern), `orderItemAmounts.js` (the one reading of a stored line), `refunds.js`, `shifts.js`, `inventory.js`, `menuCache.js` (publish gate), `tenantContext.js` (tenant filters), `socket.js`, `auditService.js` (`logActivity`: the only audit write; `csdAuditService.js` adapts CSD staff onto it), `gateways/cashfree.js`, `messagingService.js` (Fast2SMS) | one authority per rule; `pricing.js` is platform *plan* pricing, not order pricing; never `AuditLog.create` from a controller |
| `models/*Model.js` | Mongoose schemas and indexes only | hooks are for invariants (e.g. stock depletion on Order save), not workflows |
| `middlewares/` | auth (`tokenVerification`), permissions (`requirePermission`: `requireProtectedAction` = owner or PIN, `requireManager`, `requireOwnerOnly`), account lock, CSD auth | |
| `constants/` | vocabularies: `orderStatus.js`, `paymentMethods.js` | never hand-write a status or method string elsewhere; tests enforce it |
| `config/config.js` | every `process.env` read with its default | a few readers stay lazy on purpose (Fast2SMS key rotation, public-URL helpers exercised by tests) |
| `tests/` | `node --test`, ~970 tests, run by CI | |

### pos-frontend (Vite + React, the POS)

| Folder | Holds |
|---|---|
| `src/config.js` | `BACKEND_URL`, `SOCKET_URL`, `CASHFREE_SDK_URL`: the only `import.meta.env` reads |
| `src/socket.js` | the one socket.io connection (`acquireSocket` / `releaseSocket`); it joins the tenant room on every connect. Consumers keep their own `socket.on` handlers and never call `io()` |
| `src/https/` | every API call: `index.js` (POS), `storefrontApi.js` (website settings, online orders), `publicApi.js` (unauthenticated), `marketplace.js`; the axios instance and PIN header live in `axiosWrapper.js` |
| `src/pages/` | one file per route; a page composes components and owns no shared logic |
| `src/components/<area>/` | `pos/` (till), `orders/`, `tables/`, `settings/` (each Settings section is its own view), `dashboard/` (Manage Menu, its drawers and modals under `dashboard/manageMenu/`, and the realtime popups), `home/`, `qr/`, `invoice/`, `shared/` |
| `src/hooks/` | realtime sync, auto print, online orders, offline queue |
| `src/utils/` | pure helpers: `index.js` (money and dates: `money` "₹1234.50", `inr` "₹1,234.50", `dateGB`, `time12`, `timeIN`, `dateTimeIN`, `localDay`), `orderLabels.js` (`tableLabel`, `orderDisplayId`), `receiptLayout.js` + `printReceipt.js` + `escpos.js` + `catprinter.js` + `printerDevice.js` (the one print path), `offlineQueue.js`, `security.js` (roles, PIN), `storeSession.js`, `cashfree.js` |
| `src/constants/orderStatus.js` | the status vocabulary, mirrored from the backend |
| `src/redux/` | cart, customer, order type, held orders, discount, user |

The customer website is `customer-web` only. The POS used to carry a second copy under `src/storefront/` for `/website/preview`; Preview now opens the real site, and the copy is gone.

### customer-web, csd-web, onboard, pos-desktop

- **customer-web**: `src/lib/` (API client, hostname → store, dispatch, legal page registry), `src/components/landing/` (the five designs and shared parts), `src/pages/legal/` (policy bodies). Tests in `src/lib/*.test.mjs`.
- **csd-web**: `src/api/index.js` (the one client), `src/lib/format.js` (money and dates), `src/pages/`, `src/components/`.
- **onboard**: `server/` (Express, `routes/api.js`, `middleware/{auth,serviceAuth}.js`), `public/index.html` plus `public/css/portal.css` and `public/js/` (agreement template, agreement text, markdown, PDF, API client). Tests in `tests/`.
- **pos-desktop**: Electron shell for Windows (`main.js`, `preload.js`).

### 11.4 Money rules, stated once

- **Order totals** are `services/price.js#computeTotals`, used by the table bill (`calculateBill`), the website (`orderPricingService`) and order edits (`onlineOrderController`). Discount reduces the tax base; service and packaging charges are inside it; delivery is outside; `ordering.taxInclusive` extracts tax instead of adding it. Bills carry `taxPercent` and `taxInclusive` so an edit can be re-struck at the rate it was billed at.
- **A stored line's amount** is `services/orderItemAmounts.js#resolveItemAmounts` (receipts and reports alike): a legacy POS line keeps the line total in `price` with `total` at 0.
- **Refunds** follow the payment method (`services/refunds.js`). Cash, and UPI/card taken at the counter, are `NOT_APPLICABLE`: nothing went through the gateway, so nothing comes back through it and no refund control is shown. A Cashfree payment is refundable only once the order is CANCELLED (cancel and refund are two actions), for what the payment record says was paid less what already went back, through Cashfree's refund API. The lifecycle `NOT_REFUNDED -> REFUND_PENDING -> REFUNDED | REFUND_FAILED` is decided by Cashfree's answer, never by the request having been sent; a conditional update on the stored `refundStatus` makes one attempt at a time; a timeout is reconciled by reading the refund back; `POST /:id/refund/sync` and the refund webhook keep a pending one in step. Every attempt is on `order.refunds[]` with its gateway ids, status, reason and who asked.
- **Once-only writes** go through `services/idempotency.js#findOrCreate`: the ledger, storefront orders (placed and paid-then-placed), the customer record, offline sync, and both QR order paths. The payment-link capture creates inside a transaction and catches the lost race at the transaction boundary instead. The table-session `paymentHistory` guard is an in-document array; its unique index is `{ restaurantId, paymentHistory.idempotencyKey }` like every other idempotency index (migration 010 drops the old global one).

### 11.5 Manage Menu

`components/dashboard/ManageMenu.jsx` is the list, the drill-down and the mutations. Each drawer under `manageMenu/` owns its own form state and loads it when it opens from the record the page hands it (`editing`, null for create); the page never holds a form field. A drawer keys its load on the record's identity, not the object, so a background refetch of the menu does not wipe what is being typed.

### 11.6 Known debt, deliberately left

None recorded. The last item, a copy of `services/menuCache.dispatchLabel` in customer-web, went when the storefront payload started carrying `dispatchLabel` on every category and product; a test refuses a re-implementation of the words in the site.

### DEVELOPMENT RULE

Before creating a new file to fix a bug, first check whether the functionality
belongs in an existing module. Prefer modifying and consolidating existing
modules over creating duplicate fix files. A new file is justified only when it
represents a genuinely separate responsibility: a new feature, a helper shared
by more than one caller, or a component with its own state. Never leave
`*Fix`, `*V2`, `*New`, `*Old`, `temp`, `backup` or copied files in the source
tree, and never keep two implementations of one business rule: find the
authority named above and change it there.

