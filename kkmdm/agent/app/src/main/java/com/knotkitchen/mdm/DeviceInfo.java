package com.knotkitchen.mdm;

import android.Manifest;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.MediaDrm;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.os.SystemClock;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.telephony.TelephonyManager;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.UUID;

/** Device facts (enrollment) and heartbeat telemetry. */
public final class DeviceInfo {
    private DeviceInfo() {}

    /** The Device Owner may grant itself runtime permissions it declares. */
    static void grantSelf(Context c, String perm) {
        try {
            if (AgentApp.isDeviceOwner(c)) {
                AgentApp.dpm(c).setPermissionGrantState(AgentApp.admin(c), c.getPackageName(), perm,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
            }
        } catch (Exception e) {
            AgentLog.w("info", "grant " + perm + " failed: " + e.getMessage());
        }
    }

    public static JSONObject facts(Context c) throws Exception {
        grantSelf(c, Manifest.permission.READ_PHONE_STATE);
        JSONObject f = new JSONObject();
        f.put("serial", serial(c));
        f.put("hardwareId", hardwareId());
        f.put("imei", imei(c));
        f.put("manufacturer", Build.MANUFACTURER);
        f.put("model", Build.MODEL);
        f.put("androidVersion", Build.VERSION.RELEASE);
        f.put("sdkInt", Build.VERSION.SDK_INT);
        f.put("securityPatch", Build.VERSION.SECURITY_PATCH);
        f.put("gms", isInstalled(c, "com.google.android.gms"));
        f.put("agentVersion", BuildConfig.VERSION_NAME);
        f.put("agentVersionCode", BuildConfig.VERSION_CODE);
        f.put("emulator", Build.FINGERPRINT.contains("generic") || Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish"));
        return f;
    }

    static String serial(Context c) {
        try {
            String s = Build.getSerial();
            if (s != null && !s.isEmpty() && !Build.UNKNOWN.equals(s)) return s;
        } catch (SecurityException ignored) {
        }
        return "unknown";
    }

    static String imei(Context c) {
        try {
            TelephonyManager tm = c.getSystemService(TelephonyManager.class);
            if (tm != null && tm.getPhoneType() != TelephonyManager.PHONE_TYPE_NONE) return tm.getImei();
        } catch (Exception ignored) {
        }
        return null;
    }

    /** Widevine device ID: survives factory reset, unlike ANDROID_ID. Hashed. */
    static String hardwareId() {
        UUID widevine = new UUID(0xEDEF8BA979D64ACEL, 0xA3C827DCD51D21EDL);
        try (MediaDrm drm = new MediaDrm(widevine)) {
            byte[] id = drm.getPropertyByteArray(MediaDrm.PROPERTY_DEVICE_UNIQUE_ID);
            byte[] h = MessageDigest.getInstance("SHA-256").digest(id);
            return Base64.encodeToString(h, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Hardware key attestation: a fresh EC key whose certificate chain embeds
     * SHA-256(enrollment token) as the challenge. The server checks the chain.
     */
    public static JSONObject attestation(String token) {
        JSONObject out = new JSONObject();
        try {
            byte[] challenge = MessageDigest.getInstance("SHA-256").digest(token.getBytes("UTF-8"));
            String alias = "kkmdm_attest";
            KeyPairGenerator g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
            g.initialize(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setAttestationChallenge(challenge)
                    .build());
            g.generateKeyPair();
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            JSONArray chain = new JSONArray();
            for (Certificate cert : ks.getCertificateChain(alias)) {
                chain.put(Base64.encodeToString(cert.getEncoded(), Base64.NO_WRAP));
            }
            ks.deleteEntry(alias);
            out.put("chain", chain);
        } catch (Exception e) {
            AgentLog.w("info", "attestation unavailable: " + e.getMessage());
        }
        return out;
    }

    static boolean isInstalled(Context c, String pkg) {
        try {
            c.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    static PackageInfo packageInfo(Context c, String pkg) {
        try {
            return c.getPackageManager().getPackageInfo(pkg, 0);
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    /** Non-system apps plus every managed package, for the server's desired-state diff. */
    static JSONArray apps(Context c) throws Exception {
        JSONArray a = new JSONArray();
        for (PackageInfo p : c.getPackageManager().getInstalledPackages(0)) {
            boolean system = (p.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) != 0;
            boolean updatedSystem = (p.applicationInfo.flags & android.content.pm.ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0;
            if (system && !updatedSystem && !p.packageName.startsWith("com.knotkitchen")) continue;
            JSONObject o = new JSONObject();
            o.put("packageName", p.packageName);
            o.put("versionCode", p.getLongVersionCode());
            o.put("versionName", p.versionName);
            a.put(o);
        }
        return a;
    }

    public static JSONObject telemetry(Context c) throws Exception {
        JSONObject t = new JSONObject();
        Intent batt = c.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (batt != null) {
            int level = batt.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = batt.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int status = batt.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            int plugged = batt.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            t.put("battery", Math.round(level * 100f / scale));
            t.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
            t.put("plugged", plugged == BatteryManager.BATTERY_PLUGGED_AC ? "ac" : plugged == BatteryManager.BATTERY_PLUGGED_USB ? "usb"
                    : plugged == BatteryManager.BATTERY_PLUGGED_WIRELESS ? "wireless" : "none");
        }
        StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
        t.put("storageFreeMb", fs.getAvailableBytes() / (1024 * 1024));
        t.put("storageTotalMb", fs.getTotalBytes() / (1024 * 1024));
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        c.getSystemService(ActivityManager.class).getMemoryInfo(mi);
        t.put("ramFreeMb", mi.availMem / (1024 * 1024));
        t.put("ramTotalMb", mi.totalMem / (1024 * 1024));
        network(c, t);
        t.put("uptimeSec", SystemClock.elapsedRealtime() / 1000);
        t.put("lastBootReason", bootReason());
        AudioManager am = c.getSystemService(AudioManager.class);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        t.put("volume", max > 0 ? Math.round(am.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max) : 0);
        try {
            t.put("brightness", Settings.System.getInt(c.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS));
        } catch (Settings.SettingNotFoundException ignored) {
        }
        return t;
    }

    private static void network(Context c, JSONObject t) throws Exception {
        ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
        Network n = cm.getActiveNetwork();
        NetworkCapabilities caps = n != null ? cm.getNetworkCapabilities(n) : null;
        String type = "none";
        if (caps != null) {
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) type = "ethernet";
            else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) type = "wifi";
            else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) type = "cellular";
            else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_USB)) type = "usb";
            else type = "other";
            t.put("internetReachable", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
        } else {
            t.put("internetReachable", false);
        }
        t.put("networkType", type);
        if ("wifi".equals(type)) {
            WifiManager wm = c.getApplicationContext().getSystemService(WifiManager.class);
            WifiInfo wi = wm.getConnectionInfo();
            if (wi != null) {
                String ssid = wi.getSSID();
                // "<unknown ssid>" unless location is allowed (only when the policy enables it).
                if (ssid != null && !ssid.contains("unknown")) t.put("ssid", ssid.replace("\"", ""));
                t.put("signal", WifiManager.calculateSignalLevel(wi.getRssi(), 5));
            }
        }
        if (n != null) {
            LinkProperties lp = cm.getLinkProperties(n);
            if (lp != null) {
                for (LinkAddress la : lp.getLinkAddresses()) {
                    if (la.getAddress() instanceof java.net.Inet4Address) {
                        t.put("ip", la.getAddress().getHostAddress());
                        break;
                    }
                }
            }
        }
    }

    private static String bootReason() {
        try {
            Class<?> sp = Class.forName("android.os.SystemProperties");
            String r = (String) sp.getMethod("get", String.class).invoke(null, "sys.boot.reason");
            return r == null || r.isEmpty() ? null : r;
        } catch (Exception e) {
            return null;
        }
    }

    /** True when the KKMDM server answers (separate from Android's own validation). */
    static boolean serverReachable(String server) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(server + "/healthz").openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            return false;
        }
    }
}
