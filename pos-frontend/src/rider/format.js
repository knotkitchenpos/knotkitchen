/** Small display helpers for the Rider app. */

export const rupees = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const clock = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");

export const dayAndTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

export const minutesBetween = (a, b) => (a && b ? Math.max(1, Math.round((new Date(b) - new Date(a)) / 60000)) : null);

export const greeting = (d = new Date()) => {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Rider";

/** Each stage as the rider sees it. */
export const STAGES = {
  assigned: { label: "New delivery", badge: "NEW", tone: "brand" },
  accepted: { label: "Delivery accepted", badge: "ACCEPTED", tone: "blue" },
  on_the_way: { label: "On the way", badge: "ON THE WAY", tone: "green" },
  arrived: { label: "Arrived at customer", badge: "ARRIVED", tone: "amber" },
  delivered: { label: "Delivered", badge: "DELIVERED", tone: "green" },
  cancelled: { label: "Order cancelled", badge: "CANCELLED", tone: "red" },
};

export const telHref = (phone) => (phone ? `tel:${String(phone).replace(/[^\d+]/g, "")}` : "");
