# KKMDM — Architecture

_KnotKitchen Mobile Device Management. Written 2026-10-29 alongside the first build; keep it in step with the code._

KKMDM manages the Android tablets KnotKitchen supplies to restaurants and locks each one into a dedicated POS terminal (Single App Kiosk). It has three parts:

| Part | Path | Stack |
|---|---|---|
| **KK Agent**: Android Device Owner (DPC) | `kkmdm/agent` | Java, Android 9+ (minSdk 28, target 34), OkHttp |
| **KKMDM server**: admin API, device API, command queue, push channel | `kkmdm/server` | Node 20+ / Express / MongoDB (Mongoose), `ws` |
| **Admin dashboard** | `kkmdm/dashboard` | React 18 + Vite, port 5177 |

The server deliberately uses the same stack as `pos-backend` (Express + Mongoose + bcrypt + JWT) so the same people can run it and it fits the existing VPS, Docker and Caddy setup.

---

## 0. Inputs and the assumptions made

| Input | Value used | Notes |
|---|---|---|
| Tablet make/models | Tested on **"Slate" (MediaTek), Android 10 / API 29, GMS present** | Fleet list still TBD. The test matrix below must grow with each model. |
| Android versions | Minimum **Android 9 (API 28)** | Needed for lock task features, `ActivityOptions.setLockTaskEnabled`, built-in QR provisioning. |
| GMS | **Mixed assumed** | Nothing depends on GMS. FCM is optional on top. |
| POS package | `com.knotkitchen.pos` (Capacitor shell around business.knotkitchen.com) | From `pos-frontend/capacitor.config.ts`. |
| Companion apps | None yet | Add them per policy via `kiosk.allowedPackages`. |
| Peripherals | USB/Bluetooth thermal printers (see `ThermalPrinterPlugin.java`) | USB *host* is never blocked; only MTP/PTP file transfer is. |
| Store source of truth | `pos-backend` `stores` collection (6-digit `storeId`) | Read-only sync (§10). |
| Hosting | Same Hostinger VPS / Docker compose, India | DPDP-friendly; no data leaves the VPS unless a webhook is configured. |

---

## 1. Platform decision: custom DPC (with an AMAPI-ready seam)

| | (A) Custom DPC (chosen) | (B) Android Management API |
|---|---|---|
| Works on GMS-less POS hardware (Sunmi, iMin, PAX, generic) | **Yes** | No: needs Play services |
| Self-hosted APKs (POS shell, agent) | **Yes** (PackageInstaller) | Only via managed Google Play / private apps |
| Silent install / kiosk / restrictions | Yes (Device Owner) | Yes |
| Data residency | **Our VPS** | Google |
| Build/maintenance cost | Higher (we own the agent) | Lower |
| Google's direction for EMMs | Not preferred for *new EMM products* | Preferred |

**Decision: (A) custom DPC.** The fleet will include GMS-less POS hardware, and the POS shell is distributed outside Play (it self-updates via `ShellUpdater`). Both rule out AMAPI as the only path. KKMDM is a single-purpose in-house fleet tool, not an EMM product sold to others, so Google's AMAPI steer doesn't bind us.

**Hybrid later:** for an all-GMS subset (for example Samsung fleets bought in bulk), the server's per-device "desired state" model (policy JSON, desired apps, commands) maps onto AMAPI policies. A `provider` field on Device could route those devices through AMAPI without touching the dashboard.

### Capability matrix

DO = needs Device Owner; API = minimum Android API level.

