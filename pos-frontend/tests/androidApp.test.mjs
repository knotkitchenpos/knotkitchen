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

test("in the app, a LAN printer prints over TCP 9100 on the print queue, and never hangs it", () => {
  const java = JAVA("ThermalPrinterPlugin.java");
  assert.match(java, /\} else if \("lan"\.equals\(type\)\) \{\s*io\.execute\(\(\) -> printLan\(call, bytes\)\);/);
  assert.match(java, /private static final int LAN_PORT = 9100;/);
  assert.match(java, /socket\.connect\(new InetSocketAddress\(host, LAN_PORT\), LAN_CONNECT_MS\);/);
  // A printer that stops reading (paper out) is closed after the write deadline, freeing the queue.
  const print = java.slice(java.indexOf("private void printLan("), java.indexOf("/* ------------------------------------------------------------- print -- */"));
  assert.match(print, /watchdog\.schedule\(/);
  assert.match(print, /if \(deadline != null\) deadline\.cancel\(false\);/);
  // Only a private IPv4 address, checked before any connection.
  assert.ok(print.indexOf("if (!isLanHost(host))") < print.indexOf("openLan(host)"), "printLan validates first");
  const probe = java.slice(java.indexOf("public void probeLan("), java.indexOf("private void printLan("));
  assert.ok(probe.indexOf("if (!isLanHost(host))") >= 0 && probe.indexOf("if (!isLanHost(host))") < probe.indexOf("io.execute("), "probeLan validates first");
  // No leading zeros: "192.168.001.050" is no address a socket opens (it would go to DNS).
  assert.ok(java.includes(String.raw`host.matches("(0|[1-9]\\d{0,2})(\\.(0|[1-9]\\d{0,2})){3}")`), "octets without leading zeros");
  assert.match(java, /return a == 10 \|\| \(a == 172 && b >= 16 && b <= 31\) \|\| \(a == 192 && b == 168\) \|\| \(a == 169 && b == 254\);/);
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
  assert.match(open, /Thread\.sleep\(SPP_RETRY_PAUSE_MS \* round\)/, "and more rounds after a growing pause");
});

test("REGRESSION: a printer that has printed unauthenticated is never offered the pairing channel", () => {
  // It reached the secure channel -- and Android's pairing dialog -- whenever
  // it was still booting after power-on and missed the quick rounds.
  const java = JAVA("ThermalPrinterPlugin.java");
  const open = java.slice(java.indexOf("private BluetoothSocket openSpp("), java.indexOf("private static BluetoothSocket insecureChannelOne("));
  const remember = open.indexOf("putBoolean(INSECURE_OK + address, true)");
  const bail = open.indexOf("if (knownInsecure) {");
  const secure = open.indexOf("createRfcommSocketToServiceRecord(SPP)");
  assert.ok(remember > 0, "a successful unauthenticated connect is remembered for that printer");
  assert.ok(remember < open.indexOf("return socket;"), "remembered on success, before the socket is handed back");
  assert.ok(bail > remember && secure > bail, "a known printer gives up before the secure channel");
  assert.match(open, /int rounds = knownInsecure \? SPP_ROUNDS_KNOWN : SPP_ROUNDS;/, "and waits longer instead");
  assert.match(java, /SPP_ROUNDS_KNOWN = 4;/);
  assert.match(java, /getSharedPreferences\(PRINTER_PREFS, Context\.MODE_PRIVATE\)/, "kept on this device across app restarts");
  assert.match(java, /^import android\.content\.SharedPreferences;$/m);
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

test("REGRESSION: a BLE receipt printer prints in seconds, not minutes", () => {
  const java = JAVA("ThermalPrinterPlugin.java");
  const ble = java.slice(java.indexOf("private void printBle("), java.indexOf("private BluetoothAdapter adapter()"));
  // Fast link while the job runs, asked before the MTU so both apply.
  assert.ok(
    ble.indexOf("gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)") > 0 &&
      ble.indexOf("gatt.requestConnectionPriority(") < ble.indexOf("gatt.requestMtu(512)"),
  );
  // No pause between a receipt printer's writes; mini printers keep theirs.
  assert.match(SRC("src/utils/printerDevice.js"), /pace: cat \? 20 : 0,/);
});

test("REGRESSION: a BLE printer that drops the link while connecting is tried again, never once data went out", () => {
  // POS58 (owner, 2026-10-16): a GATT connect right after the last job's
  // close, or to a printer that just woke, drops at once; one try lost the ticket.
  const java = JAVA("ThermalPrinterPlugin.java");
  assert.match(java, /private static final int BLE_ATTEMPTS = 3;/);
  assert.match(java, /private static final long BLE_RETRY_PAUSE_MS = 800;/);
  const retry = java.slice(java.indexOf("private void printBle("), java.indexOf("private String printBleOnce("));
  assert.match(retry, /String retry = printBleOnce\(call, bytes, device, pace\);\s+if \(retry == null\) return;/);
  assert.match(retry, /if \(attempt == BLE_ATTEMPTS\) \{\s+call\.reject\(retry\);/);
  assert.match(retry, /Thread\.sleep\(BLE_RETRY_PAUSE_MS \* attempt\);/);

  const once = java.slice(java.indexOf("private String printBleOnce("), java.indexOf("private BluetoothAdapter adapter()"));
  const firstWrite = once.indexOf("gatt.writeCharacteristic(ch)");
  assert.ok(firstWrite > 0);
  // A message asks for another try; every one of them comes before any data goes out.
  const retries = [...once.matchAll(/return (?!null)[^;]+;/g)];
  assert.ok(retries.length >= 2, "gatt == null and a failure while connecting are retried");
  for (const m of retries) assert.ok(m.index < firstWrite, `retried after data went out: ${m[0]}`);
  // From the first write on, a failure is final.
  assert.doesNotMatch(once.slice(firstWrite), /return (?!null)[^;]+;/);
  // A printer that is off fails in 20 s, not a minute: the timeout is never retried.
  assert.match(once, /if \(!ready\.await\(20, TimeUnit\.SECONDS\)\) \{\s+call\.reject\("The printer did not answer[^"]*"\);\s+return null;/);
  // The GATT status is in the message, and a failed discovery is not read as "does not accept print data".
  assert.ok(once.includes('"The printer disconnected (GATT " + status + ")."'));
  const discovered = once.slice(once.indexOf("public void onServicesDiscovered("));
  assert.match(discovered, /^[^{]*\{\s+if \(status != BluetoothGatt\.GATT_SUCCESS\) \{/);
  // Each attempt starts from a closed GATT.
  assert.match(once, /finally \{\s+if \(gatt != null\) \{\s+try \{\s+gatt\.disconnect\(\);\s+gatt\.close\(\);/);
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
