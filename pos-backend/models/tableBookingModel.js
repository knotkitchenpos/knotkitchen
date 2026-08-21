const mongoose = require("mongoose");

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
    bookingDate: { type: Date, required: true },
    bookingTime: { type: String, required: true }, // e.g. "19:30"
    requestedArea: { type: String, default: "", trim: true },
    tableId: { type: mongoose.Schema.Types.ObjectId, ref: "Table", default: null },
    tableDisplayId: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "CANCELLED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    rejectionReason: { type: String, default: "" },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

tableBookingSchema.index({ restaurantId: 1, bookingDate: 1, status: 1 });
tableBookingSchema.index({ tableId: 1, bookingDate: 1, status: 1 });

module.exports = mongoose.models.TableBooking || mongoose.model("TableBooking", tableBookingSchema);
