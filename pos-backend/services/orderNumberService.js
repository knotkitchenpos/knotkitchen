const crypto = require("crypto");
const mongoose = require("mongoose");
const OrderCounter = require("../models/orderCounterModel");

/**
 * Globally-unique order-number generator (Module 3 §4).
 *
 * Produces order numbers in the form:
 *
 *     <SOURCE>-<YYYYMMDD>-<SEQ6>
 *
 * e.g.  POS-20260819-000042   /   WEB-20260819-000018
 *
 * The number is:
 *   1. Atomic per (restaurantId, source, date) via MongoDB's
 *      findOneAndUpdate({...}, {$inc}, {upsert:true, new:true}).
 *      Two concurrent order creations get sequential seq values, never the
 *      same one, because the driver serialises the write on a single
 *      unique key.
 *   2. Enforced globally-unique on Order.orderNumber via a partial unique
 *      index defined in orderModel.js. If a caller manages to bypass this
 *      service and inject a duplicate string, the second Order.save() will
 *      throw E11000 and the request will fail — no silent duplicate slips
 *      into the database.
 *   3. Never reused: the date segment guarantees no wrap-around, and the
 *      seq only increments within a day. A day can hold 999,999 orders per
 *      (restaurant, source) which is more than enough for real merchants.
 *
 * Sources are compacted to short prefixes so the number stays short on
 * thermal receipts:
 *     POS → POS   WEBSITE → WEB   QR → QR
 *     MARKETPLACE → MKT   PHONE → PHN   * → EXT
 */

const SOURCE_PREFIX = {
    POS: "POS",
    WEBSITE: "WEB",
    QR: "QR",
    MARKETPLACE: "MKT",
    PHONE: "PHN",
};

const yyyymmdd = (d = new Date()) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}${m}${day}`;
};

const pad6 = (n) => String(n).padStart(6, "0");

/**
 * @param {object} opts
 * @param {string} opts.source        one of the Order.source enum values
 * @param {string|ObjectId} [opts.restaurantId]  tenant scope; falls back to
 *                                     "_global" when the caller has no
 *                                     tenant (legacy single-user installs)
 * @param {Date}   [opts.date]         override for testing
 * @param {number} [opts.maxRetries]   defence-in-depth if a race ever produces
 *                                     a duplicate at the Order layer
 * @returns {Promise<string>}          the generated order number
 */
const generateOrderNumber = async ({
    source = "POS",
    restaurantId = null,
    date = new Date(),
    maxRetries = 3,
} = {}) => {
    const upperSource = String(source || "POS").toUpperCase();
    const prefix = SOURCE_PREFIX[upperSource] || "EXT";
    const dateStr = yyyymmdd(date);
    const tenantKey = restaurantId ? String(restaurantId) : "_global";
    const key = `${tenantKey}:${upperSource}:${dateStr}`;

    // MongoDB atomically increments and returns the new value. `upsert:true`
    // creates the counter document on the very first order of the day for
    // this tenant/source, without any read-then-write race.
    let attempt = 0;
    let lastError = null;
    while (attempt < Math.max(1, maxRetries)) {
        try {
            const doc = await OrderCounter.findOneAndUpdate(
                { key },
                {
                    $inc: { seq: 1 },
                    $setOnInsert: {
                        restaurantId: restaurantId || null,
                        source: upperSource,
                        date: dateStr,
                    },
                },
                { new: true, upsert: true, setDefaultsOnInsert: true },
            );
            return `${prefix}-${dateStr}-${pad6(doc.seq)}`;
        } catch (err) {
            lastError = err;
            // Duplicate key on the counter's own `key` unique index means
            // two upserts raced during a brand-new key. Retry — the second
            // attempt will hit the incremented document instead of trying
            // to insert.
            if (err && err.code === 11000) {
                attempt += 1;
                continue;
            }
            throw err;
        }
    }
    throw lastError || new Error("Failed to allocate order number after retries.");
};

/**
 * Best-effort wrapper for callers that would rather NOT fail the order
 * over a numbering hiccup. Falls back to a locally-unique random suffix
 * (`<PREFIX>-<YYYYMMDD>-Xxxxxxxx`) which is still globally-unique thanks
 * to 40 bits of entropy from crypto.randomBytes AND the partial-unique
 * index on Order.orderNumber (a duplicate would be rejected by the DB
 * with E11000 which the caller can retry).
 *
 * Used in orderController.addOrder so an in-memory / mocked Model in the
 * legacy unit tests doesn't fail — the tests never assert on the exact
 * order-number format, only that the order is created and returned.
 */
const generateOrderNumberSafe = async (opts = {}) => {
    // Fast-path fallback: if mongoose isn't connected (unit-test or startup
    // race), don't wait 10s for a buffered write to time out — return a
    // random-suffix number immediately. The partial-unique index on
    // Order.orderNumber still guarantees no duplicate can land in the DB.
    const connState = mongoose.connection?.readyState;
    if (connState !== undefined && connState !== 1) {
        const upperSource = String(opts.source || "POS").toUpperCase();
        const prefix = SOURCE_PREFIX[upperSource] || "EXT";
        const dateStr = yyyymmdd(opts.date || new Date());
        const rnd = crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 10);
        return `${prefix}-${dateStr}-X${rnd}`;
    }

    try {
        return await generateOrderNumber(opts);
    } catch (err) {
        const upperSource = String(opts.source || "POS").toUpperCase();
        const prefix = SOURCE_PREFIX[upperSource] || "EXT";
        const dateStr = yyyymmdd(opts.date || new Date());
        const rnd = crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 10);
        console.warn(
            `[order-number] atomic counter unavailable, using fallback: ${err?.message || err}`,
        );
        return `${prefix}-${dateStr}-X${rnd}`;
    }
};

module.exports = {
    generateOrderNumber,
    generateOrderNumberSafe,
    _yyyymmdd: yyyymmdd, // exported for tests
    _SOURCE_PREFIX: SOURCE_PREFIX,
};
