/**
 * Post-payment table cooldown.
 *
 * When a table's bill is settled it used to flip straight back to
 * "available", so the next party could be seated onto a table nobody had
 * cleared yet. A settled table now enters `cleaning` with an `availableAt`
 * stamp, and this sweep returns it to `available` once that passes.
 *
 * The wait is per-restaurant (`Restaurant.tableSettings.cooldownMinutes`,
 * default 2) and set from Manage Table. Zero means free it immediately, which
 * is the old behaviour for anyone who wants it.
 *
 * Deliberately a poll rather than a timer per table: a setTimeout dies with
 * the process, so a restart during service would strand every table mid-
 * cooldown. A sweep recovers on its own because the deadline lives in the
 * database, not in memory.
 */

const AUTO_FREE_TICK_MS = 20 * 1000;

let timer = null;
let isRunning = false;

/** Resolve how long this restaurant holds a table after payment. */
const DEFAULT_COOLDOWN_MINUTES = 2;

const cooldownMinutesFor = async (restaurantId) => {
  if (!restaurantId) return DEFAULT_COOLDOWN_MINUTES;

  // Settling a bill must never block on this lookup. With no live connection
  // there is nothing to read, and waiting would just burn the driver's
  // server-selection timeout before falling back to the same default anyway.
  const mongoose = require("mongoose");
  if (mongoose.connection?.readyState !== 1) return DEFAULT_COOLDOWN_MINUTES;

  try {
    const Restaurant = require("../models/restaurantModel");
    const restaurant = await Restaurant.findById(restaurantId).select("tableSettings").lean();
    const value = Number(restaurant?.tableSettings?.cooldownMinutes);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_COOLDOWN_MINUTES;
  } catch {
    return DEFAULT_COOLDOWN_MINUTES;
  }
};

/**
 * The update that puts a settled table into cooldown — or frees it outright
 * when the restaurant has the wait switched off.
 *
 * Returns the update rather than applying it so the CALLER writes through its
 * own Table model. Reaching for the model here would bypass the model the
 * caller (and its tests) is actually using.
 */
const buildCooldownUpdate = async (restaurantId) => {
  const minutes = await cooldownMinutesFor(restaurantId);
  if (minutes > 0) {
    return {
      status: "cleaning",
      availableAt: new Date(Date.now() + minutes * 60 * 1000),
      currentOrderId: null,
      currentOccupancy: 0,
    };
  }
  return { status: "available", availableAt: null, currentOrderId: null, currentOccupancy: 0 };
};

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

const stopTableCooldownSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = {
  AUTO_FREE_TICK_MS,
  DEFAULT_COOLDOWN_MINUTES,
  cooldownMinutesFor,
  buildCooldownUpdate,
  runTableCooldownTick,
  startTableCooldownSweeper,
  stopTableCooldownSweeper,
};
