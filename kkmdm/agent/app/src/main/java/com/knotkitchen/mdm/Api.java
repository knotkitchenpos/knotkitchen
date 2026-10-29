package com.knotkitchen.mdm;

import android.content.Context;
import android.net.Uri;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.CertificatePinner;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** HTTPS client for the KKMDM device API. Certificate pinning when CERT_PINS is set. */
public final class Api {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static OkHttpClient client;

    private final Context ctx;
    private final Prefs prefs;

    public Api(Context c) {
        ctx = c.getApplicationContext();
        prefs = new Prefs(ctx);
    }

    public static class ApiException extends IOException {
        public final int status;
        public ApiException(int status, String body) {
            super("HTTP " + status + ": " + body);
            this.status = status;
        }
    }

    static synchronized OkHttpClient client(String server) {
        if (client == null) {
            OkHttpClient.Builder b = new OkHttpClient.Builder()
                    .connectTimeout(15, TimeUnit.SECONDS)
                    .readTimeout(60, TimeUnit.SECONDS)
                    .writeTimeout(120, TimeUnit.SECONDS)
                    // Hard cap per call: a half-dead link (Wi-Fi drop, USB
                    // reset under adb reverse) must not stall the sync thread.
                    .callTimeout(5, TimeUnit.MINUTES)
                    .pingInterval(25, TimeUnit.SECONDS)
                    .retryOnConnectionFailure(true);
            String pins = BuildConfig.CERT_PINS;
            if (server != null && pins != null && !pins.isEmpty()) {
                String host = Uri.parse(server).getHost();
                CertificatePinner.Builder p = new CertificatePinner.Builder();
                for (String pin : pins.split(",")) p.add(host, pin.trim());
                b.certificatePinner(p.build());
            }
            client = b.build();
        }
        return client;
    }

    public OkHttpClient http() {
        return client(prefs.server());
    }

    private Request.Builder req(String path) {
        Request.Builder b = new Request.Builder().url(prefs.server() + path)
                .header("User-Agent", "KKAgent/" + BuildConfig.VERSION_NAME);
        String cred = prefs.credential();
        if (cred != null) b.header("Authorization", "Device " + cred);
        return b;
    }

    public JSONObject post(String path, JSONObject body) throws IOException {
        Request r = req(path).post(RequestBody.create(body.toString(), JSON)).build();
        okhttp3.Call call = http().newCall(r);
        call.timeout().timeout(90, TimeUnit.SECONDS);
        try (Response res = call.execute()) {
            String text = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) throw new ApiException(res.code(), text);
            try {
                return text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (Exception e) {
                throw new IOException("bad JSON from server", e);
            }
        }
    }

    public void upload(String path, File file, String contentType) throws IOException {
        Request r = req(path).post(RequestBody.create(file, MediaType.get(contentType))).build();
        try (Response res = http().newCall(r).execute()) {
            if (!res.isSuccessful()) throw new ApiException(res.code(), res.body() != null ? res.body().string() : "");
        }
    }

    /** GET to a file (APK downloads). Absolute URLs from the server are used as given. */
    public void download(String url, File dest) throws IOException {
        Request.Builder b = new Request.Builder().url(url);
        String cred = prefs.credential();
        if (cred != null && url.startsWith(prefs.server())) b.header("Authorization", "Device " + cred);
        okhttp3.Call call = http().newCall(b.build());
        call.timeout().timeout(30, TimeUnit.MINUTES); // large APKs on slow restaurant Wi-Fi
        try (Response res = call.execute()) {
            if (!res.isSuccessful() || res.body() == null) throw new ApiException(res.code(), "download failed");
            try (okio.BufferedSink sink = okio.Okio.buffer(okio.Okio.sink(dest))) {
                sink.writeAll(res.body().source());
            }
        }
    }

    public Request.Builder wsRequest() {
        String url = prefs.server().replaceFirst("^http", "ws") + "/device/ws";
        return new Request.Builder().url(url).header("Authorization", "Device " + prefs.credential());
    }
}
