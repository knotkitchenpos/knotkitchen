package com.knotkitchen.rider;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Updates the app itself (the same approach as the POS app's ShellUpdater).
 *
 * The screens are the live website and never need this; the native part
 * (alerts, picture-in-picture) does. CI publishes each signed build with a
 * small feed (versionCode, versionName, apkUrl, sha256). When it is newer
 * than this install the rider is offered "Install", and the APK streams into
 * a PackageInstaller session. Android 12+ installs it with no further screen
 * once this app is the one that installed itself; otherwise Android's own
 * screen shows once. Android only accepts it signed with this app's key; the
 * SHA-256 catches a broken download.
 */
final class Updater {
    static final String FEED_URL = "https://business.knotkitchen.com/downloads/android/kk-rider-update.json";
    private static final long EVERY_MS = 6 * 60 * 60 * 1000L;
    private static final String STATUS = "com.knotkitchen.rider.UPDATE_STATUS";
    private static long lastCheck;
    // Android's install screen, held while the app was in the background and shown on return.
    private static Intent pendingConfirm;

    private Updater() {}

    /** From MainActivity.onResume: app start, and coming back to the app. */
    static void check(MainActivity activity) {
        if (pendingConfirm != null) {
            Intent confirm = pendingConfirm;
            pendingConfirm = null;
            activity.startActivity(confirm);
            return;
        }
        // A debug build is signed with another key: a release could never install over it.
        if ((activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) return;
        long now = System.currentTimeMillis();
        if (now - lastCheck < EVERY_MS) return;
        lastCheck = now;
        new Thread(() -> {
            try {
                JSONObject m = new JSONObject(new String(get(FEED_URL), StandardCharsets.UTF_8));
                if (m.getLong("versionCode") <= installedVersion(activity)) return;
                activity.runOnUiThread(() -> {
                    if (activity.isFinishing() || activity.isDestroyed()) return;
                    new AlertDialog.Builder(activity)
                            .setTitle("KK Rider update")
                            .setMessage("Version " + m.optString("versionName") + " is ready. The app closes to install it; open it again afterwards.")
                            .setPositiveButton("Install", (d, w) -> {
                                toast(activity, "Downloading the update…");
                                new Thread(() -> install(activity, m)).start();
                            })
                            .setNegativeButton("Later", null)
                            .show();
                });
            } catch (Exception ignored) {
                // Offline, or nothing published yet: the next check tries again.
            }
        }).start();
    }

    @SuppressWarnings("deprecation")
    private static long installedVersion(Context ctx) throws Exception {
        PackageInfo p = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    private static void install(MainActivity activity, JSONObject m) {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        int id = -1;
        try {
            String apkUrl = m.getString("apkUrl");
            if (!apkUrl.startsWith("https://")) throw new IOException("apkUrl is not https");
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(activity.getPackageName());
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            id = installer.createSession(params);
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            try (PackageInstaller.Session session = installer.openSession(id)) {
                HttpURLConnection c = open(apkUrl);
                try (InputStream in = c.getInputStream(); OutputStream out = session.openWrite("base.apk", 0, -1)) {
                    byte[] buf = new byte[64 * 1024];
                    for (int n; (n = in.read(buf)) != -1; ) {
                        sha.update(buf, 0, n);
                        out.write(buf, 0, n);
                    }
                    session.fsync(out);
                } finally {
                    c.disconnect();
                }
                if (!hex(sha.digest()).equalsIgnoreCase(m.getString("sha256"))) throw new IOException("checksum mismatch");
                activity.registerReceiver(new Status(activity), new IntentFilter(STATUS), Context.RECEIVER_NOT_EXPORTED);
                int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
                Intent status = new Intent(STATUS).setPackage(activity.getPackageName());
                session.commit(PendingIntent.getBroadcast(activity, id, status, flags).getIntentSender());
            }
        } catch (Exception e) {
            if (id != -1) {
                try {
                    installer.abandonSession(id);
                } catch (RuntimeException ignored) {}
            }
            toast(activity, "The update didn't download. It will be offered again later.");
        }
    }

    /** Android's answer: it needs the rider (older Android, or unknown apps not yet allowed), or it failed. */
    private static final class Status extends BroadcastReceiver {
        private final MainActivity activity;

        Status(MainActivity activity) { this.activity = activity; }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceive(Context ctx, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm == null) return;
                if (activity.isOnScreen()) activity.startActivity(confirm);
                else pendingConfirm = confirm;
                return; // the final result comes here too
            }
            try {
                activity.unregisterReceiver(this);
            } catch (IllegalArgumentException ignored) {}
            // Success is never heard here: Android stops this process to replace it.
            if (status != PackageInstaller.STATUS_SUCCESS) toast(activity, "The update wasn't installed. It will be offered again later.");
        }
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setUseCaches(false);
        return c;
    }

    private static byte[] get(String url) throws IOException {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) != -1; ) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder s = new StringBuilder();
        for (byte b : bytes) s.append(String.format("%02x", b));
        return s.toString();
    }

    private static void toast(Activity a, String text) {
        a.runOnUiThread(() -> Toast.makeText(a, text, Toast.LENGTH_LONG).show());
    }
}
