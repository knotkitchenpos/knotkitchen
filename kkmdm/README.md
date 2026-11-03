# KKMDM — KnotKitchen Mobile Device Management

Manages KnotKitchen's restaurant tablets and locks each into a dedicated POS terminal.

* `agent/` — **KK Agent**, the Android Device Owner (Java, Android 9+)
* `server/` — **KKMDM server**: admin + device API, command queue, WebSocket push (Node/Express/MongoDB, port 8100)
* `dashboard/` — **admin dashboard** (React/Vite, port 5177)
* `scripts/` — `adb-provision.sh` (technician USB enrollment), `build-agent.sh`
* `docs/ARCHITECTURE.md` — design decisions, capability matrix, schema, flows, security, phases, test results
* `docs/openapi.yaml` — API reference

## Run locally

Uses the local test MongoDB from `..\..\local-test` (port 27018). KKMDM keeps its own `kkmdm` database and only *reads* `knotkitchen.stores`.

1. Database: `C:\Users\supra\KnotKitchen\local-test> .\start-mongo.cmd`
2. Server: `kkmdm\server> npm install`, then `npm run seed` (first time) and `npm start`
   * Copy `.env.example` to `.env`.
   * On first boot it creates the Super Admin and writes the password to `server/storage/initial-admin.txt` (git-ignored).
3. Dashboard: `kkmdm\dashboard> npm install` then `npm run dev`, and open http://localhost:5177.
4. Agent: `kkmdm/scripts/build-agent.sh`.
   * Needs the Android SDK at `C:\Users\supra\Android\Sdk`, `JAVA_HOME` = JDK 21, and the key in `agent/signing/` (git-ignored, see "Key custody" in the architecture doc).

Tests: `kkmdm\server> npm test`. They use a throwaway `kkmdm_test` database on the same mongod.

## Enroll a tablet

* **QR (production):** the setup wizard must be able to download the agent, so `PUBLIC_URL` has to be an HTTPS address the tablet can reach (e.g. `https://mdm.knotkitchen.com`). Then: Enrollment → Generate QR → factory-reset tablet → tap the Welcome screen 6 times → scan.
* **USB / ADB (local testing, already-deployed tablets):** generate a token on the Enrollment page, then run:
  ```bash
  bash kkmdm/scripts/adb-provision.sh http://localhost:8100 <token>
  ```
  For `localhost` the script sets up `adb reverse`. Policy changes that touch USB restrictions reset the USB link and drop it, so re-run `adb reverse tcp:8100 tcp:8100` while testing.
* **Return a test tablet to normal:** Device → Remote Actions → "Release (dev: remove MDM)". This is disabled in production.

Test tablets should use the **"Test tablet (ADB allowed)"** policy. The company default blocks USB debugging, which would cut off ADB.

## Admin sign-in and recovery

* Two-factor sign-in (an authenticator app) is required in production. An admin without it sees only Settings until it is set up.
* A device stays signed in until it signs out. Signing out ends only that device; a password change, a 2FA reset or disabling the account ends every device.
* Lost phone, locked out or forgotten password, from the server's terminal (asks for the new password twice, hidden):

  ```
  docker compose -f deploy/docker-compose.yml exec kkmdm node src/reset-admin.js <email>
  ```

  This turns 2FA off for that account (set it up again at the next sign-in), unlocks and re-enables it, and signs it out everywhere.
