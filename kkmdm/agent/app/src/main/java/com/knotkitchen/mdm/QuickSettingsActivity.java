package com.knotkitchen.mdm;

import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

/**
 * The tablet's own quick settings, inside the kiosk. Android keeps its Quick
 * Settings tiles off in lock task mode whatever the policy says, so the agent
 * does the same jobs as Device Owner: Wi-Fi and Bluetooth on/off, brightness,
 * auto-rotate. Choosing a Wi-Fi network, mobile data and Bluetooth pairing use
 * Android's own screens (Settings.Panel on Android 10+, and the Bluetooth
 * settings page), which belong to the Settings app; Settings is let into the
 * kiosk only while one is open (Kiosk.openPanel).
 *
 * Opened from the KK Agent notification in the pull-down shade, or by the
 * POS with the com.knotkitchen.mdm.action.QUICK_SETTINGS action.
 */
public class QuickSettingsActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout list;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.NAVY);
        scroll.setFillViewport(true);
        LinearLayout outer = Ui.column(this, Ui.NAVY);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        outer.addView(list, new LinearLayout.LayoutParams(Math.min(Ui.dp(this, 560), getResources().getDisplayMetrics().widthPixels - Ui.dp(this, 32)),
                ViewGroup.LayoutParams.WRAP_CONTENT));
        scroll.addView(outer);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from a Settings panel: Settings leaves the kiosk again.
        Kiosk.closePanel(this);
        render();
        // Wi-Fi and Bluetooth take a moment to switch; keep the rows current.
        handler.postDelayed(this::refresh, 1500);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacksAndMessages(null);
    }

    private void refresh() {
        render();
        handler.postDelayed(this::refresh, 2000);
    }

    private void render() {
        list.removeAllViews();
        list.addView(Ui.text(this, "Tablet settings", 24, Color.WHITE, true));
        android.os.BatteryManager bm = getSystemService(android.os.BatteryManager.class);
        if (bm != null) {
            int pct = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
            if (pct >= 0 && pct <= 100) list.addView(Ui.text(this, "Battery " + pct + "%" + (bm.isCharging() ? " · charging" : ""), 15, Ui.MUTED, false));
        }

        // ---- Wi-Fi ----
        WifiManager wifi = getApplicationContext().getSystemService(WifiManager.class);
        boolean wifiOn = wifi != null && wifi.isWifiEnabled();
        LinearLayout w = card(Ui.text(this, "Wi-Fi", 18, Color.WHITE, true), wifiOn ? wifiStatus(wifi) : "Off",
                toggle(wifiOn, on -> {
                    //noinspection deprecation
                    if (wifi != null && wifi.setWifiEnabled(on)) return;
                    // Android 10+ refuses this to apps, Device Owner included on
                    // some builds (the Slate: "setWifiEnabled not allowed"); the
                    // Wi-Fi panel has its own switch.
                    if (Build.VERSION.SDK_INT >= 29) openPanel(Settings.Panel.ACTION_WIFI);
                    else say("Could not switch Wi-Fi");
                }));
        if (Build.VERSION.SDK_INT >= 29) w.addView(small("Choose Wi-Fi network", () -> openPanel(Settings.Panel.ACTION_WIFI)));
        list.addView(w);

        // ---- Mobile data ----
        if (getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY) && Build.VERSION.SDK_INT >= 29) {
            LinearLayout m = card(Ui.text(this, "Mobile data", 18, Color.WHITE, true), simStatus(), null);
            m.addView(small("Open mobile data", () -> openPanel(Settings.Panel.ACTION_INTERNET_CONNECTIVITY)));
            list.addView(m);
        }

        // ---- Bluetooth ----
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt != null) {
            boolean btOn = bt.isEnabled();
            int st = bt.getState();
            String s = st == BluetoothAdapter.STATE_TURNING_ON ? "Turning on…" : st == BluetoothAdapter.STATE_TURNING_OFF ? "Turning off…" : btOn ? "On" : "Off";
            LinearLayout b = card(Ui.text(this, "Bluetooth", 18, Color.WHITE, true), s, toggle(btOn, on -> {
                try {
                    //noinspection deprecation,MissingPermission -- Device Owner is exempt on Android 13+
                    boolean ok = on ? bt.enable() : bt.disable();
                    if (!ok) say("Could not switch Bluetooth");
                } catch (SecurityException e) {
                    say("Bluetooth permission missing");
                }
            }));
            if (btOn) {
                String paired = pairedNames(bt);
                TextView t = Ui.text(this, paired.isEmpty() ? "No paired devices yet" : "Paired: " + paired, 13, Ui.MUTED, false);
                t.setGravity(Gravity.START);
                b.addView(t);
            }
            b.addView(small("Pair a device", this::pairDevice));
            list.addView(b);
        }

        // ---- Brightness ----
        boolean auto = Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS_MODE, 0) == 1;
        LinearLayout br = card(Ui.text(this, "Brightness", 18, Color.WHITE, true), auto ? "Automatic" : null,
                labeled("Auto", toggle(auto, on -> setSystem(Settings.System.SCREEN_BRIGHTNESS_MODE, on ? "1" : "0"))));
        SeekBar bar = new SeekBar(this);
        bar.setMax(255);
        bar.setProgress(Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS, 128));
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar s, int v, boolean user) {
                if (!user) return;
                setSystem(Settings.System.SCREEN_BRIGHTNESS_MODE, "0");
                setSystem(Settings.System.SCREEN_BRIGHTNESS, String.valueOf(Math.max(10, v)));
            }
            @Override public void onStartTrackingTouch(SeekBar s) { handler.removeCallbacksAndMessages(null); }
            @Override public void onStopTrackingTouch(SeekBar s) { handler.postDelayed(QuickSettingsActivity.this::refresh, 2000); }
        });
        bar.setPadding(Ui.dp(this, 8), Ui.dp(this, 16), Ui.dp(this, 8), Ui.dp(this, 8));
        br.addView(bar);
        list.addView(br);

        // ---- Auto-rotate ----
        boolean rotate = Settings.System.getInt(getContentResolver(), Settings.System.ACCELEROMETER_ROTATION, 0) == 1;
        boolean canWrite = Settings.System.canWrite(this);
        LinearLayout r = card(Ui.text(this, "Auto-rotate", 18, Color.WHITE, true),
                canWrite ? (rotate ? "On" : "Off: the screen stays as it is") : "Needs a one-time permission",
                canWrite ? toggle(rotate, on -> {
                    Settings.System.putInt(getContentResolver(), Settings.System.ACCELEROMETER_ROTATION, on ? 1 : 0);
                    // Locking keeps the current orientation, as the system tile does.
                    if (!on) Settings.System.putInt(getContentResolver(), Settings.System.USER_ROTATION,
                            getWindowManager().getDefaultDisplay().getRotation());
                }) : null);
        if (!canWrite) {
            // Android has no Device Owner switch for this one: a technician allows it once.
            if (new Prefs(this).technicianActive()) {
                r.addView(small("Allow it now", () -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + getPackageName())));
                    } catch (ActivityNotFoundException e) {
                        say("Not available on this tablet");
                    }
                }));
            } else {
                TextView t = Ui.text(this, "A technician can allow it from technician mode.", 13, Ui.MUTED, false);
                t.setGravity(Gravity.START);
                r.addView(t);
            }
        }
        list.addView(r);

        Button done = Ui.button(this, "Done", true);
        done.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 52));
        lp.topMargin = Ui.dp(this, 16);
        list.addView(done, lp);
    }

    // ---------------- actions ----------------

    private void openPanel(String action) {
        if (!Kiosk.openPanel(this, action)) say("Not available on this tablet");
    }

    /**
     * Pairing a printer or scanner: Android's Bluetooth device picker, a bare
     * list of nearby devices that pairs on tap and has no way on into
     * Settings (no menu, search or back arrow), unlike the Bluetooth settings
     * page, from which the main Settings screen was a tap away. That page is
     * only the fallback for a tablet without the picker.
     */
    private void pairDevice() {
        Intent picker = new Intent("android.bluetooth.devicepicker.action.LAUNCH")
                .putExtra("android.bluetooth.devicepicker.extra.NEED_AUTH", true)
                .putExtra("android.bluetooth.devicepicker.extra.FILTER_TYPE", 0) // all devices
                .addFlags(Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
        if (picker.resolveActivity(getPackageManager()) != null) {
            if (!Kiosk.openPanel(this, picker)) say("Not available on this tablet");
        } else {
            openPanel(Settings.ACTION_BLUETOOTH_SETTINGS);
        }
    }

    @SuppressWarnings("MissingPermission")
    private static String pairedNames(BluetoothAdapter bt) {
        StringBuilder s = new StringBuilder();
        try {
            for (android.bluetooth.BluetoothDevice d : bt.getBondedDevices()) {
                if (s.length() > 0) s.append(", ");
                s.append(d.getName() != null ? d.getName() : d.getAddress());
            }
        } catch (SecurityException ignored) {
            // permission not granted yet
        }
        return s.toString();
    }

    private void setSystem(String key, String value) {
        try {
            AgentApp.dpm(this).setSystemSetting(AgentApp.admin(this), key, value);
        } catch (Exception e) {
            AgentLog.w("quick", key + ": " + e.getMessage());
            say("Could not change it");
        }
    }

    private String wifiStatus(WifiManager wifi) {
        // Without location access Android hides the network id and name, so
        // "connected" comes from the active network instead.
        android.net.ConnectivityManager cm = getSystemService(android.net.ConnectivityManager.class);
        android.net.NetworkCapabilities caps = cm != null ? cm.getNetworkCapabilities(cm.getActiveNetwork()) : null;
        boolean onWifi = caps != null && caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI);
        if (!onWifi) return "On, not connected";
        WifiInfo info = wifi.getConnectionInfo();
        String ssid = info != null ? info.getSSID() : null;
        if (ssid == null || ssid.contains("unknown ssid")) return "Connected";
        return "Connected to " + ssid.replace("\"", "");
    }

    private String simStatus() {
        android.telephony.TelephonyManager tm = getSystemService(android.telephony.TelephonyManager.class);
        if (tm == null || tm.getSimState() == android.telephony.TelephonyManager.SIM_STATE_ABSENT) return "No SIM card";
        return tm.getNetworkOperatorName() == null || tm.getNetworkOperatorName().isEmpty() ? "SIM ready" : tm.getNetworkOperatorName();
    }

    private void say(String s) {
        android.widget.Toast.makeText(this, s, android.widget.Toast.LENGTH_SHORT).show();
    }

    // ---------------- views ----------------

    private interface OnToggle { void on(boolean on); }

    private Switch toggle(boolean checked, OnToggle f) {
        Switch s = new Switch(this);
        s.setChecked(checked);
        s.setScaleX(1.3f);
        s.setScaleY(1.3f);
        s.setOnCheckedChangeListener((v, on) -> {
            f.on(on);
            handler.postDelayed(this::render, 600);
        });
        return s;
    }

    private LinearLayout labeled(String label, Switch s) {
        LinearLayout l = new LinearLayout(this);
        l.setGravity(Gravity.CENTER_VERTICAL);
        TextView t = Ui.text(this, label, 14, Ui.MUTED, false);
        t.setPadding(0, 0, Ui.dp(this, 12), 0);
        l.addView(t);
        l.addView(s);
        return l;
    }

    /** A dark card: title and status on the left, an optional control on the right. */
    private LinearLayout card(TextView title, String status, android.view.View control) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(Ui.dp(this, 14));
        bg.setColor(Color.parseColor("#111B2E"));
        card.setBackground(bg);
        int p = Ui.dp(this, 16);
        card.setPadding(p, Ui.dp(this, 10), p, Ui.dp(this, 10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = Ui.dp(this, 12);
        card.setLayoutParams(lp);

        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        title.setGravity(Gravity.START);
        title.setPadding(0, 0, 0, 0);
        texts.addView(title);
        if (status != null) {
            TextView s = Ui.text(this, status, 14, Ui.MUTED, false);
            s.setGravity(Gravity.START);
            s.setPadding(0, Ui.dp(this, 2), 0, 0);
            texts.addView(s);
        }
        row.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (control != null) row.addView(control);
        card.addView(row);
        return card;
    }

    private Button small(String label, Runnable r) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(Ui.dp(this, 10));
        bg.setColor(Color.parseColor("#26344B"));
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(this, 46));
        lp.topMargin = Ui.dp(this, 10);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> r.run());
        return b;
    }

    static Intent intent(Context c) {
        return new Intent(c, QuickSettingsActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    }
}
