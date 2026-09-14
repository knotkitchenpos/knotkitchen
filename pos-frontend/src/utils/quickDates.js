/**
 * The horizontal date strip: always ends on Today (rightmost, no future
 * dates) and reaches back at least 14 days, or further to include an older
 * selected day.
 *
 * It used to END on the selected day. Picking a day in the past rebuilt the
 * strip without Today in it, and picking an older one moved it further back
 * again, so there was no way to walk forward to the current date.
 */
export const buildQuickDates = (selected, now = new Date()) => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const DAY = 86400000;

  let back = 14;
  if (selected) {
    const sel = new Date(`${selected}T00:00:00`);
    if (!Number.isNaN(sel.getTime())) back = Math.max(back, Math.round((today - sel) / DAY) + 3);
  }

  const days = [];
  for (let offset = -back; offset <= 0; offset += 1) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    days.push(d);
  }
  return days;
};