| Feature | DO | API | GMS | OEM notes / alternatives |
|---|---|---|---|---|
| QR provisioning (6 taps) | n/a | 24 (scanner built in from 28) | No | Some OEM setup wizards lack it: use ADB or Knox Mobile Enrollment / Sunmi DMS |
| Android 12+ provisioning intents | yes | 31 | No | `GET_PROVISIONING_MODE` + `ADMIN_POLICY_COMPLIANCE` implemented |
| Zero-touch enrollment | n/a | 26 | **Yes** | Reseller must support ZT |
| Knox Mobile Enrollment | n/a | Samsung | No | Samsung only |
| Lock task kiosk + features | yes | 28 | No | Some OEMs show extra system dialogs (USB permission) — see §8 |
| Persistent preferred HOME | yes | 21 | No | |
| Status bar / keyguard disable | yes | 23 | No | |
| User restrictions (install, factory reset, safe boot, debugging, USB file transfer, config…) | yes | 21–29 | No | |
| Silent install/uninstall | yes | 21 | No | `DISALLOW_INSTALL_APPS` also blocks the DO; the agent lifts it per session (verified on Android 10) |
| Managed configuration to POS | yes | 21 | No | POS must read `RestrictionsManager` (§8) |
| Screen timeout / brightness (`setSystemSetting`) | yes | 28 | No | |
| Stay on while plugged (`setGlobalSetting`) | yes | 21 | No | |
| Time zone (`setTimeZone`), auto time | yes | 28 / 30 | No | |
| System update window | yes | 23 | No | OEM OTA clients may ignore it (Sunmi/iMin have their own) |
| Factory Reset Protection policy | yes | **30** | **Yes** (Google accounts) | Skipped silently below 30 |
| Private DNS | yes | 29 | No | |
| Always-on VPN | yes | 24 | No | Needs a VPN app |
| Wi-Fi profiles (`addNetwork`) | yes | 21 | No | DO is exempt from the API 29 deprecation |
| Reboot / lock / wipe | yes | 24 / 8 / 8 | No | |
| Bug report (`requestBugreport`) | yes | 24 | No | Android asks the user to approve sharing |
| Location (lost mode) | yes (self-grant) | 23 | No | Only when the policy enables it (DPDP) |
| Hardware key attestation | no | 24 | No | Root pinning via `ATTESTATION_ROOT_SHA256` |
| Play Integrity | no | — | **Yes** | Not implemented; alternative to attestation on GMS |
| Remote screen view | no | 21 | No | `MediaProjection` needs on-device consent each time; OEM SDKs (Samsung Knox Remote Support, Sunmi) avoid it. **Not built.** |

---

## 2. Android Agent (`kkmdm/agent`)

```
AgentApp ─ AgentLog (rolling file, pulled by "pull_logs")
│
├─ AdminReceiver (DeviceAdminReceiver)          ← Device Owner component
│    onProfileProvisioningComplete (≤11), lock task enter/exit, bug report callbacks
├─ ProvisioningModeActivity (GET_PROVISIONING_MODE, 12+)   → fully managed
├─ PolicyComplianceActivity (ADMIN_POLICY_COMPLIANCE, 12+) → save extras, start enroll
├─ ProvisioningDoneActivity (PROVISIONING_SUCCESSFUL, 8–11)
├─ SetupActivity      manual/ADB enrollment (token + server), refuses once enrolled
│
├─ SyncEngine   single worker thread; enroll(), sync(), offline event queue,
│               stuck-worker watchdog (replaces a sync stuck > 3 min)
├─ Api          OkHttp; cert pinning (BuildConfig.CERT_PINS); 90 s per call
├─ AgentService foreground service: heartbeat timer, WebSocket wake channel,
│               network callback (flush on reconnect); 15-min keep-alive alarm
├─ PolicyEngine settings JSON → DevicePolicyManager (each step isolated,
│               failures become compliance errors)
├─ Kiosk        lock task allowlist/features, persistent HOME, technician mode
├─ HomeActivity persistent preferred HOME = kiosk launcher + crash watchdog,
│               hidden 7-tap technician gesture, technician panel
├─ Watchdog     quick-exit counting, crash-loop backoff, heartbeat self-heal
├─ Commands     executor, idempotent by cmdId, report queue
├─ AppInstaller desired-state reconcile, SHA-256 check, PackageInstaller
├─ InstallReceiver / BootReceiver / AlarmReceiver
├─ TechnicianActivity  offline TOTP PIN (5-min step)
└─ LostModeActivity    locked message screen
```

**Persistence:** `SharedPreferences` (`Prefs`). Secrets (device credential, technician seed) are AES-GCM encrypted with a key held in the Android Keystore. Queues for events and command reports are persisted, so nothing is lost while offline.

**Sync loop:** heartbeat every `telemetry.heartbeatSeconds` (default 60). The WebSocket only carries `{"type":"sync"}` nudges, so WebSocket, FCM (future) and polling all share one HTTPS code path: `POST /device/sync`.

---

## 3. Backend (`kkmdm/server`)

