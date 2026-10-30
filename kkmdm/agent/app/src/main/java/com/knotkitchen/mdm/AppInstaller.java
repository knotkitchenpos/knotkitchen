package com.knotkitchen.mdm;

import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.UserManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Silent installs as Device Owner via PackageInstaller. Every APK is
 * checked against the SHA-256 the server recorded at upload before it is
 * handed to the system.
 */
public final class AppInstaller {
    private static final Set<String> inFlight = new HashSet<>();
    // Sessions committed but not yet reported back by InstallReceiver.
    private static final AtomicInteger openSessions = new AtomicInteger();

    private AppInstaller() {}

    /**
     * DISALLOW_INSTALL_APPS / DISALLOW_UNINSTALL_APPS also stop the Device
     * Owner's own PackageInstaller (Android 10 at least), so the agent lifts
     * them for its own session and puts them back once the last one finishes.
     */
    private static void liftRestrictions(Context c) {
        openSessions.incrementAndGet();
        DevicePolicyManager dpm = AgentApp.dpm(c);
        ComponentName admin = AgentApp.admin(c);
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS);
        dpm.clearUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS);
    }

    /** Called with every install/uninstall result. */
    static void sessionFinished(Context c) {
        if (openSessions.decrementAndGet() > 0) return;
        openSessions.set(0);
        JSONObject p = new Prefs(c).policy();
        JSONObject r = p != null ? p.optJSONObject("restrictions") : null;
        if (r == null) return;
        DevicePolicyManager dpm = AgentApp.dpm(c);
        ComponentName admin = AgentApp.admin(c);
        if (r.optBoolean("blockInstallApps", true)) dpm.addUserRestriction(admin, UserManager.DISALLOW_INSTALL_APPS);
        if (r.optBoolean("blockUninstallApps", true)) dpm.addUserRestriction(admin, UserManager.DISALLOW_UNINSTALL_APPS);
    }

    /**
     * Desired-state reconcile. Missing apps install at once; updates wait for
     * the maintenance window unless the rollout says otherwise.
     */
    public static void reconcile(Context c, JSONArray desired, boolean windowOpen) {
        if (desired == null) return;
        for (int i = 0; i < desired.length(); i++) {
            JSONObject a = desired.optJSONObject(i);
            if (a == null) continue;
            String pkg = a.optString("packageName");
            long want = a.optLong("versionCode");
            PackageInfo have = DeviceInfo.packageInfo(c, pkg);
            if (have != null && have.getLongVersionCode() == want) continue;
            boolean missing = have == null;
            boolean waitForWindow = !missing && a.optBoolean("respectMaintenanceWindow", true) && !windowOpen;
            if (waitForWindow) continue;
            // Downgrades (rollback) need uninstall first; never for the agent itself,
            // nor a system component (Android System WebView): uninstalling it
            // drops every update back to the factory version.
            boolean downgrade = have != null && have.getLongVersionCode() > want;
            boolean system = have != null && have.applicationInfo != null
                    && (have.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0;
            if (downgrade && (pkg.equals(c.getPackageName()) || system)) continue;
            try {
                if (downgrade) {
                    AgentLog.i("install", "rollback " + pkg + " " + have.getLongVersionCode() + " -> " + want + ": uninstalling first");
                    uninstallBlocking(c, pkg);
                }
                install(c, a, null);
            } catch (Exception e) {
                AgentLog.e("install", "reconcile " + pkg + " failed", e);
                SyncEngine.event(c, "app_install_failed", pkg + " " + want + ": " + e.getMessage());
            }
        }
    }

    /** Downloads, verifies and installs. cmdId (optional) receives the result. */
    public static void install(Context c, JSONObject a, String cmdId) throws Exception {
        String pkg = a.optString("packageName");
        String key = pkg + "@" + a.optLong("versionCode");
        synchronized (inFlight) {
            if (!inFlight.add(key)) return;
        }
        try {
            String url = a.optString("url", "");
            if (url.isEmpty()) url = new Prefs(c).server() + "/device/apps/" + a.optString("versionId") + "/download";
            File apk = new File(c.getCacheDir(), "dl-" + pkg + ".apk");
            AgentLog.i("install", "downloading " + key);
            new Api(c).download(url, apk);
            String sha = sha256(apk);
            if (!sha.equalsIgnoreCase(a.optString("sha256"))) {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                throw new SecurityException("checksum mismatch for " + pkg);
            }
            PackageInstaller pi = c.getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(pkg);
            // The restriction is checked when the session is created, so lift it first.
            liftRestrictions(c);
            boolean committed = false;
            try {
                int sessionId = pi.createSession(params);
                try (PackageInstaller.Session s = pi.openSession(sessionId)) {
                    try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("base.apk", 0, apk.length())) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                        s.fsync(out);
                    }
                    Intent i = new Intent(c, InstallReceiver.class)
                            .putExtra("pkg", pkg).putExtra("versionCode", a.optLong("versionCode")).putExtra("cmdId", cmdId);
                    PendingIntent cb = PendingIntent.getBroadcast(c, sessionId, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                    s.commit(cb.getIntentSender());
                    committed = true;
                }
            } finally {
                // From here InstallReceiver (or, for our own update, BootReceiver) restores it.
                if (!committed) sessionFinished(c);
            }
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
            AgentLog.i("install", "committed " + key);
        } finally {
            synchronized (inFlight) {
                inFlight.remove(key);
            }
        }
    }

    public static void uninstall(Context c, String pkg, String cmdId) {
        Intent i = new Intent(c, InstallReceiver.class).putExtra("pkg", pkg).putExtra("cmdId", cmdId).putExtra("uninstall", true);
        PendingIntent cb = PendingIntent.getBroadcast(c, pkg.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        liftRestrictions(c);
        try {
            c.getPackageManager().getPackageInstaller().uninstall(pkg, cb.getIntentSender());
        } catch (RuntimeException e) {
            sessionFinished(c);
            throw e;
        }
    }

    private static void uninstallBlocking(Context c, String pkg) throws InterruptedException {
        uninstall(c, pkg, null);
        for (int i = 0; i < 60 && DeviceInfo.isInstalled(c, pkg); i++) Thread.sleep(500);
    }

    static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
