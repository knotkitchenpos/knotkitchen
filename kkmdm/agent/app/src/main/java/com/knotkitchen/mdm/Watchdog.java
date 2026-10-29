package com.knotkitchen.mdm;

import android.content.Context;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * POS crash/exit watchdog. HOME relaunches the POS whenever it leaves the
 * screen. A POS that exits within QUICK_EXIT_MS of being launched counts as
 * a crash; too many in the window is a crash loop, which backs off
 * (30s, 60s, ... 5 min) and is reported so the dashboard alerts. A POS that
 * ran normally and was closed (Back on its root screen) is just reopened.
 */
public final class Watchdog {
    public static final long QUICK_EXIT_MS = 15_000;

    private Watchdog() {}

    private static JSONObject settings(Context c) {
        JSONObject p = new Prefs(c).policy();
        JSONObject w = p != null ? p.optJSONObject("watchdog") : null;
        return w != null ? w : new JSONObject();
    }

    private static long windowMs(Context c) {
        return settings(c).optInt("crashLoopWindowSec", 120) * 1000L;
    }

    public static int recentLaunches(Context c) {
        long cutoff = System.currentTimeMillis() - windowMs(c);
        int n = 0;
        for (long t : new Prefs(c).launchTimes()) if (t > cutoff) n++;
        return n;
    }

    public static void recordQuickExit(Context c) {
        Prefs p = new Prefs(c);
        long cutoff = System.currentTimeMillis() - Math.max(windowMs(c), 600_000);
        List<Long> keep = new ArrayList<>();
        for (long t : p.launchTimes()) if (t > cutoff) keep.add(t);
        keep.add(System.currentTimeMillis());
        p.setLaunchTimes(keep);
    }

    /** Delay before the next POS launch. */
    public static long nextDelayMs(Context c) {
        int threshold = settings(c).optInt("crashLoopThreshold", 5);
        int n = recentLaunches(c);
        long base = settings(c).optInt("relaunchDelaySec", 2) * 1000L;
        if (n < threshold) return n == 0 ? 0 : base;
        int over = n - threshold + 1;
        return Math.min(300_000L, 30_000L * over);
    }

    public static boolean inCrashLoop(Context c) {
        return recentLaunches(c) >= settings(c).optInt("crashLoopThreshold", 5);
    }

    /** Heartbeat self-heal: if the kiosk should be locked but is not, bring it back. */
    public static void verifyKiosk(Context c) {
        try {
            JSONObject p = new Prefs(c).policy();
            JSONObject audio = p != null ? p.optJSONObject("audio") : null;
            if (audio != null) PolicyEngine.enforceMinVolume(c, audio.optInt("minVolumePercent", 0));
            if (!Kiosk.wanted(c) || !Kiosk.setupWizardDone(c) || new Prefs(c).lostMode() != null) return;
            if (!Kiosk.inLockTask(c)) {
                AgentLog.w("watchdog", "kiosk not locked, restoring");
                SyncEngine.event(c, "kiosk_drift", "Lock task was not active; restored");
                Kiosk.configure(c);
                Kiosk.bringHomeToFront(c);
            }
        } catch (Exception e) {
            AgentLog.e("watchdog", "verify failed", e);
        }
    }
}
