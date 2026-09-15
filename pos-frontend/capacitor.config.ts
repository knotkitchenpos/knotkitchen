import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android app is a shell around the live POS: it loads
 * business.knotkitchen.com, so every deploy reaches the app with no new
 * install. What the web cannot do -- classic Bluetooth and USB printers,
 * keeping the screen on -- is native, in android/app/src/main/java.
 *
 * When the POS cannot be reached the WebView shows public/offline.html,
 * which is bundled into the app.
 */
const config: CapacitorConfig = {
  appId: "com.knotkitchen.pos",
  appName: "KnotKitchen POS",
  webDir: "dist",
  server: {
    url: "https://business.knotkitchen.com",
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 500,
      backgroundColor: "#080F1F",
      showSpinner: false,
    },
  },
};

export default config;
