package com.knotkitchen.rider;

import android.webkit.CookieManager;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The Rider API (knotkitchen.com/rider/api), called with the rider's own
 * session: the cookie the WebView signed in with. Nothing here stores or
 * sees a PIN.
 */
final class Api {
    static final String BASE = "https://knotkitchen.com";
    static final String APP_URL = BASE + "/rider/";

    private Api() {}

    /** The rider's session cookie(s) for /rider, or "" when signed out. */
    static String cookie() {
        String c = CookieManager.getInstance().getCookie(APP_URL);
        return c == null ? "" : c;
    }

    static final class Reply {
        final int status;
        final String body;
        Reply(int status, String body) { this.status = status; this.body = body; }
        boolean ok() { return status >= 200 && status < 300; }
    }

    static Reply get(String path) throws Exception {
        return call("GET", path, null);
    }

    static Reply post(String path, String json) throws Exception {
        return call("POST", path, json == null ? "{}" : json);
    }

    private static Reply call(String method, String path, String json) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BASE + "/rider/api" + path).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestMethod(method);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("Cookie", cookie());
        // Same-origin, as the web app: the API refuses cross-site writes.
        c.setRequestProperty("Origin", BASE);
        if (json != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = c.getOutputStream()) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = c.getResponseCode();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = "";
        if (in != null) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            in.close();
            body = buf.toString("UTF-8");
        }
        c.disconnect();
        return new Reply(status, body);
    }
}
