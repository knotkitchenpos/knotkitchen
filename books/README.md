# KnotKitchen Books

A small accounting app for the KNOTKITCHEN partnership. Both partners use it on their Android phones and see the same books. It covers:

- **Invoices:** numbered KK/2026-27/001 and so on, with GST worked out and a PDF to share.
- **Expenses:** bill photos or PDFs, and whether the GST on them can be claimed back (ITC).
- **GST:** a quarterly summary, GSTR-3B figures, GSTR-1 sections and due dates.
- **Partners:** each partner's capital account.
- **Home:** profit or loss for the financial year.

It works without internet. Entries are saved on the phone and sync when the phone is back online.

There is also a **website version** of the same app at **https://books.knotkitchen.com**, for use on a computer. It uses the same sign-in and the same books.

## How it fits together

| Piece | Where |
|---|---|
| App (Vite + plain JavaScript, wrapped with Capacitor for Android) | `books/` |
| Website | `books.knotkitchen.com`: the `books-web` container (`books/Dockerfile`), with `/api/books` passed to the API by Caddy |
| Server (sign-in, sync, bill files) | `pos-backend/routes/booksRoute.js`, at `https://api.knotkitchen.com/api/books` |
| Data | The VPS MongoDB, collections `books_records` and `books_config`, included in the nightly backup |
| Bill photos / PDFs | The private documents volume on the VPS (`csd-documents/books/`). Never public. |
| APK build | `.github/workflows/build-books-apk.yml` |

Sign-in uses Google. Only the Google accounts on the access list can open the books. You can change the list in the app under More > Settings > Who can use the app. Someone taken off the list is locked out at their next sync.

The tax rules live in `src/lib/tax.js` and `src/lib/gst.js`, with tests in `test/tax.test.js`. To run the tests: `cd books && npm test`.

---

## One-time setup

You need four things: a Google sign-in setup, two server settings, a deploy, and the APK.

### 1. Google sign-in (about 15 minutes)

1. Open <https://console.cloud.google.com/> and sign in with the firm's Google account.
2. Create a project: click the project picker at the top, then **New project**. Name it `KnotKitchen Books` and click **Create**, then select it.
3. Set up the sign-in screen:
   1. Open the menu, then **Google Auth Platform**, then **Get started**.
   2. App name: `KnotKitchen Books`. Support email: yours.
   3. Audience: **External**.
   4. Contact email: yours. Agree to the terms and click **Create**.
4. Allow the two partners:
   1. Go to **Audience**, then **Test users**, then **Add users**.
   2. Add both partners' Gmail addresses and click **Save**.
   3. While the app is in "Testing", only these accounts can sign in, which is what you want.
5. Create the **Web** client (the server checks sign-ins against it):
   1. Go to **Clients**, then **Create client**.
   2. Type: **Web application**. Name: `Books web`.
   3. Under **Authorized JavaScript origins**, add `https://books.knotkitchen.com` and `http://localhost:5181` (the second is only for testing on a computer).
   4. Under **Authorized redirect URIs**, add `https://books.knotkitchen.com/` and `http://localhost:5181/`. Keep the slash at the end. The website's sign-in popup returns here.
   5. Click **Create** and copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
6. Create the **Android** client (this lets the phone app use Google sign-in):
   1. Go to **Clients**, then **Create client**, and choose type **Android**.
   2. Package name: `com.knotkitchen.books`.
   3. SHA-1 certificate fingerprint: the SHA-1 of the release key that signs the APK. This is the same key as the POS app. Get it with:
      ```
      keytool -list -v -keystore knotkitchen-release.jks -alias <your key alias>
      ```
      Copy the line that starts with `SHA1:`. If you don't have the keystore file at hand, take the SHA-1 from an APK you already built:
      ```
      apksigner verify --print-certs KnotKitchen-Books-1.0.N.apk
      ```
   4. Click **Create**. You don't need to copy anything from this client.

> Google sign-in on the phone only works with the **signed release** APK. A debug APK is signed with a throwaway key whose SHA-1 Google doesn't know.

### 2. Server settings (on the VPS)

Add two lines to `/srv/knot/deploy/.env`:

```
BOOKS_GOOGLE_CLIENT_IDS=<the Web client ID from step 1.5>
BOOKS_ALLOWED_EMAILS=partner1@gmail.com,partner2@gmail.com
```

`BOOKS_ALLOWED_EMAILS` is only read once, the first time anyone signs in. After that, the list is kept in the database and changed from the app.

### 3. Deploy

Push to `main`. The usual "Deploy to VPS" workflow rebuilds the API with the `/api/books` routes and the new settings, builds the `books-web` container, and reloads Caddy for `books.knotkitchen.com`.

If you change `deploy/.env` later without pushing anything, restart the API so it reads the new values:

