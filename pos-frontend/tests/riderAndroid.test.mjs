// The KK Rider Android app (rider-android) and the web app's side of it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ROOT = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the app keeps a foreground service while online, rings, and floats a picture-in-picture card", () => {
  const m = ROOT("rider-android/app/src/main/AndroidManifest.xml");
  for (const p of ["POST_NOTIFICATIONS", "FOREGROUND_SERVICE_SPECIAL_USE", "USE_FULL_SCREEN_INTENT", "RECEIVE_BOOT_COMPLETED", "WAKE_LOCK", "VIBRATE"]) {
    assert.match(m, new RegExp(`android.permission.${p}"`), p);
  }
  assert.match(m, /android:name="\.RiderService"[\s\S]*?android:foregroundServiceType="specialUse"/);
  assert.match(m, /android:supportsPictureInPicture="true"/);
  assert.match(m, /<receiver android:name="\.ActionReceiver" android:exported="false" \/>/);
});

test("the service rings the store's bell on a loop and answers from the alert", () => {
  const s = ROOT("rider-android/app/src/main/java/com/knotkitchen/rider/RiderService.java");
  assert.match(s, /o\.path = "\/rider\/socket\.io";/);
  assert.match(s, /o\.query = "app=rider";/);
  assert.match(s, /bell\.setLooping\(true\);/);
  assert.match(s, /\.setFullScreenIntent\(/);
  assert.match(s, /ActionReceiver\.ACCEPT/);
  assert.match(s, /ActionReceiver\.DECLINE/);
  assert.ok(fs.existsSync(new URL("../../rider-android/app/src/main/res/raw/new_order.mp3", import.meta.url)), "the bell is packaged");
  const a = ROOT("rider-android/app/src/main/java/com/knotkitchen/rider/ActionReceiver.java");
  assert.match(a, /replaceAll\("\[\^a-fA-F0-9\]", ""\)/, "an order id can't reach another API path");
});

test("the web app hands the phone what it needs, and doesn't ring twice in the app", () => {
  const app = SRC("src/rider/RiderApp.jsx");
  assert.match(app, /useRinging\(badge > 0 && !inApp\(\), me\.prefs\);/);
  assert.match(app, /useEffect\(\(\) => nativeOnline\(nativeOn\), \[nativeOn\]\);/);
  assert.match(app, /useEffect\(\(\) => nativePending\(firstWaiting\), \[firstWaiting\]\);/);
  assert.match(app, /nativeOnline\(false\);\n    try \{/, "logout stops the service");
  assert.match(SRC("src/rider/components/Prompts.jsx"), /const needed = !inApp\(\) &&/);
});

test("in a browser the bridge does nothing", async () => {
  const native = await import("../src/rider/native.js");
  assert.equal(native.inApp(), false);
  native.nativeOnline(true);
  native.nativePending({ orderId: "x" });
  assert.equal(native.isAndroidBrowser(), false);
});
