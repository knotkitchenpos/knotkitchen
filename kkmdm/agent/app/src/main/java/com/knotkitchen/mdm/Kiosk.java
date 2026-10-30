package com.knotkitchen.mdm;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.ActivityOptions;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Single App Kiosk on lock task mode. The agent's HomeActivity is the
 * persistent preferred HOME and starts the POS with lock task enabled, so
 * whenever the POS dies or finishes, HOME comes back and relaunches it.
 */
public final class Kiosk {
    public static final String DEFAULT_POS = "com.knotkitchen.pos";

    private Kiosk() {}

    static JSONObject kioskSettings(Context c) {
        JSONObject p = new Prefs(c).policy();
        JSONObject k = p != null ? p.optJSONObject("kiosk") : null;
        return k != null ? k : new JSONObject();
    }

    public static String primaryPackage(Context c) {
        return kioskSettings(c).optString("primaryPackage", DEFAULT_POS);
    }

    /** Kiosk is wanted: Device Owner, enrolled, policy says so, no technician session. */
    public static boolean wanted(Context c) {
        Prefs prefs = new Prefs(c);
        return AgentApp.isDeviceOwner(c) && prefs.isEnrolled() && kioskSettings(c).optBoolean("enabled", true)
                && !prefs.technicianActive();
    }

    public static boolean setupWizardDone(Context c) {
        return Settings.Secure.getInt(c.getContentResolver(), "user_setup_complete", 0) == 1;
    }

    static String[] lockTaskPackages(Context c) {
        Set<String> pk = new LinkedHashSet<>();
        pk.add(c.getPackageName());
        pk.add(primaryPackage(c));
        JSONArray allowed = kioskSettings(c).optJSONArray("allowedPackages");
        if (allowed != null) for (int i = 0; i < allowed.length(); i++) pk.add(allowed.optString(i));
        if (System.currentTimeMillis() < panelUntil) pk.add(SETTINGS);
        return pk.toArray(new String[0]);
    }

    // ---------------- Settings panels (QuickSettingsActivity) ----------------

    private static final String SETTINGS = "com.android.settings";
    /** A panel's "See more" leads into full Settings, so the door shuts by itself. */
    // Long enough to pair a Bluetooth printer.
    private static final long PANEL_MS = 3 * 60 * 1000L;
    private static volatile long panelUntil;

    /**
     * Opens one of Android's small settings panels (Wi-Fi networks, mobile
     * data). They are Settings activities, which lock task blocks, so Settings
     * joins the allowlist until the agent's screen is back or PANEL_MS ends.
     */
    static boolean openPanel(Activity a, String action) {
        return openPanel(a, new Intent(action));
    }

