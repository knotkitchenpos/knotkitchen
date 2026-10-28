/**
 * The printers attached to THIS device: a receipt printer (bills and
 * reports) and, optionally, a kitchen printer for KOTs (the `kitchen` slot of
 * the same record; unset, KOTs print on the receipt printer).
 *
 * Kept on the device, not the restaurant: the printer is physically plugged
 * into (or paired with) one laptop or tablet, and two tills each with their
 * own printer must not both print every order. And per takeaway on that
 * device: one till signed into Takeaway 1 and Takeaway 2 keeps a separate
 * printer, paper size and auto-print switches for each.
 *
 * Transports
 *   usb        WebUSB, raw ESC/POS. Chrome/Edge on Android, ChromeOS, macOS,
 *              Linux. On Windows the installed printer driver owns the device
 *              and the browser cannot claim it -- that case is "system".
 *   bluetooth  Web Bluetooth (BLE), raw ESC/POS. Chrome/Edge.
 *   system     The browser's print dialog, through the computer's own driver.
 *              Silent only when Chrome runs with --kiosk-printing.
 *   lan        raw ESC/POS over TCP to the printer's port 9100, by its IP
 *              address. Only in the Android and Windows apps: a browser
 *              cannot open a socket.
 *
 * In the Android app neither WebUSB nor Web Bluetooth exists, so usb and
 * bluetooth go through the app's ThermalPrinter plugin instead
 * (android/.../ThermalPrinterPlugin.java). That also reaches classic Bluetooth
 * printers, which most cheap thermal printers are and no browser can use.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";
import { readStoreScoped, storeScopedKey, writeStoreScoped } from "./storeSession.js";

/** True inside the Android app. */
export const nativePrinting = Capacitor.isNativePlatform();
const ThermalPrinter = registerPlugin("ThermalPrinter");

const KEY = "kk.receiptPrinter.v1";

/**
 * protocol: "escpos" for receipt printers; "cat" for the 57 mm mini printers (see utils/catprinter.js).
 * autoPrint: a receipt for every new order. kotPrint: a kitchen ticket for every new order and table round.
 */
export const DEFAULT_CONFIG = { type: "", name: "", paper: "80", autoPrint: false, kotPrint: false, protocol: "escpos" };

/** Where KOTs print: the kitchen slot when one is set up, else the receipt printer. */
export const kitchenPrinter = (config) => (config?.kitchen?.type ? { ...DEFAULT_CONFIG, ...config.kitchen } : config);

/** The printer another takeaway set up on this device, if any. */
const anyTakeawayConfig = () => {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(`${KEY}:`)) continue;
      const config = JSON.parse(localStorage.getItem(key));
      if (config?.type) return config; // a takeaway that never set one up has nothing to pass on
    }
  } catch {
    /* private mode */
  }
  return null;
};

/**
 * A takeaway with no settings of its own yet starts from this device's
 * printer -- the shared record from before settings were per takeaway, or
 * another takeaway's -- and keeps that copy as its own, so changes in one
 * takeaway never reach another.
 *
 * It used to START BLANK instead: the old shared record went to whichever
 * takeaway read it first and was deleted, and every other takeaway on the
 * device silently lost its printer and Auto KOT.
 */
export const loadPrinterConfig = () => {
  try {
    const own = localStorage.getItem(storeScopedKey(KEY));
    if (own !== null) return { ...DEFAULT_CONFIG, ...JSON.parse(own) };
  } catch {
    /* unreadable: fall through to the device's printer */
  }
  const legacy = readStoreScoped(KEY, null);
  const inherited = legacy?.type ? legacy : anyTakeawayConfig() || legacy;
  const config = { ...DEFAULT_CONFIG, ...(inherited || {}) };
  // Kept only once there is a printer to keep (a blank copy would block a
  // later inherit). Signed out the scoped key IS the bare key: nothing to copy.
  if (inherited?.type && storeScopedKey(KEY) !== KEY) writeStoreScoped(KEY, config);
  return config;
};

export const savePrinterConfig = (config) => {
  const next = { ...DEFAULT_CONFIG, ...config };
  writeStoreScoped(KEY, next); // private mode: the choice lasts for this page only
  return next;
};

