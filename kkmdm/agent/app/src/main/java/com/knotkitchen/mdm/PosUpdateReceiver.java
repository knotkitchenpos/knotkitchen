package com.knotkitchen.mdm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;

import org.json.JSONObject;

/**
 * The POS's own updater on a managed tablet. The kiosk policy blocks app
 * installs, so the POS cannot install its update itself; it downloads its
 * update manifest as usual and hands it here, and the agent installs it as
 * Device Owner. HOME brings the new POS back up afterwards.
 *
 * Anyone could send this broadcast, so it only ever updates the kiosk's own
 * POS to a higher version: Android refuses an APK that is not signed with the
 * installed POS's key or is a downgrade, and the SHA-256 must match. When
 * KKMDM itself manages the POS version (managed config pos_updates=kkmdm: a
 * pinned, rolled-out or stable POS build), requests are refused, so the two
 * never fight over the version.
 *
 * Extras: apkUrl (https, or the KKMDM server), sha256, versionCode, versionName.
 */
public class PosUpdateReceiver extends BroadcastReceiver {
    public static final String ACTION = "com.knotkitchen.mdm.action.INSTALL_POS_UPDATE";

    @Override
    public void onReceive(Context c, Intent i) {
        if (!ACTION.equals(i.getAction())) return;
        String refused = refuse(c, i);
        String what = "POS " + i.getStringExtra("versionName") + " (" + i.getLongExtra("versionCode", 0) + ")";
        if (refused != null) {
            AgentLog.w("install", "POS self-update refused: " + refused);
            SyncEngine.event(c, "pos_self_update_refused", what + ": " + refused);
            return;
        }
        AgentLog.i("install", "POS self-update to " + what);
        SyncEngine.event(c, "pos_self_update", what + " requested by the POS");
        JSONObject a = new JSONObject();
        try {
            a.put("packageName", Kiosk.primaryPackage(c));
            a.put("versionCode", i.getLongExtra("versionCode", 0));
            a.put("sha256", i.getStringExtra("sha256"));
            a.put("url", i.getStringExtra("apkUrl"));
        } catch (Exception ignored) {
        }
        // No goAsync: a download can outlast the broadcast timeout. The agent's
        // foreground service keeps the process alive meanwhile.
        new Thread(() -> {
            try {
                AppInstaller.install(c.getApplicationContext(), a, null);
            } catch (Exception e) {
                AgentLog.e("install", "POS self-update failed", e);
                SyncEngine.event(c, "app_install_failed", what + ": " + e.getMessage());
            }
        }, "pos-self-update").start();
    }

    private static String refuse(Context c, Intent i) {
        Prefs p = new Prefs(c);
        if (!AgentApp.isDeviceOwner(c) || !p.isEnrolled()) return "not a managed device";
        JSONObject cfg = p.managedConfig();
        if (cfg != null && "kkmdm".equals(cfg.optString("pos_updates"))) return "KKMDM manages the POS version for this tablet";
        String url = i.getStringExtra("apkUrl");
        if (url == null || !(url.startsWith("https://") || url.startsWith(p.server() + "/"))) return "apkUrl must be https";
        String sha = i.getStringExtra("sha256");
        if (sha == null || !sha.matches("[0-9a-fA-F]{64}")) return "missing sha256";
        PackageInfo have = DeviceInfo.packageInfo(c, Kiosk.primaryPackage(c));
        if (have == null) return "POS is not installed";
        if (i.getLongExtra("versionCode", 0) <= have.getLongVersionCode()) return "not newer than the installed " + have.getLongVersionCode();
        return null;
    }
}