    static boolean openPanel(Activity a, Intent intent) {
        DevicePolicyManager dpm = AgentApp.dpm(a);
        try {
            panelUntil = System.currentTimeMillis() + PANEL_MS;
            guardSettings(a, true);
            dpm.setLockTaskPackages(AgentApp.admin(a), lockTaskPackages(a));
            a.startActivity(intent);
            Context app = a.getApplicationContext();
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                if (panelUntil == 0 || System.currentTimeMillis() < panelUntil - 1000) return;
                AgentLog.i("kiosk", "settings panel time is up");
                closePanel(app);
                bringHomeToFront(app);
            }, PANEL_MS);
            return true;
        } catch (Exception e) {
            AgentLog.w("kiosk", "panel " + intent.getAction() + ": " + e.getMessage());
            closePanel(a);
            return false;
        }
    }

    /** Settings leaves the allowlist; Android ends its lock task and the POS is back. */
    static void closePanel(Context c) {
        if (panelUntil == 0) return;
        panelUntil = 0;
        try {
            if (wanted(c)) AgentApp.dpm(c).setLockTaskPackages(AgentApp.admin(c), lockTaskPackages(c));
        } catch (Exception e) {
            AgentLog.w("kiosk", "panel close: " + e.getMessage());
        }
        guardSettings(c, false);
    }

    static boolean panelOpen() {
        return System.currentTimeMillis() < panelUntil;
    }

    /**
     * What Settings may not do while it is let in for a panel. Any Settings
     * screen can reach the rest of Settings (a panel's "See more", a page's
     * search), so instead of hoping nobody wanders, the dangerous parts are
     * switched off for those minutes: Developer options, force-stopping or
     * clearing the POS and the agent, accounts, credentials, network reset,
     * location and tethering. Wi-Fi and Bluetooth stay usable.
     */
    static final String[] SETTINGS_GUARD = {
            android.os.UserManager.DISALLOW_DEBUGGING_FEATURES,
            android.os.UserManager.DISALLOW_APPS_CONTROL,
            android.os.UserManager.DISALLOW_MODIFY_ACCOUNTS,
            android.os.UserManager.DISALLOW_CONFIG_CREDENTIALS,
            android.os.UserManager.DISALLOW_NETWORK_RESET,
            android.os.UserManager.DISALLOW_CONFIG_LOCATION,
            android.os.UserManager.DISALLOW_CONFIG_TETHERING,
            android.os.UserManager.DISALLOW_FACTORY_RESET,
    };

    /** On: adds the guard. Off: each guarded restriction back to what the policy says. */
    static void guardSettings(Context c, boolean on) {
        if (on) {
            DevicePolicyManager dpm = AgentApp.dpm(c);
            ComponentName admin = AgentApp.admin(c);
            for (String r : SETTINGS_GUARD) {
                try {
                    dpm.addUserRestriction(admin, r);
                } catch (Exception e) {
                    AgentLog.w("kiosk", "guard " + r + ": " + e.getMessage());
                }
            }
            return;
        }
        Context app = c.getApplicationContext();
        new Thread(() -> PolicyEngine.releaseSettingsGuard(app), "settings-guard").start();
    }

    /** Applies lock task allowlist/features, status bar, keyguard and HOME. Returns errors. */
    public static List<String> configure(Context c) {
        List<String> errors = new ArrayList<>();
        DevicePolicyManager dpm = AgentApp.dpm(c);
        ComponentName admin = AgentApp.admin(c);
        JSONObject k = kioskSettings(c);
        boolean on = wanted(c);
        try {
            dpm.setLockTaskPackages(admin, on ? lockTaskPackages(c) : new String[0]);
            int f = DevicePolicyManager.LOCK_TASK_FEATURE_NONE;
            if (k.optBoolean("showSystemInfo", true)) f |= DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO;
            if (k.optBoolean("showHome", false)) f |= DevicePolicyManager.LOCK_TASK_FEATURE_HOME;
            // Notifications and overview need HOME; Android throws otherwise.
            if (k.optBoolean("showHome", false) && k.optBoolean("showNotifications", false)) f |= DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS;
            if (k.optBoolean("showHome", false) && k.optBoolean("showOverview", false)) f |= DevicePolicyManager.LOCK_TASK_FEATURE_OVERVIEW;
            if (k.optBoolean("showGlobalActions", false)) f |= DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS;
            if (k.optBoolean("showKeyguard", false)) f |= DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD;
            dpm.setLockTaskFeatures(admin, f);
        } catch (Exception e) {
            errors.add("lock task: " + e.getMessage());
        }
        try {
            dpm.setStatusBarDisabled(admin, on && k.optBoolean("disableStatusBar", true));
        } catch (Exception e) {
            errors.add("status bar: " + e.getMessage());
        }
        try {
            dpm.setKeyguardDisabled(admin, on && k.optBoolean("disableKeyguard", true));
        } catch (Exception e) {
            errors.add("keyguard: " + e.getMessage());
        }
        try {
            setHome(c, k.optBoolean("enabled", true) && new Prefs(c).isEnrolled());
        } catch (Exception e) {
            errors.add("home: " + e.getMessage());
        }
        return errors;
    }

    static void setHome(Context c, boolean ours) {
        DevicePolicyManager dpm = AgentApp.dpm(c);
        ComponentName admin = AgentApp.admin(c);
        dpm.clearPackagePersistentPreferredActivities(admin, c.getPackageName());
        if (!ours) return;
        IntentFilter f = new IntentFilter(Intent.ACTION_MAIN);
        f.addCategory(Intent.CATEGORY_HOME);
        f.addCategory(Intent.CATEGORY_DEFAULT);
        dpm.addPersistentPreferredActivity(admin, f, new ComponentName(c, HomeActivity.class));
    }

    public static boolean inLockTask(Context c) {
        return c.getSystemService(ActivityManager.class).getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    /** Starts the POS in its own lock task. Returns false when it is not installed. */
    public static boolean launchPos(Activity a) {
        Intent i = a.getPackageManager().getLaunchIntentForPackage(primaryPackage(a));
        if (i == null) return false;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        if (wanted(a) && AgentApp.dpm(a).isLockTaskPermitted(primaryPackage(a))) {
            ActivityOptions o = ActivityOptions.makeBasic();
            o.setLockTaskEnabled(true);
            a.startActivity(i, o.toBundle());
        } else {
            a.startActivity(i);
        }
        return true;
    }

    /**
     * Brings HOME (and so the POS) to the front, e.g. after the kiosk drifted.
     * Allowed for a Device Owner from the background. It must be a real HOME
     * intent: an explicitly started HomeActivity is not the system's home
     * activity, and the old launcher would surface when the POS dies.
     */
    public static void bringHomeToFront(Context c) {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage(c.getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }

    /** "locked" | "unlocked" | "technician" | "lost" | "error" */
    public static String state(Context c) {
        Prefs p = new Prefs(c);
        if (p.lostMode() != null) return "lost";
        if (p.technicianActive()) return "technician";
        if (!AgentApp.isDeviceOwner(c)) return "error";
        if (!DeviceInfo.isInstalled(c, primaryPackage(c))) return "error";
        if (!kioskSettings(c).optBoolean("enabled", true)) return "unlocked";
        return inLockTask(c) ? "locked" : "unlocked";
    }

    /**
     * What the kiosk looks like to Android right now, for the device's event
     * log: lock task mode, the features in force, and the two "setup finished"
     * flags. SystemUI keeps Home and the pull-down shade off until both are 1,
     * whatever the lock task features say.
     */
    static String describe(Context c) {
        int mode = c.getSystemService(ActivityManager.class).getLockTaskModeState();
        String m = mode == ActivityManager.LOCK_TASK_MODE_LOCKED ? "locked" : mode == ActivityManager.LOCK_TASK_MODE_PINNED ? "PINNED" : "none";
        int f = 0;
        try {
            f = AgentApp.dpm(c).getLockTaskFeatures(AgentApp.admin(c));
        } catch (Exception ignored) {
        }
        String features = ((f & DevicePolicyManager.LOCK_TASK_FEATURE_HOME) != 0 ? "home " : "")
                + ((f & DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS) != 0 ? "notifications " : "")
                + ((f & DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO) != 0 ? "systeminfo " : "");
        return "mode=" + m + " features=[" + features.trim() + "]"
                + " user_setup_complete=" + Settings.Secure.getInt(c.getContentResolver(), "user_setup_complete", -1)
                + " device_provisioned=" + Settings.Global.getInt(c.getContentResolver(), Settings.Global.DEVICE_PROVISIONED, -1)
                + " adb=" + Settings.Global.getInt(c.getContentResolver(), Settings.Global.ADB_ENABLED, -1);
    }

    public static String stateError(Context c) {
        if (!AgentApp.isDeviceOwner(c)) return "agent is not Device Owner";
        if (!DeviceInfo.isInstalled(c, primaryPackage(c))) return primaryPackage(c) + " is not installed";
        if (!setupWizardDone(c)) return "setup wizard still running";
        return null;
    }

    // ---- technician escape ----

    public static void enterTechnician(Context c, int minutes, String by) {
        long until = System.currentTimeMillis() + minutes * 60_000L;
        new Prefs(c).setTechnicianUntil(until);
        // Dropping every package from the allowlist ends lock task on all tasks.
        configure(c);
        AlarmManager am = c.getSystemService(AlarmManager.class);
        PendingIntent pi = PendingIntent.getBroadcast(c, 7, new Intent(c, AlarmReceiver.class).setAction(AlarmReceiver.RELOCK),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, until, pi);
        else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, until, pi);
        SyncEngine.event(c, "kiosk_technician", "Technician mode for " + minutes + " min (" + by + ")");
        AgentLog.i("kiosk", "technician mode until " + until + " by " + by);
    }

    public static void relock(Context c, String why) {
        new Prefs(c).setTechnicianUntil(0);
        configure(c);
        SyncEngine.event(c, "kiosk_relocked", why);
        bringHomeToFront(c);
    }
}
