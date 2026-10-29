package com.knotkitchen.mdm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

import org.json.JSONObject;

/** PackageInstaller results for installs and uninstalls. */
public class InstallReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        String pkg = i.getStringExtra("pkg");
        String cmdId = i.getStringExtra("cmdId");
        boolean uninstall = i.getBooleanExtra("uninstall", false);
        String what = (uninstall ? "uninstall " : "install ") + pkg;

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Should not happen for a Device Owner; surface it rather than hang.
            AgentLog.w("install", what + " wants user action");
            Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) c.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return;
        }
        AppInstaller.sessionFinished(c);
        boolean ok = status == PackageInstaller.STATUS_SUCCESS;
        AgentLog.i("install", what + (ok ? " ok" : " failed: " + msg));
        SyncEngine.event(c, ok ? (uninstall ? "app_uninstalled" : "app_installed") : "app_install_failed",
                what + (uninstall ? "" : " " + i.getLongExtra("versionCode", 0)) + (ok ? "" : ": " + msg));
        if (cmdId != null) {
            try {
                JSONObject result = new JSONObject().put("packageName", pkg).put("status", status);
                Commands.report(c, cmdId, ok ? "succeeded" : "failed", result, ok ? null : msg);
            } catch (Exception ignored) {
            }
        }
        // A fresh POS needs its lock task permission and managed config again.
        if (ok && !uninstall && pkg != null && pkg.equals(Kiosk.primaryPackage(c))) {
            SyncEngine.reapply(c);
            PolicyEngine.applyManagedConfig(c, new Prefs(c).managedConfig());
            Kiosk.bringHomeToFront(c);
        }
        SyncEngine.request(c, "install-result");
    }
}
