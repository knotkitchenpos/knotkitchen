package com.knotkitchen.pos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The managed configuration KKMDM gives this tablet (see ManagedDevice), for
 * the POS pages: src/utils/managedDevice.js. "configChanged" fires when the
 * agent changes it, for instance when the tablet moves to another store.
 */
@CapacitorPlugin(name = "ManagedDevice")
public class ManagedDevicePlugin extends Plugin {

    private BroadcastReceiver changed;

    @Override
    public void load() {
        // Android only delivers this to receivers registered at run time.
        changed = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                notifyListeners("configChanged", toJs(getContext()));
            }
        };
        ContextCompat.registerReceiver(getContext(), changed,
            new IntentFilter(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        try {
            getContext().unregisterReceiver(changed);
        } catch (IllegalArgumentException ignored) {
            // never registered
        }
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        call.resolve(toJs(getContext()));
    }

    @PluginMethod
    public void openTechnician(PluginCall call) {
        if (ManagedDevice.openTechnician(getContext())) call.resolve();
        else call.reject("KK Agent is not installed on this tablet.");
    }

    private static JSObject toJs(Context c) {
        Bundle b = ManagedDevice.config(c);
        JSObject config = new JSObject();
        for (String k : b.keySet()) {
            Object v = b.get(k);
            if (v instanceof String || v instanceof Boolean || v instanceof Integer) config.put(k, v);
        }
        JSObject out = new JSObject();
        out.put("managed", ManagedDevice.isManaged(c));
        out.put("config", config);
        return out;
    }
}
