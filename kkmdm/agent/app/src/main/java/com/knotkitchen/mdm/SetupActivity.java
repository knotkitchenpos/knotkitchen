package com.knotkitchen.mdm;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Fallback enrollment for tablets that were made Device Owner over ADB
 * (scripts/adb-provision) or cannot use QR provisioning:
 *   adb shell am start -n com.knotkitchen.mdm/.SetupActivity --es kkmdm_server URL --es kkmdm_token TOKEN
 * or type the server and token in by hand. Refuses once enrolled.
 */
public class SetupActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Prefs p = new Prefs(this);
        LinearLayout root = Ui.column(this, Color.WHITE);
        root.addView(Ui.text(this, "Set up this tablet", 26, Ui.NAVY, true));
        status = Ui.text(this, "", 15, Color.DKGRAY, false);

        if (p.isEnrolled()) {
            root.addView(Ui.text(this, "Already enrolled as " + p.deviceName() + ".", 16, Color.DKGRAY, false));
            setContentView(root);
            return;
        }
        if (!AgentApp.isDeviceOwner(this)) {
            root.addView(Ui.text(this, "KK Agent must be the Device Owner first. Factory-reset the tablet and scan the "
                    + "enrollment QR, or have a technician run the ADB provisioning script.", 16, Color.DKGRAY, false));
            setContentView(root);
            return;
        }

        String server = getIntent().getStringExtra("kkmdm_server");
        String token = getIntent().getStringExtra("kkmdm_token");
        if (server != null && token != null) {
            p.setEnrollment(server, token);
            AgentLog.i("setup", "enrollment details from intent");
            root.addView(status);
            setContentView(root);
            startEnroll();
            return;
        }

        EditText serverIn = new EditText(this);
        serverIn.setHint("Server, e.g. https://mdm.knotkitchen.com");
        serverIn.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        serverIn.setText(p.server() != null ? p.server() : "https://mdm.knotkitchen.com");
        EditText tokenIn = new EditText(this);
        tokenIn.setHint("Enrollment token");
        tokenIn.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        root.addView(serverIn, new LinearLayout.LayoutParams(Ui.dp(this, 420), LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(tokenIn, new LinearLayout.LayoutParams(Ui.dp(this, 420), LinearLayout.LayoutParams.WRAP_CONTENT));
        android.widget.Button go = Ui.button(this, "Enroll", true);
        go.setOnClickListener(v -> {
            String s = serverIn.getText().toString().trim();
            String t = tokenIn.getText().toString().trim();
            if (!s.startsWith("https://") && !s.startsWith("http://localhost") && !s.startsWith("http://127.0.0.1")) {
                status.setText("The server must be an https:// address.");
                return;
            }
            if (t.length() < 22) {
                status.setText("That token is too short.");
                return;
            }
            p.setEnrollment(s, t);
            startEnroll();
        });
        root.addView(go);
        root.addView(status);
        setContentView(root);
    }

    private void startEnroll() {
        status.setText("Enrolling…");
        AgentService.start(this);
        SyncEngine.request(this, "setup");
        handler.postDelayed(this::poll, 1500);
    }

    private void poll() {
        Prefs p = new Prefs(this);
        if (p.isEnrolled()) {
            status.setText("Enrolled as " + p.deviceName() + ". Starting the POS…");
            handler.postDelayed(() -> {
                Kiosk.bringHomeToFront(this);
                finish();
            }, 1500);
        } else if (p.enrollToken() == null) {
            status.setText("The server refused the token (used, expired or revoked). Ask for a new one.");
        } else {
            handler.postDelayed(this::poll, 1500);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
