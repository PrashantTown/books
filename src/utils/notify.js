const Notification = require("../models/Notification");
const { newClientId, text } = require("./validate");

/**
 * Creates a notification, merging it into an identical one that has not
 * been read yet (same address, tag and title), the way the frontend's bell
 * groups repeats ("Account locked — x3").
 *
 * Returns the saved Notification document.
 */
const createNotification = async ({
  clientId,
  to,
  kind = "system",
  tone = "info",
  title,
  body = "",
  go = "",
  tag,
  createdBy = null,
}) => {
  const address = String(to || "").trim().toLowerCase();
  const cleanTitle = text(title, 300);
  const cleanTag = text(tag || kind || "system", 200);

  const existing = await Notification.findOne({
    to: address,
    tag: cleanTag,
    title: cleanTitle,
    readBy: { $size: 0 },
    dismissedBy: { $size: 0 },
  });

  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.body = text(body, 1000);
    existing.kind = text(kind, 40);
    existing.tone = text(tone, 20);
    existing.go = text(go, 200);
    existing.at = new Date();
    await existing.save();
    return existing;
  }

  return Notification.create({
    clientId: clientId || newClientId("n-"),
    to: address,
    kind: text(kind, 40) || "system",
    tone: text(tone, 20) || "info",
    title: cleanTitle,
    body: text(body, 1000),
    go: text(go, 200),
    tag: cleanTag,
    at: new Date(),
    createdBy,
  });
};

const notifyAdmins = (fields) => createNotification({ ...fields, to: "admin::*" });

module.exports = { createNotification, notifyAdmins };
