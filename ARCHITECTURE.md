# Knot Kitchen — Production Architecture

_Last reviewed: 2026-08-17_

This document is the authoritative reference for how Knot Kitchen is deployed
to `knotkitchen.com` on a Hostinger KVM VPS behind Cloudflare. It supersedes
any inline notes in individual services.

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
| Super-Admin Backend          | `knotkitchen-admin/backend/`  | Node.js + Express | `4000` |
| Super-Admin Frontend         | `knotkitchen-admin/frontend/` | React + Vite     | `5174` |

Package manager: **npm** everywhere (lockfiles present).

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
| 3 | Root domain CORS did not know about `*.knotkitchen.com`.           | Added `CORS_WILDCARD_DOMAINS` support so subdomains are validated by pattern.                                          |
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
                          ▼
                    Cloudflare  (DNS + TLS + WAF + DDoS)
                          │  proxied A / AAAA
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
              │  (automatic TLS,          │
              │   wildcard *.knotkitchen) │
              └────────────┬──────────────┘
                internal Docker network `knot`
     ┌───────────┬─────────┼─────────┬────────────┐
     ▼           ▼         ▼         ▼            ▼
  admin-web  pos-web  customer-web  admin-api  pos-api
     :80        :80        :80        :4000     :8000
                                        │         │
                                        └────┬────┘
                                             ▼
                                     MongoDB Atlas
                                     (shared cluster,
                                      one DB per env)

                                     Object Storage
                                     (Cloudflare R2 or S3;
                                      restaurant media)
```

Rules that come out of this topology:

* Only the **Caddy** container publishes ports (80/443) to the host.
* All Node containers listen on the **internal** Docker network only.
* Cloudflare is the *only* thing that terminates public TCP. `trust proxy = 1`
  in every Express app already handles the extra hop.

---

## 3. DNS

Create these records in Cloudflare (all *proxied*, orange cloud):

| Type | Name                    | Value             | Notes                        |
| ---- | ----------------------- | ----------------- | ---------------------------- |
| A    | `knotkitchen.com`       | `<VPS IPv4>`      | Marketing / redirect         |
| A    | `admin.knotkitchen.com` | `<VPS IPv4>`      | Super-admin portal           |
| A    | `pos.knotkitchen.com`   | `<VPS IPv4>`      | Restaurant POS               |
| A    | `app.knotkitchen.com`   | `<VPS IPv4>`      | Optional main application    |
| A    | `api.knotkitchen.com`   | `<VPS IPv4>`      | POS backend API              |
| A    | `admin-api.knotkitchen.com` | `<VPS IPv4>`  | Super-admin backend API      |
| A    | `*.knotkitchen.com`     | `<VPS IPv4>`      | **Wildcard** for `<slug>.knotkitchen.com` |

The wildcard record is what makes new stores available *automatically* — no
per-restaurant DNS change is ever required.

TLS: Caddy performs a **DNS-01 ACME challenge with Cloudflare** so it can
obtain a real wildcard certificate for `*.knotkitchen.com`. This requires the
`CLOUDFLARE_API_TOKEN` env var described in `DEPLOYMENT.md`.

---

## 4. Multi-tenant identity

Every store has **three** identifiers that never change once assigned:

* `storeId` — 6-digit numeric (e.g. `483921`). Permanent. Shown in POS logins.
* `_id` — internal Mongo `ObjectId`. Never leaked to the customer website.
* `slug` — URL-safe (`burger-house`). May be renamed by the owner. Reserved
  words are blocked (`admin`, `api`, `pos`, …).

Public URL:  `https://<slug>.knotkitchen.com`
Legacy URL: `https://app.knotkitchen.com/store/<slug>` (still works)

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

| Container    | Internal port | Published? | Public URL                       |
| ------------ | ------------- | ---------- | -------------------------------- |
| caddy        | 80, 443       | ✅ yes      | *(the only public entry point)*  |
| pos-api      | 8000          | ❌ no       | `api.knotkitchen.com`            |
| admin-api    | 4000          | ❌ no       | `admin-api.knotkitchen.com`      |
| pos-web      | 80            | ❌ no       | `pos.knotkitchen.com`            |
| admin-web    | 80            | ❌ no       | `admin.knotkitchen.com`          |
| customer-web | 80            | ❌ no       | `*.knotkitchen.com` (wildcard)   |

Dev ports `5173/5174/8000/4000` remain unchanged for local development.

---

## 6. Environment variables

See `.env.example` files in each app. The consolidated production file lives at
`deploy/.env.production.example`; copy it to `deploy/.env` on the VPS before
`docker compose up`.

---

## 7. Object storage

`pos-backend/services/storage/` already implements a driver-based abstraction
(`local`, `cloudinary`, `s3`, `r2`). Production uses **Cloudflare R2** (S3-API
compatible) via `MEDIA_STORAGE_PROVIDER=r2`. Local disk is **not** used in
production. MongoDB only stores metadata (`imageUrl`, `storageKey`, `fileName`,
`mimeType`, `size`, `storeId`).

---

## 8. Backups

* **MongoDB Atlas** — enable continuous cloud backup on the cluster; retain 7
  daily snapshots + 4 weekly. Restores are point-in-time.
* **VPS** — a nightly `duplicity` job (see `deploy/backup.sh`) rsyncs
  `/srv/knot/deploy/.env` and the Caddy data dir to an offsite S3 bucket.
* **Object storage** — R2 buckets are versioned; lifecycle rule expires
  non-current versions after 30 days.
* **GitHub** — production deploy is always from a signed tag; the tag is the
  recovery source. Never deploy from a moving branch.

---

## 9. Rollback

* `git tag production-YYYY-MM-DD-HHMM` before every deploy.
* Deploy script writes the previous SHA to `/srv/knot/deploy/.previous`.
* `deploy/rollback.sh` re-checkouts the previous tag, rebuilds and restarts
  containers. Data is not touched (Atlas + R2 are external).

---

## 10. Scalability

Adding a store requires **only** a single database insert (Admin Panel →
Create Store). No new container, no new build, no DNS change. The system is
designed for 10,000+ stores on the same infrastructure.

Vertical growth path:

* Move the in-process rate limiter (`middlewares/rateLimiter.js`) to Redis
  when running > 1 Node instance per app.
* Move Socket.IO to a Redis adapter for horizontal scale.
* Front all three Node apps with a second Caddy replica behind Hostinger's
  load balancer if traffic requires it. Nothing in the code assumes a single
  instance.
