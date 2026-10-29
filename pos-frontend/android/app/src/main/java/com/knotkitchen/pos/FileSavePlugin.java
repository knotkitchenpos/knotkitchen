package com.knotkitchen.pos;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saving an image the POS made (the table QR card) on the phone or tablet.
 *
 * The app is a WebView around the live POS, and a WebView ignores the
 * browser's <a download>: the Download PNG button did nothing in the app.
 *
 *   Android 10+   saved straight into Pictures/KnotKitchen (MediaStore, no
 *                 permission needed), where the gallery and Files show it.
 *   Android 6-9   writing to Pictures needs a storage permission, so the
 *                 share sheet opens instead: Save to Files, Drive, WhatsApp
 *                 or a print app, the user's choice.
 *
 * The page sends the image as base64 (FileSave.saveImage in
 * src/utils/saveImage.js).
 */
@CapacitorPlugin(name = "FileSave")
public class FileSavePlugin extends Plugin {

    private static final String FOLDER = "KnotKitchen";

    @PluginMethod
    public void saveImage(PluginCall call) {
        String data = call.getString("data");
        String mimeType = call.getString("mimeType", "image/png");
        String fileName = safeName(call.getString("fileName", "knotkitchen.png"));
        if (data == null || data.isEmpty() || mimeType == null || !mimeType.startsWith("image/")) {
            call.reject("There is no image to save.");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("The image could not be read.");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveToPictures(call, bytes, fileName, mimeType);
            } else {
                shareFile(call, bytes, fileName, mimeType);
            }
        } catch (Exception e) {
            Logger.error("FileSave", "saving " + fileName + " failed", e);
            call.reject("The image could not be saved.");
        }
    }

    private void saveToPictures(PluginCall call, byte[] bytes, String fileName, String mimeType) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + FOLDER);
        // Hidden from the gallery until the whole file is written.
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("MediaStore refused the image");
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IllegalStateException("no output stream");
            out.write(bytes);
        } catch (Exception e) {
            resolver.delete(uri, null, null);
            throw e;
        }
        values.clear();
        values.put(MediaStore.Images.Media.IS_PENDING, 0);
        resolver.update(uri, values, null, null);

        JSObject result = new JSObject();
        result.put("saved", true);
        result.put("location", Environment.DIRECTORY_PICTURES + "/" + FOLDER);
        call.resolve(result);
    }

    private void shareFile(PluginCall call, byte[] bytes, String fileName, String mimeType) throws Exception {
        // cache-path in res/xml/file_paths.xml covers this folder.
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("no cache folder");
        File file = new File(dir, fileName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent send = new Intent(Intent.ACTION_SEND)
            .setType(mimeType)
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(Intent.createChooser(send, "Save the image"));

        JSObject result = new JSObject();
        result.put("saved", false);
        result.put("shared", true);
        call.resolve(result);
    }

    /** Letters, digits, dot, dash and underscore only: never a path. */
    private static String safeName(String name) {
        String s = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "-");
        if (s.isEmpty() || s.startsWith(".")) s = "knotkitchen" + s;
        return s.length() > 80 ? s.substring(s.length() - 80) : s;
    }
}
