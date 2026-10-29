package com.knotkitchen.mdm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.UserManager;

/**
 * Boot, and our own update (MY_PACKAGE_REPLACED). The kiosk itself comes back
 * through HOME (we are the persistent preferred launcher); this restarts the
 * management service and re-applies policy in case an OS update reset anything.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String action = i.getAction();
        // Before first unlock credential-protected storage is closed; the
        // real BOOT_COMPLETED follows (instantly here: keyguard is disabled).
        if (!c.getSystemService(UserManager.class).isUserUnlocked()) return;
        Prefs p = new Prefs(c);
        AgentLog.i("boot", String.valueOf(action));
        if (!p.isEnrolled()) {
            if (p.enrollToken() != null) SyncEngine.request(c, "boot-enroll");
            return;
        }
        SyncEngine.event(c, Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) ? "agent_updated" : "boot",
                Intent.ACTION_MY_PACKAGE_REPLACED.equals(action) ? "Agent updated to " + BuildConfig.VERSION_NAME : "Device booted");
        SyncEngine.reapply(c);
        AgentService.start(c);
        AgentService.scheduleKeepAlive(c);
        SyncEngine.request(c, "boot");
        if (Kiosk.wanted(c)) Kiosk.bringHomeToFront(c);
    }
}