```
            ┌───────── Admin dashboard (React) ──────────┐
            │  cookie session (SameSite=Strict) + X-KKMDM │
            ▼                                             │
  /api/*  Express ── RBAC (lib/rbac) ── audit (hash chain)│
            │                                             │
            ├── Mongo: devices, policies, commands, …     │
            │                                             │
  /device/* (device credential) ◄── KK Agent HTTPS ───────┘
  /device/ws  WebSocket wake channel  (lib/push)
  /agent/kk-agent.apk  public download for the setup wizard
            │
  jobs.js: offline sweep 30 s · command expiry 60 s · alerts 60 s ·
           telemetry daily roll-up 1 h · store sync 6 h
```

* **Command queue** is the `commands` collection: queued → sent → delivered → executing → succeeded | failed | expired | cancelled. The device dedupes on `cmdId`. A `sent` command not acknowledged within 2 min is offered again. Install/uninstall/reboot are held until the store's maintenance window unless forced.
* **Desired-state apps** (`lib/desiredApps.js`): each sync says which version of every managed app (agent, POS, companions) the device should run. Precedence: store pin → running rollout the device is in → the app's stable version.
* **Telemetry** goes into a MongoDB time-series collection with a 90-day TTL, plus a `telemetrydailies` roll-up that is kept after the raw data expires.

**Scaling to 10,000+ devices.** The API is stateless (JWT plus a DB check). Three things hold per-process state and must move out when there is more than one instance:

1. WebSocket sockets: put Redis pub/sub in front so `wake(deviceId)` reaches the node holding the socket.
2. The rate limiter: move to Redis.
3. The audit appender: its in-process serial queue must become a single writer, for example a queue consumer.

At 10k devices on a 60 s heartbeat that is about 170 syncs/s, which suits 2–3 Node instances behind Caddy with MongoDB indexes on every list filter (`models/index.js`). Bulk commands fan out as individual rows; past roughly 50k targets that loop should move to a job queue (BullMQ).

**Environments:** dev runs locally (`local-test` mongod on 27018, DB `kkmdm`). For staging and prod, add a `kkmdm` service to `deploy/docker-compose.yml` and an `mdm.<BASE_DOMAIN>` Caddy site (WebSocket upgrade passes through Caddy by default). Schema changes go in Mongoose models plus idempotent scripts. CI: `npm test` (server) and `./gradlew assembleRelease` (agent).

---

## 4. Database schema (MongoDB collections)

All of them are in `server/src/models/index.js`. Key fields:

| Collection | Purpose / key fields |
|---|---|
| `companies` | `name, slug, parentCompanyId` (reseller/franchise layer later) |
| `stores` | `companyId, name, kkStoreId (6-digit, unique), kkRestaurantId, kkStatus, timezone, maintenanceWindow{start,end}, businessHours, appPins[{packageName, versionId}], syncedAt` |
| `groups` | `companyId, storeId, name` |
| `devices` | identity, hardware facts, `lifecycle (in_stock/enrolled/active/in_repair/retired)`, `online, lastSeenAt`, `telemetry{…}` snapshot, `kiosk{state,error,crashCount,technicianUntil}`, `policy{policyId, expectedHash, appliedHash, compliant, errors}`, `apps[]`, `inventory{assetTag, purchaseDate, warrantyUntil, notes}`, `pilot`, `lostMode`, `location`, `techSecretEnc`, `rotateCredential` |
| *device_inventory* | merged into `devices.inventory` (one record per tablet; retire frees it) |
| `devicecredentials` | `deviceId, secretHash (SHA-256), lastUsedAt, revokedAt, revokedReason` |
| `deviceevents` | device activity log: `deviceId, at, type, message, data` |
| `devicelogs` | pulled logs / bug reports: `deviceId, kind, file, size` |
| `policies` | `name, version, settings` (partial: only the overrides) |
| `policyassignments` | `policyId, scope (company/store/group/device), targetId` (unique per scope+target) |
| `apps` | `packageName, role (agent/pos/companion/other), signingCertSha256, currentVersionId` |
| `appversions` | `packageName, versionCode, versionName, sha256, size, signingCertSha256, signatureScheme, minSdk, file` |
| `rollouts` | `versionId, previousVersionId, stage (pilot/percent/all), percent, status, storeIds, respectMaintenanceWindow, history` |
| `enrollmenttokens` | `tokenHash, hint, storeId, groupId, policyId, deviceName, mode, maxUses, uses, expiresAt, revokedAt, createdBy` |
| `enrollmentattempts` | every redemption attempt: `tokenId, success, reason, ip, deviceFacts` |
| `commands` | `cmdId, deviceId, type, params, status, expiresAt, holdForMaintenance, bulkId, rolloutId, createdBy, result, error, history[]` |
| `bulkjobs` | `type, params, target, total, createdBy` |
| `telemetries` | time series `{ts, deviceId, battery, charging, storageFreeMb, …}`, TTL 90 days |
| `telemetrydailies` | per-device daily roll-up |
| `alertrules` | `storeId?, type, threshold, businessHoursOnly, channels{email[], webhook}` |
| `alerts` | `ruleId, deviceId, storeId, type, severity, message, status (open/acknowledged/resolved)` |
| `adminusers` | `email, passwordHash (bcrypt 12), role, storeIds, totpSecretEnc, totpEnabled, failedLogins, lockedUntil, sessionVersion, ssoSubject` |
| `roles` | written from `lib/rbac.js` on boot (code is the source of truth) |
| `auditlogs` | `seq, at, actor*, action, target*, details, ip, prevHash, hash` (hash-chained) |

