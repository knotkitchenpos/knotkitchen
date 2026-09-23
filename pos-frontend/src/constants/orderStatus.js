/**
 * Order-status vocabulary for the POS UI.
 *
 * Mirrors `pos-backend/constants/orderStatus.js`. Keep the two in step — if you
 * add a status on one side, add it here too.
 *
 * Why this exists
 * ---------------
 * `orderStatus` is a free-form string on the order, and for a long time each
 * screen hard-coded its own spellings. That is silent when it goes wrong: a
 * status that doesn't match an equality check just quietly isn't counted, so
 * the symptom is a wrong total or a missing badge rather than an error.
 *
 * Two examples that were live in this app:
 *   - the Orders page counted only "Completed" as done, so every order the
 *     auto-complete sweep finished as "Served" or "Delivered", and every
 *     settled table bill ("paid"), was reported as still ongoing;
 *   - the online-orders card had no style for "Preparing" and fell back to the
 *     grey "Completed" look.
 *
 * Use the helpers rather than comparing strings.
 */

// --- Canonical names --------------------------------------------------------
export const PREPARING = "Preparing";
export const READY = "Ready";
export const COMPLETED = "Completed";
export const CANCELLED = "Cancelled";
export const REFUNDED = "Refunded";

/**
 * "Awaiting acceptance" for website and marketplace orders.
 *
 * NOT a synonym for Preparing in that flow: the POS offers Accept / Reject
 * while an order is here, and moves it to "In Progress" once accepted. Keep
 * the two distinct or the accept step disappears.
 */
export const AWAITING_ACCEPTANCE = "Pending";

/** Written by the auto-complete sweep, to suit the order type. */
export const SERVED = "Served";
export const DELIVERED = "Delivered";

/** A settled table bill. Legacy casing, preserved deliberately. */
export const PAID = "paid";

// --- Groups (include historical spellings still on old orders) --------------
const lower = (s) => String(s || "").toLowerCase();

const PREPARING_SET = new Set(["preparing", "pending", "in progress"]);
const READY_SET = new Set(["ready"]);
const SETTLED_SET = new Set(["completed", "served", "delivered", "paid"]);
const CANCELLED_SET = new Set(["cancelled", "canceled"]);
const REFUNDED_SET = new Set(["refunded"]);

export const isPreparing = (s) => PREPARING_SET.has(lower(s));
export const isReady = (s) => READY_SET.has(lower(s));
/** Finished with the money taken — what a revenue or "done" count should use. */
export const isSettled = (s) => SETTLED_SET.has(lower(s));
export const isCancelled = (s) => CANCELLED_SET.has(lower(s));
export const isRefunded = (s) => REFUNDED_SET.has(lower(s));

/** Over: settled, cancelled or refunded. Nothing transitions it onward. */
export const isFinished = (s) => isSettled(s) || isCancelled(s) || isRefunded(s);

/** Still live on the floor. */
export const isActive = (s) => isPreparing(s) || isReady(s);

/** True only while an order is waiting for someone to accept it. */
export const isAwaitingAcceptance = (s) => lower(s) === "pending";

/**
 * What to show the user. Old rows carry old spellings, so display goes through
 * here to keep one vocabulary on screen.
 *
 * "Served", "Delivered" and "paid" are NOT folded into "Completed" — they say
 * something true about the order that "Completed" would throw away.
 */
export const statusLabel = (s) => {
  const raw = String(s || "");
  if (!raw) return "";
  if (isAwaitingAcceptance(raw)) return "Pending";
  if (isPreparing(raw)) return PREPARING;
  if (isReady(raw)) return READY;
  if (lower(raw) === "paid") return "Paid";
  if (lower(raw) === "served") return SERVED;
  if (lower(raw) === "delivered") return DELIVERED;
  if (isCancelled(raw)) return CANCELLED;
  if (isRefunded(raw)) return REFUNDED;
  if (lower(raw) === "completed") return COMPLETED;
  return raw;
};

/**
 * Where a refund stands, from the backend (services/refunds). NOT_APPLICABLE
 * for cash and for UPI / card taken at the counter: nothing went through the
 * gateway, so nothing can come back through it.
 */
export const REFUND_STATUS = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  NOT_REFUNDED: "NOT_REFUNDED",
  REFUND_PENDING: "REFUND_PENDING",
  REFUNDED: "REFUNDED",
  REFUND_FAILED: "REFUND_FAILED",
});

export const REFUND_STATUS_LABELS = Object.freeze({
  NOT_APPLICABLE: "",
  NOT_REFUNDED: "Not refunded",
  REFUND_PENDING: "Refund pending",
  REFUNDED: "Refunded",
  REFUND_FAILED: "Refund failed",
});
