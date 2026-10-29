package com.knotkitchen.mdm;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.LinearLayout;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

/** Lost mode: a locked full-screen message until the dashboard turns it off. */
public class LostModeActivity extends Activity {
    private static WeakReference<LostModeActivity> current = new WeakReference<>(null);

    /** Server state -> device: lost != null shows the screen, null clears it. */
    static void sync(Context c, JSONObject lost) {
        Prefs p = new Prefs(c);
        boolean was = p.lostMode() != null;
        p.setLostMode(lost);
        if (lost != null && !was) {
            SyncEngine.event(c, "lost_mode", "Lost mode on");
            c.startActivity(new Intent(c, LostModeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } else if (lost == null && was) {
            SyncEngine.event(c, "lost_mode", "Lost mode off");
            LostModeActivity a = current.get();
            if (a != null) a.runOnUiThread(a::finish);
            Kiosk.bringHomeToFront(c);
        }
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        current = new WeakReference<>(this);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        JSONObject lost = new Prefs(this).lostMode();
        LinearLayout root = Ui.column(this, Ui.NAVY);
        root.addView(Ui.text(this, "This tablet is locked", 32, Color.WHITE, true));
        root.addView(Ui.text(this, lost != null ? lost.optString("message", "") : "", 20, Color.WHITE, false));
        String phone = lost != null ? lost.optString("phone", "") : "";
        if (!phone.isEmpty()) root.addView(Ui.text(this, "Please call " + phone, 20, Ui.ORANGE, true));
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (new Prefs(this).lostMode() == null) {
            finish();
            return;
        }
        // Our own package is always in the lock task allowlist.
        try {
            startLockTask();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onBackPressed() {
    }
}
