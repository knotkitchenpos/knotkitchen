package com.knotkitchen.mdm;

import android.content.Context;
import android.content.pm.PackageInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Enrollment and the sync loop. One worker thread; requests while a sync is
 * queued collapse into it. Everything the device wants to tell the server
 * (events, command results) is queued on disk and flushed on the next
 * successful sync, so an offline tablet loses nothing.
 */
public final class SyncEngine {
    private static final long STUCK_MS = 3 * 60_000;
    private static ExecutorService exec = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean pending = new AtomicBoolean(false);
    private static volatile long lastSuccess = 0;
    private static volatile long runningSince = 0;

    private SyncEngine() {}

    public static long lastSuccess() { return lastSuccess; }

    public static synchronized void request(Context ctx, String reason) {
        Context c = ctx.getApplicationContext();
        // Watchdog for the worker itself: a sync stuck past STUCK_MS gets a
        // fresh thread, so heartbeats never stop for good.
        long since = runningSince;
        if (since > 0 && System.currentTimeMillis() - since > STUCK_MS) {
            AgentLog.w("sync", "worker stuck for " + (System.currentTimeMillis() - since) / 1000 + "s, replacing it");
            exec.shutdownNow();
            exec = Executors.newSingleThreadExecutor();
            runningSince = 0;
            pending.set(false);
        }
        if (!pending.compareAndSet(false, true)) return;
        exec.execute(() -> {
            pending.set(false);
            runningSince = System.currentTimeMillis();
            try {
                Prefs p = new Prefs(c);
                if (p.server() == null) return;
                if (!p.isEnrolled()) {
                    if (p.enrollToken() != null) enroll(c);
                    return;
                }
                sync(c, reason);
            } catch (Api.ApiException e) {
                AgentLog.w("sync", "server said " + e.getMessage());
            } catch (Exception e) {
                AgentLog.w("sync", "failed (" + reason + "): " + e);
            } finally {
                runningSince = 0;
            }
        });
    }

    /** Queues a device event (sent with the next sync). */
    public static void event(Context c, String type, String message) {
        try {
            JSONObject e = new JSONObject();
            e.put("type", type);
            e.put("message", message);
            e.put("at", System.currentTimeMillis());
            new Prefs(c).queue("events", e);
        } catch (Exception ignored) {
        }
    }

    // ---------------- enrollment ----------------

    static void enroll(Context c) throws Exception {
        Prefs p = new Prefs(c);
        String token = p.enrollToken();
        AgentLog.i("enroll", "enrolling with " + p.server());
        JSONObject body = new JSONObject();
        body.put("token", token);
        body.put("facts", DeviceInfo.facts(c));
        body.put("attestation", DeviceInfo.attestation(token));
        JSONObject r;
        try {
            r = new Api(c).post("/device/enroll", body);
        } catch (Api.ApiException e) {
            // A refused token will not start working; drop it so we stop retrying.
            if (e.status == 401 || e.status == 403) {
                AgentLog.w("enroll", "token refused: " + e.getMessage());
                p.clearEnrollToken();
                p.queue("enrollErrors", new JSONObject().put("error", e.getMessage()));
            }
            throw e;
        }
        p.setIdentity(r.getString("deviceId"), r.optString("deviceName"), r.getString("credential"),
                r.getString("techSecret"), r.optInt("techStepSeconds", 300));
        p.clearEnrollToken();
        AgentLog.i("enroll", "enrolled as " + r.getString("deviceId"));
        handlePolicy(c, r.optJSONObject("policy"));
        handleManagedConfig(c, r.optJSONObject("managedConfig"));
        AppInstaller.reconcile(c, r.optJSONArray("apps"), true);
        event(c, "agent_enrolled", "Agent " + BuildConfig.VERSION_NAME + " enrolled");
        AgentService.start(c);
        sync(c, "enrolled");
    }

    // ---------------- sync ----------------

