import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const JAVA = (name) => SRC(`android/app/src/main/java/com/knotkitchen/pos/${name}`);

/**
 * The Android app: a shell around the live POS, plus the native pieces the
 * WebView cannot do. These pin the contract between the two halves.
 */

test("the app loads the live POS, with a bundled page for no connection", () => {
  const config = SRC("capacitor.config.ts");
  assert.match(config, /url: "https:\/\/business\.knotkitchen\.com"/);
  assert.match(config, /errorPath: "offline\.html"/);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "public/offline.html")), "errorPath must exist in webDir");
});

test("the printer plugin the web calls is the one the app registers", () => {
  assert.match(SRC("src/utils/printerDevice.js"), /registerPlugin\("ThermalPrinter"\)/);
  assert.match(JAVA("ThermalPrinterPlugin.java"), /name = "ThermalPrinter"/);
  // Local plugins must be registered before super.onCreate starts the bridge.
  const main = JAVA("MainActivity.java");
  assert.ok(
    main.indexOf("registerPlugin(ThermalPrinterPlugin.class)") < main.indexOf("super.onCreate"),
    "registered too late, the web side would find no plugin",
  );
});

test("every plugin method the web calls exists natively", () => {
  const web = SRC("src/utils/printerDevice.js");
  const java = JAVA("ThermalPrinterPlugin.java");
  for (const method of new Set([...web.matchAll(/ThermalPrinter\.(\w+)\(/g)].map((m) => m[1]))) {
    assert.match(java, new RegExp(`@PluginMethod\\s+public void ${method}\\(PluginCall call\\)`), `${method} is missing`);
  }
});

test("in the app, USB and Bluetooth print through the plugin, not WebUSB/Web Bluetooth", () => {
  const web = SRC("src/utils/printerDevice.js");
  const send = web.slice(web.indexOf("export const sendToPrinter"));
  assert.ok(send.indexOf("nativePrinting &&") < send.indexOf('config.type === "usb") {\n    const { device'), "native branch first");
});

test("the permissions the plugin needs are declared", () => {
  const manifest = SRC("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.BLUETOOTH_CONNECT/);
  assert.match(manifest, /android\.hardware\.usb\.host" android:required="false"/);
});

test("release signing reads only the environment; keys are never committed", () => {
  const gradle = SRC("android/app/build.gradle");
  assert.match(gradle, /System\.getenv\("KK_KEYSTORE_PATH"\)/);
  assert.ok(!/storePassword\s+"/.test(gradle), "no password literal");
  assert.match(SRC("android/.gitignore"), /^\*\.jks$/m);
});

test("REGRESSION: printing does not need BLUETOOTH_SCAN", () => {
  // cancelDiscovery() needs BLUETOOTH_SCAN on Android 12+. The app never
  // scans, so it does not hold that permission, and every print was rejected
  // with "Need android.permission.BLUETOOTH_SCAN permission".
  const java = JAVA("ThermalPrinterPlugin.java");
  assert.match(java, /try \{\s*adapter\.cancelDiscovery\(\);\s*\} catch \(SecurityException ignored\)/);
});
