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

### 3. One new endpoint

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
