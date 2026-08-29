const mongoose = require("mongoose");

/**
 * CSD chat: conversations + messages.
 *
 * Two collections rather than embedding messages in the conversation: a busy
 * support thread grows without bound, and MongoDB's 16MB document ceiling
 * would eventually reject new messages outright. Separate documents also let
 * message search use its own index.
 *
 * Unread state is tracked as a per-participant `lastReadAt` watermark rather
 * than a readBy[] array on every message. With N staff and M messages the
 * array approach costs N×M entries and rewrites old messages on every read;
 * the watermark is one small write per person per conversation.
 */

const participantSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", required: true },
    staffCode: { type: String, default: "" }, // KK-ST-001, denormalised for display
    name: { type: String, default: "" },
    lastReadAt: { type: Date, default: null },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // "group"  — an open internal channel
    // "store"  — everything concerning one restaurant, linked by storeId
    type: { type: String, enum: ["group", "store"], default: "group", index: true },

    storeId: { type: String, default: "", index: true },
    restaurantName: { type: String, default: "" },

    participants: { type: [participantSchema], default: [] },

    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff" },
    createdByName: { type: String, default: "" },

    // Denormalised so the conversation list renders without querying messages.
    lastMessageAt: { type: Date, default: null, index: true },
    lastMessagePreview: { type: String, default: "" },
    lastMessageBy: { type: String, default: "" },
    messageCount: { type: Number, default: 0 },

    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

conversationSchema.index({ archived: 1, lastMessageAt: -1 });

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CsdConversation",
      required: true,
      index: true,
    },
    body: { type: String, required: true, trim: true, maxlength: 8000 },

    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", required: true },
    authorStaffId: { type: String, default: "" },
    authorName: { type: String, default: "" },

    // An internal note is visible to staff but flagged as not-for-sharing.
    // Every message is internal today; the flag exists so the distinction is
    // recorded from the start rather than retrofitted onto old rows.
    internal: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ body: "text" });

const CsdConversation = mongoose.model("CsdConversation", conversationSchema);
const CsdMessage = mongoose.model("CsdMessage", messageSchema);

module.exports = { CsdConversation, CsdMessage };
