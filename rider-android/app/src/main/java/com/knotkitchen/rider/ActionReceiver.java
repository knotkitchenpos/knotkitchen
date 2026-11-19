package com.knotkitchen.rider;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/**
 * ✅ Accept / ✖ Decline on the new-delivery alert and the picture-in-picture
 * card: answered through the Rider API with the rider's own session, app
 * open or not. The bell stops at once; the result is a short notification.
 */
public class ActionReceiver extends BroadcastReceiver {
    static final String ACCEPT = "com.knotkitchen.rider.ACCEPT";
    static final String DECLINE = "com.knotkitchen.rider.DECLINE";
    static final String REFRESH = "com.knotkitchen.rider.REFRESH";
    static final int ID_RESULT = 3;

    static PendingIntent intent(Context ctx, String action, String orderId) {
        Intent i = new Intent(ctx, ActionReceiver.class).setAction(action).putExtra("orderId", orderId);
        return PendingIntent.getBroadcast(ctx, (action + orderId).hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        final String action = intent.getAction();
        final String id = String.valueOf(intent.getStringExtra("orderId")).replaceAll("[^a-fA-F0-9]", "");
        if (id.isEmpty() || !(ACCEPT.equals(action) || DECLINE.equals(action))) return;
        final boolean accept = ACCEPT.equals(action);
        RiderService.start(ctx, RiderService.ACTION_SILENCE);
        final PendingResult pending = goAsync();
        new Thread(() -> {
            String title;
            String text;
            try {
                Api.Reply r = accept
                        ? Api.post("/deliveries/" + id + "/accept", "{}")
                        : Api.post("/deliveries/" + id + "/reject", "{\"reason\":\"Not available\"}");
                JSONObject body = new JSONObject(r.body.isEmpty() ? "{}" : r.body);
                if (r.ok()) {
                    String n = body.optJSONObject("data") != null && body.getJSONObject("data").optJSONObject("delivery") != null
                            ? body.getJSONObject("data").getJSONObject("delivery").optString("orderNumber") : "";
                    title = accept ? "Accepted order #" + n + " ✅" : "Declined order #" + n;
                    text = accept ? "Open KK Rider to start the ride." : "The store has been told.";
                } else {
                    title = accept ? "Couldn't accept" : "Couldn't decline";
                    text = body.optString("message", "Open KK Rider and try again.");
                }
            } catch (Exception e) {
                title = accept ? "Couldn't accept" : "Couldn't decline";
                text = "No connection. Open KK Rider and try again.";
            }
            Notification n = new Notification.Builder(ctx, RiderService.CH_ONLINE)
                    .setSmallIcon(R.drawable.ic_stat_rider)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setAutoCancel(true)
                    .setContentIntent(RiderService.openApp(ctx, id))
                    .build();
            ctx.getSystemService(NotificationManager.class).notify(ID_RESULT, n);
            // The service looks again (another delivery may be waiting); an open app refreshes.
            RiderService.start(ctx, RiderService.ACTION_CHECK);
            ctx.sendBroadcast(new Intent(REFRESH).setPackage(ctx.getPackageName()));
            pending.finish();
        }).start();
    }
}
