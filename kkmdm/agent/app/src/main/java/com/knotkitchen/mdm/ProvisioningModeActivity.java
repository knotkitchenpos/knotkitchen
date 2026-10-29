package com.knotkitchen.mdm;

import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.Intent;
import android.os.Bundle;

/** Android 12+: the setup wizard asks which mode to provision. Always fully managed. */
public class ProvisioningModeActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        AdminReceiver.saveProvisioningExtras(this, getIntent());
        Intent result = new Intent();
        result.putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE);
        setResult(RESULT_OK, result);
        finish();
    }
}
