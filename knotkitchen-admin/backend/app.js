const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/database");
const config = require("./config/config");
const { seedSuperAdmin } = require("./controllers/authController");
const apiRoutes = require("./routes/api");
const globalErrorHandler = require("./middlewares/globalErrorHandler");

const app = express();

// Security / parsing middleware
app.use(
  cors({
    origin: config.nodeEnv === "production" ? process.env.ADMIN_FRONTEND_ORIGIN : "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check
app.get("/health", (req, res) => {
  res.json({ success: true, status: "ok", service: "knotkitchen-admin-backend" });
});

// API routes (all admin endpoints live under /api)
app.use("/api", apiRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found!" });
});

// Global error handler
app.use(globalErrorHandler);

// Bootstrap
const start = async () => {
  try {
    await connectDB();
    await seedSuperAdmin();
    app.listen(config.port, () => {
      console.log(`🚀 KnotKitchen Admin Portal backend running on http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error("❌ Failed to start admin backend:", error);
    process.exit(1);
  }
};

start();