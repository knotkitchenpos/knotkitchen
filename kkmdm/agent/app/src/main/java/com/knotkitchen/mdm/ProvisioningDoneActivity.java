package com.knotkitchen.mdm;

import android.app.Activity;
import android.os.Bundle;

/** Android 8-11: ACTION_PROVISIONING_SUCCESSFUL after the wizard provisioned us. */
public class ProvisioningDoneActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        AdminReceiver.saveProvisioningExtras(this, getIntent());
        AdminReceiver.startEnrollment(this);
        finish();
    }
}
