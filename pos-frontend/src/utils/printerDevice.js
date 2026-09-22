/**
 * The receipt printer attached to THIS device.
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
 *   (LAN is not offered yet.)
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

/**
 * The config from before it was kept per takeaway was one shared record. It
 * goes to the first takeaway that reads it, so an existing till keeps its
 * printer; every other takeaway starts unset instead of inheriting it.
 */
export const loadPrinterConfig = () => {
  const config = { ...DEFAULT_CONFIG, ...readStoreScoped(KEY, {}) };
  try {
    // Signed out the scoped key IS the bare key: claiming would delete what was just read.
    if (storeScopedKey(KEY) !== KEY && localStorage.getItem(KEY) !== null) {
      writeStoreScoped(KEY, config);
      // Only once the copy is really there (writes can fail in private mode).
      if (localStorage.getItem(storeScopedKey(KEY)) !== null) localStorage.removeItem(KEY);
    }
  } catch {
    /* private mode */
  }
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
        "Choose \"Use the computer's printer driver\" instead.",
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

let bt = null; // { device, characteristic }

/** Services every BLE device has and none prints through (Generic Access/Attribute, Device Info, Battery). */
const STANDARD_SERVICE = /^0000(1800|1801|180a|180f)-/;

const connectBluetooth = async (device) => {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
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
  bt = { device, characteristic: found[0].ch };
  return bt;
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
  return { name: device.name || "Bluetooth printer", bluetooth: { id: device.id } };
};

const bluetoothFor = async (config) => {
  if (bt && bt.device.id === config.bluetooth?.id) {
    if (!bt.device.gatt.connected) await connectBluetooth(bt.device);
    return bt;
  }
  // Chrome only hands back a previously chosen device where getDevices is
  // enabled; elsewhere the printer has to be chosen again after a reload.
  if (navigator.bluetooth.getDevices) {
    const match = (await navigator.bluetooth.getDevices()).find((d) => d.id === config.bluetooth?.id);
    if (match) return connectBluetooth(match);
  }
  const err = new Error("The Bluetooth printer needs reconnecting. Open Settings > Device Configuration and press Connect.");
  err.code = "BT_RECONNECT";
  throw err;
};

/* ---------------------------------------------------------------- Send -- */

// Calibration knobs: BLE printers differ in how much they take per write.
export const BLE_CHUNK = 180;
export const USB_CHUNK = 16384;

/** Send a print job to the configured USB or Bluetooth printer. */
export const sendToPrinter = async (config, bytes) => {
  if (nativePrinting && (config.type === "usb" || config.type === "bluetooth")) {
    const cat = config.protocol === "cat";
    await ThermalPrinter.print({
      type: config.type,
      data: toBase64(bytes),
      address: config.bluetooth?.address,
      vendorId: config.usb?.vendorId,
      productId: config.usb?.productId,
      // The mini printers are BLE only, whatever the pairing says, and pace
      // at about 20 ms per write.
      ble: cat,
      pace: cat ? 20 : 5,
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
    return;
  }
  throw new Error("No receipt printer is set up on this device.");
};
