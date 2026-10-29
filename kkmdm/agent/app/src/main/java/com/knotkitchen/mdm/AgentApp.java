package com.knotkitchen.mdm;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;

public class AgentApp extends Application {
    public static final String CHANNEL = "kkmdm";

    @Override
    public void onCreate() {
        super.onCreate();
        AgentLog.init(this);
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Device management", NotificationManager.IMPORTANCE_MIN);
        ch.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
        AgentLog.i("app", "started, device owner=" + isDeviceOwner(this));
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
