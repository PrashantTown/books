// Unknown routes return JSON instead of Express's default HTML page.
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

// Last-resort error handler. Controllers handle their own expected errors;
// this catches malformed JSON, oversized bodies and anything unexpected.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, message: "Request body is not valid JSON" });
  }

  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ success: false, message: "Request body is too large" });
  }

  if (err && err.name === "ValidationError") {
    return res.status(400).json({ success: false, message: "Invalid data", details: err.message });
  }

  if (err && err.code === 11000) {
    return res.status(409).json({ success: false, message: "That record already exists" });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({ success: false, message: "Server error" });
};

module.exports = { notFound, errorHandler };
