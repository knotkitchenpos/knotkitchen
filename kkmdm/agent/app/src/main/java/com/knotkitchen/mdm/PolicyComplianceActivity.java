package com.knotkitchen.mdm;

import android.app.Activity;
import android.os.Bundle;

/**
 * Android 12+: called once we are Device Owner, before the setup wizard
 * finishes. Enrollment runs in the background; returning at once keeps the
 * wizard moving and needs no taps from staff.
 */
public class PolicyComplianceActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        AdminReceiver.saveProvisioningExtras(this, getIntent());
        AdminReceiver.startEnrollment(this);
        setResult(RESULT_OK);
        finish();
    }
}