export const supports = {
  usb: () => nativePrinting || (typeof navigator !== "undefined" && Boolean(navigator.usb)),
  bluetooth: () => nativePrinting || (typeof navigator !== "undefined" && Boolean(navigator.bluetooth)),
};

/**
 * App only: the printers this phone can print to right now. Bluetooth lists
 * the devices already PAIRED in Android settings; USB, the ones plugged in.
 */
export const listNativePrinters = async (kind) => {
  if (kind === "usb") {
    const { devices } = await ThermalPrinter.listUsb();
    return devices.map((d) => ({ name: d.name, usb: { vendorId: d.vendorId, productId: d.productId } }));
  }
  const { devices } = await ThermalPrinter.listBluetooth();
  return devices.map((d) => ({ name: d.name, bluetooth: { address: d.address } }));
};

/** Uint8Array to base64, in slices: spreading 100 KB into one call overflows the stack. */
const toBase64 = (bytes) => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- LAN -- */

/** A printer's address on this network: private IPv4 only (the apps refuse anything else too). */
export const isLanIp = (host) => {
  const m = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(String(host ?? "").trim());
  if (!m) return false;
  const [a, b, ...rest] = m.slice(1).map(Number);
  if ([a, b, ...rest].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
};

const UPDATE_FOR_LAN = "Update the KnotKitchen POS app to use a LAN printer.";

/**
 * Raw ESC/POS to a LAN printer's port 9100, through the Android or Windows
 * app; with no bytes it only checks a printer answers. A browser cannot open
 * a TCP connection at all, and an app from before LAN printing says to update.
 */
const lan = async (host, bytes) => {
  try {
    if (nativePrinting) {
      return bytes ? await ThermalPrinter.print({ type: "lan", host, data: toBase64(bytes) }) : await ThermalPrinter.probeLan({ host });
    }
    if (typeof window.knotDesktop?.printLan === "function") return await window.knotDesktop.printLan(host, bytes || null);
  } catch (err) {
    if (err?.code === "UNIMPLEMENTED") throw new Error(UPDATE_FOR_LAN);
    // Electron prefixes the main process's message.
    throw new Error(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
  }
  throw new Error(window.knotDesktop ? UPDATE_FOR_LAN : "A browser cannot reach a network printer. Use the KnotKitchen POS app on Android or Windows.");
};

/** Whether this device can print to a LAN printer at all (the apps can; a browser cannot). */
export const lanPrinting = () => nativePrinting || typeof window.knotDesktop?.printLan === "function";

/** Resolves when a printer answers at host:9100; prints nothing. */
export const probeLanPrinter = (host) => lan(host, null);

/* ------------------------------------------------------------------ USB -- */

let usb = null; // { device, endpoint }

const describeUsb = (d) => d.productName || `USB device ${d.vendorId.toString(16)}:${d.productId.toString(16)}`;

const openUsb = async (device) => {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  // The printer-class interface if there is one, else any interface with a
  // bulk OUT endpoint (many cheap printers report a vendor class).
  const candidates = device.configuration.interfaces
    .map((iface) => ({ iface, alt: iface.alternate }))
    .filter(({ alt }) => alt.endpoints.some((e) => e.direction === "out" && e.type === "bulk"))
    .sort((a, b) => (b.alt.interfaceClass === 7) - (a.alt.interfaceClass === 7));
  if (!candidates.length) throw new Error("This USB device is not a printer.");
  const { iface, alt } = candidates[0];
  try {
    if (!iface.claimed) await device.claimInterface(iface.interfaceNumber);
  } catch {
    throw new Error(
      "The computer's printer driver is using this USB printer, so the browser cannot reach it. " +
        "Install the KnotKitchen POS Windows app to print through that driver.",
    );
  }
  const endpoint = alt.endpoints.find((e) => e.direction === "out" && e.type === "bulk").endpointNumber;
  usb = { device, endpoint };
  return usb;
};

/** Show the browser's USB device list and connect to the one chosen. */
export const chooseUsbPrinter = async () => {
  if (!supports.usb()) throw new Error("This browser cannot use USB printers. Open the POS in Chrome or Edge.");
  const device = await navigator.usb.requestDevice({ filters: [] });
  await openUsb(device);
  return {
    name: describeUsb(device),
    usb: { vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber || "" },
  };
};

const usbFor = async (config) => {
  // Only if it is this takeaway's printer: after switching takeaway in the same
  // tab, the open device may be the other one's.
  const sameUsb = (d) =>
    d.vendorId === config.usb?.vendorId &&
    d.productId === config.usb?.productId &&
    (!config.usb?.serialNumber || d.serialNumber === config.usb.serialNumber);
  if (usb && usb.device.opened && sameUsb(usb.device)) return usb;
  // A device the user already allowed comes back without asking again.
  const devices = await navigator.usb.getDevices();
  const match = devices.find(sameUsb);
  if (!match) throw new Error("The USB printer is not connected. Check the cable, then choose it again in Device Configuration.");
  return openUsb(match);
};

/* ------------------------------------------------------------ Bluetooth -- */

// Services the common BLE receipt printers expose their write characteristic
// under. Web Bluetooth only lets a page use services it names up front.
const PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000af30-0000-1000-8000-00805f9b34fb",
];

// saved bluetooth.id -> { device, characteristic }: a receipt and a kitchen printer stay connected together.
const bts = new Map();

/** Services every BLE device has and none prints through (Generic Access/Attribute, Device Info, Battery). */
const STANDARD_SERVICE = /^0000(1800|1801|180a|180f)-/;

const ASLEEP = "The Bluetooth printer is not answering. Switch it on (it turns itself off when idle), then print again.";
// Calibration knob: Chrome on Android has no connect timeout, and a printer that went to sleep held the job ~30 s.
const CONNECT_MS = 10000;

const gattConnect = (device) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(ASLEEP)), CONNECT_MS);
  });
  return Promise.race([device.gatt.connect(), timeout])
    .catch((err) => {
      device.gatt.disconnect?.();
      // Chrome's own text ("Bluetooth Device is no longer in range") read as "disconnected".
      throw err?.name === "NetworkError" || err?.message === ASLEEP ? new Error(ASLEEP) : err;
    })
    .finally(() => clearTimeout(timer));
};

