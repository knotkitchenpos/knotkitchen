package com.knotkitchen.mdm;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.app.admin.FactoryResetProtectionPolicy;
import android.app.admin.SystemUpdatePolicy;
import android.content.ComponentName;
import android.content.Context;
import android.media.AudioManager;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.UserManager;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Applies an effective policy (the server's merged settings JSON) through
 * DevicePolicyManager. Every step is independent: one failure is reported
 * as a compliance error and the rest still apply.
 */
public final class PolicyEngine {
    private static final String PLAY_STORE = "com.android.vending";

    // policy key -> user restriction
    private static final String[][] RESTRICTIONS = {
            {"blockInstallApps", UserManager.DISALLOW_INSTALL_APPS},
            {"blockUninstallApps", UserManager.DISALLOW_UNINSTALL_APPS},
            {"blockUnknownSources", UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES},
            {"blockFactoryReset", UserManager.DISALLOW_FACTORY_RESET},
            {"blockSafeBoot", UserManager.DISALLOW_SAFE_BOOT},
            {"blockAddUser", UserManager.DISALLOW_ADD_USER},
            {"blockDebugging", UserManager.DISALLOW_DEBUGGING_FEATURES},
            {"blockConfigWifi", UserManager.DISALLOW_CONFIG_WIFI},
            {"blockConfigBluetooth", UserManager.DISALLOW_CONFIG_BLUETOOTH},
            {"blockConfigDateTime", UserManager.DISALLOW_CONFIG_DATE_TIME},
            {"blockConfigVpn", UserManager.DISALLOW_CONFIG_VPN},
            {"blockConfigMobileNetworks", UserManager.DISALLOW_CONFIG_MOBILE_NETWORKS},
            {"blockUsbFileTransfer", UserManager.DISALLOW_USB_FILE_TRANSFER},
            {"blockMountMedia", UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA},
            {"blockAdjustVolume", UserManager.DISALLOW_ADJUST_VOLUME},
    };

    /** Every restriction KKMDM may set; cleared on release. */
    static final String[] ALL_RESTRICTIONS;
    static {
        List<String> l = new ArrayList<>();
        for (String[] r : RESTRICTIONS) l.add(r[1]);
        l.add(UserManager.DISALLOW_BLUETOOTH);
        l.add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY);
        ALL_RESTRICTIONS = l.toArray(new String[0]);
    }

    private final Context c;
    private final DevicePolicyManager dpm;
    private final ComponentName admin;
    private final List<String> errors = new ArrayList<>();

    private PolicyEngine(Context c) {
        this.c = c;
        this.dpm = AgentApp.dpm(c);
        this.admin = AgentApp.admin(c);
    }

    public static List<String> apply(Context c, JSONObject s) {
        PolicyEngine e = new PolicyEngine(c);
        e.run(s);
        return e.errors;
    }

    private interface Step { void run() throws Exception; }

    private void step(String name, Step s) {
        try {
            s.run();
        } catch (Throwable t) {
            errors.add(name + ": " + t.getMessage());
            AgentLog.w("policy", name + " failed: " + t);
        }
    }

    private void run(JSONObject s) {
        if (!AgentApp.isDeviceOwner(c)) {
            errors.add("agent is not Device Owner");
            return;
        }
        JSONObject r = obj(s, "restrictions");
        JSONObject display = obj(s, "display");
        JSONObject audio = obj(s, "audio");
        JSONObject net = obj(s, "network");
        JSONObject time = obj(s, "time");
        JSONObject upd = obj(s, "systemUpdates");
        JSONObject sec = obj(s, "security");

        for (String[] pair : RESTRICTIONS) {
            step(pair[0], () -> setRestriction(pair[1], r.optBoolean(pair[0], false) || guarded(pair[1])));
        }
        // "Debugging allowed" means switched on, too: a factory reset turns
        // USB debugging off, and getting to Developer options inside the kiosk
        // takes a technician session.
        step("adbEnabled", () -> {
            if (!r.optBoolean("blockDebugging", false) && !Kiosk.panelOpen()) dpm.setGlobalSetting(admin, Settings.Global.ADB_ENABLED, "1");
        });
        if (Build.VERSION.SDK_INT >= 29) {
            step("blockUnknownSourcesGlobally", () -> setRestriction(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY, r.optBoolean("blockUnknownSources", true)));
        }
        step("bluetooth", () -> setRestriction(UserManager.DISALLOW_BLUETOOTH, "block".equals(net.optString("bluetooth"))));
        step("screenCapture", () -> dpm.setScreenCaptureDisabled(admin, r.optBoolean("blockScreenCapture", true)));
        step("playStore", () -> {
            if (DeviceInfo.isInstalled(c, PLAY_STORE)) dpm.setApplicationHidden(admin, PLAY_STORE, r.optBoolean("hidePlayStore", true));
        });

        // ---- display / audio ----
        step("stayOn", () -> dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN,
                display.optBoolean("stayOnWhilePlugged", true) ? "7" : "0")); // AC|USB|wireless
        step("screenTimeout", () -> {
            int sec2 = display.optInt("screenTimeoutSec", 1800);
            if (sec2 > 0) dpm.setSystemSetting(admin, Settings.System.SCREEN_OFF_TIMEOUT, String.valueOf(sec2 * 1000L));
        });
        step("brightness", () -> {
            if (display.isNull("brightness") || !display.has("brightness")) return;
            int b = Math.max(10, Math.min(255, display.optInt("brightness")));
            dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS_MODE, "0");
            dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS, String.valueOf(b));
        });
        step("minVolume", () -> enforceMinVolume(c, audio.optInt("minVolumePercent", 0)));

        // ---- time ----
        step("autoTime", () -> {
            boolean req = time.optBoolean("autoTimeRequired", true);
            if (Build.VERSION.SDK_INT >= 30) dpm.setAutoTimeEnabled(admin, req);
            else //noinspection deprecation
                dpm.setAutoTimeRequired(admin, req);
        });
        step("timeZone", () -> {
            String tz = time.optString("timeZone", "");
            if (tz.isEmpty()) return;
            if (Build.VERSION.SDK_INT >= 30) dpm.setAutoTimeZoneEnabled(admin, false);
            else dpm.setGlobalSetting(admin, Settings.Global.AUTO_TIME_ZONE, "0");
            if (!dpm.setTimeZone(admin, tz)) throw new IllegalStateException("setTimeZone refused " + tz);
        });

        // ---- system updates in the maintenance window ----
        step("systemUpdates", () -> {
            String mode = upd.optString("mode", "windowed");
            SystemUpdatePolicy p;
            switch (mode) {
                case "automatic": p = SystemUpdatePolicy.createAutomaticInstallPolicy(); break;
                case "postpone": p = SystemUpdatePolicy.createPostponeInstallPolicy(); break;
                case "none": p = null; break;
                default: p = SystemUpdatePolicy.createWindowedInstallPolicy(minutes(upd.optString("windowStart", "03:00")), minutes(upd.optString("windowEnd", "06:00")));
            }
            dpm.setSystemUpdatePolicy(admin, p);
        });

        // ---- network ----
        step("wifiProfiles", () -> addWifi(net.optJSONArray("wifiProfiles")));
        step("privateDns", () -> {
            if (Build.VERSION.SDK_INT < 29) return;
            JSONObject pd = obj(net, "privateDns");
            String mode = pd.optString("mode", "off");
            if ("host".equals(mode) && !pd.optString("host").isEmpty()) {
                int res = dpm.setGlobalPrivateDnsModeSpecifiedHost(admin, pd.optString("host"));
                if (res != DevicePolicyManager.PRIVATE_DNS_SET_NO_ERROR) throw new IllegalStateException("private DNS host rejected (" + res + ")");
            } else if ("opportunistic".equals(mode)) {
                dpm.setGlobalPrivateDnsModeOpportunistic(admin);
            }
        });
        step("alwaysOnVpn", () -> {
            JSONObject vpn = obj(net, "alwaysOnVpn");
            String pkg = vpn.optString("package", "");
            dpm.setAlwaysOnVpnPackage(admin, pkg.isEmpty() ? null : pkg, vpn.optBoolean("lockdown", false));
        });

        // ---- security ----
        step("frp", () -> {
            if (Build.VERSION.SDK_INT < 30) return; // Android 11+
            JSONArray acc = sec.optJSONArray("frpAccounts");
            List<String> l = new ArrayList<>();
            if (acc != null) for (int i = 0; i < acc.length(); i++) l.add(acc.optString(i));
            if (l.isEmpty()) return;
            dpm.setFactoryResetProtectionPolicy(admin, new FactoryResetProtectionPolicy.Builder()
                    .setFactoryResetProtectionAccounts(l).setFactoryResetProtectionEnabled(true).build());
        });
        step("location", () -> {
            boolean on = obj(s, "location").optBoolean("enabled", false);
            int state = on ? DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED : DevicePolicyManager.PERMISSION_GRANT_STATE_DEFAULT;
            dpm.setPermissionGrantState(admin, c.getPackageName(), Manifest.permission.ACCESS_FINE_LOCATION, state);
        });

        // Bluetooth on/off in the tablet settings screen (Android 12+ makes it a runtime permission).
        step("bluetoothPermission", () -> {
            if (Build.VERSION.SDK_INT >= 31) dpm.setPermissionGrantState(admin, c.getPackageName(),
                    Manifest.permission.BLUETOOTH_CONNECT, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
        });

        // ---- POS: no permission prompts staff could get stuck on ----
        step("posPermissions", () -> {
            String pos = Kiosk.primaryPackage(c);
            if (!DeviceInfo.isInstalled(c, pos)) return;
            List<String> perms = new ArrayList<>();
            perms.add(Manifest.permission.CAMERA);
            if (Build.VERSION.SDK_INT >= 31) {
                perms.add(Manifest.permission.BLUETOOTH_CONNECT);
                perms.add(Manifest.permission.BLUETOOTH_SCAN);
            }
            if (Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS);
            for (String p : perms) dpm.setPermissionGrantState(admin, pos, p, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
        });

        // Kiosk last, so the allowlist reflects everything above.
        errors.addAll(Kiosk.configure(c));
    }

    /**
     * Ends Kiosk.SETTINGS_GUARD: a restriction the policy also controls goes
     * back to the policy's value, the rest are cleared, and USB debugging is
     * switched back on where the policy allows it. From closing a Settings
     * panel, and from every agent start (a crash mid-panel must not leave it on).
     */
    private static boolean guarded(String restriction) {
        if (!Kiosk.panelOpen()) return false;
        for (String g : Kiosk.SETTINGS_GUARD) if (g.equals(restriction)) return true;
        return false;
    }

    static void releaseSettingsGuard(Context c) {
        if (Kiosk.panelOpen() || !AgentApp.isDeviceOwner(c)) return;
        DevicePolicyManager dpm = AgentApp.dpm(c);
        ComponentName admin = AgentApp.admin(c);
        JSONObject p = new Prefs(c).policy();
        JSONObject r = p != null ? p.optJSONObject("restrictions") : null;
        for (String guard : Kiosk.SETTINGS_GUARD) {
            boolean on = false;
            for (String[] pair : RESTRICTIONS) {
                if (pair[1].equals(guard)) on = r != null ? r.optBoolean(pair[0], false) : true;
            }
            try {
                if (on) dpm.addUserRestriction(admin, guard);
                else dpm.clearUserRestriction(admin, guard);
            } catch (Exception e) {
                AgentLog.w("policy", "release " + guard + ": " + e.getMessage());
            }
        }
        try {
            if (r != null && !r.optBoolean("blockDebugging", false)) dpm.setGlobalSetting(admin, Settings.Global.ADB_ENABLED, "1");
        } catch (Exception e) {
            AgentLog.w("policy", "adb back on: " + e.getMessage());
        }
    }

    private void setRestriction(String key, boolean on) {
        if (on) dpm.addUserRestriction(admin, key);
        else dpm.clearUserRestriction(admin, key);
    }

    static void enforceMinVolume(Context c, int pct) {
        if (pct <= 0) return;
        AudioManager am = c.getSystemService(AudioManager.class);
        for (int stream : new int[]{AudioManager.STREAM_MUSIC, AudioManager.STREAM_NOTIFICATION, AudioManager.STREAM_ALARM, AudioManager.STREAM_RING}) {
            try {
                int max = am.getStreamMaxVolume(stream);
                int min = (int) Math.ceil(max * pct / 100.0);
                if (am.getStreamVolume(stream) < min) am.setStreamVolume(stream, min, 0);
            } catch (Exception ignored) {
                // Some streams are fixed on some OEMs; not worth a compliance error.
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void addWifi(JSONArray profiles) {
        if (profiles == null || profiles.length() == 0) return;
        WifiManager wm = c.getApplicationContext().getSystemService(WifiManager.class);
        for (int i = 0; i < profiles.length(); i++) {
            JSONObject p = profiles.optJSONObject(i);
            if (p == null || p.optString("ssid").isEmpty()) continue;
            String ssid = "\"" + p.optString("ssid") + "\"";
            boolean exists = false;
            for (WifiConfiguration w : wm.getConfiguredNetworks()) if (ssid.equals(w.SSID)) exists = true;
            if (exists) continue;
            WifiConfiguration cfg = new WifiConfiguration();
            cfg.SSID = ssid;
            if ("OPEN".equalsIgnoreCase(p.optString("security"))) {
                cfg.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
            } else {
                cfg.preSharedKey = "\"" + p.optString("password") + "\"";
            }
            int id = wm.addNetwork(cfg);
            if (id < 0) throw new IllegalStateException("could not add Wi-Fi " + p.optString("ssid"));
            wm.enableNetwork(id, false);
        }
    }

    /** POS managed configuration (RestrictionsManager on the POS side). */
    public static void applyManagedConfig(Context c, JSONObject cfg) {
        if (cfg == null || !AgentApp.isDeviceOwner(c)) return;
        try {
            Bundle b = new Bundle();
            for (Iterator<String> it = cfg.keys(); it.hasNext(); ) {
                String k = it.next();
                Object v = cfg.opt(k);
                if (v instanceof Boolean) b.putBoolean(k, (Boolean) v);
                else if (v instanceof Integer) b.putInt(k, (Integer) v);
                else if (v != null && v != JSONObject.NULL) b.putString(k, String.valueOf(v));
            }
            AgentApp.dpm(c).setApplicationRestrictions(AgentApp.admin(c), Kiosk.primaryPackage(c), b);
        } catch (Exception e) {
            AgentLog.e("policy", "managed config failed", e);
        }
    }

    /** Undo for release_device_owner: leave the tablet as a normal Android device. */
    public static void clearAll(Context c) {
        DevicePolicyManager dpm = AgentApp.dpm(c);
        ComponentName admin = AgentApp.admin(c);
        for (String r : ALL_RESTRICTIONS) {
            try { dpm.clearUserRestriction(admin, r); } catch (Exception ignored) { }
        }
        try { dpm.setLockTaskPackages(admin, new String[0]); } catch (Exception ignored) { }
        try { dpm.setStatusBarDisabled(admin, false); } catch (Exception ignored) { }
        try { dpm.setKeyguardDisabled(admin, false); } catch (Exception ignored) { }
        try { dpm.setScreenCaptureDisabled(admin, false); } catch (Exception ignored) { }
        try { dpm.setApplicationHidden(admin, PLAY_STORE, false); } catch (Exception ignored) { }
        try { dpm.setSystemUpdatePolicy(admin, null); } catch (Exception ignored) { }
        try { dpm.clearPackagePersistentPreferredActivities(admin, c.getPackageName()); } catch (Exception ignored) { }
        try { dpm.setApplicationRestrictions(admin, Kiosk.primaryPackage(c), new Bundle()); } catch (Exception ignored) { }
        try {
            if (Build.VERSION.SDK_INT >= 30) dpm.setAutoTimeZoneEnabled(admin, true);
            else dpm.setGlobalSetting(admin, Settings.Global.AUTO_TIME_ZONE, "1");
        } catch (Exception ignored) { }
    }

    private static int minutes(String hhmm) {
        String[] p = hhmm.split(":");
        return Integer.parseInt(p[0]) * 60 + (p.length > 1 ? Integer.parseInt(p[1]) : 0);
    }

    private static JSONObject obj(JSONObject o, String k) {
        JSONObject v = o != null ? o.optJSONObject(k) : null;
        return v != null ? v : new JSONObject();
    }
}
