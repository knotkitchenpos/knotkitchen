const crypto = require("crypto");
const config = require("../config");
const { Policy, PolicyAssignment, Device, Store, Group } = require("../models");

/**
 * Every setting a device understands, with its built-in value. A policy only
 * stores the keys it overrides; resolution layers
 * built-in -> company -> store -> group -> device, last one wins.
 */
const DEFAULT_SETTINGS = {
  kiosk: {
    enabled: true,
    primaryPackage: config.posPackage,
    // Companion apps that may run inside the kiosk (payment, printer).
    allowedPackages: [],
    autoStart: true,
    // Lock task features left ON (everything else is hidden).
    showSystemInfo: true,
    showNotifications: false,
    showHome: false,
    showOverview: false,
    showGlobalActions: false,
    showKeyguard: false,
    disableStatusBar: true,
    disableKeyguard: true,
  },
  restrictions: {
    blockSettings: true,
    hidePlayStore: true,
    blockInstallApps: true,
    blockUninstallApps: true,
    blockUnknownSources: true,
    blockFactoryReset: true,
    blockSafeBoot: true,
    blockAddUser: true,
    blockDebugging: true,
    blockScreenCapture: true,
    blockConfigWifi: false,
    blockConfigBluetooth: false,
    blockConfigDateTime: true,
    blockConfigVpn: true,
    blockConfigMobileNetworks: true,
    // MTP/PTP off; USB host peripherals (printers, scanners) keep working.
    blockUsbFileTransfer: true,
    blockMountMedia: true,
    blockAdjustVolume: false,
  },
  display: {
    screenTimeoutSec: 1800,
    stayOnWhilePlugged: true,
    // null = leave the user/auto setting alone; 0..255 forces a value.
    brightness: null,
  },
  audio: {
    // Order alerts must stay audible.
    minVolumePercent: 60,
  },
  network: {
    wifiProfiles: [], // [{ ssid, security: "WPA"|"OPEN", password }]
    bluetooth: "allow", // allow | block
    privateDns: { mode: "off", host: "" }, // off | opportunistic | host
    alwaysOnVpn: { package: "", lockdown: false },
  },
  time: {
    autoTimeRequired: true,
    timeZone: "Asia/Kolkata",
  },
  systemUpdates: {
    mode: "windowed", // automatic | windowed | postpone | none
    useMaintenanceWindow: true,
    windowStart: "03:00",
    windowEnd: "06:00",
  },
  security: {
    // Android 11+: Google accounts allowed to unlock a reset device.
    frpAccounts: [],
  },
  location: {
    // DPDP: collected only when enabled here, for lost-device recovery.
    enabled: false,
  },
  telemetry: {
    heartbeatSeconds: 60,
  },
  technician: {
    escapeMinutes: 15,
  },
  watchdog: {
    relaunchDelaySec: 2,
    crashLoopThreshold: 5,
    crashLoopWindowSec: 120,
  },
  // Extra managed-configuration keys passed to the POS app.
  managedConfig: {},
};

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/** Merges `over` onto `base`; arrays and scalars replace, objects merge. */
function deepMerge(base, over, sourceLabel, sources, prefix = "") {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && isPlainObject(base?.[k])) {
      out[k] = deepMerge(base[k], v, sourceLabel, sources, key);
    } else if (v !== undefined) {
      out[k] = v;
      if (sources) sources[key] = sourceLabel;
    }
  }
  return out;
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

function hashSettings(settings) {
  return crypto.createHash("sha256").update(stableStringify(settings)).digest("hex").slice(0, 16);
}

/**
 * Effective policy for a device, with where each key came from.
 * Returns { settings, sources, layers, hash, policyId }.
 */
async function resolveForDevice(deviceOrId) {
  const device = deviceOrId?._id ? deviceOrId : await Device.findById(deviceOrId).lean();
  if (!device) throw new Error("device not found");
  const levels = [
    ["company", device.companyId],
    ["store", device.storeId],
    ["group", device.groupId],
    ["device", device._id],
  ].filter(([, id]) => id);

  const assignments = await PolicyAssignment.find({
    $or: levels.map(([scope, targetId]) => ({ scope, targetId })),
  }).lean();
  const policies = await Policy.find({ _id: { $in: assignments.map((a) => a.policyId) } }).lean();
  const byId = new Map(policies.map((p) => [String(p._id), p]));

  let settings = structuredClone(DEFAULT_SETTINGS);
  const sources = {};
  const layers = [];
  let mostSpecific = null;
  for (const [scope, targetId] of levels) {
    const a = assignments.find((x) => x.scope === scope && String(x.targetId) === String(targetId));
    const p = a && byId.get(String(a.policyId));
    if (!p) continue;
    settings = deepMerge(settings, p.settings, `${scope}:${p.name}`, sources);
    layers.push({ scope, policyId: p._id, name: p.name, version: p.version });
    mostSpecific = p;
  }

  // The store's maintenance window drives the OS update window.
  if (settings.systemUpdates?.useMaintenanceWindow && device.storeId) {
    const store = await Store.findById(device.storeId, { maintenanceWindow: 1 }).lean();
    if (store?.maintenanceWindow) {
      settings.systemUpdates.windowStart = store.maintenanceWindow.start;
      settings.systemUpdates.windowEnd = store.maintenanceWindow.end;
    }
  }
  return { settings, sources, layers, hash: hashSettings(settings), policyId: mostSpecific?._id || null };
}

/**
 * Managed configuration handed to the POS app through the agent.
 * pos_updates says who installs POS updates: "kkmdm" when an uploaded POS
 * build is desired for this device (pin, rollout or stable), so the POS's own
 * updater stays quiet; else "self", and the POS's updater hands its download
 * to KK Agent, which installs it (the kiosk policy blocks the POS doing so).
 */
async function managedConfigFor(device, desiredApps = []) {
  const [store, group] = await Promise.all([
    device.storeId ? Store.findById(device.storeId).lean() : null,
    device.groupId ? Group.findById(device.groupId).lean() : null,
  ]);
  return {
    kkmdm_device_id: String(device._id),
    kkmdm_device_name: device.name,
    kkmdm_server: config.publicUrl,
    store_id: store?.kkStoreId || "",
    restaurant_id: store?.kkRestaurantId || "",
    store_name: store?.name || "",
    terminal_name: device.name,
    device_group: group?.name || "",
    pos_updates: desiredApps.some((a) => a.packageName === config.posPackage) ? "kkmdm" : "self",
  };
}

module.exports = { DEFAULT_SETTINGS, deepMerge, resolveForDevice, managedConfigFor, hashSettings, stableStringify };
