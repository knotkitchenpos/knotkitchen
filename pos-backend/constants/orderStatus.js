/**
 * The single source of truth for `Order.orderStatus`.
 *
 * Why this file exists
 * --------------------
 * `orderStatus` is a bare `{ type: String, required: true }` with no enum, so
 * for a long time any string could be written. Different code paths picked
 * different spellings of the same state — "Pending" and "pending", "Completed"
 * and "completed" — and because the field is free-form nothing ever objected.
 *
 * That produced two real, silent failures:
 *
 *   1. Orders created by the QR and table-session flows were written as
 *      lowercase "pending". The auto-ready sweep queried only
 *      ["Preparing", "Pending", "In Progress"], so those orders were never
 *      returned and never auto-promoted to Ready.
 *
 *   2. The analytics endpoints counted ["completed", "served", "delivered"] —
 *      three spellings that NOTHING in the codebase writes. Revenue and
 *      completed-order counts were matching an empty set.
 *
 * Neither threw an error. A status that doesn't match just quietly isn't there,
 * which is why both survived so long.
 *
 * How to use it
 * -------------
 * - WRITING a status: use the canonical constants (`PREPARING`, `READY`, …).
 *   Never write a string literal; `orderStatusVocabulary.test.js` scans the
 *   source and fails if you do.
 *
 * - QUERYING by status: use the `*_STATUSES` match arrays, never a single
 *   constant. Orders written before this file existed are still on disk with
 *   their old spellings, and a query that omits them silently under-reports.
 *
 * - DISPLAYING a status: pass it through `canonicalStatus()` so old rows and
 *   new rows read the same way in the UI.
 *
 * Deliberately NOT normalised: "paid"
 * -----------------------------------
 * Table sessions mark their kitchen orders "paid" when the bill is settled
 * (tableSessionController). It is a genuine state with its own meaning, not a
 * mis-spelling, and both `receiptService` and the Manage Tables tests depend on
 * the exact string. It is included in `SETTLED_STATUSES` because the money is
 * real and analytics must count it, but `canonicalStatus()` leaves it alone.
 */

// --- Canonical vocabulary (Module 4 §1) -------------------------------------
// Preparing → Ready → Completed. Cancelled is reachable from any non-terminal
// state. Refunded is terminal and set by the payments flow.
const PREPARING = "Preparing";
const READY = "Ready";
const COMPLETED = "Completed";
const CANCELLED = "Cancelled";
const REFUNDED = "Refunded";

/** Settled table-session orders. Legacy casing, preserved on purpose (above). */
const PAID = "paid";

/**
 * Terminal states the auto-complete sweep writes instead of "Completed", to
 * keep the wording true to the order type: a dine-in order is Served, a
 * delivery is Delivered. They are separate display states on purpose and are
 * NOT folded into "Completed" by `canonicalStatus`, but they are settled
 * revenue and must be counted as such.
 */
/**
 * "Awaiting acceptance" in the online-order and marketplace flows.
 *
 * IMPORTANT: in THAT context this is not a synonym for Preparing. The POS
 * shows Accept / Reject for an order in this state and moves it to
 * "In Progress" once accepted, so "Pending" (nobody has accepted it yet) and
 * "In Progress" (accepted, being cooked) are genuinely different things to a
 * member of staff.
 *
 * canonicalStatus() folds both into Preparing, which is right for the POS
 * order list and for analytics but LOSES that distinction. So the online-order
 * views deliberately do not canonicalise, and use this constant instead of a
 * bare "Pending" literal.
 */
const AWAITING_ACCEPTANCE = "Pending";

const SERVED = "Served";
const DELIVERED = "Delivered";

// --- Historical spellings, for QUERIES only ---------------------------------
// Every variant that exists in the database. Adding a spelling here makes old
// data visible again; removing one hides it.

/** In the kitchen. "Pending" and "In Progress" are pre-Module-4 names. */
const PREPARING_STATUSES = [
  PREPARING, "Pending", "In Progress",
  "preparing", "pending", "in progress",
];

