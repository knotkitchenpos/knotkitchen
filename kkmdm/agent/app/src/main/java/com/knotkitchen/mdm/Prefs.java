package com.knotkitchen.mdm;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Agent state. Secrets (device credential, technician seed) are encrypted
 * with an AES key that never leaves the Android Keystore.
 */
public final class Prefs {
    private static final String FILE = "kkmdm";
    private static final String KEY_ALIAS = "kkmdm_secrets";
    private static final int MAX_SEEN_COMMANDS = 300;
    private static final int MAX_QUEUE = 200;

    private final SharedPreferences sp;

    public Prefs(Context c) {
        sp = c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    // ---- enrollment inputs (from the QR extras bundle or SetupActivity) ----

    public void setEnrollment(String server, String token) {
        sp.edit().putString("server", trimSlash(server)).putString("enrollToken", token).apply();
    }

    public String server() { return sp.getString("server", null); }
    public void setServer(String s) { sp.edit().putString("server", trimSlash(s)).apply(); }
    public String enrollToken() { return sp.getString("enrollToken", null); }
    public void clearEnrollToken() { sp.edit().remove("enrollToken").apply(); }

    // ---- identity ----

    public boolean isEnrolled() { return credential() != null; }
    public String deviceId() { return sp.getString("deviceId", null); }
    public String deviceName() { return sp.getString("deviceName", ""); }

    public void setIdentity(String deviceId, String name, String credential, String techSecret, int techStep) {
        sp.edit()
                .putString("deviceId", deviceId)
                .putString("deviceName", name)
                .putString("credential", encrypt(credential))
                .putString("techSecret", encrypt(techSecret))
                .putInt("techStep", techStep)
                .apply();
    }

    public void setCredential(String credential) { sp.edit().putString("credential", encrypt(credential)).apply(); }
    public String credential() { return decrypt(sp.getString("credential", null)); }
    public String techSecret() { return decrypt(sp.getString("techSecret", null)); }
    public int techStep() { return sp.getInt("techStep", 300); }

    // ---- policy / runtime state ----

    public JSONObject policy() { return json(sp.getString("policy", null)); }
    public String policyHash() { return sp.getString("policyHash", null); }
    public String appliedHash() { return sp.getString("appliedHash", null); }

    public void setPolicy(String hash, JSONObject settings) {
        sp.edit().putString("policyHash", hash).putString("policy", settings.toString()).apply();
    }

    public void setApplied(String hash, List<String> errors) {
        sp.edit().putString("appliedHash", hash).putString("policyErrors", new JSONArray(errors).toString())
                .putLong("appliedAt", System.currentTimeMillis()).apply();
    }

    public JSONArray policyErrors() { return jsonArray(sp.getString("policyErrors", "[]")); }
    public long appliedAt() { return sp.getLong("appliedAt", 0); }

    public JSONObject managedConfig() { return json(sp.getString("managedConfig", null)); }
    public void setManagedConfig(JSONObject o) { sp.edit().putString("managedConfig", o.toString()).apply(); }

    public int heartbeatSeconds() { return sp.getInt("heartbeat", 60); }
    public void setHeartbeatSeconds(int s) { sp.edit().putInt("heartbeat", Math.max(15, s)).apply(); }

    public long technicianUntil() { return sp.getLong("techUntil", 0); }
    public void setTechnicianUntil(long t) { sp.edit().putLong("techUntil", t).apply(); }
    public boolean technicianActive() { return technicianUntil() > System.currentTimeMillis(); }
    /** Turned off on this tablet from Tablet settings (on top of the policy's kiosk.showNotifications). */
    public boolean shadeOff() { return sp.getBoolean("shadeOff", false); }
    public void setShadeOff(boolean off) { sp.edit().putBoolean("shadeOff", off).apply(); }

    public JSONObject lostMode() { return json(sp.getString("lostMode", null)); }
    public void setLostMode(JSONObject o) {
        if (o == null) sp.edit().remove("lostMode").apply();
        else sp.edit().putString("lostMode", o.toString()).apply();
    }

    public boolean readyReported() { return sp.getBoolean("ready", false); }
    public void setReadyReported() { sp.edit().putBoolean("ready", true).apply(); }

    public boolean maintenanceWindowOpen() { return sp.getBoolean("mwOpen", false); }
    public void setMaintenanceWindowOpen(boolean b) { sp.edit().putBoolean("mwOpen", b).apply(); }

    // ---- crash-loop watchdog ----

    public List<Long> launchTimes() {
        JSONArray a = jsonArray(sp.getString("launches", "[]"));
        List<Long> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) out.add(a.optLong(i));
        return out;
    }

    public void setLaunchTimes(List<Long> l) { sp.edit().putString("launches", new JSONArray(l).toString()).apply(); }

    // ---- command dedupe (idempotency by cmdId) ----

    public synchronized boolean markCommandSeen(String cmdId) {
        JSONArray seen = jsonArray(sp.getString("seenCmds", "[]"));
        for (int i = 0; i < seen.length(); i++) if (cmdId.equals(seen.optString(i))) return false;
        JSONArray next = new JSONArray();
        int start = Math.max(0, seen.length() - MAX_SEEN_COMMANDS + 1);
        for (int i = start; i < seen.length(); i++) next.put(seen.optString(i));
        next.put(cmdId);
        sp.edit().putString("seenCmds", next.toString()).apply();
        return true;
    }

    // ---- offline queues: events and command reports, flushed on reconnect ----

    public synchronized void queue(String name, JSONObject item) {
        JSONArray q = jsonArray(sp.getString(name, "[]"));
        q.put(item);
        while (q.length() > MAX_QUEUE) q.remove(0);
        sp.edit().putString(name, q.toString()).apply();
    }

    public synchronized JSONArray drain(String name) {
        JSONArray q = jsonArray(sp.getString(name, "[]"));
        sp.edit().remove(name).apply();
        return q;
    }

    public void clearAll() { sp.edit().clear().apply(); }

    // ---- helpers ----

    private static String trimSlash(String s) {
        if (s == null) return null;
        s = s.trim();
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private static JSONObject json(String s) {
        try { return s == null ? null : new JSONObject(s); } catch (Exception e) { return null; }
    }

    private static JSONArray jsonArray(String s) {
        try { return new JSONArray(s); } catch (Exception e) { return new JSONArray(); }
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    private static String encrypt(String plain) {
        if (plain == null) return null;
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] data = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(data, Base64.NO_WRAP);
        } catch (Exception e) {
            throw new IllegalStateException("keystore encrypt failed", e);
        }
    }

    private static String decrypt(String blob) {
        if (blob == null) return null;
        try {
            String[] p = blob.split(":");
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            AgentLog.e("prefs", "decrypt failed", e);
            return null;
        }
    }
}
