const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
    // Gateway payment identifier (Razorpay's `id`). Unique so webhook replays
    // are rejected at the DB layer — see paymentController.webHookVerification
    // for the corresponding E11000 handler (§20).
    paymentId: { type: String, unique: true, sparse: true },
    orderId: String,
    amount: Number,
    currency: String,
    status: String,
    method: String,
    email: String,
    contact: String,
    createdAt: Date,
});

const Payment = mongoose.model("Payment", paymentSchema);
module.exports = Payment;
