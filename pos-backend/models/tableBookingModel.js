const mongoose = require("mongoose");

/**
 * A customer's request for a table at a time, made from the restaurant website.
 *
 *   PENDING    submitted, waiting for the POS to accept or cancel it
 *   CONFIRMED  accepted and pre-booked onto `tableId`; the table is blocked
 *              for new orders between `blockFrom` and `blockUntil`
 *   SEATED     the party arrived; the block is released so staff can order
 *   CANCELLED  a confirmed booking called off (no-show, customer cancelled)
 *   REJECTED   a pending request the restaurant declined
 *
 * The block window is stamped when the booking is accepted, from the settings
 * in force at that moment, so a later settings change never moves a table
 * that has already been promised to someone.
 */
const tableBookingSchema = new mongoose.Schema(
  {
    bookingId: { type: String, required: true, unique: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },
    storeId: { type: String, required: true, index: true },
    customerDetails: {
      name: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, default: "", trim: true },
    },
    guestCount: { type: Number, required: true, min: 1 },
    bookingDate: { type: String, required: true }, // "2026-09-14", restaurant-local
    bookingTime: { type: String, required: true }, // "17:00", restaurant-local
    startAt: { type: Date, required: true, index: true },
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: "Table", default: null },
    tableDisplayId: { type: String, default: "", trim: true },
    blockFrom: { type: Date, default: null },
    blockUntil: { type: Date, default: null },
    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "SEATED", "CANCELLED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    rejectionReason: { type: String, default: "" },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

tableBookingSchema.index({ restaurantId: 1, status: 1, startAt: 1 });
tableBookingSchema.index({ tableId: 1, status: 1, blockFrom: 1, blockUntil: 1 });

module.exports = mongoose.models.TableBooking || mongoose.model("TableBooking", tableBookingSchema);