```
cd /srv/knot && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d pos-api pos-api-2
```

### 4. APK signing secrets

The workflow signs the APK with the **same release key and GitHub secrets the POS app already uses**:
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

They are already set in this repository, so there's nothing to add. If you ever need to create them from scratch:

```
keytool -genkeypair -v -keystore knotkitchen-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias knotkitchen
base64 -w0 knotkitchen-release.jks > keystore.b64      # on Windows: certutil -encode knotkitchen-release.jks keystore.b64 (then remove the BEGIN/END lines)
gh secret set ANDROID_KEYSTORE_BASE64 < keystore.b64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS
gh secret set ANDROID_KEY_PASSWORD
```

Keep the `.jks` file and its passwords safe and offline. An installed app only accepts updates signed with the same key. Never commit the keystore, `.env`, or `google-services.json`. This app doesn't use `google-services.json` at all.

### 5. Scan bill (optional, needs a Claude API key)

The **Scan bill** box at the top of a new expense reads a bill photo or PDF with Claude and fills in the vendor, GSTIN, date, amounts, GST and category. You check the form and save. Each scan sends only that bill to Anthropic and costs a fraction of a rupee.

It needs an Anthropic API key on the server (the same key also turns on AI reply suggestions in the support desk):

1. Create a key at <https://console.anthropic.com/> (Settings, then API keys) and add some credit.
2. On the VPS, add it to `/srv/knot/deploy/.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Restart the API: `cd /srv/knot && docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d pos-api pos-api-2`

Without a key the app says scanning is not switched on and keeps the bill attached, so you fill the form by hand.

---

## Getting the APK onto a phone

1. Push to `main`, or run it by hand: GitHub, then **Actions**, then **Build KnotKitchen Books APK**, then **Run workflow**.
2. Wait for the run to turn green (about 5–8 minutes) and open it.
3. Under **Artifacts**, download **KnotKitchen-Books-1.0.N**. You get a `.zip`; unzip it to get `KnotKitchen-Books-1.0.N.apk`.
   - The repository is private, so you need to be signed in to GitHub. Artifacts are kept for 90 days.
4. Put the APK on the phone. You can send it to yourself on WhatsApp or Telegram, or use a USB cable, Google Drive, or download it on the phone's browser while signed in to GitHub.
5. On the phone, tap the APK. If Android asks, allow **Install unknown apps** for that app (Files, Chrome or WhatsApp), then tap **Install**.
6. Open **KnotKitchen Books** and tap **Sign in with Google**. Choose your Gmail account; it must be on the access list.
7. For updates, install the newer APK over the old one. Your data stays on the server and on the phone.

---

## Testing on a computer (localhost)

1. Start the local database and the API with the local `.env`. The test settings are already in `pos-backend/.env`:
   ```
   BOOKS_DEV_LOGIN=1
   BOOKS_ALLOWED_EMAILS=partner1@books.test,partner2@books.test
   ```
   `BOOKS_DEV_LOGIN` adds a "sign in for testing" box. It never works when `NODE_ENV=production`.
2. Run `cd books`, then `npm install`, then `npm run dev`, and open <http://localhost:5181>.
3. Run `npm test` for the tax tests.

## Notes on the rules

- **Registered on a date:** a GSTIN is entered and the date is on or after "Registered from". Before that, invoices carry no GST and print "Supplier not registered under GST".
- **Place of supply:** the same as the firm's state means CGST + SGST at half the rate each; any other state means IGST.
- **ITC on a bill:** claimable only if all of these are true:
  - the firm was registered on the bill date;
  - the vendor's GSTIN is on the bill;
  - the bill is in the firm's name;
  - it's for business use;
  - it isn't food and entertainment.
  Otherwise the GST is counted as part of the cost.
- **Credit set-off order:**
  - IGST credit goes to IGST, then CGST, then SGST.
  - CGST credit goes to CGST, then IGST.
  - SGST credit goes to SGST, then IGST.
  - Unused credit carries forward to the next month.
- **GSTR-1 sections:**
  - 4A B2B if the client has a GSTIN.
  - 5 B2CL for inter-state invoices to unregistered buyers over ₹1 lakh. This is the Rule 59 limit since August 2024.
  - 7 B2CS for everything else.
- **Due dates for West Bengal:**
  - QRMP: PMT-06 by the 25th, GSTR-1 by the 13th and GSTR-3B by the 24th after the quarter.
  - Monthly: GSTR-1 by the 11th and GSTR-3B by the 20th.
  - Also shown: advance tax (15 Jun, 15 Sep, 15 Dec, 15 Mar) and ITR-5 by 31 July.
- **Estimated income tax:** 31.2% of profit (30% + 4% cess for a firm).

Always check ITC against GSTR-2B and confirm due dates on gst.gov.in. The app is a helper, not a substitute for your CA.
