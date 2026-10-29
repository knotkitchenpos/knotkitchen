package com.knotkitchen.pos;

import android.app.Activity;
import android.util.DisplayMetrics;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * Display size on KKMDM kiosk tablets.
 *
 * Android's Settings > Display size makes everything smaller, and the POS on a
 * 10" counter tablet wants "Small": at the default size it falls into its
 * phone layout in portrait. Android gives the Device Owner no way to set
 * display size across a fleet, so the POS does the same for its own pages:
 * it lays the page out wider by the same factor and scales it down to fit.
 *
 * The target is managed config display_scale_percent of the tablet's
 * default density (KKMDM policy display.posScalePercent, 85 = Android's
 * "Small"). A tablet already set to that size or smaller is left alone, so a
 * technician's own choice in Settings still wins. Tablets KKMDM does not
 * manage are never touched.
 */
final class KioskDisplay {

    private KioskDisplay() {}

    /** The page scale to apply, or 1 for none. */
    static float scale(Activity a) {
        if (!ManagedDevice.isManaged(a)) return 1f;
        int pct = ManagedDevice.config(a).getInt("display_scale_percent", 85);
        if (pct <= 0 || pct >= 100) return 1f;
        float target = DisplayMetrics.DENSITY_DEVICE_STABLE * pct / 100f;
        float current = a.getResources().getDisplayMetrics().densityDpi;
        return current > target + 1 ? target / current : 1f;
    }

    /** From page load and rotation. The layout width follows the screen's current width. */
    static void apply(Activity a, WebView webView) {
        float s = scale(a);
        if (s >= 1f) return;
        WebSettings ws = webView.getSettings();
        // The page's viewport meta only sets the layout width with these on.
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        int width = Math.round(a.getResources().getConfiguration().screenWidthDp / s);
        String scale = String.format(java.util.Locale.ROOT, "%.4f", s);
        webView.evaluateJavascript("(function(){var m=document.querySelector('meta[name=viewport]');"
            + "if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}"
            + "m.setAttribute('content','width=" + width + ", initial-scale=" + scale
            + ", minimum-scale=" + scale + ", maximum-scale=" + scale + ", user-scalable=no');})()", null);
    }
}
