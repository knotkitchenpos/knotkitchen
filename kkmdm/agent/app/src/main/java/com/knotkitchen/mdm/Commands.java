package com.knotkitchen.mdm;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.location.Location;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStreamReader;

/**
 * Executes server commands. Each command id runs at most once (Prefs keeps
 * the ids seen); progress goes back as delivered -> executing -> succeeded|failed.
 * Reports that cannot be sent are queued and flushed on the next sync.
 */
public final class Commands {
    private Commands() {}

    public static void handle(Context c, JSONObject cmd) {
        String id = cmd.optString("cmdId");
        String type = cmd.optString("type");
        JSONObject params = cmd.optJSONObject("params");
        if (params == null) params = new JSONObject();
        if (!new Prefs(c).markCommandSeen(id)) {
            // Server re-offered it (our ack got lost); just acknowledge again.
            report(c, id, "delivered", null, null);
            return;
        }
        if (cmd.optLong("expiresAt", Long.MAX_VALUE) < System.currentTimeMillis()) return;
        AgentLog.i("cmd", "executing " + type + " " + id);
        report(c, id, "delivered", null, null);
        report(c, id, "executing", null, null);
        try {
            JSONObject result = run(c, id, type, params);
            // null = the result is reported asynchronously (installs, bug reports).
            if (result != null) report(c, id, "succeeded", result, null);
        } catch (Throwable t) {
            AgentLog.e("cmd", type + " failed", t);
            report(c, id, "failed", null, t.getMessage() != null ? t.getMessage() : t.toString());
        }
    }

    private static JSONObject run(Context c, String id, String type, JSONObject p) throws Exception {
        DevicePolicyManager dpm = AgentApp.dpm(c);
        ComponentName admin = AgentApp.admin(c);
        Prefs prefs = new Prefs(c);
        switch (type) {
            case "refresh_status":
                return new JSONObject().put("telemetry", DeviceInfo.telemetry(c)).put("kiosk", Kiosk.state(c));

            case "restart_app": {
                String pos = Kiosk.primaryPackage(c);
                HomeActivity.expectRestart();
                // Hiding a package stops it at once; unhiding brings it back clean.
                dpm.setApplicationHidden(admin, pos, true);
                Thread.sleep(800);
                dpm.setApplicationHidden(admin, pos, false);
                Kiosk.configure(c);
                Kiosk.bringHomeToFront(c);
                return new JSONObject().put("restarted", pos);
            }

            case "reboot":
                report(c, id, "succeeded", new JSONObject().put("rebooting", true), null);
                flushReports(c);
                dpm.reboot(admin);
                return null;

            case "lock":
                dpm.lockNow();
                return new JSONObject().put("locked", true);

            case "apply_policy":
                SyncEngine.reapply(c);
                return new JSONObject().put("errors", prefs.policyErrors());

            case "kiosk_exit_temp": {
                int minutes = p.optInt("minutes", 15);
                Kiosk.enterTechnician(c, minutes, "dashboard");
                return new JSONObject().put("until", prefs.technicianUntil());
            }

            case "kiosk_relock":
                Kiosk.relock(c, "dashboard");
                return new JSONObject().put("locked", true);

            case "lost_mode_on":
                LostModeActivity.sync(c, p);
                return new JSONObject().put("lost", true);

            case "lost_mode_off":
                LostModeActivity.sync(c, null);
                return new JSONObject().put("lost", false);

            case "locate":
                return locate(c);

            case "pull_logs":
                uploadLogs(c, id);
                return new JSONObject().put("uploaded", true);

            case "bugreport":
                // Android shows the user a consent notification; the file arrives in AdminReceiver.
                if (!dpm.requestBugreport(admin)) throw new IllegalStateException("bug report refused (one may be in progress)");
                prefs.queue("bugreportCmd", new JSONObject().put("cmdId", id));
                return null;

            case "install_app":
                AppInstaller.install(c, p, id);
                return null;

            case "uninstall_app":
                AppInstaller.uninstall(c, p.getString("packageName"), id);
                return null;

            case "wipe":
                report(c, id, "succeeded", new JSONObject().put("wiping", true), null);
                flushReports(c);
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    int flags = p.optBoolean("wipeExternal") ? DevicePolicyManager.WIPE_EXTERNAL_STORAGE : 0;
                    dpm.wipeData(flags);
                }, 2000);
                return null;

