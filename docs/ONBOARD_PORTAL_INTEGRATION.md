# Onboarding portal → CSD store creation

How a signed agreement in the partner onboarding portal becomes a store in
KnotKitchen, and the three things the portal must implement for it to work.

The CSD side is **built and tested**. The portal side is **not** — it lives in
a separate repository (`knotkitchenpos/onboard`) and needs the changes below.

---

## Why the CSD side owns duplicate protection

The agreement lives in the portal's datastore; the store lives in MongoDB.
There is no shared transaction between them.

If "already processed" were only a status flag on the agreement, then any
failure to write that flag — portal restarting, network blip, someone editing
the JSON by hand — would let the next click create a **second store for a
paying customer**. So CSD keeps its own `CsdAgreementLink` record, in the same
database as the store, with a **unique index on `agreementId`**.

That index, not a read-then-check, is what makes the guarantee hold: two
admins clicking at the same instant both pass any "does it exist?" test, but
only one can win the insert. Verified with five concurrent requests producing
exactly one store.

The portal's status flag is therefore a **display convenience for sales
agents**, not the source of truth. Writing it is best-effort and never blocks
or reverses store creation.

---

## What the portal must add

### 1. A service credential

The portal's API is session-authenticated for human agents. CSD has no
session, so it sends a shared secret header:

```
x-service-token: <ONBOARD_SERVICE_TOKEN>
```

Set the same value in both deployments. Reject requests without it — do not
fall back to "unauthenticated is fine", or these endpoints become a public
export of every customer's PII.

### 2. Accept the service token on two existing endpoints

`GET /api/agreements` and `GET /api/agreements/:id` already exist and already
return the right shape. They only need to also accept a valid service token in
place of an agent session.

CSD reads these fields (everything else is ignored):

| Field | Used for |
| --- | --- |
| `id` | agreement identity, and the dedupe key |
| `status` | must be `Completed` / `Signed` to be offered |
| `r_name`, `o_name`, `sales_agent` | list display, with `data` as fallback |
| `created_at` | list display |
| `data.*` | everything mapped onto the store — see the mapper |

### 3. Accept the service token on `/uploads/*`

The agreement's uploaded documents are copied into the store when it is
created. `/uploads` is session-protected in the portal (correctly — it holds
customer KYC), so it must accept a valid service token in place of a session,
exactly as the agreement endpoints do.

Files are **copied, not linked**. A store's GST certificate must not disappear
because a sales agent later deleted the agreement or one of its files, and the
documents must remain readable when the portal is down.

### 4. One new endpoint

```
POST /api/agreements/:id/store-created
x-service-token: <token>

{ "storeId": "472770", "storeCreatedAt": "2026-08-29T…", "by": "KK-ST-003 Administrator" }
```

Set the agreement's status to `Store Created` and record `storeId`. Return any
2xx. CSD treats a failure here as non-fatal, surfaces it in the UI, and offers
a **Sync portal** retry.

---

## Configuration

Add to `deploy/.env`:

```env
# Reachable over the internal Docker network — traffic never leaves the host.
ONBOARD_BASE_URL=http://onboard-portal:3000
# Must match the value configured in the onboarding portal.
ONBOARD_SERVICE_TOKEN=<long random string>
```

If `ONBOARD_SERVICE_TOKEN` is unset, CSD does not call the portal at all: the
Agreements page explains that the connection is not configured rather than
showing an empty list or attempting an unauthenticated request.

---

## Field mapping

Implemented in `pos-backend/services/agreementMapper.js`, kept pure and
separately unit-tested (19 tests) because a mistake here is silent — a store
created with the wrong phone number looks perfectly fine until someone calls it.

| Agreement | Store | Notes |
| --- | --- | --- |
| `r_display` → `r_name` | Restaurant name | display name preferred |
| `r_address` / `r_city` / `r_state` / `r_pin` | Address | PIN must be 6 digits, not starting `0` |
| `r_phone` | Restaurant phone | non-digits stripped, last 10 kept |
| `r_type` | Restaurant type | |
| `r_maps` | Maps link | dropped unless `http(s)://` |
| `o_name` / `o_phone` / `o_email` | Owner | email lower-cased |
| `b_legalname` | Legal name | |
| `b_gst` / `b_gstin` | GST | GSTIN upper-cased |
| `b_fssai` / `b_fssai_valid` | FSSAI | number must be 14 digits |
| `sales_agent` | Sales agent | |
| — | **Latitude / longitude** | **the only manual input** |

Two mapping decisions worth knowing:

- **Dates are parsed day-first.** Agents enter `03/04/2027` meaning 3 April;
  `new Date()` reads that as 4 March. An FSSAI licence expiring in the wrong
  month is the kind of error nobody catches until it matters.
