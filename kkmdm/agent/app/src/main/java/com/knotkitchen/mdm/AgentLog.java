package com.knotkitchen.mdm;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Logcat plus a small rolling file the dashboard can pull ("pull_logs"). */
public final class AgentLog {
    private static final long MAX_BYTES = 512 * 1024;
    private static File file;

    private AgentLog() {}

    static void init(Context c) {
        file = new File(c.getFilesDir(), "agent.log");
    }

    public static File file() {
        return file;
    }

    public static void i(String tag, String msg) {
        Log.i("KKMDM/" + tag, msg);
        write("I", tag, msg);
    }

    public static void w(String tag, String msg) {
        Log.w("KKMDM/" + tag, msg);
        write("W", tag, msg);
    }

    public static void e(String tag, String msg, Throwable t) {
        Log.e("KKMDM/" + tag, msg, t);
        write("E", tag, msg + (t != null ? " :: " + t : ""));
    }

    private static synchronized void write(String level, String tag, String msg) {
        if (file == null) return;
        try {
            if (file.length() > MAX_BYTES) {
                File old = new File(file.getParentFile(), "agent.log.1");
                //noinspection ResultOfMethodCallIgnored
                old.delete();
                //noinspection ResultOfMethodCallIgnored
                file.renameTo(old);
            }
            try (FileWriter w = new FileWriter(file, true)) {
                String ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
                w.write(ts + " " + level + "/" + tag + ": " + msg + "\n");
            }
        } catch (IOException ignored) {
        }
    }
}
