# Remaining work

Last updated: **2026-09-06**

Status of everything known to be unfinished. Items marked *verified* were
checked against the running system or the code this session; items marked
*unconfirmed* are believed true but were not re-checked.

---

## 1. Blocking — the e-bill is not safe to switch on yet

### 1.1 Confirm the WhatsApp variable order · **blocking**

Fast2SMS does not document which end of `variables_values` the **header**
variable goes on when a template has both a header and a body. `knotkitchen_ebill`
has both. The order in the code is header-first, and it is **unverified**.

This is the only remaining failure that produces **no error**: Fast2SMS returns
200 and the customer reads their order number where the total should be.

Send yourself a marker message (substitute a real 10-digit number):

```bash
cd /srv/knot && docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T pos-api node -e "require('/app/services/messagingService').sendEBillMessage({phone:'9876543210',restaurantName:'V1',orderNumber:'V2',total:'V3',receiptUrl:'V4'}).then(r=>console.log(r)).catch(e=>console.log('ERR',e.message))"
```

Correct = **V1** in the bold header, then V2 / V3 / V4 down the body. If V4 is in
the header instead, reverse the array in `MESSAGES.eBill.whatsapp.variables`
(`pos-backend/services/messagingService.js`) — one line.

### 1.2 Rotate the Fast2SMS API key · **blocking**

The key was pasted into a chat transcript. Regenerate it in the Fast2SMS Dev API
panel and install the replacement with:

```bash
bash /srv/knot/deploy/configure-secrets.sh
```

### 1.3 Confirm the wallet and link origin · *unconfirmed*

Never run. Both fail only at send time, so worth closing before going live:

```bash
cd /srv/knot && docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T pos-api node -e "const l=require('/app/services/receiptLink');console.log('PUBLIC_API_URL :',process.env.PUBLIC_API_URL||'(unset)');try{console.log('sample link    :',l.urlForOrder('000000000000000000000000'))}catch(e){console.log('sample link    : FAILS -',e.message)};fetch('https://www.fast2sms.com/dev/wallet',{headers:{authorization:process.env.FAST2SMS_API_KEY}}).then(r=>r.json()).then(j=>console.log('wallet         :',JSON.stringify(j)))"
```

### 1.4 Turn Auto E-Bill on

Off by default, per restaurant, in **Settings → Auto E-Bill**. Deliberately not
enabled for anyone — it flips a live store from sending nothing to messaging
every paying customer. Do 1.1 first.

Once on, it fires on every settle path: counter orders paid at the till,
counter orders completed later, the auto-complete sweep, table sessions
(including QR and online payments), and pay-by-link. A test pins all five.

### 1.5 Decide whether a phone number is compulsory at the POS · **your call**

The one remaining reason a customer would not get a bill: **nobody asked for
their number**. Phone is optional on counter orders today (required only for
delivery), so a walk-in with no number recorded cannot be sent anything.

Making it required would guarantee coverage at the cost of slowing the counter
queue and collecting junk numbers from people who decline. Not changed
unilaterally — say the word either way.

**Verified working:** the WhatsApp transport, the signed `/r/<token>` receipt
page, channel selection, idempotency, and the settle hooks. 620 backend + 18
frontend tests pass.

---

## 2. Payments — an unmade decision

### 2.1 Cashfree credentials are not installed · *verified absent at last check*

Every store resolved to **"NOBODY (payments off)"**. Until credentials are in
place, QR payments and payment links cannot take money. Same script as 1.2.

### 2.2 Whitelist `business.knotkitchen.online` in Cashfree · *unconfirmed*

Only `knotkitchen.online` was on the list. The POS runs on the `business.`
subdomain.

### 2.3 Decide how restaurants get paid · **needs your decision**

You want money to reach each restaurant directly rather than pooling with you.
Two routes:

| | Path A — per-store Cashfree accounts | Path B — Cashfree Easy Split |
|---|---|---|
| Build needed | **none, already works** | vendor onboarding, `order_splits`, status tracking |
| Restaurant does | full Cashfree signup + KYC themselves | enters bank details into KnotKitchen |
| Blocked on | nothing | **Cashfree must enable Easy Split on your account, Test *and* Production** |

Path B needs two things from you: **email Cashfree support** to enable Easy
Split, and **decide your commission** (a percentage or a flat fee — they are
different code).

Design note if Path B goes ahead: bank account numbers and PAN are posted
straight to Cashfree and **never stored in the KnotKitchen database**. Only the
`vendor_id` and its verification status are kept.

---

## 3. Known gaps in the code

### 3.1 CSD → POS crash · *fixed, awaiting your confirmation*

`TypeError: Cannot read properties of null (reading 'name')` — clearing a
category while a subcategory was open. Fixed in `c5f39e9` and deployed. Worth
confirming it has not recurred.

### 3.2 `billUrl` is returned but unused

`POST /api/receipts/send-ebill` now returns the bill link even when delivery
fails, so an operator could read it out or copy it. Nothing in the POS displays
it yet. Small, genuinely useful.

### 3.3 Product Timing & Schedule · *no repro*

Reported earlier, never reproduced. Needs a concrete example — which product,
which schedule, what was expected.

### 3.4 Support helpline placeholder · *blocked on you*

Reported earlier; a real number was never supplied, and I could not re-locate
the placeholder by search this session. Needs the number, and a pointer to
where it shows.

### 3.5 The Fast2SMS **SMS** (DLT) fallback is unverified

E-bills go over WhatsApp. If WhatsApp is unconfigured the code falls back to a
DLT SMS template whose variable order was never checked against a registered
template — same silent-failure risk as 1.1. Either verify it or leave the DLT
template IDs unset so the fallback is never chosen.

---

## 4. Housekeeping

- **No tests at all in `csd-web` and `customer-web`.** `pos-backend` (620) and
  `pos-frontend` (18) are covered; the other two front ends have no `test`
  script. *verified*
- **Lint errors, all pre-existing:** pos-frontend 34, csd-web 8, customer-web 1.
  Mostly unused variables and imports. None introduced by recent work. *verified*
- **Stale script on the server.** `/docker/knotkitchen/configure-secrets.sh` is an
  old broken copy that writes to an env file nothing reads. The live one is
  `/srv/knot/deploy/configure-secrets.sh`. Delete the stale one. *unconfirmed*
- **GitHub Actions Node 20 deprecation.** `actions/checkout@v4` and
  `actions/setup-node@v4` are being forced onto Node 24. Bump to `@v5` before
  they stop working. *verified*
- **POS bundle is ~1 MB** (297 kB gzipped), over Vite's 500 kB warning. No code
  splitting. Not urgent.
- **Deploy path confusion, now fixed.** The checkout is `/srv/knot`, not
  `/docker/knotkitchen`. The script self-locates, so this should not recur.

---

## 5. Your machine

**WSL is broken** — `/bin/bash` is missing, so the Run button on shell commands
fails locally. Use PowerShell or Windows Terminal, which have `ssh` built in.
`wsl --list --verbose` would show whether a distro is registered.

---

## Notes on working practice

- Secrets go into `/srv/knot/deploy/.env` via `configure-secrets.sh`, never into
  chat. Diagnostics report credential **lengths only**.
- **`docker compose restart` does not pick up `.env` changes** — it reuses the
  existing container's environment. Use
  `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d pos-api`.
- **compose only forwards environment keys listed explicitly** under a service.
  A key added to `.env` and read via `process.env` is undefined in the container
  until it is also added to `deploy/docker-compose.yml`. This has caused silent
  misconfiguration more than once.
