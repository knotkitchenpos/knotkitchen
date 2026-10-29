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
        return pk.toArray(new String[0]);
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
