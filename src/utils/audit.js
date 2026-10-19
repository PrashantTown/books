const AuditLog = require("../models/AuditLog");
const { newClientId, text } = require("./validate");

/**
 * Writes an entry to the administrators' activity log. Never throws: a log
 * failure must not break the request that caused it.
 */
const writeAudit = async ({ kind = "account", what, who = "system", detail = "", user = null }) => {
  try {
    await AuditLog.create({
      clientId: newClientId("log"),
      kind: text(kind, 40) || "account",
      what: text(what, 500),
      who: text(who, 254) || "system",
      detail: text(detail, 1000),
      user,
      at: new Date(),
    });
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
};

module.exports = { writeAudit };
