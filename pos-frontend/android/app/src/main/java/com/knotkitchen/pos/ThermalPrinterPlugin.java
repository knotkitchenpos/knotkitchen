package com.knotkitchen.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.ContextCompat;
import androidx.core.content.IntentCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Raw ESC/POS to a receipt printer, for the Android app.
 *
 * The POS builds the print job itself (utils/escpos.js); this only delivers
 * the bytes. It exists because the in-app WebView has neither WebUSB nor Web
 * Bluetooth, and because most cheap thermal printers are classic Bluetooth
 * (serial port profile), which no browser can reach at all.
 *
 *   bluetooth  a printer already paired in Android settings, over RFCOMM/SPP
 *              (classic) or GATT (BLE, the 57 mm mini printers and some
 *              receipt printers). A BLE printer paired only for classic
 *              took the SPP connection and printed nothing.
 *   usb        a printer on USB OTG, over its bulk OUT endpoint
 */
@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class ThermalPrinterPlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String USB_PERMISSION = "com.knotkitchen.pos.USB_PERMISSION";
    // Calibration knobs: printers differ in how fast they drain their buffer.
    private static final int BT_CHUNK = 1024;
    private static final int USB_CHUNK = 16384;
    // A printer just switched on takes a moment before it answers.
    private static final long SPP_RETRY_PAUSE_MS = 1500;

    // Services the BLE printers put their write characteristic under; same
    // list as utils/printerDevice.js. Standard services never print.
    private static final List<String> BLE_PRINTER_SERVICES = Arrays.asList(
        "000018f0-0000-1000-8000-00805f9b34fb",
        "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
        "49535343-fe7d-4ae5-8fa9-9fafd205e455",
        "0000ff00-0000-1000-8000-00805f9b34fb",
        "0000ffe0-0000-1000-8000-00805f9b34fb",
        "0000fee7-0000-1000-8000-00805f9b34fb",
        "0000ae30-0000-1000-8000-00805f9b34fb",
        "0000af30-0000-1000-8000-00805f9b34fb"
    );
    private static final List<String> BLE_STANDARD_SERVICES = Arrays.asList("00001800", "00001801", "0000180a", "0000180f");

    // One job at a time: two receipts interleaved on one printer is garbage.
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    /* ------------------------------------------------------------ status -- */

    @PluginMethod
    public void available(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        JSObject out = new JSObject();
        out.put("bluetooth", adapter != null);
        out.put("bluetoothOn", adapter != null && adapter.isEnabled());
        out.put("usb", getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_HOST));
        call.resolve(out);
    }

    /* --------------------------------------------------------- bluetooth -- */

    /** Android 12+ asks for "Nearby devices" before any paired device is visible. */
    private boolean needsBluetoothPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    @PluginMethod
    public void listBluetooth(PluginCall call) {
        if (needsBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermissionResult");
            return;
        }
        doListBluetooth(call);
    }

    @PermissionCallback
    private void bluetoothPermissionResult(PluginCall call) {
        if (needsBluetoothPermission()) {
            call.reject("Allow \"Nearby devices\" for KnotKitchen POS to use a Bluetooth printer.");
            return;
        }
        if ("print".equals(call.getMethodName())) {
            startPrint(call);
        } else {
            doListBluetooth(call);
        }
    }

    @SuppressLint("MissingPermission")
    private void doListBluetooth(PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This device has no Bluetooth.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is off. Turn it on and try again.");
            return;
        }
        JSArray devices = new JSArray();
        for (BluetoothDevice d : adapter.getBondedDevices()) {
            JSObject o = new JSObject();
            o.put("name", d.getName() != null ? d.getName() : d.getAddress());
            o.put("address", d.getAddress());
            devices.put(o);
        }
        JSObject out = new JSObject();
        out.put("devices", devices);
        call.resolve(out);
    }

    @SuppressLint("MissingPermission")
    private void printBluetooth(PluginCall call, byte[] bytes) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth is off. Turn it on and try again.");
            return;
        }
        String address = call.getString("address", "");
        BluetoothDevice remote;
        try {
            remote = adapter.getRemoteDevice(address);
        } catch (IllegalArgumentException e) {
            call.reject("The printer's Bluetooth address is not valid. Choose it again in Device Configuration.");
            return;
        }
        // The web side asks for BLE for the mini printers (they are BLE only,
        // whatever the pairing says); a device Android itself knows as LE
        // gets it too. Everything else is a classic serial-port printer.
        boolean ble = Boolean.TRUE.equals(call.getBoolean("ble", false))
            || remote.getType() == BluetoothDevice.DEVICE_TYPE_LE;
        if (ble) {
            printBle(call, bytes, remote, call.getInt("pace", 5));
            return;
        }
        BluetoothSocket socket = null;
        PinAnswer pinAnswer = null;
        try {
            // Discovery slows a connection down, but stopping it needs
            // BLUETOOTH_SCAN on Android 12+, which this app does not hold: it
            // never scans, only lists paired printers. Without the guard every
            // print failed with "Need android.permission.BLUETOOTH_SCAN".
            try {
                adapter.cancelDiscovery();
            } catch (SecurityException ignored) {
                // not scanning anyway
            }
            // Only a printer that is still paired: one the owner removed in
            // Settings, or one a wrong PIN un-paired, is never paired silently.
            if (remote.getBondState() == BluetoothDevice.BOND_BONDED) {
                pinAnswer = answerPinRequests(remote, call.getString("pin", ""));
            }
            socket = openSpp(remote);
            OutputStream out = socket.getOutputStream();
            for (int at = 0; at < bytes.length; at += BT_CHUNK) {
                out.write(bytes, at, Math.min(BT_CHUNK, bytes.length - at));
                out.flush();
            }
            // Closing at once can drop what is still in the radio's buffer.
            Thread.sleep(Math.min(4000, 300 + bytes.length / 40));
            call.resolve();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            call.reject("Printing was interrupted.");
        } catch (Exception e) {
            if (pinAnswer != null && pinAnswer.answered.get() && remote.getBondState() == BluetoothDevice.BOND_NONE) {
                call.reject("Android un-paired the printer while reconnecting. The PIN in Device Configuration may be wrong. "
                    + "Pair it again in Settings > Bluetooth and check the PIN.");
            } else {
                call.reject("Could not reach the Bluetooth printer. Check it is on and nearby. (" + e.getMessage() + ")");
            }
        } finally {
            closeQuietly(socket);
            stopAnswering(pinAnswer);
        }
    }

    /**
     * Answers Android's pairing request for this printer with the PIN saved in
     * Device Configuration, but only while this app is connecting to it.
     *
     * Insecure RFCOMM (openSpp) avoids the request when only Android wanted
     * authentication. A printer that forgets its link key when switched off
     * AND insists on authentication starts PIN pairing itself. Without this,
     * Android showed its "Bluetooth pairing request" dialog on the next print,
     * although the printer was still listed as paired. Only the legacy PIN
     * variant, only the saved printer, only once per job (a wrong PIN makes
     * Android drop the bond, so it is never tried twice), and only when the
     * owner entered a PIN. Returns null when there is nothing to answer with.
     * The caller registers it only for a printer that is still paired.
     */
    private PinAnswer answerPinRequests(BluetoothDevice device, String pin) {
        if (pin == null || !pin.matches("[0-9]{1,16}")) return null;
        PinAnswer receiver = new PinAnswer(device.getAddress(), pin.getBytes(StandardCharsets.US_ASCII));
        IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_PAIRING_REQUEST);
        // Ahead of Settings' dialog: the highest priority an app may ask for.
        filter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY - 1);
        // EXPORTED: the request comes from the Bluetooth process, not this app.
        // It is a protected broadcast, so no other app can send it.
        ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_EXPORTED);
        return receiver;
    }

    private void stopAnswering(PinAnswer receiver) {
        if (receiver == null) return;
        try {
            getContext().unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
            // already gone
        }
    }

    private static final class PinAnswer extends BroadcastReceiver {
        final String address;
        final byte[] pin;
        final AtomicBoolean answered = new AtomicBoolean(false);

        PinAnswer(String address, byte[] pin) {
            this.address = address;
            this.pin = pin;
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onReceive(Context context, Intent intent) {
            BluetoothDevice device = IntentCompat.getParcelableExtra(intent, BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
            int variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, -1);
            if (device == null || !address.equalsIgnoreCase(device.getAddress())) return;
            if (variant != BluetoothDevice.PAIRING_VARIANT_PIN || !answered.compareAndSet(false, true)) return;
            try {
                // Settings' dialog never opens. Where the broadcast is not
                // ordered it opens and closes itself once the bond is made.
                if (device.setPin(pin) && isOrderedBroadcast()) abortBroadcast();
            } catch (SecurityException ignored) {
                // No "Nearby devices" permission: Android's own dialog stays.
            }
        }
    }

    /**
     * An open serial-port connection to a paired classic printer.
     *
     * Unauthenticated first. An authenticated (secure) connection needs the
     * link key the printer stored at pairing, and many cheap thermal printers
     * forget it when they are switched off: Android then shows its "pairing
     * request" dialog on every print after a restart, although the printer is
     * still listed as paired. An unauthenticated channel needs no key, so it
     * reconnects silently. Just after power-on the printer's service record
     * is often not answering yet, so the fixed channel 1 (where these printers
     * listen) is tried too, and the whole round once more after a pause.
     * The authenticated channel is kept as the last resort for the few
     * printers that refuse anything else -- the only step that can bring the
     * pairing dialog back, and only when the printer really needs it.
     */
    @SuppressLint("MissingPermission")
    private BluetoothSocket openSpp(BluetoothDevice device) throws IOException, InterruptedException {
        IOException last = null;
        for (int round = 0; round < 2; round++) {
            if (round > 0) Thread.sleep(SPP_RETRY_PAUSE_MS);
            for (int way = 0; way < 2; way++) {
                BluetoothSocket socket = null;
                try {
                    socket = way == 0 ? device.createInsecureRfcommSocketToServiceRecord(SPP) : insecureChannelOne(device);
                    socket.connect();
                    return socket;
                } catch (IOException e) {
                    closeQuietly(socket);
                    last = e;
                }
            }
        }
        BluetoothSocket secure = device.createRfcommSocketToServiceRecord(SPP);
        try {
            secure.connect();
            return secure;
        } catch (IOException e) {
            closeQuietly(secure);
            throw last != null ? last : e;
        }
    }

    /** RFCOMM channel 1 without a service lookup; a hidden API, so it may be missing. */
    private static BluetoothSocket insecureChannelOne(BluetoothDevice device) throws IOException {
        try {
            return (BluetoothSocket) device.getClass().getMethod("createInsecureRfcommSocket", int.class).invoke(device, 1);
        } catch (ReflectiveOperationException | RuntimeException e) {
            throw new IOException("RFCOMM channel 1 is not available on this device.", e);
        }
    }

    /**
     * BLE: connect, negotiate a larger MTU, find the printer's write
     * characteristic, stream the job in MTU-sized writes. Runs on the io
     * thread; the GATT callbacks hand results back through latches.
     */
    @SuppressLint("MissingPermission")
    private void printBle(PluginCall call, byte[] bytes, BluetoothDevice device, int pace) {
        final CountDownLatch ready = new CountDownLatch(1);
        final Semaphore written = new Semaphore(0);
        final AtomicReference<BluetoothGattCharacteristic> tx = new AtomicReference<>();
        final AtomicReference<String> failure = new AtomicReference<>();
        final AtomicInteger mtu = new AtomicInteger(23);

        BluetoothGattCallback callback = new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    // A receipt is a thousand or more acknowledged writes. At
                    // the default (balanced) interval each one costs ~45 ms;
                    // HIGH asks for ~11-15 ms while this job runs. An EZO
                    // printer took 3-5 minutes per receipt without it.
                    gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);
                    // Bigger writes; onMtuChanged continues. Some stacks refuse
                    // the request outright, then discover at the default size.
                    if (!gatt.requestMtu(512)) gatt.discoverServices();
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    failure.compareAndSet(null, "The printer disconnected.");
                    ready.countDown();
                    written.release();
                }
            }

            @Override
            public void onMtuChanged(BluetoothGatt gatt, int size, int status) {
                if (status == BluetoothGatt.GATT_SUCCESS) mtu.set(size);
                gatt.discoverServices();
            }

            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                BluetoothGattCharacteristic best = null;
                int bestScore = -1;
                for (BluetoothGattService service : gatt.getServices()) {
                    String uuid = service.getUuid().toString().toLowerCase();
                    if (BLE_STANDARD_SERVICES.contains(uuid.substring(0, 8))) continue;
                    for (BluetoothGattCharacteristic ch : service.getCharacteristics()) {
                        int props = ch.getProperties();
                        boolean noResponse = (props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
                        boolean write = (props & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
                        if (!noResponse && !write) continue;
                        int score = (BLE_PRINTER_SERVICES.contains(uuid) ? 2 : 0) + (noResponse ? 1 : 0);
                        if (score > bestScore) {
                            bestScore = score;
                            best = ch;
                        }
                    }
                }
                if (best == null) failure.compareAndSet(null, "This Bluetooth device does not accept print data.");
                tx.set(best);
                ready.countDown();
            }

            @Override
            public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic ch, int status) {
                if (status != BluetoothGatt.GATT_SUCCESS) failure.compareAndSet(null, "The printer refused the data (GATT " + status + ").");
                written.release();
            }
        };

        BluetoothGatt gatt = null;
        try {
            gatt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? device.connectGatt(getContext(), false, callback, BluetoothDevice.TRANSPORT_LE)
                : device.connectGatt(getContext(), false, callback);
            if (gatt == null) {
                call.reject("Could not open a Bluetooth connection to the printer.");
                return;
            }
            if (!ready.await(20, TimeUnit.SECONDS)) {
                call.reject("The printer did not answer. Check it is on and nearby, then try again.");
                return;
            }
            BluetoothGattCharacteristic ch = tx.get();
            if (ch == null || failure.get() != null) {
                call.reject(failure.get() != null ? failure.get() : "This Bluetooth device does not accept print data.");
                return;
            }
            boolean noResponse = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
            ch.setWriteType(noResponse
                ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            int chunk = Math.max(20, mtu.get() - 3);
            for (int at = 0; at < bytes.length; at += chunk) {
                ch.setValue(Arrays.copyOfRange(bytes, at, Math.min(bytes.length, at + chunk)));
                if (!gatt.writeCharacteristic(ch)) {
                    call.reject("The printer stopped accepting data part-way through.");
                    return;
                }
                // Each write is acknowledged by onCharacteristicWrite; then a
                // pause so an unacknowledged write cannot outrun the buffer.
                if (!written.tryAcquire(3, TimeUnit.SECONDS) || failure.get() != null) {
                    call.reject(failure.get() != null ? failure.get() : "The printer stopped answering part-way through.");
                    return;
                }
                Thread.sleep(pace);
            }
            // Let the last packets drain before the link drops.
            Thread.sleep(Math.min(3000, 300 + bytes.length / 40));
            call.resolve();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            call.reject("Printing was interrupted.");
        } catch (Exception e) {
            call.reject("Could not reach the Bluetooth printer. Check it is on and nearby. (" + e.getMessage() + ")");
        } finally {
            if (gatt != null) {
                try {
                    gatt.disconnect();
                    gatt.close();
                } catch (Exception ignored) {
                    // nothing to recover
                }
            }
        }
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager != null ? manager.getAdapter() : null;
    }

    private static void closeQuietly(BluetoothSocket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
            // nothing to recover
        }
    }

    /* --------------------------------------------------------------- usb -- */

    private UsbManager usbManager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    /** The printer-class interface if there is one, else any with a bulk OUT endpoint. */
    private static Object[] bulkOut(UsbDevice device) {
        Object[] fallback = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            for (int e = 0; e < iface.getEndpointCount(); e++) {
                UsbEndpoint ep = iface.getEndpoint(e);
                if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                    Object[] found = new Object[] { iface, ep };
                    if (iface.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return found;
                    if (fallback == null) fallback = found;
                }
            }
        }
        return fallback;
    }

    @PluginMethod
    public void listUsb(PluginCall call) {
        UsbManager manager = usbManager();
        JSArray devices = new JSArray();
        if (manager != null) {
            for (UsbDevice d : manager.getDeviceList().values()) {
                if (bulkOut(d) == null) continue;
                JSObject o = new JSObject();
                String name = d.getProductName();
                o.put("name", name != null ? name : "USB printer " + Integer.toHexString(d.getVendorId()) + ":" + Integer.toHexString(d.getProductId()));
                o.put("vendorId", d.getVendorId());
                o.put("productId", d.getProductId());
                devices.put(o);
            }
        }
        JSObject out = new JSObject();
        out.put("devices", devices);
        call.resolve(out);
    }

    private UsbDevice findUsb(PluginCall call) {
        UsbManager manager = usbManager();
        if (manager == null) return null;
        int vendorId = call.getInt("vendorId", -1);
        int productId = call.getInt("productId", -1);
        for (UsbDevice d : manager.getDeviceList().values()) {
            if (d.getVendorId() == vendorId && d.getProductId() == productId) return d;
        }
        return null;
    }

    private void printUsb(PluginCall call, byte[] bytes) {
        UsbManager manager = usbManager();
        UsbDevice device = findUsb(call);
        if (manager == null || device == null) {
            call.reject("The USB printer is not connected. Check the cable, then choose it again in Device Configuration.");
            return;
        }
        if (manager.hasPermission(device)) {
            io.execute(() -> writeUsb(call, manager, device, bytes));
            return;
        }

        // Android shows its own "Allow access to the printer?" dialog once.
        Context context = getContext();
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                try {
                    ctx.unregisterReceiver(this);
                } catch (IllegalArgumentException ignored) {
                    // already gone
                }
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                    io.execute(() -> writeUsb(call, manager, device, bytes));
                } else {
                    call.reject("Access to the USB printer was not allowed.");
                }
            }
        };
        ContextCompat.registerReceiver(context, receiver, new IntentFilter(USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        Intent intent = new Intent(USB_PERMISSION).setPackage(context.getPackageName());
        manager.requestPermission(device, PendingIntent.getBroadcast(context, 0, intent, flags));
    }

    private void writeUsb(PluginCall call, UsbManager manager, UsbDevice device, byte[] bytes) {
        Object[] target = bulkOut(device);
        if (target == null) {
            call.reject("This USB device is not a printer.");
            return;
        }
        UsbInterface iface = (UsbInterface) target[0];
        UsbEndpoint endpoint = (UsbEndpoint) target[1];
        UsbDeviceConnection connection = manager.openDevice(device);
        if (connection == null) {
            call.reject("Could not open the USB printer.");
            return;
        }
        try {
            if (!connection.claimInterface(iface, true)) {
                call.reject("The USB printer is busy.");
                return;
            }
            for (int at = 0; at < bytes.length; at += USB_CHUNK) {
                int length = Math.min(USB_CHUNK, bytes.length - at);
                if (connection.bulkTransfer(endpoint, bytes, at, length, 10000) < 0) {
                    call.reject("The USB printer stopped responding.");
                    return;
                }
            }
            call.resolve();
        } finally {
            connection.releaseInterface(iface);
            connection.close();
        }
    }

    /* ------------------------------------------------------------- print -- */

    /**
     * { type: "bluetooth", address, pin? } or { type: "usb", vendorId, productId },
     * plus data: base64 ESC/POS. pin answers a printer that asks to pair again.
     */
    @PluginMethod
    public void print(PluginCall call) {
        if ("bluetooth".equals(call.getString("type")) && needsBluetoothPermission()) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermissionResult");
            return;
        }
        startPrint(call);
    }

    private void startPrint(PluginCall call) {
        byte[] bytes;
        try {
            bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("The print job was not readable.");
            return;
        }
        if (bytes.length == 0) {
            call.reject("Nothing to print.");
            return;
        }
        String type = call.getString("type", "");
        if ("bluetooth".equals(type)) {
            io.execute(() -> printBluetooth(call, bytes));
        } else if ("usb".equals(type)) {
            printUsb(call, bytes);
        } else {
            call.reject("Unknown printer type.");
        }
    }
}
