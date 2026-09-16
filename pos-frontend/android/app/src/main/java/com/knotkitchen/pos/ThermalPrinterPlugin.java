package com.knotkitchen.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
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
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Raw ESC/POS to a receipt printer, for the Android app.
 *
 * The POS builds the print job itself (utils/escpos.js); this only delivers
 * the bytes. It exists because the in-app WebView has neither WebUSB nor Web
 * Bluetooth, and because most cheap thermal printers are classic Bluetooth
 * (serial port profile), which no browser can reach at all.
 *
 *   bluetooth  a printer already paired in Android settings, over RFCOMM/SPP
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