- **A present GSTIN beats an unticked GST box.** A 15-character GSTIN is not
  typed by accident, whereas a checkbox is easily missed. The mismatch is
  flagged as a warning rather than silently resolved.

`missing` blocks creation; `warnings` are shown for the admin to eyeball but
do not block.

---

## Failure behaviour

| Failure | Result |
| --- | --- |
| Portal unreachable / times out | Agreements page shows the error; no store created |
| Service token rejected | Explicit "portal rejected this server's credentials" |
| Token not configured | Page explains the setup step; no requests attempted |
| Agreement missing required fields | Creation refused, missing fields listed |
| Agreement not `Completed` | Creation refused |
| Store write fails mid-way | Restaurant **and** link are rolled back, so a retry is clean |
| Storefront provisioning fails | Store still created; the error is surfaced |
| Portal write-back fails | Store still created; flagged, and retryable via **Sync portal** |
| Two admins click at once | Exactly one store; the other gets a 409 naming the existing store |
| A document fails to import | The store is still created; the failure is listed per-file and it can be uploaded manually |
| A document is not a PDF/image | Refused by byte-sniffing, regardless of its declared content-type |

---

## Where documents are stored

**Not** in `services/storage/` with the menu photos. That path is mounted at
`/uploads` by `express.static` with no authentication and
`Cache-Control: public, immutable`, and its S3/Cloudinary drivers likewise
return publicly fetchable URLs. Putting a customer's PAN card there would
expose their KYC at a guessable URL.

Compliance documents instead live under `CSD_DOCUMENTS_DIR`
(`/app/csd-documents`, its own `csd_documents` Docker volume), which nothing
serves statically. They reach a browser only by streaming through an
authenticated CSD route, with `no-store`, `nosniff` and a null CSP. Storage
keys are random and never sent to the client.

Type safety is by **byte sniffing**, not the declared content-type: only PDF,
JPEG, PNG, WebP and HEIC are accepted, so nothing a browser might execute can
be stored and later opened by a staff member.

---

## Appendix: how the service-token integration was applied

## What the real portal turned out to look like

Three things decided the design, none of which could be guessed from outside:

**1. `requireAuth` is a plain Express middleware** (`server/middleware/auth.js`)
— a JWT in the `kk_session` httpOnly cookie. That is exactly the shape
`allowServiceToken` wraps, so no adaptation was needed.

**2. The agreement routes have no guard of their own.** They sit under a
blanket `router.use(requireAuth)` at `api.js:92`. This is the important one:
the obvious patch — widening that blanket, or adding the service routes below
it — would hand the token *every* route beneath, including agent CRUD and both
DELETE endpoints. So the three service-accessible routes are **defined above
line 92** instead. Express matches in definition order, so the token reaches
exactly those three and nothing else.

**3. `/uploads` was already protected.** `server.js:46` reads
`app.use('/uploads', requireAuth, express.static(UPLOADS_DIR))`. An earlier
draft of this document warned that KYC documents might be publicly fetchable,
and that adding a guard could break the agent UI. **That was wrong** — the
security patch had already handled it, and the change here is a strict
widening (session *or* token), so agent behaviour is untouched.

---

## Configuration

Both deployments, same value:

```env
ONBOARD_SERVICE_TOKEN=<64 hex chars>
```

```bash
openssl rand -hex 32
```

Minimum 24 characters. `serviceAuth.js` refuses to match anything shorter, so a
missing or truncated value fails closed rather than turning the agreements API
into a public export of customer PII.

CSD additionally needs `ONBOARD_BASE_URL` (default `http://onboard-portal:3000`
— internal to the Docker network, so this traffic never leaves the host).

## Deploy order

**Portal first, on its own.** With `ONBOARD_SERVICE_TOKEN` unset no token can
match, nothing calls the new endpoint, and every route behaves exactly as it
does today. The change is inert. CSD then ships separately and the feature
switches on when the token is set on both sides — two independently harmless
deploys instead of one simultaneous cutover.

---

## Verification performed

Against the patched portal running on a seeded database:

