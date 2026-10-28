import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

/**
 * LAN printers (owner, 2026-10-15): pick LAN, type the printer's IP, the app
 * connects by itself, paper is 80 mm, and it keeps working after a restart.
 * Both the receipt and the kitchen (KOT) slot take one. The web half runs
 * here against the two apps' bridges, the Windows app's socket code runs for
 * real on loopback; the Android half is pinned in androidApp.test.mjs.
 */

// Before @capacitor/core loads: the Android app's bridge as Capacitor sees it.
const nativeCalls = [];
const pluginMethods = [{ name: "print", rtype: "promise" }, { name: "probeLan", rtype: "promise" }];
globalThis.Capacitor = {
  PluginHeaders: [{ name: "ThermalPrinter", methods: pluginMethods }],
  nativePromise: async (plugin, method, options) => {
    nativeCalls.push([plugin, method, options]);
    return {};
  },
};
const web = await import("../src/utils/printerDevice.js");
globalThis.androidBridge = {};
const warn = console.warn;
console.warn = () => {}; // "already registered": the same plugin, from a second copy of the module
const android = await import("../src/utils/printerDevice.js?android");
console.warn = warn;

const JOB = Uint8Array.of(0x1b, 0x40, 0x1d, 0x56, 0x42, 0);

test("only a private IPv4 address is a LAN printer", () => {
  for (const ok of ["192.168.1.50", " 10.0.0.5 ", "172.16.0.9", "172.31.255.254", "169.254.1.1"]) assert.ok(web.isLanIp(ok), ok);
  for (const no of ["8.8.8.8", "192.168.1", "256.1.1.1", "172.32.0.1", "127.0.0.1", "192.168.1.500", "", null, "printer.local", "192.168.1.50:9100", "192.168.001.050", "010.0.0.1"]) {
    assert.ok(!web.isLanIp(no), String(no));
  }
});

test("a browser cannot reach a LAN printer, and says so", async () => {
  globalThis.window = {};
  try {
    assert.equal(web.lanPrinting(), false);
    await assert.rejects(web.probeLanPrinter("192.168.1.50"), /A browser cannot reach a network printer\. Use the KnotKitchen POS app on Android or Windows\./);
    await assert.rejects(web.sendToPrinter({ type: "lan", lan: { host: "192.168.1.50" } }, JOB), /A browser cannot reach a network printer/);
  } finally {
    delete globalThis.window;
  }
});

test("a Windows app from before LAN printing says to update", async () => {
  globalThis.window = { knotDesktop: { printHtml() {} } };
  try {
    assert.equal(web.lanPrinting(), false);
    await assert.rejects(web.probeLanPrinter("192.168.1.50"), /^Error: Update the KnotKitchen POS app to use a LAN printer\.$/);
  } finally {
    delete globalThis.window;
  }
});

test("Windows app: the probe sends nothing, a print sends the job, errors read plainly", async () => {
  const calls = [];
  globalThis.window = {
    knotDesktop: {
      printHtml() {},
      printLan: async (host, data) => {
        calls.push([host, data]);
        if (host === "192.168.1.9") throw new Error("Error invoking remote method 'printers:lan': Error: No printer answered at 192.168.1.9.");
        return true;
      },
    },
  };
  try {
    assert.equal(web.lanPrinting(), true);
    await web.probeLanPrinter("192.168.1.50");
    await web.sendToPrinter({ type: "lan", lan: { host: "192.168.1.50" } }, JOB);
    assert.deepEqual(calls, [["192.168.1.50", null], ["192.168.1.50", JOB]]);
    await assert.rejects(web.probeLanPrinter("192.168.1.9"), (e) => e.message === "No printer answered at 192.168.1.9.");
  } finally {
    delete globalThis.window;
  }
});

test("Android app: probeLan, and print with type lan, through the ThermalPrinter plugin", async () => {
  nativeCalls.length = 0;
  assert.equal(android.lanPrinting(), true);
  await android.probeLanPrinter("10.0.0.7");
  await android.sendToPrinter({ type: "lan", lan: { host: "10.0.0.7" } }, Uint8Array.of(0x1b, 0x40));
  assert.deepEqual(nativeCalls, [
    ["ThermalPrinter", "probeLan", { host: "10.0.0.7" }],
    ["ThermalPrinter", "print", { type: "lan", host: "10.0.0.7", data: "G0A=" }],
  ]);
});

