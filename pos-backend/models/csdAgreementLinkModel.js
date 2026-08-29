const mongoose = require("mongoose");

/**
 * Links one signed agreement to the store created from it.
 *
 * This is the authoritative "already processed" record, and it lives HERE
 * rather than only as a status flag on the agreement, for two reasons:
 *
 *   1. The agreement lives in the onboarding portal's JSON file, in another
 *      container. If that write-back fails — portal down, network blip — a
 *      flag-only design would happily create a second store on the next
 *      attempt. Store creation and the dedupe record are in the same
 *      database, so they cannot disagree.
 *   2. `agreementId` is uniquely indexed, so two admins clicking "Create
 *      Store" at the same moment cannot both succeed: the second insert
 *      fails on the index and that request is rejected, rather than racing
 *      to create a duplicate restaurant.
 */
const csdAgreementLinkSchema = new mongoose.Schema(
  {
    agreementId: { type: String, required: true, unique: true, trim: true },

    storeId: { type: String, required: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    restaurantName: { type: String, default: "" },

    salesAgent: { type: String, default: "" },

    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff" },
    createdByStaffId: { type: String, default: "" },
    createdByName: { type: String, default: "" },

    // Whether the portal was successfully told the store exists. Best-effort:
    // a failure here must never block or reverse store creation, but it does
    // need to be visible so someone can retry the notification.
    portalNotified: { type: Boolean, default: false },
    portalNotifyError: { type: String, default: "" },

    // The agreement payload as it was at creation time. The portal's copy can
    // be edited or deleted afterwards; this is the evidence of what the store
    // was actually built from.
    sourceSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CsdAgreementLink", csdAgreementLinkSchema);
