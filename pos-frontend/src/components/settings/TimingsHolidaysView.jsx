import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { updateChannelTimings, updateHolidays, toggleClosedForToday } from "../../https";
import { getWebsiteSettings } from "../../https/storefrontApi";

/* ---------- Store Timings UI Redesign & Holidays Calendar ---------- */
const TimingsHolidaysView = () => {
  const qc = useQueryClient();
  const { data: webRes, isLoading } = useQuery({ queryKey: ["website", "settings"], queryFn: getWebsiteSettings });
  const settings = webRes?.data?.data?.settings || {};

  // Active channel tab: "collection", "delivery", or "table"
  const [activeChannel, setActiveChannel] = useState("delivery");

  // Holidays state
  const existingHolidays = settings.holidays || [];
  const [holidays, setHolidays] = useState(existingHolidays);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("Store Closed for Holiday");

  React.useEffect(() => {
    if (settings.holidays) setHolidays(settings.holidays);
  }, [settings.holidays]);

  // Days list Monday to Sunday
  const DAYS = [
    { key: "monday", label: "Monday", dayIndex: 1 },
    { key: "tuesday", label: "Tuesday", dayIndex: 2 },
    { key: "wednesday", label: "Wednesday", dayIndex: 3 },
    { key: "thursday", label: "Thursday", dayIndex: 4 },
    { key: "friday", label: "Friday", dayIndex: 5 },
    { key: "saturday", label: "Saturday", dayIndex: 6 },
    { key: "sunday", label: "Sunday", dayIndex: 0 },
  ];

  // Store timings schedule for current channel
  const channelData = settings.channelHours?.[activeChannel] || {};
  const [sameTimingAllDays, setSameTimingAllDays] = useState(Boolean(channelData.sameTimingAllDays));
  const [weeklySchedule, setWeeklySchedule] = useState({});

  React.useEffect(() => {
    const rawData = settings.channelHours?.[activeChannel] || {};
    setSameTimingAllDays(Boolean(rawData.sameTimingAllDays));
    const map = {};
    DAYS.forEach(({ key, dayIndex }) => {
      const found = (rawData.weekly || []).find((w) => Number(w.day) === dayIndex);
      const openT = found?.openTime || "16:00";
      const closeT = found?.closeTime || "23:50";
      const isOvr = isOvernight(openT, closeT);
      const closeD = found?.closeDay !== undefined && found?.closeDay !== null
        ? Number(found.closeDay)
        : (isOvr ? (dayIndex + 1) % 7 : dayIndex);

      map[key] = {
        isOpen: found ? Boolean(found.isOpen) : true,
        openTime: openT,
        closeDay: closeD,
        closeTime: closeT,
        periods: Array.isArray(found?.periods) ? found.periods : [],
      };
    });
    setWeeklySchedule(map);
  }, [activeChannel, settings]);

  const timingMutation = useMutation({
    mutationFn: updateChannelTimings,
    onSuccess: () => {
      enqueueSnackbar("Store timings updated successfully!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update timings", { variant: "error" }),
  });

  const holidayMutation = useMutation({
    mutationFn: updateHolidays,
    onSuccess: () => {
      enqueueSnackbar("Holidays updated successfully!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update holidays", { variant: "error" }),
  });

  const cftMutation = useMutation({
    mutationFn: toggleClosedForToday,
    onSuccess: (res) => {
      enqueueSnackbar(res.data?.message || "Closed for Today status updated!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["website", "settings"] });
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update Closed for Today status", { variant: "error" }),
  });

  const isOvernight = (openT, closeT) => {
    if (!openT || !closeT) return false;
    const [oh, om] = openT.split(":").map(Number);
    const [ch, cm] = closeT.split(":").map(Number);
    return ch * 60 + cm < oh * 60 + om;
  };

  const handleToggleDay = (dayKey) => {
    setWeeklySchedule((prev) => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        isOpen: !prev[dayKey]?.isOpen,
      },
    }));
  };

  const handleTimeChange = (dayKey, field, val, periodIdx = null) => {
    setWeeklySchedule((prev) => {
      const current = prev[dayKey] || { isOpen: true, openTime: "16:00", closeDay: 1, closeTime: "23:50", periods: [] };
      if (periodIdx !== null) {
        const copyPeriods = [...(current.periods || [])];
        copyPeriods[periodIdx] = { ...copyPeriods[periodIdx], [field]: val };
        return { ...prev, [dayKey]: { ...current, periods: copyPeriods } };
      }

      const updated = { ...current, [field]: val };

      // Auto-adjust closeDay if openTime or closeTime is changed and closeDay wasn't manually specified
      if (field === "openTime" || field === "closeTime") {
        const openT = field === "openTime" ? val : current.openTime;
        const closeT = field === "closeTime" ? val : current.closeTime;
        const dayObj = DAYS.find((d) => d.key === dayKey);
        const startDayIdx = dayObj ? dayObj.dayIndex : 0;
        if (isOvernight(openT, closeT)) {
          updated.closeDay = (startDayIdx + 1) % 7;
        } else {
          updated.closeDay = startDayIdx;
        }
      }

      if (sameTimingAllDays) {
        const syncAll = {};
        DAYS.forEach(({ key, dayIndex }) => {
          const itemOpenT = field === "openTime" ? val : (prev[key]?.openTime || "16:00");
          const itemCloseT = field === "closeTime" ? val : (prev[key]?.closeTime || "23:50");
          let itemCloseD = field === "closeDay" ? Number(val) : (prev[key]?.closeDay ?? dayIndex);
          if (field === "openTime" || field === "closeTime") {
            itemCloseD = isOvernight(itemOpenT, itemCloseT) ? (dayIndex + 1) % 7 : dayIndex;
          }
          syncAll[key] = {
            ...prev[key],
            [field]: val,
            closeDay: itemCloseD,
          };
        });
        return syncAll;
      }
      return { ...prev, [dayKey]: updated };
    });
  };

  const handleAddHour = (dayKey) => {
    setWeeklySchedule((prev) => {
      const current = prev[dayKey] || { isOpen: true, openTime: "16:00", closeTime: "23:50", periods: [] };
      const copyPeriods = [...(current.periods || []), { openTime: "21:00", closeTime: "23:50" }];
      return { ...prev, [dayKey]: { ...current, periods: copyPeriods } };
    });
  };

  const handleRemovePeriod = (dayKey, periodIdx) => {
    setWeeklySchedule((prev) => {
      const current = prev[dayKey];
      const copyPeriods = (current.periods || []).filter((_, i) => i !== periodIdx);
      return { ...prev, [dayKey]: { ...current, periods: copyPeriods } };
    });
  };

  const handleSubmitDay = () => {
    const weekly = DAYS.map(({ key, dayIndex }) => {
      const dayData = weeklySchedule[key] || { isOpen: true, openTime: "16:00", closeTime: "23:50", periods: [] };
      const openT = dayData.openTime || "16:00";
      const closeT = dayData.closeTime || "23:50";
      const isOvr = isOvernight(openT, closeT);
      const closeD = dayData.closeDay !== undefined && dayData.closeDay !== null
        ? Number(dayData.closeDay)
        : (isOvr ? (dayIndex + 1) % 7 : dayIndex);

      return {
        day: dayIndex,
        isOpen: Boolean(dayData.isOpen),
        openTime: openT,
        closeDay: closeD,
        closeTime: closeT,
        periods: dayData.periods || [],
      };
    });

    timingMutation.mutate({
      channel: activeChannel,
      data: {
        sameTimingAllDays,
        weekly,
      },
    });
  };

  const channelTitle =
    activeChannel === "delivery"
      ? "Shop Delivery Hours"
      : activeChannel === "collection"
      ? "Shop Collection Hours"
      : "Shop Restaurant Hours";

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading Store Timings…</div>;

  return (
    <div className="space-y-6 text-[#0F172A]">

      {/* Main Workspace Card */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">

        {/* Top Horizontal Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[#E2E8F0] pb-3">
          <h3 className="text-[18px] sm:text-[20px] font-extrabold tracking-tight text-[#0F172A]">{channelTitle}</h3>

          <div className="flex items-center gap-5 sm:gap-8 text-[14px] max-w-full overflow-x-auto no-scrollbar">
            {[
              { key: "collection", label: "Collection Time" },
              { key: "delivery", label: "Delivery Time" },
              { key: "table", label: "Restaurant Time" },
            ].map((tab) => {
              const active = activeChannel === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveChannel(tab.key)}
                  className={`pb-2 transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? "text-[#1E293B] font-extrabold border-b-2 border-[#FD5302]"
                      : "text-[#64748B] font-semibold hover:text-[#0F172A]"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Same timing for all days option */}
        <div className="flex items-center gap-2 select-none text-[13px] font-bold text-[#475569]">
          <input
            type="checkbox"
            id="sameTiming"
            checked={sameTimingAllDays}
            onChange={(e) => setSameTimingAllDays(e.target.checked)}
            className="w-4 h-4 accent-[#FD5302] cursor-pointer"
          />
          <label htmlFor="sameTiming" className="cursor-pointer">Same timing for all days</label>
        </div>

        {/* Day-by-Day Timings List */}
        <div className="divide-y divide-[#F1F5F9]">
          {/* dayIndex is used below for the end-day dropdown default and the
              overnight badge — destructure it or the whole page throws
              ReferenceError on first render. */}
          {DAYS.map(({ key, label, dayIndex }) => {
            const dayData = weeklySchedule[key] || { isOpen: true, openTime: "16:00", closeTime: "23:50", periods: [] };
            const isOpen = dayData.isOpen;
            const overnight = isOpen && isOvernight(dayData.openTime, dayData.closeTime);

            return (
              <div key={key} className="py-4 space-y-3">
                {/* flex-wrap: the row is a fixed ~975px of controls, so on a
                    narrow window the badge and buttons drop to a second line
                    instead of overflowing the card. */}
                <div className="flex items-center gap-4 text-[13.5px] flex-wrap">
                  {/* ON/OFF Switch */}
                  <div className="flex items-center gap-2.5 w-[90px] shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleDay(key)}
                      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                        isOpen ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                          isOpen ? "right-1" : "left-1"
                        }`}
                      />
                    </button>
                    <span className={`font-bold text-[13px] ${isOpen ? "text-[#16A34A]" : "text-[#94A3B8]"}`}>
                      {isOpen ? "Open" : "Closed"}
                    </span>
                  </div>

                  {/* Day Name */}
                  <span className="font-extrabold text-[14.5px] text-[#334155] w-[110px] shrink-0">
                    {label}
                  </span>

                  {/* Primary Operating Time Inputs.
                      Fixed widths, not flex-1: letting this block stretch pushed
                      the action buttons to the far edge of the card and opened a
                      chasm across the middle of every row. */}
                  {isOpen ? (
                    <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                      {/* Opening / Start Time Input */}
                      <input
                        type="time"
                        value={dayData.openTime}
                        onChange={(e) => handleTimeChange(key, "openTime", e.target.value)}
                        className="w-[125px] h-[38px] px-3 rounded-lg border border-[#E2E8F0] font-semibold text-[13.5px] text-[#334155] bg-white focus:border-[#FD5302]"
                      />

                      {/* Connector Arrow */}
                      <span className="text-[#C2410C] font-extrabold text-sm px-1">→</span>

                      {/* End Day Selector Dropdown */}
                      <div className="flex items-center gap-1.5">
                        <select
                          value={dayData.closeDay !== undefined && dayData.closeDay !== null ? dayData.closeDay : (overnight ? (dayIndex + 1) % 7 : dayIndex)}
                          onChange={(e) => handleTimeChange(key, "closeDay", Number(e.target.value))}
                          className="w-[145px] h-[38px] px-2.5 rounded-lg border border-[#E2E8F0] font-semibold text-[13px] text-[#334155] bg-white focus:border-[#FD5302] cursor-pointer"
                          title="Select End Day"
                        >
                          {DAYS.map((d) => (
                            <option key={d.dayIndex} value={d.dayIndex}>
                              {d.label}
                            </option>
                          ))}
                        </select>

                        {/* Closing / End Time Input */}
                        <input
                          type="time"
                          value={dayData.closeTime}
                          onChange={(e) => handleTimeChange(key, "closeTime", e.target.value)}
                          className="w-[125px] h-[38px] px-3 rounded-lg border border-[#E2E8F0] font-semibold text-[13.5px] text-[#334155] bg-white focus:border-[#FD5302]"
                        />
                      </div>

                    </div>
                  ) : (
                    // 125 + 8 + 22 (arrow) + 8 + (145 + 6 + 125) — the width of the time
                    // block above, so the buttons sit in the same place either way.
                    <div className="w-full sm:w-[439px] shrink-0 text-[13px] font-bold text-[#94A3B8] italic">
                      Closed all day
                    </div>
                  )}

                  {/* Overnight / Next-Day Indicator Badge.
                      Reserved slot rather than a conditional element, so one
                      overnight day doesn't shove its own buttons out of line
                      with every other row. */}
                  <div className="sm:w-[104px] shrink-0">
                    {isOpen && (Number(dayData.closeDay) !== dayIndex || overnight) && (
                      <span className="px-2.5 py-1 rounded-md bg-[#FFF1E8] text-[#C2410C] text-[11px] font-extrabold flex items-center gap-1 w-fit">
                        <span>🌙</span> Overnight
                      </span>
                    )}
                  </div>

                  {/* Actions: Add Hour & Submit. Right-aligned inside a fixed
                      slot so Submit keeps its column on closed days, where
                      Add Hour isn't rendered. */}
                  <div className="sm:w-[168px] shrink-0 flex items-center justify-end gap-2">
                    {isOpen && (
                      <button
                        type="button"
                        onClick={() => handleAddHour(key)}
                        className="h-[34px] px-3.5 rounded-lg bg-[#E0F2FE] text-[#0284C7] font-bold text-[12px] hover:bg-[#BAE6FD] transition-colors"
                      >
                        Add Hour
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSubmitDay(key)}
                      disabled={timingMutation.isPending}
                      className="h-[34px] px-4 rounded-lg bg-[#DCFCE7] text-[#15803D] font-bold text-[12px] hover:bg-[#BBF7D0] transition-colors disabled:opacity-50"
                    >
                      {timingMutation.isPending ? "Saving…" : "Submit"}
                    </button>
                  </div>
                </div>

                {/* Additional Operating Periods */}
                {isOpen && (dayData.periods || []).map((period, pIdx) => (
                  <div key={pIdx} className="sm:pl-[204px] flex flex-wrap items-center gap-3 text-[13px]">
                    <span className="text-[11px] font-extrabold text-[#94A3B8] uppercase">Slot {pIdx + 2}:</span>
                    <input
                      type="time"
                      value={period.openTime}
                      onChange={(e) => handleTimeChange(key, "openTime", e.target.value, pIdx)}
                      className="h-[34px] px-2.5 rounded-lg border border-[#E2E8F0] font-semibold text-[12.5px]"
                    />

                    <span className="text-[#94A3B8] font-bold px-1">—</span>

                    <input
                      type="time"
                      value={period.closeTime}
                      onChange={(e) => handleTimeChange(key, "closeTime", e.target.value, pIdx)}
                      className="h-[34px] px-2.5 rounded-lg border border-[#E2E8F0] font-semibold text-[12.5px]"
                    />

                    <button
                      type="button"
                      onClick={() => handleRemovePeriod(key, pIdx)}
                      className="text-[#DC2626] font-bold text-[11.5px] hover:underline ml-2"
                    >
                      Remove Slot
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Closed for Today 1-Day Override Card */}
      <div className={`border rounded-2xl p-5 transition-all ${
        settings.closedForToday?.enabled
          ? "bg-[#FEF2F2] border-[#FCA5A5]"
          : "bg-white border-[#E2E8F0]"
      }`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="space-y-1 max-w-[640px]">
            <div className="flex items-center gap-2.5">
              <h4 className="text-[15px] font-extrabold text-[#0F172A]">Closed for Today</h4>
              {settings.closedForToday?.enabled ? (
                <span className="px-2.5 py-0.5 rounded-full bg-[#DC2626] text-white text-[11px] font-extrabold uppercase tracking-wide animate-pulse">
                  Active (Closed Today)
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-[#F1F5F9] text-[#64748B] text-[11px] font-bold">
                  Normal Schedule Active
                </span>
              )}
            </div>
            <p className="text-[12.5px] text-[#475569]">
              Temporarily close takeaway and online ordering for the entire current business day (including overnight shift). Regular schedule will automatically resume tomorrow without altering any configured hours.
            </p>
            {settings.closedForToday?.enabled && (
              <p className="text-[12px] font-bold text-[#DC2626] pt-1">
                🚫 Ordering is currently blocked for today ({settings.closedForToday?.date}). Will automatically re-open on tomorrow's scheduled time.
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const nowState = Boolean(settings.closedForToday?.enabled);
                cftMutation.mutate({ enabled: !nowState });
              }}
              disabled={cftMutation.isPending}
              className={`h-[42px] px-5 rounded-xl text-[13.5px] font-extrabold transition-all flex items-center gap-2 shadow-xs ${
                settings.closedForToday?.enabled
                  ? "bg-[#DC2626] text-white hover:bg-[#B91C1C]"
                  : "bg-[#0F172A] text-white hover:bg-[#1E293B]"
              } disabled:opacity-50`}
            >
              <span className={`w-2.5 h-2.5 rounded-full ${settings.closedForToday?.enabled ? "bg-white animate-ping" : "bg-emerald-400"}`} />
              {settings.closedForToday?.enabled ? "Turn Off 'Closed for Today'" : "Enable 'Closed for Today'"}
            </button>
          </div>
        </div>
      </div>

      {/* Module 7 §7: Holidays Calendar */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5 space-y-4">
        <div>
          <h4 className="text-[15px] font-extrabold text-[#0F172A]">Holidays Calendar</h4>
          <p className="text-[12px] text-[#94A3B8]">During a holiday, website displays "Store is Closed" and online ordering is blocked server-side.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[13px]">
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
          <div>
            <label className="text-[11.5px] font-bold text-[#94A3B8]">Reason / Message</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Annual Staff Day"
              className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => {
              if (!startDate || !endDate) {
                enqueueSnackbar("Start date and end date are required.", { variant: "warning" });
                return;
              }
              const updated = [...holidays, { startDate, endDate, reason }];
              setHolidays(updated);
              holidayMutation.mutate({ holidays: updated });
              setStartDate("");
              setEndDate("");
              setReason("Store Closed for Holiday");
            }}
            disabled={holidayMutation.isPending}
            className="h-[38px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50"
          >
            Add Holiday
          </button>
        </div>

        <div className="pt-2 border-t border-[#E2E8F0]">
          <h5 className="text-[13px] font-extrabold text-[#0F172A] mb-2">Configured Holidays ({holidays.length})</h5>
          {holidays.length === 0 ? (
            <p className="text-[12.5px] text-[#94A3B8]">No holidays scheduled.</p>
          ) : (
            <div className="space-y-2">
              {holidays.map((h, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[13px]">
                  <div>
                    <p className="font-bold text-[#0F172A]">{h.reason || "Holiday"}</p>
                    <p className="text-[11.5px] text-[#64748B]">
                      {new Date(h.startDate).toLocaleDateString("en-GB")} → {new Date(h.endDate).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const updated = holidays.filter((_, idx) => idx !== i);
                      setHolidays(updated);
                      holidayMutation.mutate({ holidays: updated });
                    }}
                    className="h-8 px-3 rounded-lg border border-[#FECACA] text-[#DC2626] font-bold text-[12px] hover:bg-[#FEF2F2]"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TimingsHolidaysView;