test("an Android app from before LAN printing says to update, not a Capacitor error", async () => {
  const at = pluginMethods.findIndex((m) => m.name === "probeLan");
  const [probe] = pluginMethods.splice(at, 1);
  try {
    await assert.rejects(android.probeLanPrinter("10.0.0.7"), /^Error: Update the KnotKitchen POS app to use a LAN printer\.$/);
  } finally {
    pluginMethods.splice(at, 0, probe);
  }
});

test("a LAN printer is kept on the device, in either slot, across a restart", async () => {
  const m = new Map();
  const mem = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
  for (const n of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, n, { value: mem, configurable: true, writable: true });
  try {
    web.savePrinterConfig({
      type: "lan", name: "LAN printer 192.168.1.50", lan: { host: "192.168.1.50" }, paper: "80",
      kitchen: { type: "lan", name: "LAN printer 192.168.1.51", lan: { host: "192.168.1.51" }, paper: "80" },
    });
    const config = web.loadPrinterConfig(); // what the app reads after a restart
    assert.deepEqual([config.type, config.lan.host, config.paper], ["lan", "192.168.1.50", "80"]);
    const kitchen = web.kitchenPrinter(config);
    assert.deepEqual([kitchen.type, kitchen.lan.host, kitchen.protocol], ["lan", "192.168.1.51", "escpos"]);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
});

test("receipts, KOTs and reports send the ESC/POS job to a LAN printer, never a dialog", () => {
  const print = SRC("src/utils/printReceipt.js");
  const send = print.slice(print.indexOf("const sendCanvas"));
  assert.match(send, /if \(printer\.type === "usb" \|\| printer\.type === "bluetooth" \|\| printer\.type === "lan"\) \{/);
  // LAN goes first in sendToPrinter, so the app's USB/Bluetooth branch never sees it.
  const device = SRC("src/utils/printerDevice.js");
  const sendTo = device.slice(device.indexOf("export const sendToPrinter"));
  assert.ok(sendTo.indexOf('if (config.type === "lan") return lan(') < sendTo.indexOf("nativePrinting &&"));
});

test("Device Configuration: IP in, auto-connect, kept only once a printer answers, 80 mm only", () => {
  const ui = SRC("src/components/settings/DeviceConfiguration.jsx");
  // Inside PrinterSlot, so the receipt and the kitchen slot both have it.
  const slot = ui.slice(ui.indexOf("const PrinterSlot"), ui.indexOf("const DeviceConfiguration"));
  assert.match(slot, /Printer IP address/);
  assert.equal(ui.match(/<PrinterSlot\b/g).length, 2);
  // Two sibling cards: same-type keys ("none"/"none", "lan"/"lan") would leave a stale card on screen.
  assert.match(ui, /key=\{`receipt-\$\{device\.type \|\| "none"\}`\}/);
  assert.match(ui, /key=\{`kitchen-\$\{device\.kitchen\?\.type \|\| "none"\}`\}/);
  // Opens on the LAN tab, with its address, after a restart; a USB slot never picks up a stale one.
  assert.match(slot, /useState\(device\.type === "bluetooth" \|\| device\.type === "lan" \? device\.type : "usb"\)/);
  assert.match(slot, /useState\(device\.type === "lan" \? device\.lan\?\.host \|\| "" : ""\)/);
  // Kept only after the probe answers, at 80 mm.
  const check = slot.slice(slot.indexOf("await probeLanPrinter(host);"));
  assert.ok(check.length < slot.length, "the address is probed");
  assert.match(check.slice(0, check.indexOf("catch")), /patchDevice\(\{ type: "lan", name: `LAN printer \$\{host\}`, lan: \{ host \}.*paper: "80" \}\)/);
  assert.match(slot, /lanCheck\?\.state === "checking" \? "Connecting…" : lanCheck\?\.state === "ok" \? "Connected"/);
  assert.match(slot, /`Connected · \$\{lanHost\}`/);
  assert.match(slot, /`Not reachable · \$\{lanHost\}`/);
  // No paper choice for a LAN printer.
  // No paper choice for a LAN printer: the section is not shown at all.
  assert.match(slot, /\{tab !== "lan" && device\.type !== "lan" && \(\s*<div[^>]*>\s*<p[^>]*>Paper size<\/p>/);
  // Save waits for the printer to answer.
  assert.match(ui, /disabled=\{saveMutation\.isPending \|\| lanWaiting\.receipt \|\| lanWaiting\.kitchen\}/);
  // A browser, or an app from before LAN printing, is told what to do.
  assert.match(slot, /A browser cannot reach a network printer\. Use the KnotKitchen POS app on Android or Windows\./);
  assert.match(slot, /Update the KnotKitchen POS app to use a LAN printer: it updates itself; restart it when it offers\./);
});

/* -------------------------------------------- Windows app (pos-desktop) -- */

const main = SRC("../pos-desktop/main.js");
const lanBlock = main.slice(main.indexOf("const LAN_PORT"), main.indexOf("const trusted"));
/** main.js's LAN code as shipped, or pointed at a loopback "printer" (the shipped check refuses 127.x). */
const desktopLan = (port, netImpl = net) => {
  const code = port
    ? lanBlock.replace("const LAN_PORT = 9100;", `const LAN_PORT = ${port};`).replace("return a === 10 ||", "return a === 127 || a === 10 ||")
    : lanBlock;
  if (port) assert.ok(code.includes(`LAN_PORT = ${port};`) && code.includes("a === 127"), "the loopback copy");
  return new Function("net", "Buffer", `${code}\nreturn { isLanIp, sendLan };`)(netImpl, Buffer);
};
const listen = (onSocket) =>
  new Promise((resolve) => {
    const server = net.createServer(onSocket);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

test("Windows app: only the POS page, only a private IPv4, only port 9100", async () => {
  assert.match(main, /const net = require\("net"\);/);
  assert.match(main, /const LAN_PORT = 9100;/);
  assert.match(main, /ipcMain\.handle\("printers:lan", \(event, host, data\) => \{\n  if \(!trusted\(event\)\) throw new Error\("Not allowed\."\);/);
  const send = lanBlock.slice(lanBlock.indexOf("const sendLan"));
  assert.ok(send.indexOf("if (!isLanIp(host))") < send.indexOf("net.connect("), "checked before connecting");
  assert.match(SRC("../pos-desktop/preload.js"), /printLan: \(host, data\) => ipcRenderer\.invoke\("printers:lan", String\(host \|\| ""\), data \|\| null\),/);

  const shipped = desktopLan();
  for (const ok of ["192.168.1.50", "10.0.0.5", "172.16.0.9", "169.254.1.1"]) assert.ok(shipped.isLanIp(ok), ok);
  for (const no of ["8.8.8.8", "127.0.0.1", "172.32.0.1", "256.1.1.1", "printer.local", "", "192.168.001.050"]) assert.ok(!shipped.isLanIp(no), no);
  await assert.rejects(shipped.sendLan("8.8.8.8", JOB), /IP address on this network/);
});

test("Windows app: nothing at the address is a plain error, not a hang", async () => {
  const server = await listen(() => {});
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  await assert.rejects(desktopLan(port).sendLan("127.0.0.1"), /^Error: No printer answered at 127\.0\.0\.1\./);
});

test("Windows app: the probe sends nothing; a print delivers every byte", async () => {
  const got = [];
  const server = await listen((s) => {
    const chunks = [];
    s.on("data", (c) => chunks.push(c));
    s.on("end", () => got.push(Buffer.concat(chunks).length));
  });
  try {
    const lan = desktopLan(server.address().port);
    assert.equal(await lan.sendLan("127.0.0.1"), true);
    assert.equal(await lan.sendLan("127.0.0.1", new Uint8Array(300000)), true);
    for (let i = 0; i < 50 && got.length < 2; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(got, [0, 300000]);
  } finally {
    server.close();
  }
});

test("Windows app: a job the printer drops mid-way is an error, not printed", async () => {
  // A socket whose pending write fails: the printer reset the connection while the job was queued.
  const dropping = {
    connect() {
      const d = new Duplex({
        read() {},
        write(chunk, enc, cb) {
          setTimeout(() => cb(Object.assign(new Error("write ECONNRESET"), { code: "ECONNRESET" })), 20);
        },
      });
      setImmediate(() => d.emit("connect"));
      return d;
    },
  };
  await assert.rejects(
    desktopLan(null, dropping).sendLan("192.168.1.50", new Uint8Array(1000)),
    /^Error: The LAN printer stopped taking the job\. Check its paper and cover\. \(ECONNRESET\)$/,
  );
});
