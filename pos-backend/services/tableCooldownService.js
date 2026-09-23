/**
 * Freeing a table after payment.
 *
 * A settled table used to rest in `cleaning` for a configurable wait before
 * returning to `available`. That is gone: payment now frees the table
 * immediately, so the next party can be seated the moment the bill is
 * settled.
 *
 * What remains, and why:
 *
 *   `cleaning` is STILL a real status. Staff set it by hand from Manage
 *   Table, and the CSD can too. Removing the status would take away a control
 *   people use; only the AUTOMATIC hold after payment has gone.
 *
 *   The sweep is kept as a release valve. It frees any table carrying an
 *   `availableAt` deadline -- which now only happens to rows stamped before
 *   this change. Without it those tables would sit in `cleaning` forever,
 *   because nothing would ever come back to clear them. A table a member of
 *   staff marked `cleaning` by hand carries no deadline and is left alone, so
 *   it stays until they clear it.
 */

const AUTO_FREE_TICK_MS = 20 * 1000;

let timer = null;
let isRunning = false;

/**
 * There is no wait any more.
 *
 * Kept as a function, and exported, so the settle path and its tests have one
 * place that answers "how long is a table held" rather than each assuming
 * zero independently.
 */
const DEFAULT_COOLDOWN_MINUTES = 0;

const cooldownMinutesFor = async () => DEFAULT_COOLDOWN_MINUTES;

/**
 * The update applied to a table when its bill is settled: free, immediately.
 *
 * Returns the update rather than applying it so the CALLER writes through its
 * own Table model. Reaching for the model here would bypass the model the
 * caller (and its tests) is actually using.
 */
const buildCooldownUpdate = async () => ({
  status: "available",
  availableAt: null,
  currentOrderId: null,
  currentOccupancy: 0,
});

/** One sweep: free every table whose cooldown has elapsed. */
const runTableCooldownTick = async () => {
  const Table = require("../models/tableModel");
  const now = new Date();

  const result = await Table.updateMany(
    {
      status: "cleaning",
      availableAt: { $ne: null, $lte: now },
      isDeleted: { $ne: true },
    },
    { $set: { status: "available", availableAt: null, currentOccupancy: 0, currentOrderId: null } },
  );

  return result?.modifiedCount || 0;
};

const startTableCooldownSweeper = () => {
  if (timer) return;
  timer = setInterval(async () => {
    // One sweep at a time: a slow database must not stack ticks.
    if (isRunning) return;
    isRunning = true;
    try {
      const freed = await runTableCooldownTick();
      if (freed > 0) console.log(`[tableCooldown] ${freed} table(s) returned to available`);
    } catch (err) {
      console.warn("[tableCooldown] sweep failed:", err.message);
    } finally {
      isRunning = false;
    }
  }, AUTO_FREE_TICK_MS);

  if (typeof timer.unref === "function") timer.unref();
  console.log(`[tableCooldown] sweeper started (tick=${AUTO_FREE_TICK_MS}ms)`);
};

module.exports = {
  AUTO_FREE_TICK_MS,
  DEFAULT_COOLDOWN_MINUTES,
  cooldownMinutesFor,
  buildCooldownUpdate,
  runTableCooldownTick,
  startTableCooldownSweeper,
};