const READY_STATUSES = [READY, "ready"];

/**
 * Finished with revenue realised — what "how much did we take?" should count.
 *
 * Both casings of Served/Delivered are listed: the auto-complete sweep writes
 * them Title Case, while the older analytics queries looked for them in lower
 * case and therefore counted none of them.
 */
const SETTLED_STATUSES = [
  COMPLETED, "completed",
  SERVED, "served",
  DELIVERED, "delivered",
  PAID, "Paid",
];

const CANCELLED_STATUSES = [CANCELLED, "cancelled", "canceled", "Canceled"];

const REFUNDED_STATUSES = [REFUNDED, "refunded"];

/** Still live on the floor — neither settled nor cancelled. */
const ACTIVE_STATUSES = [...PREPARING_STATUSES, ...READY_STATUSES];

/** No further transitions allowed. */
const TERMINAL_STATUSES = new Set([COMPLETED, CANCELLED, REFUNDED]);

// --- Normalisation ----------------------------------------------------------

const ALIASES = new Map([
  ["pending", PREPARING],
  ["in progress", PREPARING],
  ["preparing", PREPARING],
  ["ready", READY],
  ["completed", COMPLETED],
  // "served" / "delivered" are deliberately absent: they are distinct display
  // states, not misspellings of Completed. See SERVED / DELIVERED above.
  ["cancelled", CANCELLED],
  ["canceled", CANCELLED],
  ["refunded", REFUNDED],
]);

/**
 * Map any historical spelling to its canonical name, so the UI, analytics and
 * downstream services see one vocabulary regardless of when the order was
 * written. Unknown values pass through untouched rather than being coerced
 * into a state they don't mean — "paid" relies on this.
 */
const canonicalStatus = (status) => {
  const raw = String(status || "");
  if (raw === PAID) return PAID;
  return ALIASES.get(raw.toLowerCase()) || raw;
};

const isPreparing = (status) => canonicalStatus(status) === PREPARING;
const isSettled = (status) => SETTLED_STATUSES.includes(String(status || ""));
const isCancelled = (status) => canonicalStatus(status) === CANCELLED;
const isTerminal = (status) => TERMINAL_STATUSES.has(canonicalStatus(status));

const isRefunded = (status) => canonicalStatus(status) === REFUNDED;

/**
 * The order is over: settled, cancelled or refunded. Nothing may transition it
 * onward.
 *
 * Use this, NOT `isTerminal`, to guard a status change. `TERMINAL_STATUSES`
 * holds only the three canonical names, so a raw `.has()` against it let
 * five real finished states through — the legacy lowercase spellings, the
 * Served/Delivered the auto-complete sweep writes, and paid. The last
 * one mattered most: a settled table bill could be reopened and its history
 * rewritten.
 */
const isFinished = (status) =>
  isSettled(status) || isCancelled(status) || isRefunded(status);

/** Statuses a client is permitted to request via the update endpoint. */
const ALLOWED_STATUS_TRANSITIONS = new Set([
  PREPARING, "Pending", "In Progress", READY, COMPLETED, CANCELLED,
]);

/** Statuses an order may be created with. */
const ALLOWED_INITIAL_STATUS = new Set([PREPARING, "Pending", "In Progress", READY]);

module.exports = {
  PREPARING, READY, COMPLETED, CANCELLED, REFUNDED, PAID, SERVED, DELIVERED,
  AWAITING_ACCEPTANCE,
  PREPARING_STATUSES, READY_STATUSES, SETTLED_STATUSES,
  CANCELLED_STATUSES, REFUNDED_STATUSES, ACTIVE_STATUSES,
  TERMINAL_STATUSES, ALLOWED_STATUS_TRANSITIONS, ALLOWED_INITIAL_STATUS,
  canonicalStatus, isPreparing, isSettled, isCancelled, isTerminal, isRefunded, isFinished,
};
