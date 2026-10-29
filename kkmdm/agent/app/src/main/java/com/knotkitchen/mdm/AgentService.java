package com.knotkitchen.mdm;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;

import java.util.concurrent.TimeUnit;

import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Foreground service: heartbeat timer, the WebSocket wake channel, and the
 * network callback that flushes queued work when the tablet reconnects.
 * An inexact 15-minute alarm restarts it if the OS ever kills it.
 */
public class AgentService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebSocket ws;
    private long wsBackoffMs = 2000;
    private boolean stopped;
    private ConnectivityManager.NetworkCallback netCb;

    public static void start(Context c) {
        try {
            c.startForegroundService(new Intent(c, AgentService.class));
        } catch (Exception e) {
            AgentLog.e("service", "start failed", e);
        }
    }

    public static void stop(Context c) {
        c.stopService(new Intent(c, AgentService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        // Android's quick settings tiles are off in the kiosk; this opens the agent's own.
        PendingIntent settings = PendingIntent.getActivity(this, 0, QuickSettingsActivity.intent(this),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, AgentApp.CHANNEL)
                .setContentTitle("Tablet settings")
                .setContentText("Wi-Fi, mobile data, Bluetooth, brightness, auto-rotate")
                .setSmallIcon(android.R.drawable.ic_menu_manage)
                .setContentIntent(settings)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);

        netCb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                AgentLog.i("service", "network available");
                handler.post(() -> {
                    wsBackoffMs = 2000;
                    connectWs();
                    SyncEngine.request(AgentService.this, "network");
                });
            }
        };
        getSystemService(ConnectivityManager.class).registerDefaultNetworkCallback(netCb);
        scheduleKeepAlive(this);
        handler.post(heartbeat);
        connectWs();
    }

    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            if (stopped) return;
            if (ws == null) connectWs();
            SyncEngine.request(AgentService.this, "heartbeat");
            handler.postDelayed(this, TimeUnit.SECONDS.toMillis(new Prefs(AgentService.this).heartbeatSeconds()));
        }
    };

    private void connectWs() {
        Prefs p = new Prefs(this);
        if (stopped || !p.isEnrolled() || ws != null) return;
        try {
            ws = new Api(this).http().newWebSocket(new Api(this).wsRequest().build(), new WebSocketListener() {
                @Override
                public void onOpen(WebSocket s, Response r) {
                    AgentLog.i("push", "connected");
                    wsBackoffMs = 2000;
                }

                @Override
                public void onMessage(WebSocket s, String text) {
                    if (text.contains("\"sync\"")) SyncEngine.request(AgentService.this, "push");
                }

                @Override
                public void onClosed(WebSocket s, int code, String reason) {
                    reconnectLater(s);
                }

                @Override
                public void onFailure(WebSocket s, Throwable t, Response r) {
                    AgentLog.w("push", "failure: " + t.getMessage() + (r != null ? " http " + r.code() : ""));
                    reconnectLater(s);
                }
            });
        } catch (Exception e) {
            AgentLog.e("push", "connect failed", e);
        }
    }

    private void reconnectLater(WebSocket s) {
        handler.post(() -> {
            if (ws == s) ws = null;
            if (stopped) return;
            handler.postDelayed(this::connectWs, wsBackoffMs);
            wsBackoffMs = Math.min(wsBackoffMs * 2, 5 * 60_000);
        });
    }

    static void scheduleKeepAlive(Context c) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = PendingIntent.getBroadcast(c, 1, new Intent(c, AlarmReceiver.class).setAction(AlarmReceiver.KEEPALIVE),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + AlarmManager.INTERVAL_FIFTEEN_MINUTES,
                AlarmManager.INTERVAL_FIFTEEN_MINUTES, pi);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        handler.removeCallbacksAndMessages(null);
        if (ws != null) ws.close(1000, "stopping");
        try {
            getSystemService(ConnectivityManager.class).unregisterNetworkCallback(netCb);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
