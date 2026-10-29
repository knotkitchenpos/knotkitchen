import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * A POS58 on Web Bluetooth (Chrome, the Windows app). Owner, 2026-10-16: "keeps
 * disconnecting". It switches itself off when idle; the page forgot it on every
 * reload; a KOT and a receipt sent together lost the second; a printer that
 * went to sleep held the job ~30 s. printerDevice.js runs here against a fake
 * navigator.bluetooth that behaves like Chrome (no getDevices unless enabled).
 */

const networkError = (message) => Object.assign(new Error(message), { name: "NetworkError" });

const makePrinter = (id = "id-1") => {
  const p = { awake: true, connected: false, pending: false, received: [], writes: 0, dropAfter: Infinity, connects: 0, disconnects: 0 };
  const ch = {
    properties: { writeWithoutResponse: true, write: true },
    async writeValueWithoutResponse(chunk) {
      // Chrome refuses a second write while one is pending on the characteristic.
      if (p.pending) throw networkError("GATT operation already in progress.");
      if (!p.connected) throw networkError("GATT Server is disconnected. Cannot perform GATT operations.");
      p.pending = true;
      await new Promise((r) => setImmediate(r));
      p.pending = false;
      p.writes += 1;
      if (p.writes > p.dropAfter) {
        p.connected = false;
        throw networkError("GATT Server is disconnected. Cannot perform GATT operations.");
      }
      p.received.push(chunk[0]);
    },
  };
  const service = { uuid: "000018f0-0000-1000-8000-00805f9b34fb", getCharacteristics: async () => [ch] };
  p.device = {
    id,
    name: "POS58",
    gatt: {
      get connected() {
        return p.connected;
      },
      async connect() {
        p.connects += 1;
        if (!p.awake) throw networkError("Bluetooth Device is no longer in range.");
        p.connected = true;
        return p.device.gatt;
      },
      disconnect() {
        p.disconnects += 1;
        p.connected = false;
      },
      async getPrimaryServices() {
        if (!p.connected) throw networkError("GATT Server is disconnected. Cannot retrieve services.");
        return [service];
      },
    },
  };
  p.sleep = () => {
    p.awake = false;
    p.connected = false;
  };
  return p;
};

const printer = makePrinter();
const chooser = [];
const bluetooth = {
  getAvailability: async () => true,
  // A real browser shows its chooser only from a tap; the test is the tap.
  requestDevice: async (options) => {
    chooser.push(options);
    return printer.device;
  },
};
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { bluetooth } });

let reloads = 0;
/** A fresh copy of printerDevice.js: the page after a reload or a discarded tab. */
const reload = async () => {
  const warn = console.warn;
  console.warn = () => {}; // "ThermalPrinter already registered": the same plugin, from a second copy
  try {
    return await import(`../src/utils/printerDevice.js?reload=${(reloads += 1)}`);
  } finally {
    console.warn = warn;
  }
};

// Every byte of a job is its tag, so an interleaved or doubled job shows.
const job = (tag, chunks = 3) => new Uint8Array(180 * chunks).fill(tag);

const page = await reload();
const picked = await page.chooseBluetoothPrinter();
const config = { type: "bluetooth", protocol: "escpos", paper: "58", ...picked };

test("the printer is saved with its name, so Reconnect can show just this one", async () => {
  assert.deepEqual(picked, { name: "POS58", bluetooth: { id: "id-1", name: "POS58" } });
  printer.received = [];
  await page.sendToPrinter(config, job(1));
  assert.deepEqual(printer.received, [1, 1, 1]);
  assert.equal(page.bluetoothLinked(config), true);
});

test("REGRESSION: a KOT and a receipt sent together both print, one after the other", async () => {
  printer.received = [];
  const both = await Promise.allSettled([page.sendToPrinter(config, job(4, 4)), page.sendToPrinter(config, job(5, 4))]);
  assert.deepEqual(both.map((r) => r.status), ["fulfilled", "fulfilled"], String(both.map((r) => r.reason)));
  assert.equal(printer.received.join(""), "44445555");
});

