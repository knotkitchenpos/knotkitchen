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

test("REGRESSION: a paired printer switched off and on reconnects without asking to pair again", () => {
  // The secure (authenticated) channel needs the link key the printer stored
  // at pairing; cheap printers forget it on power-off, and Android then showed
  // its pairing dialog on the next print although the printer was still paired.
  const java = JAVA("ThermalPrinterPlugin.java");
  assert.match(java, /socket = openSpp\(remote\);/, "classic printing goes through openSpp");
  const open = java.slice(java.indexOf("private BluetoothSocket openSpp("), java.indexOf("private static BluetoothSocket insecureChannelOne("));
  const insecure = open.indexOf("createInsecureRfcommSocketToServiceRecord(SPP)");
  const secure = open.indexOf("createRfcommSocketToServiceRecord(SPP)");
  assert.ok(insecure > 0 && secure > insecure, "unauthenticated first; the authenticated channel only as the last resort");
  assert.match(open, /insecureChannelOne\(device\)/, "channel 1 fallback for a printer that has just been switched on");
  assert.match(open, /Thread\.sleep\(SPP_RETRY_PAUSE_MS\)/, "and a second round after a pause");
});

test("REGRESSION: a printer that forgot its pairing and asks for the PIN is answered without Android's dialog", () => {
  const java = JAVA("ThermalPrinterPlugin.java");
  // Answering starts before the connection and stops when the job ends.
  assert.ok(
    java.indexOf('pinAnswer = answerPinRequests(remote, call.getString("pin", ""));') < java.indexOf("socket = openSpp(remote);"),
  );
  // Only for a printer still paired: never pairs a removed or unknown device silently.
  assert.match(java, /if \(remote\.getBondState\(\) == BluetoothDevice\.BOND_BONDED\) \{\s*pinAnswer = answerPinRequests/);
  assert.match(java, /finally \{\s*closeQuietly\(socket\);\s*stopAnswering\(pinAnswer\);/);
  const answer = java.slice(java.indexOf("private static final class PinAnswer"), java.indexOf("/* --------------------------------------------------------------- usb -- */"));
  // Only this printer, only the PIN variant, only once: a wrong PIN un-pairs it.
  assert.match(answer, /address\.equalsIgnoreCase\(device\.getAddress\(\)\)/);
  assert.match(answer, /variant != BluetoothDevice\.PAIRING_VARIANT_PIN \|\| !answered\.compareAndSet\(false, true\)/);
  assert.match(answer, /if \(device\.setPin\(pin\) && isOrderedBroadcast\(\)\) abortBroadcast\(\);/);
  // No PIN saved: nothing is answered and Android behaves as before.
  assert.match(java, /if \(pin == null \|\| !pin\.matches\("\[0-9\]\{1,16\}"\)\) return null;/);
  // The web hands the saved PIN over with every Bluetooth print.
  assert.match(SRC("src/utils/printerDevice.js"), /pin: config\.pin \|\| "",/);
  // Device Configuration: the field in the app for a Bluetooth receipt printer,
  // digits only, kept for the same printer and cleared for another one.
  const config = SRC("src/components/settings/DeviceConfiguration.jsx");
  assert.match(config, /nativePrinting && isThis\("bluetooth"\) && device\.protocol !== "cat" &&/);
  assert.match(config, /patchDevice\(\{ pin: e\.target\.value\.replace\(\/\\D\/g, ""\) \}\)/);
  assert.match(config, /picked\.bluetooth\.address === device\.bluetooth\?\.address/);
  assert.match(config, /pin: samePrinter \? device\.pin : "",/);
});

test("Cashfree checkout in the app can list and open UPI apps", () => {
  // Without a JS bridge named "Android" (getAppList/openApp, Cashfree's WebView
  // contract) the checkout offered only "UPI ID / QR", and operators paid by
  // screenshotting the QR.
  const plugin = JAVA("UpiIntentPlugin.java");
  assert.match(plugin, /addJavascriptInterface\(this, "Android"\)/);
  assert.match(plugin, /@JavascriptInterface\s+public String getAppList\(String link\)/);
  assert.match(plugin, /@JavascriptInterface\s+public boolean openApp\(String appPackage, String link\)/);
  assert.match(plugin, /intent\.setPackage\(appPackage\)/, "opened only in the app picked");

  const main = JAVA("MainActivity.java");
  assert.ok(main.indexOf("registerPlugin(UpiIntentPlugin.class)") < main.indexOf("super.onCreate"));
  assert.match(main, /requestCode == UpiIntentPlugin\.UPI_REQUEST/);

  // Android 11+ hides the apps unless the schemes are declared; keep both lists in step.
  const manifest = SRC("android/app/src/main/AndroidManifest.xml");
  const schemes = plugin.match(/UPI_SCHEMES = Arrays\.asList\(([^)]*)\)/)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
  for (const scheme of schemes) assert.match(manifest, new RegExp(`<data android:scheme="${scheme}" />`), scheme);
});

test("in the app a top-up checks out full page and is settled on the way back", () => {
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /redirectTarget: inApp \? "_self" : "_modal"/);
  assert.match(billing, /returnUrl: `\$\{window\.location\.origin\}\/settings\/billing\?recharge=\{order_id\}`/);
  assert.match(billing, /get\("recharge"\)[\s\S]{0,200}settleTopUp\(gatewayOrderId\)/);
});