| Check | Result |
| --- | --- |
| No credential → the two agreement routes and `/uploads/*` | 401, 401, 401 |
| Wrong service token → same routes | 401, 401 |
| Correct service token → same routes | 200, 200, 200 |
| `POST /agreements/:id/store-created` | 200, status persisted as `Store Created` with `storeId` |
| Same call repeated (CSD's retry) | 200 — idempotent |
| Unknown agreement id | 404 |
| Token → `GET/POST/DELETE /api/agents` | 401 |
| Token → `DELETE /api/agreements/:id` and `/files/:key` | 401 |
| Token → `POST /api/agreements` | 401 |
| Agreement and its file intact after all of the above | 200, 200 |

`serviceAuth.test.mjs` covers the middleware itself (18 tests): constant-time
comparison, an unset token not matching an empty header, a 63-character prefix
of a 64-character token not matching, and wiring it up with no guard throwing
at startup rather than silently opening the route.

---

## The bug this found in CSD

The portal's status vocabulary is **Draft → eSigned → Submitted**
(`index.html:3347` sets `state.status = 'Submitted'`). CSD had been built
against a mock that used `"Completed"`, and its accepted set was
`{completed, signed, complete, store created}`.

**`Submitted` was not in it.** Wired up as-is, CSD would have listed zero
agreements and refused every store creation — with a message blaming the
agreement rather than the mismatch.

Fixed in `csdAgreementController.js`, with regression tests. `eSigned` is
deliberately still refused: in the portal it means a signed PDF was uploaded
but not submitted, and the portal tells the customer that staff confirm the
eSign before the account goes live. Creating a store from one would skip that.

This is the class of error a self-written mock cannot catch, because the mock
encodes the same assumption as the code it is testing.

---

## Field mapping

`pos-backend/services/agreementMapper.js`, kept pure and separately unit-tested
(19 tests) because a mistake here is silent — a store created with the wrong
phone number looks fine until someone calls it.

| Agreement | Store | Notes |
| --- | --- | --- |
| `r_display` → `r_name` | Restaurant name | display name preferred |
| `r_address` / `r_city` / `r_state` / `r_pin` | Address | PIN must be 6 digits, not starting `0` |
| `r_phone` | Restaurant phone | non-digits stripped, last 10 kept |
| `r_type` | Restaurant type | |
| `r_maps` | Maps link | dropped unless `http(s)://` |
| `o_name` / `o_phone` / `o_email` | Owner | email lower-cased |
| `b_legalname` | Legal name | |
| `b_gst` / `b_gstin` | GST | GSTIN upper-cased |
| `b_fssai` / `b_fssai_valid` | FSSAI | number must be 14 digits |
| `sales_agent` | Sales agent | |
| — | **Latitude / longitude** | **the only manual input** |

- **Dates are parsed day-first.** Agents enter `03/04/2027` meaning 3 April;
  `new Date()` reads that as 4 March. An FSSAI licence expiring in the wrong
  month is the kind of error nobody catches until it matters.
- **A present GSTIN beats an unticked GST box.** A 15-character GSTIN is not
  typed by accident; a checkbox is easily missed. The mismatch is flagged as a
  warning rather than silently resolved.

`missing` blocks creation; `warnings` are shown for the admin to eyeball.

## Why CSD owns duplicate protection

The agreement lives in the portal's JSON store, the store lives in MongoDB, and
there is no shared transaction. If "already processed" were only a flag on the
agreement, any failure to write it — portal restart, network blip, someone
editing the JSON by hand — would let the next click create a **second store for
a paying customer**.

So CSD keeps its own `CsdAgreementLink` in the same database as the store, with
a **unique index on `agreementId`**. That index, not a read-then-check, is what
makes the guarantee hold: two admins clicking at the same instant both pass any
"does it exist?" test, but only one can win the insert. Verified with five
concurrent requests producing exactly one store.

The portal's status flag is therefore a display convenience for sales agents,
not the source of truth. Writing it is best-effort and never blocks or reverses
store creation.

## Failure behaviour

| Failure | Result |
| --- | --- |
| Portal unreachable / times out | Agreements page shows the error; no store created |
| Service token rejected | Explicit "portal rejected this server's credentials" |
| Token not configured | Page explains the setup step; no requests attempted |
| Agreement missing required fields | Creation refused, missing fields listed |
| Agreement not submitted | Creation refused |
| Store write fails mid-way | Restaurant **and** link rolled back, so a retry is clean |
| Storefront provisioning fails | Store still created; the error is surfaced |
| Portal write-back fails | Store still created; flagged, retryable via **Sync portal** |
| Two admins click at once | Exactly one store; the other gets a 409 naming the existing store |
| A document fails to import | Store still created; the failure is listed per-file |
| A document is not a PDF/image | Refused by byte-sniffing, whatever its declared content-type |

## Where documents are stored

**Not** in `services/storage/` with the menu photos. That path is mounted at
`/uploads` by `express.static` with no authentication and
`Cache-Control: public, immutable`, and its S3/Cloudinary drivers likewise
return publicly fetchable URLs. A customer's PAN card there would be exposed at
a guessable URL.

Compliance documents live under `CSD_DOCUMENTS_DIR` (`/app/csd-documents`, its
own Docker volume), which nothing serves statically. They reach a browser only
by streaming through an authenticated CSD route, with `no-store`, `nosniff` and
a null CSP. Storage keys are random and never sent to the client.

Files are **copied, not linked**: a store's GST certificate must not disappear
because an agent later deleted the agreement, and the documents must stay
readable when the portal is down.
