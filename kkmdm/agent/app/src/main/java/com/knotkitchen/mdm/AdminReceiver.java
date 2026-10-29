package com.knotkitchen.mdm;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PersistableBundle;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** The Device Owner component (com.knotkitchen.mdm/.AdminReceiver). */
public class AdminReceiver extends DeviceAdminReceiver {

    /**
     * Reads the QR's PROVISIONING_ADMIN_EXTRAS_BUNDLE: only the enrollment
     * token and the server URL, never anything else.
     */
    static void saveProvisioningExtras(Context c, Intent i) {
        if (i == null) return;
        PersistableBundle b = i.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE);
        if (b == null) return;
        String server = b.getString("kkmdm_server");
        String token = b.getString("kkmdm_token");
        Prefs p = new Prefs(c);
        if (server != null && token != null && !p.isEnrolled()) {
            p.setEnrollment(server, token);
            AgentLog.i("provision", "extras received for " + server);
        }
    }

    /** After provisioning: enroll in the background while the setup wizard finishes. */
    static void startEnrollment(Context c) {
        AgentService.start(c);
        SyncEngine.request(c, "provisioned");
    }

    @Override
    public void onEnabled(Context c, Intent i) {
        AgentLog.i("admin", "enabled; device owner=" + AgentApp.isDeviceOwner(c));
    }

    /** Android 8-11 QR flow (12+ uses PolicyComplianceActivity). */
    @Override
    public void onProfileProvisioningComplete(Context c, Intent i) {
        AgentLog.i("admin", "provisioning complete");
        saveProvisioningExtras(c, i);
        startEnrollment(c);
    }

    @Override
    public void onLockTaskModeEntering(Context c, Intent i, String pkg) {
        AgentLog.i("kiosk", "lock task entering " + pkg);
    }

    @Override
    public void onLockTaskModeExiting(Context c, Intent i) {
        AgentLog.i("kiosk", "lock task exiting");
        SyncEngine.event(c, "kiosk_exited", new Prefs(c).technicianActive() ? "Technician session" : "Lock task ended");
        // Self-heal straight away rather than at the next heartbeat.
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            if (Kiosk.wanted(c) && Kiosk.setupWizardDone(c) && !Kiosk.inLockTask(c)) Kiosk.bringHomeToFront(c);
        }, 1500);
    }

    @Override
    public void onBugreportShared(Context c, Intent i, String hash) {
        Uri uri = i.getData();
        new Thread(() -> {
            String cmdId = null;
            try {
                JSONArray q = new Prefs(c).drain("bugreportCmd");
                if (q.length() > 0) cmdId = q.getJSONObject(q.length() - 1).optString("cmdId");
                File f = new File(c.getCacheDir(), "bugreport.zip");
                try (InputStream in = c.getContentResolver().openInputStream(uri); OutputStream out = new FileOutputStream(f)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                new Api(c).upload("/device/logs?kind=bugreport" + (cmdId != null ? "&cmdId=" + cmdId : ""), f, "application/zip");
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                if (cmdId != null) Commands.report(c, cmdId, "succeeded", null, null);
            } catch (Exception e) {
                AgentLog.e("bugreport", "upload failed", e);
                if (cmdId != null) Commands.report(c, cmdId, "failed", null, e.getMessage());
            }
        }).start();
    }

    @Override
    public void onBugreportFailed(Context c, Intent i, int failureCode) {
        JSONArray q = new Prefs(c).drain("bugreportCmd");
        if (q.length() > 0) {
            Commands.report(c, q.optJSONObject(q.length() - 1).optString("cmdId"), "failed", null, "bug report failed (" + failureCode + ")");
            SyncEngine.request(c, "bugreport-failed");
        }
    }

    @Override
    public void onBugreportSharingDeclined(Context c, Intent i) {
        onBugreportFailed(c, i, -1);
    }
}
