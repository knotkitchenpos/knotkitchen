const mongoose = require("mongoose");

/**
 * A till shift: opened with a cash float, closed with a cash count.
 *
 * Every order placed between openedAt and closedAt belongs to the shift.
 * On close, what the orders say should be in the drawer (opening float +
 * cash sales - cash refunds) is frozen alongside what was counted, and the
 * difference is the number an owner looks at. One open shift per
 * restaurant (or outlet) at a time.
 */
const moneySchema = { type: Number, default: 0 };

const shiftSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },

    openedAt: { type: Date, default: Date.now },
    openedBy: { type: String, default: "" },
    openingCash: moneySchema,

    closedAt: { type: Date, default: null },
    closedBy: { type: String, default: "" },
    closingCash: moneySchema, // counted in the drawer
    note: { type: String, default: "", maxlength: 300 },

    // Frozen at close, from the orders of the shift.
    summary: {
      orders: { type: Number, default: 0 },
      cancelled: { type: Number, default: 0 },
      sales: moneySchema, // net of refunds
      refunds: moneySchema,
      cash: moneySchema,
      upi: moneySchema,
      gateway: moneySchema,
      other: moneySchema,
      cashRefunds: moneySchema,
      expectedCash: moneySchema, // openingCash + cash - cashRefunds
      difference: moneySchema, // closingCash - expectedCash
    },
  },
  { timestamps: true },
);

shiftSchema.index({ restaurantId: 1, status: 1, openedAt: -1 });

module.exports = mongoose.model("Shift", shiftSchema);
