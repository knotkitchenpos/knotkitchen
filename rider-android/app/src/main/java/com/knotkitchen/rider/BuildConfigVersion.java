package com.knotkitchen.rider;

import android.content.Context;

/** The installed version name, for the web app and the WebView's user agent. */
final class BuildConfigVersion {
    private BuildConfigVersion() {}

    static String name(Context ctx) {
        try {
            return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0";
        }
    }
}
