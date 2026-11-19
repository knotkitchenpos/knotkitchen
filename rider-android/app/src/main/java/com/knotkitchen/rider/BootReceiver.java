package com.knotkitchen.rider;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a restart (or an app update), back online if the rider was online. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        if (ctx.getSharedPreferences(RiderService.PREFS, Context.MODE_PRIVATE).getBoolean("online", false)) {
            try {
                RiderService.start(ctx, RiderService.ACTION_CHECK);
            } catch (Exception ignored) {
                // Some phones refuse a start this early; opening the app starts it.
            }
        }
    }
}
