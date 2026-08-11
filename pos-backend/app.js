const express = require("express");
const http = require("http");
const connectDB = require("./config/database");
const config = require("./config/config");
const globalErrorHandler = require("./middlewares/globalErrorHandler");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const app = express();


const PORT = config.port;
connectDB();

// Middlewares
app.use(cors({
    credentials: true,
    origin: ['http://localhost:5173']
}))
app.use(express.json()); // parse incoming request in json format
app.use(cookieParser())


// Root Endpoint
app.get("/", (req,res) => {
    res.json({message : "Hello from POS Server!"});
})

// Other Endpoints
app.use("/api/user", require("./routes/userRoute"));
app.use("/api/order", require("./routes/orderRoute"));
app.use("/api/table", require("./routes/tableRoute"));
app.use("/api/menu", require("./routes/menuRoute"));
app.use("/api/payment", require("./routes/paymentRoute"));
app.use("/api/marketplace", require("./routes/marketplaceRoute"));
app.use("/api/restaurant", require("./routes/restaurantRoute"));
app.use("/api/team", require("./routes/teamRoute"));
app.use("/api/kds", require("./routes/kdsRoute"));
app.use("/api/inventory", require("./routes/inventoryRoute"));
app.use("/api/loyalty", require("./routes/loyaltyRoute"));
app.use("/api/billing", require("./routes/billingRoute"));
app.use("/api/qr", require("./routes/qrRoute"));
app.use("/api/analytics", require("./routes/analyticsRoute"));
app.use("/api/notification", require("./routes/notificationRoute"));
app.use("/api/offline", require("./routes/offlineRoute"));
app.use("/api/plugin", require("./routes/pluginRoute"));

// EPOS table session + customer + payment link routes
app.use("/api/table-session", require("./routes/tableSessionRoute"));
app.use("/api/table-qr", require("./routes/tableQRRoute"));
app.use("/api/customer", require("./routes/customerRoute"));
app.use("/api/payment-link", require("./routes/paymentLinkRoute"));

// Global Error Handler
app.use(globalErrorHandler);

// HTTP server + optional Socket.IO realtime
const server = http.createServer(app);
if (config.socketEnabled !== false) {
  try {
    const { initSocket } = require("./services/socket");
    initSocket(server, { corsOrigin: config.frontendUrls || ["http://localhost:5173"] });
  } catch (err) {
    console.warn("Socket.IO disabled:", err.message);
  }
}

// Server
server.listen(PORT, () => {
    console.log(`☑️  POS Server is listening on port ${PORT}`);
})