---

## 5. Enrollment flow

```
Admin                Dashboard/Server                 Tablet (setup wizard)            KK Agent
  │ Generate QR ──────► token (256-bit), store SHA-256
  │ ◄── QR payload (shown on screen, countdown)
  │                                                   Welcome: tap ×6 → QR scanner
  │                                                   scan → join Wi-Fi (from QR)
  │                    GET /agent/kk-agent.apk ◄────── download, verify SIGNATURE_CHECKSUM
  │                                                   install, set Device Owner
  │                                                   [12+] GET_PROVISIONING_MODE ──────► FULLY_MANAGED
  │                                                   [12+] ADMIN_POLICY_COMPLIANCE ────► save extras, start
  │                                                   [≤11] PROFILE_PROVISIONING_COMPLETE ► save extras, start
  │                    POST /device/enroll ◄───────────────────────────────────────────── token + facts + attestation
  │                    validate, burn token (atomic), create Device, issue credential
  │                    ─────► credential, tech seed, policy, managed config, desired apps
  │                                                                                     apply policy, install POS
  │                                                   wizard finishes → HOME = agent
  │                                                                                     lock task → launch POS
  │                    POST /device/sync (events: ready) ◄─────────────────────────────  Device → Active
```

**Fallback paths**
* **ADB** (`scripts/adb-provision.sh`): for deployed tablets or a setup wizard without QR support. It needs no accounts and a single user. It installs the agent, runs `dpm set-device-owner com.knotkitchen.mdm/.AdminReceiver`, then starts `SetupActivity` with the server and token. Verified on the Slate tablet.
* **Manual token entry:** `SetupActivity` takes the server URL and token typed in by hand, once the agent is Device Owner.
* **Zero-touch / Knox Mobile Enrollment** (design): both deliver the same admin extras bundle (`kkmdm_token`, `kkmdm_server`) through their portal configuration. Use a **batch token** with a long TTL per purchase order. The agent needs no change.
* **OEM paths** (Sunmi/iMin/PAX DMS): push the agent APK through the OEM console and set Device Owner with the OEM's provisioning SDK where it exists. Otherwise use ADB.
* **Migration of tablets already in restaurants** (not Device Owner): Device Owner cannot be added to a device with accounts. Schedule visits in the maintenance window: factory reset → QR, or remove accounts → ADB script. Before the visit, generate a batch token per store with `deviceName` = store name.

---

## 6. QR payload and token security

```json
{
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": "com.knotkitchen.mdm/com.knotkitchen.mdm.AdminReceiver",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": "https://mdm.knotkitchen.com/agent/kk-agent.apk",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": "<base64url SHA-256 of the signing cert>",
  "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": true,
  "android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": true,
  "android.app.extra.PROVISIONING_TIME_ZONE": "Asia/Kolkata",
  "android.app.extra.PROVISIONING_LOCALE": "en_IN",
  "android.app.extra.PROVISIONING_WIFI_SSID": "optional",
  "android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE": "WPA",
  "android.app.extra.PROVISIONING_WIFI_PASSWORD": "optional",
  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": { "kkmdm_token": "<43-char token>", "kkmdm_server": "https://mdm.knotkitchen.com" }
}
```

