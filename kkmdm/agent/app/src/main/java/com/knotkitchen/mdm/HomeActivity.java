package com.knotkitchen.mdm;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.DateFormat;
import java.util.Date;

/**
 * The kiosk launcher (persistent preferred HOME). Normally visible only for a
 * moment: it pins itself, then starts the POS in lock task. When the POS
 * exits or crashes this comes back to the front and relaunches it.
 *
 * Technician escape: tap the KnotKitchen title 7 times within 4 seconds.
 */
public class HomeActivity extends Activity {
    private static volatile boolean expectRestart;
    private static volatile long lastLaunchAt;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status;
    private LinearLayout techPanel;
    private android.widget.Button setupButton;
    private int taps;
    private long firstTapAt;

    /** The next POS exit is deliberate (restart_app); do not count it as a crash. */
    static void expectRestart() {
        expectRestart = true;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout root = Ui.column(this, Ui.NAVY);
        TextView title = Ui.text(this, "KnotKitchen", 34, Color.WHITE, true);
        title.setOnClickListener(v -> onTitleTap());
        root.addView(title);
        status = Ui.text(this, "Starting POS…", 18, Ui.MUTED, false);
        root.addView(status);

        techPanel = new LinearLayout(this);
        techPanel.setOrientation(LinearLayout.VERTICAL);
        techPanel.setGravity(android.view.Gravity.CENTER);
        techPanel.setVisibility(View.GONE);
        android.widget.Button settings = Ui.button(this, "Open Settings", false);
        settings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        android.widget.Button wifi = Ui.button(this, "Wi-Fi settings", false);
        wifi.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)));
        android.widget.Button pos = Ui.button(this, "Open POS", false);
        pos.setOnClickListener(v -> Kiosk.launchPos(this));
        android.widget.Button relock = Ui.button(this, "Re-lock now", true);
        relock.setOnClickListener(v -> {
            Kiosk.relock(this, "technician on device");
            render();
        });
        techPanel.addView(settings);
        techPanel.addView(wifi);
        techPanel.addView(pos);
        techPanel.addView(relock);
        root.addView(techPanel);

        setupButton = Ui.button(this, "Set up this tablet", true);
        setupButton.setOnClickListener(v -> startActivity(new Intent(this, SetupActivity.class)));
        setupButton.setVisibility(View.GONE);
        root.addView(setupButton);

        TextView footer = Ui.text(this, "", 12, Ui.MUTED, false);
        footer.setId(View.generateViewId());
        footer.setTag("footer");
        root.addView(footer);
        setContentView(root);
    }

    private void onTitleTap() {
        long now = System.currentTimeMillis();
        if (now - firstTapAt > 4000) {
            firstTapAt = now;
            taps = 0;
        }
        if (++taps >= 7) {
            taps = 0;
            startActivity(new Intent(this, TechnicianActivity.class));
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacksAndMessages(null);
    }

    private void render() {
        handler.removeCallbacksAndMessages(null);
        Prefs p = new Prefs(this);
        TextView footer = getWindow().getDecorView().findViewWithTag("footer");
        footer.setText(p.deviceName() + "  ·  KK Agent " + BuildConfig.VERSION_NAME);
        techPanel.setVisibility(View.GONE);
        setupButton.setVisibility(View.GONE);

        if (p.lostMode() != null) {
            startActivity(new Intent(this, LostModeActivity.class));
            return;
        }
        if (!AgentApp.isDeviceOwner(this)) {
            status.setText("This tablet is not managed by KnotKitchen yet.");
            showSetupButton();
            return;
        }
        if (!p.isEnrolled()) {
            status.setText(p.enrollToken() != null ? "Connecting to KnotKitchen…" : "Waiting for enrollment.");
            if (p.enrollToken() == null) showSetupButton();
            handler.postDelayed(this::render, 3000);
            SyncEngine.request(this, "home-not-enrolled");
            return;
        }
        if (p.technicianActive()) {
            status.setText("Technician mode until " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(p.technicianUntil())));
            techPanel.setVisibility(View.VISIBLE);
            stopLockTaskSafe();
            return;
        }
        if (!Kiosk.wanted(this)) {
            status.setText("Kiosk is off for this tablet.");
            techPanel.setVisibility(View.VISIBLE);
            return;
        }
        if (!DeviceInfo.isInstalled(this, Kiosk.primaryPackage(this))) {
            status.setText("Installing KnotKitchen POS…");
            SyncEngine.request(this, "pos-missing");
            handler.postDelayed(this::render, 5000);
            return;
        }

        // Pin HOME itself so there is never an unlocked gap between POS launches.
        if (AgentApp.dpm(this).isLockTaskPermitted(getPackageName()) && !Kiosk.inLockTask(this)) {
            try {
                startLockTask();
            } catch (Exception e) {
                AgentLog.w("home", "startLockTask: " + e.getMessage());
            }
        }

        long now = System.currentTimeMillis();
        if (lastLaunchAt > 0 && now - lastLaunchAt < Watchdog.QUICK_EXIT_MS && !expectRestart) {
            Watchdog.recordQuickExit(this);
            SyncEngine.event(this, "pos_crash", "POS exited " + (now - lastLaunchAt) / 1000 + "s after launch");
        }
        expectRestart = false;
        long delay = Watchdog.nextDelayMs(this);
        if (Watchdog.inCrashLoop(this)) {
            status.setText("POS keeps closing. Retrying in " + delay / 1000 + "s…");
            SyncEngine.request(this, "crash-loop");
        } else {
            status.setText("Starting POS…");
        }
        handler.postDelayed(() -> {
            lastLaunchAt = System.currentTimeMillis();
            if (!Kiosk.launchPos(this)) status.setText("POS is not installed.");
        }, Math.max(delay, 300));
    }

    private void showSetupButton() {
        setupButton.setVisibility(View.VISIBLE);
    }

    private void stopLockTaskSafe() {
        try {
            stopLockTask();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onBackPressed() {
        // HOME has nowhere to go back to.
    }
}
