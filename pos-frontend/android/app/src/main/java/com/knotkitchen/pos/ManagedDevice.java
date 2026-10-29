package com.knotkitchen.pos;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.RestrictionsManager;
import android.os.Bundle;

import org.json.JSONObject;

/**
 * A tablet managed by KKMDM (kkmdm/ in this repository): KK Agent is its
 * Device Owner and keeps the POS locked in front, as a kiosk.
 *
 * The agent hands the POS a managed configuration (res/xml/app_restrictions.xml
 * lists the keys): which store and terminal this tablet is, and who installs
 * POS updates. A tablet that is not managed has none of it, and the app
 * behaves exactly as before.
 */
final class ManagedDevice {

    static final String AGENT = "com.knotkitchen.mdm";
    private static final String TECHNICIAN = "com.knotkitchen.mdm.action.TECHNICIAN";
    private static final String INSTALL_POS_UPDATE = "com.knotkitchen.mdm.action.INSTALL_POS_UPDATE";

    private ManagedDevice() {}

    static Bundle config(Context c) {
        RestrictionsManager rm = (RestrictionsManager) c.getSystemService(Context.RESTRICTIONS_SERVICE);
        Bundle b = rm != null ? rm.getApplicationRestrictions() : null;
        return b != null ? b : new Bundle();
    }

    /** The agent has handed over a device id: KKMDM manages this tablet. */
    static boolean isManaged(Context c) {
        return !config(c).getString("kkmdm_device_id", "").isEmpty();
    }

    /** "kkmdm": KKMDM rolls POS builds out itself. "self": the POS's own updater, installed by the agent. */
    static boolean kkmdmOwnsUpdates(Context c) {
        return "kkmdm".equals(config(c).getString("pos_updates", "self"));
    }

    /** Opens the agent's PIN-protected technician screen. */
    static boolean openTechnician(Context c) {
        try {
            c.startActivity(new Intent(TECHNICIAN).setPackage(AGENT).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    /**
     * The kiosk policy blocks app installs, the POS's own included, so the
     * agent installs the update as Device Owner. The POS closes while it is
     * replaced and the agent brings the new one straight back up.
     */
    static void installUpdate(Context c, JSONObject m) {
        c.sendBroadcast(new Intent(INSTALL_POS_UPDATE).setPackage(AGENT)
            .putExtra("apkUrl", m.optString("apkUrl"))
            .putExtra("sha256", m.optString("sha256"))
            .putExtra("versionCode", m.optLong("versionCode"))
            .putExtra("versionName", m.optString("versionName")));
    }
}