    static void sync(Context c, String reason) throws Exception {
        Prefs p = new Prefs(c);
        Commands.flushReports(c);

        JSONObject body = new JSONObject();
        body.put("telemetry", DeviceInfo.telemetry(c));
        body.put("apps", DeviceInfo.apps(c));
        body.put("agentVersion", BuildConfig.VERSION_NAME);
        body.put("agentVersionCode", BuildConfig.VERSION_CODE);
        body.put("androidVersion", android.os.Build.VERSION.RELEASE);
        body.put("securityPatch", android.os.Build.VERSION.SECURITY_PATCH);
        body.put("sdkInt", android.os.Build.VERSION.SDK_INT);
        PackageInfo pos = DeviceInfo.packageInfo(c, Kiosk.primaryPackage(c));
        if (pos != null) {
            body.put("posVersion", pos.versionName);
            body.put("posVersionCode", pos.getLongVersionCode());
        }
        JSONObject kiosk = new JSONObject();
        kiosk.put("state", Kiosk.state(c));
        kiosk.put("error", Kiosk.stateError(c));
        kiosk.put("crashCount", Watchdog.recentLaunches(c));
        if (p.technicianActive()) kiosk.put("technicianUntil", p.technicianUntil());
        body.put("kiosk", kiosk);
        JSONObject pol = new JSONObject();
        pol.put("appliedHash", p.appliedHash());
        pol.put("errors", p.policyErrors());
        pol.put("appliedAt", p.appliedAt());
        body.put("policy", pol);
        if (p.policy() == null) body.put("wantPolicy", true);
        JSONArray events = p.drain("events");
        maybeReady(c, events);
        body.put("events", events);

        JSONObject r;
        try {
            r = new Api(c).post("/device/sync", body);
        } catch (Exception e) {
            for (int i = 0; i < events.length(); i++) p.queue("events", events.getJSONObject(i));
            throw e;
        }
        lastSuccess = System.currentTimeMillis();

        if (r.has("newCredential")) {
            p.setCredential(r.getString("newCredential"));
            AgentLog.i("sync", "credential rotated");
        }
        p.setHeartbeatSeconds(r.optInt("heartbeatSeconds", 60));
        p.setMaintenanceWindowOpen(r.optBoolean("maintenanceWindowOpen", false));
        handlePolicy(c, r.optJSONObject("policy"));
        // Self-heal: re-apply when what we applied is not what the server expects.
        if (!r.optString("policyHash").equals(p.appliedHash()) && p.policy() != null && r.optJSONObject("policy") == null) {
            reapply(c);
        }
        handleManagedConfig(c, r.optJSONObject("managedConfig"));
        LostModeActivity.sync(c, r.optJSONObject("lostMode"));
        AppInstaller.reconcile(c, r.optJSONArray("apps"), p.maintenanceWindowOpen());
        JSONArray cmds = r.optJSONArray("commands");
        if (cmds != null) for (int i = 0; i < cmds.length(); i++) Commands.handle(c, cmds.getJSONObject(i));
        Watchdog.verifyKiosk(c);
    }

    static void handlePolicy(Context c, JSONObject policy) {
        if (policy == null) return;
        Prefs p = new Prefs(c);
        p.setPolicy(policy.optString("hash"), policy.optJSONObject("settings"));
        reapply(c);
    }

    static void reapply(Context c) {
        Prefs p = new Prefs(c);
        JSONObject s = p.policy();
        if (s == null) return;
        List<String> errors = PolicyEngine.apply(c, s);
        p.setApplied(p.policyHash(), errors);
        AgentLog.i("policy", "applied " + p.policyHash() + (errors.isEmpty() ? "" : " with errors " + errors));
        event(c, errors.isEmpty() ? "policy_applied" : "policy_errors", p.policyHash() + (errors.isEmpty() ? "" : " " + errors));
    }

    private static void handleManagedConfig(Context c, JSONObject cfg) {
        if (cfg == null) return;
        Prefs p = new Prefs(c);
        JSONObject old = p.managedConfig();
        if (old != null && old.toString().equals(cfg.toString())) return;
        p.setManagedConfig(cfg);
        PolicyEngine.applyManagedConfig(c, cfg);
        event(c, "managed_config", "POS configuration updated");
    }

    /** "Ready" once: policy applied, POS installed, kiosk locked. Marks the device Active. */
    private static void maybeReady(Context c, JSONArray events) throws Exception {
        Prefs p = new Prefs(c);
        if (p.readyReported()) return;
        if (p.appliedHash() == null || !"locked".equals(Kiosk.state(c))) return;
        JSONObject e = new JSONObject();
        e.put("type", "ready");
        e.put("message", "Kiosk locked on " + Kiosk.primaryPackage(c));
        e.put("at", System.currentTimeMillis());
        events.put(e);
        p.setReadyReported();
    }
}