            case "release_device_owner":
                report(c, id, "succeeded", new JSONObject().put("released", true), null);
                flushReports(c);
                release(c);
                return null;

            default:
                throw new IllegalArgumentException("unknown command " + type);
        }
    }

    /** Returns the tablet to a normal Android device. Development/test use. */
    static void release(Context c) {
        AgentLog.w("cmd", "releasing Device Owner");
        AgentService.stop(c);
        PolicyEngine.clearAll(c);
        new Prefs(c).clearAll();
        AgentApp.dpm(c).clearDeviceOwnerApp(c.getPackageName());
    }

    private static JSONObject locate(Context c) throws Exception {
        JSONObject loc = new Prefs(c).policy() != null ? new Prefs(c).policy().optJSONObject("location") : null;
        if (loc == null || !loc.optBoolean("enabled", false)) throw new IllegalStateException("location is disabled by policy");
        DeviceInfo.grantSelf(c, Manifest.permission.ACCESS_FINE_LOCATION);
        LocationManager lm = c.getSystemService(LocationManager.class);
        Location best = null;
        for (String prov : lm.getProviders(true)) {
            @SuppressWarnings("MissingPermission") Location l = lm.getLastKnownLocation(prov);
            if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
        }
        if (best == null) throw new IllegalStateException("no location fix available");
        return new JSONObject().put("lat", best.getLatitude()).put("lng", best.getLongitude())
                .put("accuracy", best.getAccuracy()).put("at", best.getTime());
    }

    private static void uploadLogs(Context c, String cmdId) throws Exception {
        Api api = new Api(c);
        File agent = AgentLog.file();
        if (agent != null && agent.exists()) api.upload("/device/logs?kind=agent&cmdId=" + cmdId, agent, "text/plain");
        // Our own process's logcat (other apps' logs need READ_LOGS, which a DPC cannot hold).
        File out = new File(c.getCacheDir(), "logcat.txt");
        Process proc = Runtime.getRuntime().exec(new String[]{"logcat", "-d", "-v", "time", "-t", "5000"});
        try (BufferedReader r = new BufferedReader(new InputStreamReader(proc.getInputStream())); FileWriter w = new FileWriter(out)) {
            String line;
            while ((line = r.readLine()) != null) w.write(line + "\n");
        }
        api.upload("/device/logs?kind=logcat&cmdId=" + cmdId, out, "text/plain");
        //noinspection ResultOfMethodCallIgnored
        out.delete();
    }

    // ---------------- reporting ----------------

    public static void report(Context c, String cmdId, String status, JSONObject result, String error) {
        try {
            JSONObject b = new JSONObject().put("cmdId", cmdId).put("status", status);
            if (result != null) b.put("result", result);
            if (error != null) b.put("error", error);
            new Prefs(c).queue("reports", b);
        } catch (Exception ignored) {
        }
        // Sent on the worker thread or the next sync; queued first so nothing is lost.
        if (Looper.myLooper() != Looper.getMainLooper()) flushReports(c);
    }

    public static synchronized void flushReports(Context c) {
        Prefs p = new Prefs(c);
        JSONArray q = p.drain("reports");
        Api api = new Api(c);
        for (int i = 0; i < q.length(); i++) {
            JSONObject r = q.optJSONObject(i);
            try {
                api.post("/device/commands/" + r.getString("cmdId"), r);
            } catch (Api.ApiException e) {
                // 4xx: server will never accept it (unknown/finished command); drop.
                if (e.status >= 500) {
                    requeueFrom(p, q, i);
                    return;
                }
            } catch (Exception e) {
                requeueFrom(p, q, i);
                return;
            }
        }
    }

    private static void requeueFrom(Prefs p, JSONArray q, int from) {
        for (int j = from; j < q.length(); j++) p.queue("reports", q.optJSONObject(j));
    }
}
