package com.knotkitchen.rider;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Rational;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The rider's screens: knotkitchen.com/rider in a WebView. The web app tells
 * this shell (window.KKRiderApp) when the rider goes online or offline, which
 * starts and stops RiderService, and which delivery is waiting, which the
 * picture-in-picture card shows when the rider leaves the app.
 */
public class MainActivity extends Activity {
    /** The delivery waiting to be answered (JSON), or "": set by the web app and RiderService. */
    static volatile String pending = "";

    private WebView web;
    private boolean inPip;

    private final BroadcastReceiver refresh = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { js("window.dispatchEvent(new Event('kk:refresh'))"); }
    };

    @SuppressLint({ "SetJavaScriptEnabled", "AddJavascriptInterface" })
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        RiderService.channels(this);
        // Rings like a call: over the lock screen when a delivery comes in.
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        // An activity started by the service's alert: the card is already pending.
        updatePip();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " KKRiderApp/" + BuildConfigVersion.name(this));
        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Bridge(), "KKRiderApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                // The rider app stays here; calls, Maps and everything else open their own apps.
                if ("https".equals(u.getScheme()) && "knotkitchen.com".equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/rider")) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
            }
        });
        web.loadUrl(urlFor(getIntent()));

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        }
        // Only this app's own broadcasts (ActionReceiver), on every Android version.
        registerReceiver(refresh, new IntentFilter(ActionReceiver.REFRESH), Context.RECEIVER_NOT_EXPORTED);
    }

    private String urlFor(Intent i) {
        String id = i == null ? null : i.getStringExtra("orderId");
        if (id != null && id.matches("[a-fA-F0-9]{24}")) return Api.BASE + "/rider/delivery/" + id;
        return Api.APP_URL;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String id = intent.getStringExtra("orderId");
        if (id != null && id.matches("[a-fA-F0-9]{24}")) web.loadUrl(urlFor(intent));
    }

    /** Leaving the app with a delivery waiting: the card floats, with Accept / Decline. */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        enterPip();
    }

    /** The picture-in-picture card's settings: Accept / Decline for the waiting delivery, or none. */
    private PictureInPictureParams pipParams() {
        String id = "";
        try {
            id = pending.isEmpty() ? "" : new JSONObject(pending).optString("orderId");
        } catch (Exception ignored) {}
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(4, 5));
        List<RemoteAction> actions = new ArrayList<>();
        if (!id.isEmpty()) {
            actions.add(new RemoteAction(Icon.createWithResource(this, R.drawable.ic_accept), "Accept", "Accept delivery",
                    ActionReceiver.intent(this, ActionReceiver.ACCEPT, id)));
            actions.add(new RemoteAction(Icon.createWithResource(this, R.drawable.ic_decline), "Decline", "Decline delivery",
                    ActionReceiver.intent(this, ActionReceiver.DECLINE, id)));
        }
        b.setActions(actions);
        // Android 12+: float by itself (and smoothly) when the rider goes home with a delivery waiting.
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(!id.isEmpty());
        return b.build();
    }

    /** Keep the window's picture-in-picture settings in step with what's waiting. */
    private void updatePip() {
        runOnUiThread(() -> {
            try {
                setPictureInPictureParams(pipParams());
            } catch (Exception ignored) {}
        });
    }

    private void enterPip() {
        if (pending.isEmpty() || Build.VERSION.SDK_INT >= 31) return; // 31+: auto-enter does it
        try {
            enterPictureInPictureMode(pipParams());
        } catch (Exception ignored) {}
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPip, newConfig);
        inPip = isInPip;
        // The web app draws a compact card for the small window.
        js("window.dispatchEvent(new CustomEvent('kk:pip',{detail:" + isInPip + "}))");
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        js("window.dispatchEvent(new Event('kk:refresh'))");
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(refresh); } catch (Exception ignored) {}
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private void js(String code) {
        if (web != null) web.post(() -> web.evaluateJavascript(code, null));
    }

    /** What the web app may ask of the phone. */
    private class Bridge {
        /** Online (and approved): stay connected and ring; offline: stop. */
        @JavascriptInterface
        public void setOnline(boolean online) {
            getSharedPreferences(RiderService.PREFS, MODE_PRIVATE).edit().putBoolean("online", online).apply();
            CookieManager.getInstance().flush();
            if (online) {
                RiderService.start(MainActivity.this, RiderService.ACTION_CHECK);
                askBatteryExemption();
            } else {
                RiderService.stop(MainActivity.this);
            }
        }

        /** The rider's Sound / Vibration settings, for the service's bell. */
        @JavascriptInterface
        public void setPrefs(boolean sound, boolean vibration) {
            getSharedPreferences(RiderService.PREFS, MODE_PRIVATE).edit().putBoolean("sound", sound).putBoolean("vibration", vibration).apply();
        }

        /** The delivery waiting to be answered (JSON), or "" when none. */
        @JavascriptInterface
        public void setPending(String json) {
            pending = json == null ? "" : json;
            updatePip();
        }

        @JavascriptInterface
        public String version() {
            return BuildConfigVersion.name(MainActivity.this);
        }
    }

    /** Once: ask to be left out of battery saving, so the alert isn't held back. */
    private void askBatteryExemption() {
        try {
            PowerManager pm = getSystemService(PowerManager.class);
            if (pm.isIgnoringBatteryOptimizations(getPackageName())) return;
            if (getSharedPreferences(RiderService.PREFS, MODE_PRIVATE).getBoolean("askedBattery", false)) return;
            getSharedPreferences(RiderService.PREFS, MODE_PRIVATE).edit().putBoolean("askedBattery", true).apply();
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
    }
}