/** Connect and keep the link under `key`: the saved id, which a re-chosen device may not share. */
const connectBluetooth = async (device, key = device.id) => {
  const server = device.gatt.connected ? device.gatt : await gattConnect(device);
  // The first writable characteristic anywhere was sometimes a standard one
  // (a device-name field, say): the job was "sent", nothing printed. Prefer a
  // known printer service, never a standard one, and a characteristic that
  // takes unacknowledged writes.
  const found = [];
  for (const service of await server.getPrimaryServices()) {
    if (STANDARD_SERVICE.test(service.uuid)) continue;
    for (const ch of await service.getCharacteristics()) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) {
        found.push({ ch, score: (PRINTER_SERVICES.includes(service.uuid) ? 2 : 0) + (ch.properties.writeWithoutResponse ? 1 : 0) });
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  if (!found.length) throw new Error("This Bluetooth device does not accept print data.");
  const link = { device, characteristic: found[0].ch };
  bts.set(key, link);
  return link;
};

export const bluetoothAvailable = async () => {
  if (nativePrinting) {
    try {
      return (await ThermalPrinter.available()).bluetoothOn;
    } catch {
      return true;
    }
  }
  if (!supports.bluetooth()) return false;
  try {
    return await navigator.bluetooth.getAvailability();
  } catch {
    return true;
  }
};

/** Show nearby Bluetooth devices and connect to the one chosen. */
export const chooseBluetoothPrinter = async () => {
  if (!supports.bluetooth()) {
    throw new Error("This browser cannot use Bluetooth printers. Open the POS in Chrome or Edge.");
  }
  if (!(await bluetoothAvailable())) throw new Error("Bluetooth is off on this device. Turn it on and try again.");
  const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
  await connectBluetooth(device);
  // The name lets Reconnect show only this printer.
  return { name: device.name || "Bluetooth printer", bluetooth: { id: device.id, name: device.name || "" } };
};

/** `err` offering Reconnect: the browser's chooser for `config` (printer: what Reconnect asks it for). */
const needsChooser = (err, config) => Object.assign(err, { code: "BT_RECONNECT", printer: config });

/** The link to this printer, reconnected at print time when it dropped (the printer slept). */
const bluetoothFor = async (config) => {
  const cached = bts.get(config.bluetooth?.id);
  if (cached) return cached.device.gatt.connected ? cached : connectBluetooth(cached.device, config.bluetooth.id);
  // After a reload or a discarded tab: Chrome hands back a printer chosen
  // before only where getDevices is enabled; elsewhere it must be chosen again.
  if (navigator.bluetooth.getDevices) {
    const match = (await navigator.bluetooth.getDevices()).find((d) => d.id === config.bluetooth?.id);
    // Chrome may not have seen a remembered printer since it restarted and then
    // never connects to it, awake or not; the chooser scans and finds it.
    if (match) return connectBluetooth(match).catch((err) => { throw needsChooser(err, config); });
  }
  throw needsChooser(new Error("The browser needs the Bluetooth printer chosen again: tap Reconnect."), config);
};

/**
 * From a tap (the browser shows its chooser only then): the chooser again,
 * listing just this printer, and the link kept under the saved id.
 */
export const reconnectBluetoothPrinter = async (config) => {
  const name = config.bluetooth?.name;
  const device = await navigator.bluetooth.requestDevice({
    ...(name ? { filters: [{ name }] } : { acceptAllDevices: true }),
    optionalServices: PRINTER_SERVICES,
  });
  await connectBluetooth(device, config.bluetooth?.id);
};

/** False when this page has no link to the Web Bluetooth printer and printing needs Reconnect first. */
export const bluetoothLinked = (config) => nativePrinting || config?.type !== "bluetooth" || bts.has(config.bluetooth?.id);

/* ---------------------------------------------------------------- Send -- */

// Calibration knobs: BLE printers differ in how much they take per write.
export const BLE_CHUNK = 180;
export const USB_CHUNK = 16384;

const writeBluetooth = async (config, bytes) => {
  const { characteristic } = await bluetoothFor(config);
  const fast = characteristic.properties.writeWithoutResponse;
  for (let at = 0; at < bytes.length; at += BLE_CHUNK) {
    const chunk = bytes.slice(at, at + BLE_CHUNK);
    if (fast) {
      await characteristic.writeValueWithoutResponse(chunk);
      // Unacknowledged writes can outrun the printer's buffer. The mini
      // printers have a small one and pace at about 20 ms per write.
      await sleep(config.protocol === "cat" ? 20 : 4);
    } else {
      await characteristic.writeValueWithResponse(chunk);
    }
  }
};

// One Web Bluetooth job at a time per printer: Chrome refuses a write while
// another is pending ("GATT operation already in progress"), and the second of
// a KOT and a receipt sent together was lost.
const btJobs = new Map();

/** Send a print job to the configured USB, Bluetooth or LAN printer. */
export const sendToPrinter = async (config, bytes) => {
  if (config.type === "lan") return lan(config.lan?.host, bytes);
  if (nativePrinting && (config.type === "usb" || config.type === "bluetooth")) {
    const cat = config.protocol === "cat";
    await ThermalPrinter.print({
      type: config.type,
      data: toBase64(bytes),
      address: config.bluetooth?.address,
      // Answers the printer's own pairing request when, switched off and on,
      // it forgot the pairing: no "Bluetooth pairing request" dialog.
      pin: config.pin || "",
      vendorId: config.usb?.vendorId,
      productId: config.usb?.productId,
      // The mini printers are BLE only, whatever the pairing says, and pace
      // at about 20 ms per write. A receipt printer needs no pause: each
      // write already waits for the printer's acknowledgement, and the 5 ms
      // added ~17 s to a 3-inch receipt over 20-byte BLE writes.
      ble: cat,
      pace: cat ? 20 : 0,
    });
    return;
  }
  if (config.type === "usb") {
    const { device, endpoint } = await usbFor(config);
    for (let at = 0; at < bytes.length; at += USB_CHUNK) {
      await device.transferOut(endpoint, bytes.subarray(at, at + USB_CHUNK));
    }
    return;
  }
  if (config.type === "bluetooth") {
    const key = config.bluetooth?.id;
    const job = (btJobs.get(key) || Promise.resolve()).then(() => writeBluetooth(config, bytes));
    btJobs.set(key, job.catch(() => {})); // a failed job never blocks the next
    return job;
  }
  throw new Error("No receipt printer is set up on this device.");
};
