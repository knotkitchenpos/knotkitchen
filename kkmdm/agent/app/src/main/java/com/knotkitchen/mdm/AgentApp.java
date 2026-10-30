package com.knotkitchen.mdm;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;

public class AgentApp extends Application {
    public static final String CHANNEL = "kkmdm";
    /** The ongoing "Tablet settings" entry in the shade: full row and a status bar icon, not tucked under Silent. */
    public static final String TABLET_CHANNEL = "tablet_settings";

    @Override
    public void onCreate() {
        super.onCreate();
        AgentLog.init(this);
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Device management", NotificationManager.IMPORTANCE_MIN);
        ch.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
        NotificationChannel tablet = new NotificationChannel(TABLET_CHANNEL, "Tablet settings", NotificationManager.IMPORTANCE_LOW);
        tablet.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(tablet);
        AgentLog.i("app", "started, device owner=" + isDeviceOwner(this));
        // A Settings panel left open when the process died leaves its guard on.
        if (isDeviceOwner(this)) new Thread(() -> PolicyEngine.releaseSettingsGuard(this), "settings-guard").start();
    }

    public static ComponentName admin(Context c) {
        return new ComponentName(c, AdminReceiver.class);
    }

    public static DevicePolicyManager dpm(Context c) {
        return c.getSystemService(DevicePolicyManager.class);
    }

    public static boolean isDeviceOwner(Context c) {
        return dpm(c).isDeviceOwnerApp(c.getPackageName());
    }
}
