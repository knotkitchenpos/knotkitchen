/**
 * The KK Rider Android app (rider-android) loads this web app and adds
 * window.KKRiderApp: a background service that rings for new deliveries with
 * the app closed, and a picture-in-picture card. In a browser it is absent
 * and every call here does nothing.
 */
const bridge = () => (typeof window !== "undefined" ? window.KKRiderApp : undefined);

export const inApp = () => Boolean(bridge());

const call = (name, ...args) => {
  try {
    bridge()?.[name]?.(...args);
  } catch {
    /* an older app without this call */
  }
};

/** A value from the app, or undefined in a browser or an app too old to have it. */
const ask = (name, ...args) => {
  try {
    const b = bridge();
    return typeof b?.[name] === "function" ? b[name](...args) : undefined;
  } catch {
    return undefined;
  }
};

/** In the app: whether Android lets KK Rider notify (true / false), or undefined. */
export const nativeNotificationsOn = () => ask("notificationsEnabled");
export const nativeOpenNotificationSettings = () => call("openNotificationSettings");
/** In the app: a test notification from the phone itself; false when notifications are off. */
export const nativeTestNotification = () => ask("testNotification");

/** Online and approved: the phone stays connected and rings; otherwise it stops. */
export const nativeOnline = (online) => call("setOnline", Boolean(online));

export const nativePrefs = (prefs) => call("setPrefs", prefs?.sound !== false, prefs?.vibration !== false);

/** The delivery waiting to be answered, for the picture-in-picture card ("" when none). */
export const nativePending = (delivery) => call("setPending", delivery ? JSON.stringify(delivery) : "");

/** Where the Android app is downloaded from (published by .github/workflows/build-rider-android.yml). */
export const ANDROID_APP_URL = "https://business.knotkitchen.com/downloads/android/KK-Rider.apk";

export const isAndroidBrowser = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent) && !inApp();
