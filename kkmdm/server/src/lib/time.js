/** Minutes since local midnight in a time zone. */
function localMinutes(tz = "Asia/Kolkata", at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour").value);
  const m = Number(parts.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

function hhmm(str) {
  const [h, m] = String(str || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** True when `at` falls in [start, end) local time; handles windows over midnight. */
function inWindow(start, end, tz, at = new Date()) {
  const now = localMinutes(tz, at);
  const s = hhmm(start);
  const e = hhmm(end);
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

module.exports = { localMinutes, hhmm, inWindow };
