const globalErrorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal Server Error!",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

module.exports = globalErrorHandler;