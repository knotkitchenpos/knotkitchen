import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaWhatsapp } from "react-icons/fa";
import { enqueueSnackbar } from "../../utils/notify";
import { partnersApi, errorMessage } from "../api";

/**
 * Daily WhatsApp summary (owner, 2026-11-13): yesterday's sales across all
 * stores on WhatsApp, every morning at the hour chosen
 * (pos-backend services/partnerDailySummary).
 */

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

const DailySummary = () => {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["partner-summary"],
    queryFn: () => partnersApi.summary().then((r) => r.data.data),
  });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    if (data?.settings) setForm({ enabled: data.settings.enabled, phone: data.settings.phone, hour: data.settings.hour });
  }, [data]);

  const save = async (next) => {
    setBusy("save");
    try {
      await partnersApi.saveSummary(next);
      setForm(next);
      qc.invalidateQueries({ queryKey: ["partner-summary"] });
      enqueueSnackbar(next.enabled ? `On: every day at ${hourLabel(next.hour)}.` : "Daily summary off.", { variant: "success", important: true });
    } catch (err) {
      enqueueSnackbar(errorMessage(err, "Not saved."), { variant: "error" });
    } finally {
      setBusy("");
    }
  };

  const sendNow = async () => {
    setBusy("send");
    try {
      await partnersApi.sendSummaryNow();
      enqueueSnackbar("Sent. Check WhatsApp.", { variant: "success", important: true });
    } catch (err) {
      enqueueSnackbar(errorMessage(err, "Could not send."), { variant: "error" });
    } finally {
      setBusy("");
    }
  };

  const s = data?.settings;
  const t = data?.template;
  const dirty = form && s && (form.phone !== s.phone || form.hour !== s.hour);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Daily WhatsApp summary</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">Yesterday&apos;s sales across all your stores, and anything that needs you, on WhatsApp every morning.</p>
      </div>
      {isError ? (
        <p className="text-[14px] font-bold text-[#B91C1C]">{errorMessage(error, "Could not load.")}</p>
      ) : isLoading || !form ? (
        <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : (
        <>
          {!t.ready && (
            <p className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] px-3.5 py-2.5 text-[12.5px] font-bold text-[#92400E]">
              Not available yet: {t.reason} Your settings are kept, and the first summary goes out once KnotKitchen has it approved.
            </p>
          )}
          <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-3">
              <FaWhatsapp size={26} className={form.enabled ? "text-[#16A34A]" : "text-[#94A3B8]"} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-extrabold">{form.enabled ? `On, every day at ${hourLabel(form.hour)}` : "Off"}</span>
                {s.lastSentAt && <span className="block text-[12px] text-[#64748B]">Last sent {new Date(s.lastSentAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>}
                {s.lastError && <span className="block text-[12px] font-bold text-[#B91C1C]">Last attempt: {s.lastError}</span>}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.enabled}
                aria-label="Daily summary"
                disabled={Boolean(busy)}
                onClick={() => save({ ...form, enabled: !form.enabled })}
                className={`w-12 h-7 rounded-full relative transition-colors disabled:opacity-50 ${form.enabled ? "bg-[#16A34A]" : "bg-[#CBD5E1]"}`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${form.enabled ? "left-6" : "left-1"}`} />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[12.5px] font-bold text-[#334155]">WhatsApp number</span>
                <input inputMode="numeric" maxLength={10} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })} placeholder="10-digit number" className="mt-1 h-11 w-full px-3 rounded-xl border border-[#E2E8F0]" />
              </label>
              <label className="block">
                <span className="text-[12.5px] font-bold text-[#334155]">Send at</span>
                <select value={form.hour} onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })} className="mt-1 h-11 w-full px-3 rounded-xl border border-[#E2E8F0] bg-white">
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!dirty || Boolean(busy)} onClick={() => save(form)} className="h-10 px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-extrabold disabled:opacity-40">
                {busy === "save" ? "Saving…" : "Save"}
              </button>
              <button type="button" disabled={!t.ready || !s.phone || Boolean(busy)} onClick={sendNow} className="h-10 px-4 rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#334155] disabled:opacity-40">
                {busy === "send" ? "Sending…" : "Send yesterday's now"}
              </button>
            </div>
          </section>
          <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5">
            <p className="text-[12px] font-bold uppercase tracking-wide text-[#64748B]">Yesterday&apos;s message</p>
            <p className="mt-2 rounded-xl bg-[#DCF8C6] px-3.5 py-3 text-[13.5px] leading-relaxed text-[#111827]">{data.preview}</p>
          </section>
        </>
      )}
    </div>
  );
};

export default DailySummary;
