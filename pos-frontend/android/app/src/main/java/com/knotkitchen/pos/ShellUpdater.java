package com.knotkitchen.pos;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.lifecycle.Lifecycle;
import androidx.lifecycle.LifecycleOwner;

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
 * Updates the app itself, over the air.
 *
 * The POS pages are the live website and never need this; the native shell
 * around them (plugins, manifest) does. CI publishes each release-signed build
 * with a small manifest (versionCode, versionName, apkUrl, sha256); when it is
 * newer than this install, the operator is offered "Install", and the APK is
 * streamed straight into a PackageInstaller session.
 *
 * Android 12+ installs it with no further screen (an app updating itself, with
 * UPDATE_PACKAGES_WITHOUT_USER_ACTION). Older Android, or before "Install
 * unknown apps" is allowed for this app, shows Android's own screen once.
 * Android only accepts it if signed with this app's key; the SHA-256 catches a
 * truncated or half-replaced download.
 */
final class ShellUpdater {

    static final String MANIFEST_URL =
        "https://github.com/knotkitchenpos/knotkitchen/releases/download/android-latest/android-update.json";
    // Calibration knob: how often a till looks (on start, and on coming back after this long).
    private static final long EVERY_MS = 6 * 60 * 60 * 1000L;
    private static final String STATUS = "com.knotkitchen.pos.UPDATE_STATUS";
    // ponytail: in memory, so each app start checks once; SharedPreferences if that gets chatty.
    private static long lastCheck;
    // Android's install screen, held while the app was in the background
    // (Android 10+ refuses to open it from there) and shown on return.
    private static Intent pendingConfirm;

    private ShellUpdater() {}

    /** From MainActivity.onResume: app start, and coming back to the app. */
    static void check(Activity activity) {
        if (pendingConfirm != null) {
            Intent confirm = pendingConfirm;
            pendingConfirm = null;
            activity.startActivity(confirm);
            return;
        }
        // A debug build is signed with another key: a release update could never install over it.
        if ((activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) return;
        long now = System.currentTimeMillis();
        if (now - lastCheck < EVERY_MS) return;
        lastCheck = now;
        new Thread(() -> {
            try {
                JSONObject m = new JSONObject(new String(get(MANIFEST_URL), StandardCharsets.UTF_8));
                long installed = PackageInfoCompat.getLongVersionCode(
                    activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0));
                if (m.getLong("versionCode") <= installed) return;
                activity.runOnUiThread(() -> {
                    if (activity.isFinishing() || activity.isDestroyed()) return;
                    new AlertDialog.Builder(activity)
                        .setTitle("App update available")
                        .setMessage("KnotKitchen POS " + m.optString("versionName")
                            + " is ready. The app closes to install it; open it again afterwards.")
                        .setPositiveButton("Install", (d, w) -> {
                            toast(activity, "Downloading the update...");
                            new Thread(() -> install(activity, m)).start();
                        })
                        .setNegativeButton("Later", null)
                        .show();
                });
            } catch (Exception ignored) {
                // offline, or nothing published yet: the next check tries again
            }
        }).start();
    }

    private static void install(Activity activity, JSONObject m) {
        PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
        int id = -1;
        try {
            String apkUrl = m.getString("apkUrl");
            if (!apkUrl.startsWith("https://")) throw new IOException("apkUrl is not https");
            PackageInstaller.SessionParams params =
                new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(activity.getPackageName());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            }
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
                // As ThermalPrinterPlugin's USB permission: explicit, not exported,
                // mutable on 12+ so the installer can add its result.
                ContextCompat.registerReceiver(activity, new Status(activity), new IntentFilter(STATUS), ContextCompat.RECEIVER_NOT_EXPORTED);
                int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
                Intent status = new Intent(STATUS).setPackage(activity.getPackageName());
                session.commit(PendingIntent.getBroadcast(activity, id, status, flags).getIntentSender());
            }
        } catch (Exception e) {
            if (id != -1) {
                try {
                    installer.abandonSession(id);
                } catch (RuntimeException ignored) {
                    // already gone
                }
            }
            toast(activity, "The update did not download. It will be offered again later.");
        }
    }

    /** Android's answer: it needs the operator (older Android, unknown apps not yet allowed), or it failed. */
    private static final class Status extends BroadcastReceiver {
        private final Activity activity;

        Status(Activity activity) {
            this.activity = activity;
        }

        @Override
        public void onReceive(Context ctx, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm == null) return;
                boolean onScreen = activity instanceof LifecycleOwner
                    && ((LifecycleOwner) activity).getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED);
                if (onScreen) activity.startActivity(confirm);
                else pendingConfirm = confirm;
                return; // the final result comes here too
            }
            try {
                activity.unregisterReceiver(this);
            } catch (IllegalArgumentException ignored) {
                // already unregistered
            }
            // Success is never heard here: Android stops this process to replace it.
            if (status != PackageInstaller.STATUS_SUCCESS) {
                toast(activity, "The update was not installed. It will be offered again later.");
            }
        }
    }

    private static HttpURLConnection open(String url) throws IOException {
        // Follows github.com -> release-assets.githubusercontent.com (https to https) by itself.
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
