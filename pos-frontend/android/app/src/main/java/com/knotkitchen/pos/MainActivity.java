package com.knotkitchen.pos;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins register before the bridge starts.
        registerPlugin(ThermalPrinterPlugin.class);
        super.onCreate(savedInstanceState);

        // A till on the counter should not go dark between orders.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // The POS page (business.) signs in against the API host (api.), so its
        // session cookies must be kept.
        WebView webView = getBridge().getWebView();
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        // Back goes back inside the POS; at the first screen it sends the app to
        // the background instead of closing it, so the till is not signed out of
        // its live connection by a stray tap.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }
}
