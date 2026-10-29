package com.knotkitchen.mdm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Keep-alive (restarts the service) and the technician-mode auto re-lock. */
public class AlarmReceiver extends BroadcastReceiver {
    static final String KEEPALIVE = "com.knotkitchen.mdm.KEEPALIVE";
    static final String RELOCK = "com.knotkitchen.mdm.RELOCK";

    @Override
    public void onReceive(Context c, Intent i) {
        if (RELOCK.equals(i.getAction())) {
            AgentLog.i("alarm", "technician time is up, re-locking");
            Kiosk.relock(c, "technician time expired");
            return;
        }
        if (new Prefs(c).isEnrolled()) {
            AgentService.start(c);
            SyncEngine.request(c, "keepalive");
        }
    }
}
