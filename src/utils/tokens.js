const crypto = require("crypto");

// One-time links and codes are stored only as SHA-256 hashes.
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const newToken = () => crypto.randomBytes(32).toString("hex");

const escapeHtml = (value) =>
  String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

module.exports = { hashToken, newToken, escapeHtml };
