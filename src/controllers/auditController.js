const AuditLog = require("../models/AuditLog");
const { isClientId, text, ms } = require("../utils/validate");

/**
 * The administrators' activity log.
 *   POST /api/audit   add an entry (any signed-in person; recorded as them)
 *   GET  /api/audit   admin: newest entries (?limit=, ?kind=)
 */

const entryOut = (e) => ({
  id: e.clientId,
  kind: e.kind,
  what: e.what,
  who: e.who,
  detail: e.detail,
  at: ms(e.at),
});

const addEntry = async (req, res) => {
  try {
    const b = req.body || {};
    const clientId = b.id || `log${Date.now().toString(36)}`;
    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!b.what || !String(b.what).trim()) return res.status(400).json({ success: false, message: "Say what happened" });

    const existing = await AuditLog.findOne({ clientId });
    if (existing) return res.json({ success: true, item: entryOut(existing) });

    const entry = await AuditLog.create({
      clientId,
      kind: text(b.kind, 40) || "account",
      what: text(b.what, 500),
      who: req.user.email,
      detail: text(b.detail, 1000),
      user: req.user._id,
      at: new Date(),
    });
    return res.status(201).json({ success: true, item: entryOut(entry) });
  } catch (error) {
    console.error("Add audit entry error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const listEntries = async (req, res) => {
  try {
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 400));
    const query = req.query.kind ? { kind: String(req.query.kind) } : {};
    const entries = await AuditLog.find(query).sort({ at: -1 }).limit(limit);
    return res.json({ success: true, items: entries.map(entryOut) });
  } catch (error) {
    console.error("List audit entries error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { addEntry, listEntries };
