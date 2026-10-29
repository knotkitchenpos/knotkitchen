package com.knotkitchen.mdm;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.nio.ByteBuffer;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Technician escape. The PIN is a TOTP over this device's own seed with a
 * 5-minute step, issued from the dashboard (and logged there). Works offline.
 * Five wrong PINs lock the screen for 5 minutes.
 */
public class TechnicianActivity extends Activity {
    private static int failures;
    private static long lockedUntil;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout root = Ui.column(this, Color.WHITE);
        root.addView(Ui.text(this, "Technician access", 26, Ui.NAVY, true));
        root.addView(Ui.text(this, "Enter the 6-digit PIN from the KKMDM dashboard.", 16, Color.DKGRAY, false));
        EditText pin = new EditText(this);
        pin.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pin.setTextSize(28);
        pin.setGravity(android.view.Gravity.CENTER);
        root.addView(pin, new LinearLayout.LayoutParams(Ui.dp(this, 260), LinearLayout.LayoutParams.WRAP_CONTENT));
        TextView status = Ui.text(this, "", 15, Color.RED, false);
        android.widget.Button ok = Ui.button(this, "Unlock", true);
        android.widget.Button cancel = Ui.button(this, "Cancel", false);
        ok.setOnClickListener(v -> {
            if (System.currentTimeMillis() < lockedUntil) {
                status.setText("Too many wrong PINs. Try again later.");
                return;
            }
            if (verify(pin.getText().toString().trim())) {
                failures = 0;
                JSONObject pol = new Prefs(this).policy();
                int minutes = pol != null && pol.optJSONObject("technician") != null
                        ? pol.optJSONObject("technician").optInt("escapeMinutes", 15) : 15;
                Kiosk.enterTechnician(this, minutes, "PIN on device");
                SyncEngine.request(this, "technician");
                finish();
            } else {
                failures++;
                SyncEngine.event(this, "technician_pin_failed", "Wrong technician PIN (" + failures + ")");
                if (failures >= 5) {
                    lockedUntil = System.currentTimeMillis() + 5 * 60_000;
                    failures = 0;
                }
                status.setText("Wrong PIN.");
                pin.setText("");
            }
        });
        cancel.setOnClickListener(v -> finish());
        root.addView(ok);
        root.addView(cancel);
        root.addView(status);
        setContentView(root);
    }

    private boolean verify(String code) {
        Prefs p = new Prefs(this);
        String secret = p.techSecret();
        if (secret == null || !code.matches("\\d{6}")) return false;
        long step = p.techStep();
        long counter = System.currentTimeMillis() / 1000 / step;
        for (long w = -1; w <= 1; w++) {
            if (code.equals(totp(base32(secret), counter + w))) return true;
        }
        return false;
    }

    static String totp(byte[] key, long counter) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            byte[] h = mac.doFinal(ByteBuffer.allocate(8).putLong(counter).array());
            int off = h[h.length - 1] & 0xf;
            int bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
            return String.format(java.util.Locale.US, "%06d", bin % 1_000_000);
        } catch (Exception e) {
            return "";
        }
    }

    static byte[] base32(String s) {
        String a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        s = s.replace("=", "").toUpperCase(java.util.Locale.US);
        ByteBuffer out = ByteBuffer.allocate(s.length() * 5 / 8);
        int bits = 0, value = 0;
        for (char ch : s.toCharArray()) {
            value = (value << 5) | a.indexOf(ch);
            bits += 5;
            if (bits >= 8) {
                out.put((byte) ((value >>> (bits - 8)) & 0xff));
                bits -= 8;
            }
        }
        return out.array();
    }
}