test("REGRESSION: a printer that switched itself off says so, and the next job reconnects by itself", async () => {
  printer.sleep();
  await assert.rejects(page.sendToPrinter(config, job(2)), {
    message: "The Bluetooth printer is not answering. Switch it on (it turns itself off when idle), then print again.",
  });
  // Woken up: no tap, no chooser, the queue is not stuck behind the failed job.
  printer.awake = true;
  printer.received = [];
  const asked = chooser.length;
  await page.sendToPrinter(config, job(3, 2));
  assert.deepEqual(printer.received, [3, 3]);
  assert.equal(chooser.length, asked);
});

test("REGRESSION: a connect that never answers gives up after 10 s, not ~30 s", async () => {
  printer.connected = false;
  const connect = printer.device.gatt.connect;
  printer.device.gatt.connect = () => new Promise(() => {});
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const before = printer.disconnects;
    const sent = page.sendToPrinter(config, job(2));
    const outcome = sent.then(() => "printed", (e) => e.message);
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    mock.timers.tick(9999);
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    let settled = false;
    outcome.then(() => (settled = true));
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false, "still waiting at 9.999 s");
    mock.timers.tick(1);
    assert.match(await outcome, /^The Bluetooth printer is not answering\./);
    assert.equal(printer.disconnects, before + 1, "the pending connect is cancelled");
  } finally {
    mock.timers.reset();
    printer.device.gatt.connect = connect;
  }
});

test("a link that drops mid-job is not sent again (no doubled ticket); the next job reconnects", async () => {
  await page.sendToPrinter(config, job(9, 1));
  printer.received = [];
  printer.writes = 0;
  printer.dropAfter = 2;
  await assert.rejects(page.sendToPrinter(config, job(6, 5)), /GATT Server is disconnected/);
  assert.deepEqual(printer.received, [6, 6]);
  printer.dropAfter = Infinity;
  printer.received = [];
  await page.sendToPrinter(config, job(7, 2));
  assert.deepEqual(printer.received, [7, 7]);
});

test("REGRESSION: after a reload the printer comes back with one tap on Reconnect", async () => {
  const fresh = await reload();
  assert.equal(fresh.bluetoothLinked(config), false, "Device Configuration shows Not connected");
  // No getDevices (stable Chrome, the Windows app): a clear error that carries the printer.
  const err = await fresh.sendToPrinter(config, job(8)).catch((e) => e);
  assert.equal(err.code, "BT_RECONNECT");
  assert.equal(err.message, "The browser needs the Bluetooth printer chosen again: tap Reconnect.");
  assert.equal(err.printer, config);
  // The browser may hand the same printer back under a new id.
  printer.device.id = "id-2";
  printer.connected = false;
  chooser.length = 0;
  await fresh.reconnectBluetoothPrinter(err.printer);
  assert.deepEqual(chooser[0].filters, [{ name: "POS58" }], "only this printer in the chooser");
  assert.ok(chooser[0].optionalServices.includes("000018f0-0000-1000-8000-00805f9b34fb"));
  assert.equal(fresh.bluetoothLinked(config), true);
  printer.received = [];
  await fresh.sendToPrinter(config, job(8, 2));
  assert.deepEqual(printer.received, [8, 8], "kept under the saved id");
  printer.device.id = "id-1";
});

test("a printer saved before its name was kept: Reconnect shows every device", async () => {
  const fresh = await reload();
  chooser.length = 0;
  await fresh.reconnectBluetoothPrinter({ type: "bluetooth", bluetooth: { id: "id-1" } });
  assert.equal(chooser[0].acceptAllDevices, true);
  assert.equal(chooser[0].filters, undefined);
});