* The signature checksum comes from the APK's v2/v3 signing certificate (`lib/apk.js`, which matched `apksigner` in testing). Because it is a *signature* checksum and not a package checksum, agent updates do not change the QR.
* **Tokens:**
  * 32 random bytes (base64url). Only `sha256(token)` is stored, plus a 6-character hint.
  * Bound to store, group, policy, device name, creator and expiry.
  * Single-use by default. Batch mode allows N uses.
  * TTL 24 h by default (15 min to 14 days). Revocable.
  * Burned atomically (`findOneAndUpdate … $expr uses < maxUses`).
  * Rate-limited at 20 per 10 min per IP.
  * Every attempt is logged to `enrollmentattempts` and the audit log.
* **No credentials in the QR** except Wi-Fi, which Android requires for setup. It is never stored server side. The dashboard shows the QR on screen only, with a countdown. Prefer a staging SSID.
* **Per-device credential:**
  * 256-bit secret, SHA-256 stored, sent as `Authorization: Device <id>.<secret>`.
  * Rotation (dashboard) hands a new one on the next sync, and first use of the new one revokes the old.
  * Retire or wipe revokes all of them. Re-enrolling the same serial revokes the previous ones.
* **Attestation:**
  * The agent sends a hardware-keystore certificate chain whose challenge is `sha256(token)`.
  * The server checks chain signatures, the attestation extension and the challenge.
  * It accepts a root only if it is in `ATTESTATION_ROOT_SHA256` (paste Google's published roots).
  * With `REQUIRE_ATTESTATION=true` in production, unverified devices and emulators are rejected.
* **Key custody:** `agent/signing/kk-agent.jks` (git-ignored) **is the fleet's lifeline**.
  * A Device Owner can only be updated by an APK signed with the same key. Lose the key and every tablet needs a factory reset.
  * Keep two offline encrypted copies (for example a password manager vault plus a sealed USB drive with the owner).
  * The production build runs only on a machine that holds it. The keystore password is never in git.
  * Signature scheme v2/v3. A planned key rotation uses the v3 rotation lineage (`apksigner rotate`).

---

## 7. API

`kkmdm/docs/openapi.yaml` is the reference (admin API under `/api`, device API under `/device`). Summary:

* **Auth:** `POST /api/auth/login {email,password,totp?}`, `/logout`, `GET /me`, `POST /reauth`, `/2fa/setup`, `/2fa/enable`, `/password`.
* **Devices:**
  * `GET /api/devices` with filters `status, lifecycle, storeId, groupId, lowBattery, notCharging, outdated, kioskError, noncompliant, pilot, q`, paged.
  * `GET /export.csv`, `GET/PATCH /:id`, and per-device `/:id/policy|events|telemetry|commands|logs`.
  * `POST /:id/commands`, `POST /bulk/commands`, `/:id/technician-otp`, `/:id/rotate-credentials`, `/:id/retire`.
* **Organisation:** `/api/stores` (+`/sync`), `/api/groups`, `/api/policies` (+`/defaults`), `PUT /api/policy-assignments`.
* **Enrollment:** `/api/enrollment/tokens` (+`/:id/revoke`), `/attempts`, `/agent`.
* **Apps:** `/api/apps` (`/upload` takes a raw APK body), `/:id/set-current`, `/rollouts/all`, `POST /rollouts`, `/rollouts/:id/{advance|all|pause|resume|complete|rollback}`.
* **Other:** `/api/summary`, `/api/commands` (+`/:cmdId/cancel`), `/api/bulk`, `/api/alerts` (+`/:id/ack`), `/api/alert-rules`, `/api/audit` (+`/verify`), `/api/admins`, `/api/roles`, `/api/settings`.
* **Device:** `POST /device/enroll`, `POST /device/sync`, `POST /device/commands/:cmdId`, `POST /device/logs?kind=`, `GET /device/apps/:versionId/download`, `WS /device/ws`, public `GET /agent/kk-agent.apk`.

**Commands:** `refresh_status, restart_app, reboot, lock, apply_policy, kiosk_exit_temp, kiosk_relock, lost_mode_on, lost_mode_off, locate, pull_logs, bugreport, install_app, uninstall_app, wipe, release_device_owner` (the last is dev only and disabled in production unless `ALLOW_RELEASE=true`).

---

## 8. Kiosk / Device Owner implementation, and the POS changes it needs

**How the kiosk works**
* `HomeActivity` is the **persistent preferred HOME**. It pins itself (`startLockTask`) and starts the POS with `ActivityOptions.setLockTaskEnabled(true)`.
* When the POS crashes, is force-stopped, finishes or is updated, Android returns to HOME, which relaunches it. Verified: force-stop, restart command, agent update and reboot all came back LOCKED.
* `bringHomeToFront` must use a real `CATEGORY_HOME` intent. An explicitly started HomeActivity is not the system's home, and the stock launcher surfaced on the first force-stop test. That is fixed.
* Lock task allowlist: agent + `kiosk.primaryPackage` + `kiosk.allowedPackages`. Features default to SYSTEM_INFO only (clock and battery), with no home, recents, notifications or global actions.
* Restrictions applied (on by default): no install/uninstall/unknown sources, factory reset, safe boot, add user, debugging, screen capture, date/time config, VPN config, mobile networks, USB file transfer, physical media. Wi-Fi and Bluetooth config stay allowed, so staff can reconnect Wi-Fi in technician mode.
* **Watchdog:** a POS exit within 15 s of launch counts as a crash. Five in 2 min is a crash loop, which backs off from 30 s up to 5 min and alerts. Every heartbeat re-checks lock task and restores it if it has drifted. `onLockTaskModeExiting` self-heals after 1.5 s.
* **Technician escape:**
  * The PIN is a TOTP over a per-device seed with a 5-min step and ±1 step tolerance. It works offline.
  * It is issued from the dashboard (Device → Technician PIN, audit-logged) and entered on the agent's Technician screen.
  * It opens technician mode for `technician.escapeMinutes` (default 15): Settings, Wi-Fi and POS become reachable, with automatic re-lock by alarm.
  * Five wrong PINs lock the screen for 5 min.
  * The dashboard can also do this remotely (`kiosk_exit_temp` / `kiosk_relock`).
* The agent's HOME screen is only visible for a moment, so the 7-tap gesture is mainly a fallback. The POS should offer an entry point (below).

**Changes to the KnotKitchen POS app (`pos-frontend`)**
1. **Managed configuration: done.**
   * `ManagedDevice.java` reads `RestrictionsManager.getApplicationRestrictions()`; the keys are declared in `res/xml/app_restrictions.xml`.
   * `ManagedDevicePlugin` (`getConfig`, `openTechnician`, a `configChanged` event on `ACTION_APPLICATION_RESTRICTIONS_CHANGED`) hands it to the pages through `src/utils/managedDevice.js`.
   * Keys: `kkmdm_device_id, kkmdm_device_name, kkmdm_server, store_id, restaurant_id, store_name, terminal_name, device_group, pos_updates`.
   * Sign-in prefills the Store ID from `store_id`.
   * Still open: printing `terminal_name` on receipts and KOTs.
2. **Technician entry: done.** Settings → Device Configuration shows a "Managed tablet" card only on managed tablets: terminal, store, group, who installs updates, and a **Technician mode** button that opens the agent's PIN screen (`com.knotkitchen.mdm.action.TECHNICIAN`). The PIN gate is the agent's, so the button is safe to show.
3. **Stay inside the kiosk.** Don't open the external browser, Settings, the Play Store or share sheets. UPI intents (`UpiIntentPlugin`) open other apps, which lock task blocks unless their packages are in `kiosk.allowedPackages`. Either list the UPI apps a store uses in its policy, or use in-app or QR UPI flows on kiosk devices.
4. **`ShellUpdater` keeps working on managed tablets: done.**
   * **The problem:** the kiosk policy sets `DISALLOW_INSTALL_APPS`, which also blocks the POS installing its own update.
   * **The handoff:** the POS still checks the GitHub manifest and offers "Install". On a managed tablet it then sends `com.knotkitchen.mdm.action.INSTALL_POS_UPDATE` (apkUrl, sha256, versionCode) to the agent, which installs it as Device Owner (`PosUpdateReceiver`, via `AppInstaller`). HOME reopens the new POS, still locked.
   * **Checks, because any app can send that broadcast:** the request must be for the kiosk's POS, from https or the KKMDM server, with a SHA-256, and newer than the installed version. Android itself refuses an APK signed with another key.
   * **Who owns updates:** the server sets managed config `pos_updates=kkmdm` once a POS build is pinned, rolled out or made stable for the device. The POS updater then stays quiet and the agent refuses handoffs, so the two never fight over the version. Otherwise it is `pos_updates=self`.
   * **Tested on the Slate:**
     * The agent downloaded and verified POS 1.0.185 and committed it. Android rejected it with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, because the tablet's POS 1.0.179 is a debug-signed sideload, not the release key.
     * Requests that were not https, not newer, or had no SHA-256 were refused.
     * A production-signed tablet takes the update; this tablet needs a release-signed POS reinstall first.
5. **USB printers:** Android's USB permission dialog comes from System UI. Under lock task it shows on most OEMs, but **test it per model**. Where it is blocked, grant the permission once during technician mode (tick "always").
6. **Lock-task safe UI:** no reliance on Home or Recents; handle `onBackPressed` on the root screen (the agent reopens the POS if it exits, which is fine but slower).

---

## 9. Dashboard information architecture

Navigation (left rail; each item is hidden without its permission):
* Dashboard
* Devices
* Stores
* Groups
* Applications
* Policies
* Enrollment
* Remote Actions
* Alerts
* Activity / Audit
* Settings
* Admin Users

| Screen | Contents |
|---|---|
| Dashboard | KPI tiles (total, online, offline, low battery, outdated POS, kiosk errors, non-compliant, pending enrollments). Each tile links to the filtered device list. Recent alerts. Rollouts in progress. Live push count. |
| Devices | Search; store/status/lifecycle selects; toggle filters; bulk select + bulk action (whole fleet needs re-auth); CSV export. Columns: name/serial, store/group, status, last seen, battery, Android, POS, model, network, kiosk, policy compliance. |
| Device detail | Header with quick actions (restart POS, refresh, reboot, lock, technician PIN). Tabs: Info (edit/inventory/retire/rotate credential), Status, Application, Kiosk, Network, Battery (24 h chart), Storage, Policy (effective + per-key source + compliance), Activity, Remote Actions (all commands + history), Logs. |
| Enrollment | QR generator (store, group, policy, name, single/batch, TTL, optional Wi-Fi). Full-screen QR with countdown. ADB fallback command. Token list with revoke. Recent attempts. Printable setup card. |
| Applications | APK upload (parsed and verified), versions with install counts, set stable, staged rollouts (pilot → % → all, pause/resume/complete/rollback). |
| Policies | List, JSON override editor with defaults reference, assignment to company. Store and group assignment are on their own pages. |
| Stores | Synced list (KK store ID/status), device counts, store policy, maintenance window, business hours. |
| Alerts | Open/acknowledged/resolved list. Rules per type/store with threshold, business-hours flag, webhook/email. |
| Audit | Filterable log; "Verify integrity" walks the hash chain. |
| Settings | Server/agent info, 2FA setup, password change. |
| Admin Users | Users, role changes (end their sessions), disable, reset 2FA, create (store users pick stores), role/permission matrix. |

---

## 10. Organisation, roles, security

* **Hierarchy:** Company → Store → Group (optional) → Device. `parentCompanyId` reserves a reseller layer above.
* **Store sync:** `lib/storeSync.js` reads pos-backend's `stores` (read-only, `secondaryPreferred`) every 6 h or on demand. It upserts by `kkStoreId`, maps `restaurantId`, and archives deleted or closed stores.
* **RBAC** (`lib/rbac.js`, enforced per route by `requirePerm`, store scoping by `scopeFilter`):

| Role | Can |
|---|---|
| Super Admin | everything, incl. **wipe**, admin users, settings |
| Admin | devices, stores, groups, policies, enrollment, apps, rollouts, alerts, bulk, lost mode, technician PIN. **No wipe**, no admin users |
| Support Agent | view, restart app/device, refresh, lock, pull logs, technician PIN. No wipe, no policy edits, no enrollment |
| Store User | own stores' devices only (list and detail are filtered server side), restart app, view alerts |

* **Admin auth:**
  * bcrypt passwords: 12+ characters with upper case, lower case and a digit.
  * Lockout after 5 failures for 15 min.
  * TOTP 2FA (RFC 6238). Production logins prompt to enrol.
  * 60-min sliding JWT session in an httpOnly SameSite=Strict cookie, plus the `X-KKMDM` CSRF header.
  * `sessionVersion` revokes every session of a user.
  * Last login IP and time are kept, and login success and failure are audit-logged.
  * **Re-auth** within 5 min is required for wipe, release and fleet-wide bulk.
  * `ssoSubject` is reserved for SSO (OIDC) later.
* **Security:**
  * TLS terminated by Caddy. Agent certificate pinning via `-PkkmdmCertPins=sha256/…`; pin the intermediate *and* a backup key.
  * Secrets at rest: technician seeds and TOTP secrets use AES-256-GCM (`DATA_ENCRYPTION_KEY`; move to a KMS-wrapped data key when on a cloud KMS).
  * Immutable hash-chained audit log, and a device activity log (`deviceevents`).
* **DPDP Act 2023:**
  * Data is minimised: no personal data about staff, and IMEI/serial only for asset management.
  * Location only when `location.enabled`, for lost-device recovery. Purpose documented here. Off by default. SSID is reported only when location is permitted (an Android rule).
  * Retention: raw telemetry 90 days, then daily roll-ups; audit indefinitely.
* **Backups/DR:** include the `kkmdm` database in `deploy/backup.sh` (same mongodump schedule as `knotkitchen`) and `server/storage` (APKs, logs). Restore order: Mongo → storage → server. Tablets keep running their kiosk offline and catch up when the server is back. **The agent signing key is not in the backup by design** (see key custody).

---

## 11. Phases and status

| Phase | Item | Status |
|---|---|---|
| 1 | QR enrollment (payload, tokens, provisioning intents) | Built; QR scan not yet tested on hardware (needs a public HTTPS URL) |
| 1 | Device Owner agent, kiosk lock, auto-recovery | **Built + verified on Slate/Android 10** |
| 1 | Heartbeat, device list/detail | Built + verified |
| 1 | Reboot/lock/restart app | Built + verified (reboot, restart) |
| 1 | Single-use tokens, RBAC, audit log | Built + automated tests |
| 2 | APK repo + staged rollouts | Built; agent self-update verified on device; staged POS rollout needs a POS APK uploaded |
| 2 | Policies with inheritance | Built + tests |
| 2 | Maintenance windows | Built (commands, desired apps, OS updates) |
| 2 | Alerts | Built (webhook; email logs until SMTP is configured) |
| 2 | Support / Store User roles | Built + tests |
| 2 | Technician OTP escape | **Built + verified on device** |
| 3 | Batch enrollment | Built + test |
| 3 | Zero-touch / Knox | Designed (§5), not configured |
| 3 | Lost mode | Built, not tried on device |
| 3 | FRP | Built (Android 11+ only) |
| 3 | Log pull | Built + verified (agent log + logcat) |
| 3 | Bug report | Built (needs on-device consent) |
| 3 | Store sync | Built + verified against local KnotKitchen DB |
| 3 | Reporting/CSV | CSV export built |
| 3 | Remote view | Not built (see §1) |
| — | FCM wake-up | Seam in `lib/push.js`; needs a Firebase project |
| — | Play Integrity | Not built |

### Acceptance tests

| Test | Result |
|---|---|
| Reset → 6 taps → scan → POS locked in ~5 min | **Not run yet.** Needs `PUBLIC_URL` on HTTPS (staging) and a factory reset. ADB enrollment on the same tablet reached "POS open and locked" in ~3 s after enroll |
| Reused/expired token rejected and logged | Pass (device + `api.test.js`) |
| Staff can't reach Home/Settings/notifications/other apps or install | Pass on Slate (Home, Recents, Settings and browser intents blocked; restrictions verified via `dumpsys user`). Peripherals not tested (no printer attached) |
| Kill POS / reboot / power loss → back in kiosk | Force-stop, restart command, agent update and reboot pass. Power pull not tested (same path as reboot) |
| Offline command executes after reconnect | Pass (queued while unreachable → succeeded after reconnect) |
| Staged update pilot → fleet, rollback | Logic unit-tested; on-device run pending a POS APK |
| Support Agent cannot wipe / edit policies (API) | Pass (`api.test.js`) |

**Test matrix:** every model × Android version in the fleet. Emulator: `adb shell dpm set-device-owner com.knotkitchen.mdm/.AdminReceiver` on an AVD without accounts.
