/**
 * The receipt printer attached to THIS device.
 *
 * Kept on the device, not the restaurant: the printer is physically plugged
 * into (or paired with) one laptop or tablet, and two tills each with their
 * own printer must not both print every order.
 *
 * Transports
 *   usb        WebUSB, raw ESC/POS. Chrome/Edge on Android, ChromeOS, macOS,
 *              Linux. On Windows the installed printer driver owns the device
 *              and the browser cannot claim it -- that case is "system".
 *   bluetooth  Web Bluetooth (BLE), raw ESC/POS. Chrome/Edge.
 *   system     The browser's print dialog, through the computer's own driver.
 *              Silent only when Chrome runs with --kiosk-printing.
 *   (LAN is not offered yet.)
 */

const KEY = "kk.receiptPrinter.v1";

export const DEFAULT_CONFIG = { type: "", name: "", paper: "80", autoPrint: false };

export const loadPrinterConfig = () => {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
};

export const savePrinterConfig = (config) => {
  const next = { ...DEFAULT_CONFIG, ...config };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  return next;
};

export const supports = {
  usb: () => typeof navigator !== "undefined" && Boolean(navigator.usb),
  bluetooth: () => typeof navigator !== "undefined" && Boolean(navigator.bluetooth),
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
  if (usb && usb.device.opened) return usb;
  // A device the user already allowed comes back without asking again.
  const devices = await navigator.usb.getDevices();
  const match = devices.find(
    (d) =>
      d.vendorId === config.usb?.vendorId &&
      d.productId === config.usb?.productId &&
      (!config.usb?.serialNumber || d.serialNumber === config.usb.serialNumber),
  );
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

const connectBluetooth = async (device) => {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  for (const service of await server.getPrimaryServices()) {
    for (const ch of await service.getCharacteristics()) {
      if (ch.properties.writeWithoutResponse || ch.properties.write) {
        bt = { device, characteristic: ch };
        return bt;
      }
    }
  }
  throw new Error("This Bluetooth device does not accept print data.");
};

export const bluetoothAvailable = async () => {
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
        // Unacknowledged writes can outrun the printer's buffer.
        await sleep(4);
      } else {
        await characteristic.writeValueWithResponse(chunk);
      }
    }
    return;
  }
  throw new Error("No receipt printer is set up on this device.");
};
