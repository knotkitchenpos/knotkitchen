const mongoose = require("mongoose");

/**
 * One diner review of one Knot Eats order (eats.<base>/order/<v_token>).
 *
 * No accounts: the signed order link is the only way in, and the unique
 * orderId index is what makes it "one review per order". Ratings are not
 * counted onto the store -- services/knotEats aggregates visible rows when it
 * rebuilds its snapshot, so hiding a review needs no counter bookkeeping.
 *
 * storeId/restaurantId are here so services/storePurge removes the rows with
 * the store.
 */
const knotEatsReviewSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, default: "" }, // CSD only, never public
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    text: { type: String, default: "", maxlength: 500 },
    authorName: { type: String, default: "", maxlength: 40 },
    hidden: { type: Boolean, default: false },
    hiddenReason: { type: String, default: "", maxlength: 300 },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: String, default: "" }, // CsdStaff.staffId
  },
  { timestamps: true }
);

knotEatsReviewSchema.index({ orderId: 1 }, { unique: true });
knotEatsReviewSchema.index({ storeId: 1, hidden: 1, createdAt: -1 });
knotEatsReviewSchema.index({ hidden: 1, createdAt: -1 });

module.exports = mongoose.model("KnotEatsReview", knotEatsReviewSchema);
