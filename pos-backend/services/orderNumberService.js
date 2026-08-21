const crypto = require("crypto");
const mongoose = require("mongoose");
const OrderCounter = require("../models/orderCounterModel");

/**
 * Customer-facing Order-number generator.
 *
 * === What the customer sees ===
 *
 * Every generated number is a purely-numeric, date-independent string of
 * 6 digits (leading digit >= 1 so it's never printed as "0xxxxx"):
 *
 *     583721        904315        712048
 *
 * That is what appears on:
 *   - POS order cards
 *   - Website order confirmations
 *   - Printed / e-mailed receipts
 *   - Reports
 *
 * The old SOURCE-DATE-SEQ format ("POS-20260821-000001") is intentionally
 * abandoned per QA BUG 4 — it leaked the date, the source and the daily
 * sequence to the customer.
 *
 * === What stays internal ===
 *
 * We are ONLY changing the value stored in `Order.orderNumber` (the
 * human-facing identifier). We deliberately do NOT touch:
 *   - `Order._id`               (internal Mongo primary key, still ObjectId)
 *   - `Bill.orderId`, `Payment.orderId`, `PaymentLink.orderId`, etc.
 *     — all continue to reference `Order._id`, so all existing DB
 *     relationships keep working.
 *   - `paymentData.razorpay_*`  (gateway identifiers)
 *   - The Order.orderNumber unique partial index in orderModel.js — a
 *     duplicate would still fail with E11000, giving us defence-in-depth
 *     collision protection.
 *
 * === Uniqueness strategy ===
 *
 * A 6-digit random number has 900,000 possible values. For real-world
 * merchants (< a few thousand orders per day) that is more than enough to
 * make natural collisions vanishingly rare. We still enforce global
 * uniqueness through two layers:
 *
 *   1. This generator retries up to `maxRetries` times, expanding the
 *      candidate space to 7 and then 8 digits if the 6-digit space keeps
 *      colliding — which effectively never happens.
 *   2. `Order.orderNumber` carries a partial-unique index in orderModel.
 *      A duplicate insert would throw E11000, so even if this generator
 *      somehow produced a duplicate the DB would reject it and the
 *      caller's retry loop (see orderController.addOrder /
 *      storefrontController.createOnlineOrder) would try again.
 *   3. Optionally the caller can pass `checkExisting = true` to run a
 *      pre-flight `Order.exists()` check against the candidate number.
 *      This is enabled by default in `generateOrderNumberSafe`, and
 *      short-circuits any DB churn from the E11000 retry path.
 *
 * === Multi-store isolation ===
 *
 * Numbers are drawn from a single global pool, but stores never see each
 * other's numbers because every read path is tenant-scoped by
 * `restaurantId`. Two different tenants COULD theoretically be assigned
 * the same 6-digit number, and that is fine — the number is scoped by
 * tenant when you look it up. The unique index is kept as a global
 * safety net because operationally you never want to accept two rows
 * with the same public identifier even across tenants (it makes support
 * tickets ambiguous). If a global collision does happen, the DB rejects
 * the second write and the caller retries with a fresh number.
 *
 * === Backwards compatibility ===
 *
 * The exported name and signature are unchanged, so every existing
 * caller (orderController.addOrder, storefrontController, retry paths,
 * tests) keeps working. `SOURCE_PREFIX` and `_yyyymmdd` are still
 * exported so a rare test-time consumer that referenced them doesn't
 * break — but this generator no longer uses them.
 */

// --- Legacy exports (kept for backward compatibility with older code
//     paths and tests) ---
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

/**
 * Produce a random numeric string of `digits` length whose FIRST digit
 * is 1-9. That guarantees the printed value never renders as a shorter
 * padded string (e.g. "058371" would confuse a customer reading it out
 * to support). Uses `crypto.randomInt` so the distribution is
 * cryptographically uniform — no Math.random() bias.
 */
const randomNumericId = (digits = 6) => {
    if (digits < 2) throw new Error("digits must be >= 2");
    const first = crypto.randomInt(1, 10); // 1..9 inclusive
    let rest = "";
    for (let i = 1; i < digits; i += 1) {
        rest += String(crypto.randomInt(0, 10));
    }
    return `${first}${rest}`;
};

