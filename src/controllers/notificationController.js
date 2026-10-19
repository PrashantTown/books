const Notification = require("../models/Notification");
const { createNotification } = require("../utils/notify");
const { isAdmin, addressFor, addressesFor } = require("../utils/access");
const { isClientId, ms } = require("../utils/validate");

/**
 * The notification bell.
 *   GET    /api/notifications             yours (newest first)
 *   POST   /api/notifications             send one (rules below)
 *   POST   /api/notifications/:id/read    mark one read
 *   POST   /api/notifications/read-all    mark all yours read
 *   DELETE /api/notifications/:id         dismiss one
 *   DELETE /api/notifications             clear all yours
 *
 * Who may send to whom: administrators to anyone; parents to themselves or
 * to all administrators ("admin::*").
 */

const MAX = 80;

const noteOut = (n, user) => ({
  id: n.clientId,
  to: n.to,
  kind: n.kind,
  tone: n.tone,
  title: n.title,
  body: n.body,
  go: n.go,
  tag: n.tag,
  at: ms(n.at),
  read: (n.readBy || []).some((id) => String(id) === String(user._id)),
  count: n.count > 1 ? n.count : undefined,
});

const visibleQuery = (user) => ({
  to: { $in: addressesFor(user) },
  dismissedBy: { $ne: user._id },
});

const canSendTo = (user, to) => {
  if (isAdmin(user)) return /^(parent|admin)::(\*|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(to);
  return to === addressFor(user) || to === "admin::*";
};

const listNotes = async (req, res) => {
  try {
    const notes = await Notification.find(visibleQuery(req.user)).sort({ at: -1 }).limit(MAX);
    return res.json({ success: true, items: notes.map((n) => noteOut(n, req.user)) });
  } catch (error) {
    console.error("List notifications error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const sendNote = async (req, res) => {
  try {
    const b = req.body || {};
    const to = String(b.to || "").trim().toLowerCase();
    if (!b.title || !String(b.title).trim()) {
      return res.status(400).json({ success: false, message: "A notification needs a title" });
    }
    if (!canSendTo(req.user, to)) {
      return res.status(403).json({ success: false, message: "You can't send a notification to that address" });
    }
    if (b.id && !isClientId(b.id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (b.id && (await Notification.exists({ clientId: b.id }))) {
      const existing = await Notification.findOne({ clientId: b.id });
      return res.json({ success: true, item: noteOut(existing, req.user) });
    }

    const note = await createNotification({
      clientId: b.id,
      to,
      kind: b.kind,
      tone: b.tone,
      title: b.title,
      body: b.body,
      go: b.go,
      tag: b.tag,
      createdBy: req.user._id,
    });
    return res.status(201).json({ success: true, item: noteOut(note, req.user) });
  } catch (error) {
    console.error("Send notification error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const findMine = async (req, res) => {
  const note = await Notification.findOne({ clientId: req.params.id, ...visibleQuery(req.user) });
  if (!note) res.status(404).json({ success: false, message: "Notification not found" });
  return note;
};

const markRead = async (req, res) => {
  try {
    const note = await findMine(req, res);
    if (!note) return;
    await Notification.updateOne({ _id: note._id }, { $addToSet: { readBy: req.user._id } });
    return res.json({ success: true });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(visibleQuery(req.user), { $addToSet: { readBy: req.user._id } });
    return res.json({ success: true });
  } catch (error) {
    console.error("Mark all read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const dismiss = async (req, res) => {
  try {
    const note = await findMine(req, res);
    if (!note) return;
    if (note.to.endsWith("::*")) {
      await Notification.updateOne({ _id: note._id }, { $addToSet: { dismissedBy: req.user._id } });
    } else {
      await note.deleteOne();
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Dismiss notification error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const clearAll = async (req, res) => {
  try {
    await Notification.deleteMany({ to: addressFor(req.user) });
    await Notification.updateMany(visibleQuery(req.user), { $addToSet: { dismissedBy: req.user._id } });
    return res.json({ success: true });
  } catch (error) {
    console.error("Clear notifications error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listNotes, sendNote, markRead, markAllRead, dismiss, clearAll };
