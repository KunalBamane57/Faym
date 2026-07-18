/**
 * Global error handler middleware.
 */
function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${err.message}`);
  console.error(err.stack);

  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || "Internal Server Error",
  });
}

/**
 * Request logger middleware.
 */
function requestLogger(req, _res, next) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
}

module.exports = { errorHandler, requestLogger };