test("REGRESSION: a checkout's later pages stay in the app, and Back skips them", () => {
  // Capacitor sends every off-host page to the system browser; a bank or 3-D
  // Secure hop after Cashfree's full-page checkout then never came back.
  const plugin = JAVA("UpiIntentPlugin.java");
  assert.match(plugin, /if \(host != null && !host\.equals\(appHost\) && !host\.equals\(getBridge\(\)\.getHost\(\)\)\) return false;/);
  // intent:// only ever opens a UPI app.
  assert.match(plugin, /Intent intent = upiIntent\(parsed\.getDataString\(\)\);/);
  assert.match(JAVA("MainActivity.java"), /appHost\.equals\(Uri\.parse\(history\.getItemAtIndex\(i\)\.getUrl\(\)\)\.getHost\(\)\)/);
  // Cashfree may settle in its own modal on a phone even with "_self".
  const billing = SRC("src/pages/Billing.jsx");
  assert.match(billing, /return Boolean\(result\?\.redirect\);/);
  assert.match(billing, /if \(await checkout\(opened\.data\.data\)\) return;\s*\n\s*await settleTopUp\(gatewayOrderId\);/);
});

test("the app updates itself from the release channel CI publishes", () => {
  const updater = JAVA("ShellUpdater.java");
  assert.match(updater, /releases\/download\/android-latest\/android-update\.json/);
  // Checksum before commit; an unverified download is abandoned.
  assert.ok(updater.indexOf('m.getString("sha256")') < updater.indexOf("session.commit("));
  assert.match(updater, /installer\.abandonSession\(id\)/);
  assert.match(JAVA("MainActivity.java"), /public void onResume\(\) \{\s*super\.onResume\(\);[\s\S]{0,120}ShellUpdater\.check\(this\);/);
  const manifest = SRC("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /android\.permission\.UPDATE_PACKAGES_WITHOUT_USER_ACTION/);
});

test("an out-of-date Android System WebView is named, with how to update it", async () => {
  // The tablet that showed a broken rupee sign on Cashfree's page.
  const { oldWebViewVersion } = await import("../src/utils/webview.js");
  assert.equal(oldWebViewVersion("Mozilla/5.0 (Linux; Android 10; Slate Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/94.0.4606.85 Safari/537.36"), 94);
  assert.equal(oldWebViewVersion("Mozilla/5.0 (Linux; Android 14; I2019; wv) AppleWebKit/537.36 Chrome/153.0.8010.36 Mobile Safari/537.36"), null);
  assert.equal(oldWebViewVersion("Mozilla/5.0 (Windows NT 10.0) Chrome/94.0.4606.85 Safari/537.36"), null, "only inside the app");
  assert.match(SRC("src/App.jsx"), /\{isAuth && <OldWebViewBanner \/>\}/);
  assert.match(SRC("src/components/shared/OldWebViewBanner.jsx"), /search &quot;Android System WebView&quot; and tap Update/);
});
