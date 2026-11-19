package com.knotkitchen.rider;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.engineio.client.transports.WebSocket;

/**
 * While the rider is online: one live connection to KnotKitchen (the same
 * Socket.IO room the web app uses), kept by a foreground service so it
 * survives the app being closed. When a delivery is assigned it rings the
 * store's bell on a loop, buzzes, and shows a high-priority alert with
 * Accept / Decline (and the full screen, like a call, on a locked phone),
 * until the delivery is answered. A minute's poll backs the connection up.
 */
public class RiderService extends Service {
    static final String ACTION_CHECK = "com.knotkitchen.rider.CHECK";
    static final String ACTION_SILENCE = "com.knotkitchen.rider.SILENCE";
    static final String CH_ONLINE = "online";
    static final String CH_NEW = "new_delivery_v1";
    static final int ID_ONLINE = 1;
    static final int ID_ALERT = 2;
    static final String PREFS = "kk_rider";

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private Socket socket;
    private MediaPlayer bell;
    private String ringingFor = "";
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            check();
            main.postDelayed(this, 60_000);
        }
    };

    /** Start (or nudge) the service. */
    static void start(Context ctx, String action) {
        Intent i = new Intent(ctx, RiderService.class).setAction(action == null ? ACTION_CHECK : action);
        ctx.startForegroundService(i);
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, RiderService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        channels(this);
        Notification n = new Notification.Builder(this, CH_ONLINE)
                .setSmallIcon(R.drawable.ic_stat_rider)
                .setContentTitle("You're online")
                .setContentText("KK Rider will ring for new deliveries.")
                .setOngoing(true)
                .setContentIntent(openApp(this, null))
                .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(ID_ONLINE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(ID_ONLINE, n);
        }
        connect();
        main.postDelayed(poll, 60_000);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_CHECK : intent.getAction();
        if (ACTION_SILENCE.equals(action)) silence();
        check();
        return START_STICKY;
    }

    private void connect() {
        try {
            IO.Options o = new IO.Options();
            o.path = "/rider/socket.io";
            o.query = "app=rider";
            o.transports = new String[] { WebSocket.NAME };
            o.reconnection = true;
            o.reconnectionDelay = 2000;
            o.reconnectionDelayMax = 15000;
            Map<String, List<String>> headers = new HashMap<>();
            headers.put("Cookie", Collections.singletonList(Api.cookie()));
            headers.put("Origin", Collections.singletonList(Api.BASE));
            o.extraHeaders = headers;
            socket = IO.socket(Api.BASE, o);
            socket.on(Socket.EVENT_CONNECT, a -> check());
            socket.on("delivery:updated", a -> check());
            socket.on("rider:account", a -> check());
            socket.connect();
        } catch (Exception e) {
            // The minute's poll still runs.
        }
    }

    /** What's assigned to this rider now: ring for it, or stop ringing. */
    private void check() {
        io.execute(() -> {
            try {
                Api.Reply r = Api.get("/deliveries?scope=active");
                if (r.status == 401) { // signed out on this phone
                    main.post(this::stopSelf);
                    return;
                }
                if (!r.ok()) return;
                JSONArray list = new JSONObject(r.body).getJSONObject("data").getJSONArray("deliveries");
                JSONObject waiting = null;
                int count = 0;
                for (int i = 0; i < list.length(); i++) {
                    JSONObject d = list.getJSONObject(i);
                    if ("assigned".equals(d.optString("stage"))) {
                        count++;
                        if (waiting == null) waiting = d;
                    }
                }
                final JSONObject first = waiting;
                final int n = count;
                main.post(() -> {
                    if (first == null) silence();
                    else alert(first, n);
                });
            } catch (Exception e) {
                // Network hiccup: the next event or poll tries again.
            }
        });
    }

    private void alert(JSONObject d, int count) {
        String id = d.optString("orderId");
        String number = d.optString("orderNumber");
        JSONObject customer = d.optJSONObject("customer");
        JSONObject address = d.optJSONObject("address");
        double collect = d.optDouble("collect", 0);
        double total = d.optJSONObject("bills") != null ? d.optJSONObject("bills").optDouble("total", 0) : 0;
        String money = collect > 0 ? "Collect ₹" + Math.round(collect) + " cash" : "₹" + Math.round(total) + " · Paid";
        String body = (customer != null ? customer.optString("name") + " · " : "")
                + (address != null ? address.optString("text") + " · " : "") + money;

        Notification.Builder b = new Notification.Builder(this, CH_NEW)
                .setSmallIcon(R.drawable.ic_stat_rider)
                .setContentTitle("New Delivery 🚴 Order #" + number + (count > 1 ? "  (+" + (count - 1) + " more)" : ""))
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(openApp(this, id))
                .setFullScreenIntent(openApp(this, id), true)
                .addAction(new Notification.Action.Builder(null, "✅ Accept", ActionReceiver.intent(this, ActionReceiver.ACCEPT, id)).build())
                .addAction(new Notification.Action.Builder(null, "✖ Decline", ActionReceiver.intent(this, ActionReceiver.DECLINE, id)).build());
        getSystemService(NotificationManager.class).notify(ID_ALERT, b.build());
        MainActivity.pending = d.toString();

        if (!id.equals(ringingFor)) {
            ringingFor = id;
            ring();
        }
    }

    private void ring() {
        stopBell();
        try {
            PowerManager pm = getSystemService(PowerManager.class);
            pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kkrider:ring").acquire(60_000);
        } catch (Exception ignored) {}
        if (getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("sound", true)) {
            try {
                bell = MediaPlayer.create(this, R.raw.new_order, new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(), 0);
                if (bell != null) {
                    bell.setLooping(true);
                    bell.start();
                }
            } catch (Exception ignored) {}
        }
        if (getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("vibration", true)) {
            Vibrator v = getSystemService(Vibrator.class);
            if (v != null) v.vibrate(VibrationEffect.createWaveform(new long[] { 0, 400, 200, 400, 2700 }, 0));
        }
    }

    private void stopBell() {
        if (bell != null) {
            try { bell.stop(); } catch (Exception ignored) {}
            bell.release();
            bell = null;
        }
        Vibrator v = getSystemService(Vibrator.class);
        if (v != null) v.cancel();
    }

    /** Nothing waiting (or the rider answered): quiet, alert gone. */
    private void silence() {
        ringingFor = "";
        stopBell();
        getSystemService(NotificationManager.class).cancel(ID_ALERT);
        MainActivity.pending = "";
    }

    static PendingIntent openApp(Context ctx, String orderId) {
        Intent i = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (orderId != null) i.putExtra("orderId", orderId);
        return PendingIntent.getActivity(ctx, orderId == null ? 0 : orderId.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void channels(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel online = new NotificationChannel(CH_ONLINE, "Online status", NotificationManager.IMPORTANCE_LOW);
        online.setShowBadge(false);
        nm.createNotificationChannel(online);
        NotificationChannel alert = new NotificationChannel(CH_NEW, "New deliveries", NotificationManager.IMPORTANCE_HIGH);
        // The bell is played by the service, on a loop; the channel stays silent so it isn't doubled.
        alert.setSound(null, null);
        alert.enableVibration(false);
        alert.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(alert);
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(poll);
        silence();
        if (socket != null) {
            socket.off();
            socket.disconnect();
        }
        io.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
