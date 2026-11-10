const mongoose = require("mongoose");

/**
 * WhatsApp support inbox (CSD → Chat → WhatsApp).
 *
 * One conversation per customer WhatsApp number, for the life of the number:
 * the history a colleague needs is everything that customer ever said, not
 * just this week's thread. "Closed" is a status on the same conversation, and
 * a new message from the customer re-opens it.
 *
 * Unread is shared by the team (a single counter), not per agent as in the
 * internal chat: this is a queue, and a message one agent has opened is no
 * longer "new" for anyone.
 */

const conversationSchema = new mongoose.Schema(
  {
    // The customer's WhatsApp ID: country code + number, digits only (919876543210).
    waId: { type: String, required: true, unique: true, trim: true },
    // The name the customer gave WhatsApp (their profile name), and a name an agent set.
    profileName: { type: String, default: "", maxlength: 200 },
    customName: { type: String, default: "", maxlength: 200 },

    // The provider's own id for the thread (MyOperator), kept for reference.
    providerConversationId: { type: String, default: "" },

    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", default: null, index: true },
    assignedToName: { type: String, default: "" },
    assignedAt: { type: Date, default: null },

    // Denormalised for the list.
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: "" },
    lastMessageDirection: { type: String, default: "" },
    // WhatsApp lets a business send free text only within 24 hours of the
    // customer's last message; after that only an approved template.
    lastInboundAt: { type: Date, default: null },
    unreadCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ status: 1, lastMessageAt: -1 });

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "WaConversation", required: true },
    // in: from the customer · out: to the customer · note: staff only · event: assigned, closed…
    direction: { type: String, enum: ["in", "out", "note", "event"], required: true },
    type: { type: String, default: "text" }, // text, image, document, template, …
    body: { type: String, default: "", maxlength: 8000 },
    media: {
      url: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      filename: { type: String, default: "" },
    },
    template: { name: { type: String, default: "" }, language: { type: String, default: "" } },

    // The provider's id for the message: deduplicates webhook retries and
    // lets delivery and read receipts find the message they belong to.
    providerMessageId: { type: String, default: undefined },
    status: {
      type: String,
      enum: ["received", "pending", "sent", "delivered", "read", "failed"],
      default: "received",
    },
    error: { type: String, default: "" },

    // Who sent it from CSD (out and note), or "" for the customer / another app.
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", default: null },
    staffName: { type: String, default: "" },
    // Sent from outside CSD (the provider's own app or panel).
    external: { type: Boolean, default: false },

    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, sentAt: -1 });
messageSchema.index({ providerMessageId: 1 }, { unique: true, partialFilterExpression: { providerMessageId: { $type: "string" } } });
messageSchema.index({ body: "text" });

const WaConversation = mongoose.model("WaConversation", conversationSchema);
const WaMessage = mongoose.model("WaMessage", messageSchema);

module.exports = { WaConversation, WaMessage };
