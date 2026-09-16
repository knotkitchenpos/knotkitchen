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
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
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
            BluetoothDevice device = adapter.getRemoteDevice(address);
            socket = device.createRfcommSocketToServiceRecord(SPP);
            try {
                socket.connect();
            } catch (IOException secureFailed) {
                // Some printers only accept an unauthenticated channel.
                closeQuietly(socket);
                socket = device.createInsecureRfcommSocketToServiceRecord(SPP);
                socket.connect();
            }
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
            call.reject("Could not reach the Bluetooth printer. Check it is on and nearby. (" + e.getMessage() + ")");
        } finally {
            closeQuietly(socket);
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

    /** { type: "bluetooth", address } or { type: "usb", vendorId, productId }, plus data: base64 ESC/POS. */
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
