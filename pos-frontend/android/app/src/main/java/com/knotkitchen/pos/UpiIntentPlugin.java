package com.knotkitchen.pos;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.webkit.JavascriptInterface;

import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * UPI apps inside the Cashfree checkout.
 *
 * In a WebView, Cashfree's checkout offers only "UPI ID / QR" unless it finds
 * a JS bridge named "Android" with getAppList/openApp, which it uses to list
 * the installed UPI apps and open the chosen one (Cashfree docs, "UPI Intent
 * in JS SDK", code based solution; methods as in Cashfree's CFJsBridge
 * sample). Operators were screenshotting the QR to pay it from their own phone.
 *
 * The bridge reaches every frame and cannot tell which one called it, so it
 * only ever resolves UPI schemes, and opens them only in the app picked.
 */
@CapacitorPlugin(name = "UpiIntent")
public class UpiIntentPlugin extends Plugin {

    /** MainActivity tells the checkout page when the UPI app hands back. */
    static final int UPI_REQUEST = 1000;

    // Keep in step with <queries> in AndroidManifest.xml: a scheme missing
    // there makes its apps invisible to getAppList on Android 11+.
    private static final List<String> UPI_SCHEMES = Arrays.asList(
        "upi", "tez", "gpay", "phonepe", "paytmmp", "credpay", "bhim", "amazonpay"
    );

    @Override
    public void load() {
        // Plugins load before the first page, so every page gets window.Android.
        getBridge().getWebView().addJavascriptInterface(this, "Android");
    }

    /** ACTION_VIEW for a UPI link, or null for anything else. */
    private static Intent upiIntent(String link) {
        Uri uri = link == null ? null : Uri.parse(link);
        String scheme = uri == null ? null : uri.getScheme();
        if (scheme == null || !UPI_SCHEMES.contains(scheme.toLowerCase(Locale.ROOT))) return null;
        return new Intent(Intent.ACTION_VIEW, uri);
    }

    /** JSON [{ appName, appPackage }] of the installed apps that take this UPI link. */
    @JavascriptInterface
    public String getAppList(String link) {
        Logger.debug("UpiIntent", "getAppList " + link); // what Cashfree asks for, for the first device test
        JSONArray apps = new JSONArray();
        Intent intent = upiIntent(link);
        if (intent == null) return apps.toString();
        PackageManager pm = getContext().getPackageManager();
        for (ResolveInfo info : pm.queryIntentActivities(intent, 0)) {
            try {
                apps.put(new JSONObject()
                    .put("appName", String.valueOf(pm.getApplicationLabel(info.activityInfo.applicationInfo)))
                    .put("appPackage", info.activityInfo.packageName));
            } catch (JSONException ignored) {
                // skip that app
            }
        }
        return apps.toString();
    }

    /** Opens the UPI link in the app picked on the checkout. */
    @JavascriptInterface
    public boolean openApp(String appPackage, String link) {
        Intent intent = upiIntent(link);
        if (intent == null || appPackage == null || appPackage.isEmpty()) return false;
        intent.setPackage(appPackage);
        // Called on the WebView's bridge thread; start the activity on the UI thread.
        getActivity().runOnUiThread(() -> {
            try {
                // For result, as Cashfree's sample does: UPI apps answer their caller.
                getActivity().startActivityForResult(intent, UPI_REQUEST);
            } catch (ActivityNotFoundException ignored) {
                // uninstalled since getAppList; the checkout keeps its other options
            }
        });
        return true;
    }

    /**
     * Two navigations Capacitor's default policy gets wrong for a checkout:
     *
     * intent:// links (Cashfree's server-side UPI flow). Capacitor hands them
     * to ACTION_VIEW raw, which finds no app and does nothing. Parsed as Chrome
     * does, only for a UPI target, never into a named component or with the
     * link's own flags.
     *
     * Pages after the checkout's first. The in-app top-up opens Cashfree full
     * page; its next hops (a bank, 3-D Secure, Cashfree's own status pages)
     * would otherwise be sent out to the system browser, where the payment
     * could never find its way back to the app. While the page on screen is
     * not the POS, web links stay in the WebView. They get no Capacitor access:
     * that is granted by origin, and only the POS has it.
     *
     * Everything else keeps Capacitor's own policy (null).
     */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
        if (scheme.equals("intent")) {
            try {
                Intent parsed = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME);
                Intent intent = upiIntent(parsed.getDataString());
                if (intent != null) {
                    if (parsed.getPackage() != null) intent.setPackage(parsed.getPackage());
                    intent.addCategory(Intent.CATEGORY_BROWSABLE);
                    getActivity().startActivity(intent);
                }
            } catch (URISyntaxException | RuntimeException ignored) {
                // malformed, or no app for it
            }
            return true;
        }
        if (scheme.equals("http") || scheme.equals("https")) {
            String current = getBridge().getWebView().getUrl();
            String host = current == null ? null : Uri.parse(current).getHost();
            String appHost = Uri.parse(getBridge().getAppUrl()).getHost();
            if (host != null && !host.equals(appHost) && !host.equals(getBridge().getHost())) return false;
        }
        return null;
    }
}