/**
 * Core generator.
 *
 * @param {object} opts
 * @param {string} [opts.source]         Order.source value (informational only).
 * @param {string|ObjectId} [opts.restaurantId]
 * @param {Date}   [opts.date]           (ignored — kept for backward compat)
 * @param {number} [opts.digits=6]       initial candidate length; retries auto-grow.
 * @param {number} [opts.maxRetries=8]   retry cap before giving up.
 * @param {boolean}[opts.checkExisting=false]
 *                                       when true, we look up Order.exists({orderNumber})
 *                                       before returning so downstream inserts don't
 *                                       need to retry on E11000. Enabled by
 *                                       generateOrderNumberSafe.
 * @returns {Promise<string>}            e.g. "583721"
 */
const generateOrderNumber = async ({
    source = "POS",
    restaurantId = null,
    date = new Date(),
    digits = 6,
    maxRetries = 8,
    checkExisting = false,
} = {}) => {
    // Historic side-effect: the OrderCounter document is still bumped so
    // any downstream reporting that grouped by tenant/source/date keeps
    // working. We do NOT use its value in the returned string.
    if (mongoose.connection?.readyState === 1) {
        try {
            const upperSource = String(source || "POS").toUpperCase();
            const dateStr = yyyymmdd(date);
            const tenantKey = restaurantId ? String(restaurantId) : "_global";
            const key = `${tenantKey}:${upperSource}:${dateStr}`;
            await OrderCounter.findOneAndUpdate(
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
            ).catch(() => null);
        } catch (_e) {
            // Non-fatal — counter is analytics-only in the new scheme.
        }
    }

    // Model is loaded lazily so the older unit tests that use
    // Module._load to swap Order don't need to also stub this service.
    let OrderModel = null;
    if (checkExisting) {
        try {
            OrderModel = require("../models/orderModel");
        } catch (_e) {
            OrderModel = null;
        }
    }

    let currentDigits = Math.max(6, Math.min(10, digits));
    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        // Expand the candidate space after a few collisions. In practice
        // this branch never fires — 6 digits gives ~900k values.
        if (attempt === Math.floor(maxRetries / 2)) currentDigits = Math.min(currentDigits + 1, 10);
        if (attempt === maxRetries - 1) currentDigits = Math.min(currentDigits + 1, 10);

        const candidate = randomNumericId(currentDigits);

        if (checkExisting && OrderModel && mongoose.connection?.readyState === 1) {
            try {
                // exists() returns the doc id if a match is found, null otherwise.
                const clash = await OrderModel.exists({ orderNumber: candidate });
                if (clash) continue;
            } catch (_e) {
                // If the pre-flight check itself blows up, fall through and
                // let the DB partial-unique index be the safety net.
            }
        }
        return candidate;
    }

    // Extremely unlikely: 8 draws from 900k+ pool all collided. Give up
    // and return one last candidate; the DB partial-unique index will
    // still reject a genuine dup and the caller's retry loop kicks in.
    return randomNumericId(Math.min(10, currentDigits + 1));
};

/**
 * Best-effort wrapper — the historically-used entry point.
 *
 * Ensures we never fail an order over an ID-generation issue: if the
 * primary path throws, we fall back to an even-lower-friction crypto
 * draw. The DB partial-unique index on Order.orderNumber remains the
 * ultimate guarantee that no two persisted orders share the same
 * customer-facing number.
 */
const generateOrderNumberSafe = async (opts = {}) => {
    const merged = {
        checkExisting: true, // enable pre-flight uniqueness check
        ...opts,
    };

    // Fast-path fallback: if mongoose isn't connected (unit-test or
    // startup race), don't wait 10s for a buffered write/read to time
    // out — return a random candidate immediately. The partial-unique
    // index still guarantees no duplicate can land in the DB at runtime.
    const connState = mongoose.connection?.readyState;
    if (connState !== undefined && connState !== 1) {
        return randomNumericId(merged.digits || 6);
    }

    try {
        return await generateOrderNumber(merged);
    } catch (err) {
        console.warn(
            `[order-number] generator failed, using fallback: ${err?.message || err}`,
        );
        return randomNumericId(merged.digits || 6);
    }
};

module.exports = {
    generateOrderNumber,
    generateOrderNumberSafe,
    _yyyymmdd: yyyymmdd,        // exported for backwards-compat with tests
    _SOURCE_PREFIX: SOURCE_PREFIX,
    _randomNumericId: randomNumericId, // exposed for tests
};