test("where the browser remembers devices (getDevices), a reload needs no tap at all", async () => {
  bluetooth.getDevices = async () => [printer.device];
  try {
    const fresh = await reload();
    printer.connected = false;
    chooser.length = 0;
    printer.received = [];
    await fresh.sendToPrinter(config, job(5, 1));
    assert.deepEqual(printer.received, [5]);
    assert.equal(chooser.length, 0);
  } finally {
    delete bluetooth.getDevices;
  }
});

test("a remembered printer that will not connect after a restart offers Reconnect, not an endless Retry", async () => {
  // Chrome may not have seen it since it restarted and then never connects to
  // it, awake or not; only the chooser (which scans) finds it again.
  bluetooth.getDevices = async () => [printer.device];
  printer.sleep();
  try {
    const fresh = await reload();
    const err = await fresh.sendToPrinter(config, job(6, 1)).catch((e) => e);
    assert.equal(err.code, "BT_RECONNECT");
    assert.equal(err.printer, config);
    assert.match(err.message, /^The Bluetooth printer is not answering\./, "still says why");
    printer.awake = true;
    chooser.length = 0;
    printer.received = [];
    await fresh.reconnectBluetoothPrinter(err.printer);
    await fresh.sendToPrinter(config, job(6, 1));
    assert.deepEqual([chooser.length, printer.received], [1, [6]]);
  } finally {
    printer.awake = true;
    delete bluetooth.getDevices;
  }
});

test("Device Configuration: Bluetooth status is checked again, and the pill says when the printer cannot print", () => {
  const ui = SRC("src/components/settings/DeviceConfiguration.jsx");
  // Was read once on opening the screen: Bluetooth turned off later still showed "available".
  const effect = ui.slice(ui.indexOf("const check = () => bluetoothAvailable().then(setBtOn);"));
  assert.ok(effect.length > 0, "bluetoothAvailable is re-checked");
  assert.match(effect, /^const check = \(\) => bluetoothAvailable\(\)\.then\(setBtOn\);\s+check\(\);\s+const t = setInterval\(check, 5000\);\s+window\.addEventListener\("focus", check\);\s+return \(\) => \{\s+clearInterval\(t\);\s+window\.removeEventListener\("focus", check\);/);
  assert.doesNotMatch(ui, /bluetoothAvailable\(\)\.then\(setBtOn\);\s+\}, \[\]\);/, "no longer only on mount");
  // The pill is red, not green, when the Bluetooth printer cannot print from here.
  const slot = ui.slice(ui.indexOf("const PrinterSlot"), ui.indexOf("const DeviceConfiguration"));
  assert.match(slot, /const btState = device\.type !== "bluetooth" \? null : btOn === false \? "off" : bluetoothLinked\(device\) \? null : "unlinked";/);
  assert.match(slot, /lanState === "fail" \|\| btState \? "bg-\[#FEE2E2\] text-\[#B91C1C\]" : "bg-\[#DCFCE7\] text-\[#15803D\]"/);
  assert.match(slot, /btState === "off"\s+\? `Bluetooth off · \$\{device\.name\}`/);
  assert.match(slot, /btState === "unlinked"\s+\? "Not connected · tap Reconnect"/);
  // No Printer PIN field (owner, 2026-10-29): the app reconnects on its own.
  assert.doesNotMatch(slot, /Printer PIN/);
});

test("the app never shows Not connected: it prints over its own plugin, not Web Bluetooth", async () => {
  // bluetoothLinked is about this page's Web Bluetooth link only.
  const fresh = await reload();
  assert.equal(fresh.bluetoothLinked({ type: "usb" }), true);
  assert.equal(fresh.bluetoothLinked({ type: "lan", lan: { host: "10.0.0.2" } }), true);
  const device = SRC("src/utils/printerDevice.js");
  assert.match(device, /export const bluetoothLinked = \(config\) => nativePrinting \|\| config\?\.type !== "bluetooth" \|\| bts\.has\(config\.bluetooth\?\.id\);/);
});
