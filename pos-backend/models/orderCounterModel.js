const mongoose = require("mongoose");

/**
 * Atomic per-tenant / per-day sequence counter for order numbers
 * (Module 3 §4).
 *
 * Each restaurant × source × day combination has ONE counter document.
 * `findOneAndUpdate({...}, { $inc: { seq: 1 } }, { upsert: true, new: true })`
 * is atomic at the MongoDB level, meaning two concurrent order creations
 * can never receive the same `seq` for the same key.
 *
 * The key layout deliberately splits by `source` (POS / WEBSITE / QR /
 * MARKETPLACE / PHONE / EXTERNAL) so a POS order and a website order
 * placed in the same second cannot collide even if the source prefix is
 * ever stripped from the human-readable number. And the same `orderNumber`
 * never gets reused because:
 *   1. `seq` monotonically increases within (restaurantId, source, date).
 *   2. `date` is embedded in the generated number, so tomorrow's counter
 *      restart at 1 still yields a different string.
 *   3. The unique partial index on `Order.orderNumber` (see orderModel)
 *      is the ultimate safety net at the persistence layer.
 */
const orderCounterSchema = new mongoose.Schema(
    {
        // Compact primary key: `${restaurantId}:${source}:${YYYYMMDD}` (or
        // `_global:POS:${YYYYMMDD}` for legacy pre-tenant deployments).
        key: { type: String, required: true, unique: true, index: true },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", default: null },
        source: { type: String, required: true },
        date: { type: String, required: true }, // YYYYMMDD, purely for reporting
        seq: { type: Number, required: true, default: 0 },
    },
    { timestamps: true },
);

module.exports =
    mongoose.models.OrderCounter || mongoose.model("OrderCounter", orderCounterSchema);
