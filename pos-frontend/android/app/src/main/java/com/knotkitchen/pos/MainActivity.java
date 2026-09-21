package com.knotkitchen.pos;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebBackForwardList;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins register before the bridge starts.
        registerPlugin(ThermalPrinterPlugin.class);
        registerPlugin(UpiIntentPlugin.class);
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
        // its live connection by a stray tap. Pages that are not the POS (a
        // finished Cashfree checkout) are skipped, not returned to.
        String appHost = Uri.parse(getBridge().getAppUrl()).getHost();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebBackForwardList history = webView.copyBackForwardList();
                for (int i = history.getCurrentIndex() - 1; i >= 0; i--) {
                    if (appHost.equals(Uri.parse(history.getItemAtIndex(i).getUrl()).getHost())) {
                        webView.goBackOrForward(i - history.getCurrentIndex());
                        return;
                    }
                }
                moveTaskToBack(true);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        // The app updates itself; the POS pages are live and never need it.
        ShellUpdater.check(this);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        // Back from the UPI app: Cashfree's checkout moves to its "verifying
        // payment" step, as in Cashfree's WebView sample.
        if (requestCode == UpiIntentPlugin.UPI_REQUEST) {
            getBridge().getWebView().evaluateJavascript("window.showVerifyUI && window.showVerifyUI()", null);
        }
    }
}
