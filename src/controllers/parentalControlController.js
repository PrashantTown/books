const ParentalControl = require("../models/ParentalControl");
const {
  getChildForUser,
  getControl,
  isObjectId,
} = require("../utils/readingAccess");

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const validateControlInput = (body, partial = false) => {
  const fields = ["dailyLimit", "sessionLimit", "allowedStartTime", "allowedEndTime", "externalLinksAllowed"];
  for (const field of fields) {
    if (partial && body[field] === undefined) continue;
    if (!partial && body[field] === undefined) return `${field} is required`;
  }

  if (body.dailyLimit !== undefined && (!Number.isFinite(Number(body.dailyLimit)) || Number(body.dailyLimit) <= 0)) {
    return "dailyLimit must be greater than 0";
  }
  if (body.sessionLimit !== undefined && (!Number.isFinite(Number(body.sessionLimit)) || Number(body.sessionLimit) <= 0)) {
    return "sessionLimit must be greater than 0";
  }
  if (body.allowedStartTime !== undefined && !timePattern.test(body.allowedStartTime)) {
    return "allowedStartTime must use HH:mm format";
  }
  if (body.allowedEndTime !== undefined && !timePattern.test(body.allowedEndTime)) {
    return "allowedEndTime must use HH:mm format";
  }
  if (body.externalLinksAllowed !== undefined && typeof body.externalLinksAllowed !== "boolean") {
    return "externalLinksAllowed must be Boolean";
  }
  return null;
};

const findOwnedChild = async (req, res) => {
  if (!isObjectId(req.params.childId)) {
    res.status(400).json({ success: false, message: "Invalid child ID" });
    return null;
  }

  const child = await getChildForUser(req.user, req.params.childId);
  if (!child) {
    res.status(req.user.role === "admin" ? 404 : 403).json({
      success: false,
      message: "You do not have access to this child",
    });
    return null;
  }
  return child;
};

const getControls = async (req, res) => {
  try {
    const child = await findOwnedChild(req, res);
    if (!child) return;
    const control = await getControl(child._id);
    if (!control) return res.status(404).json({ success: false, message: "Parental controls not found" });
    res.json({ success: true, data: control });
  } catch (error) {
    console.error("Get parental controls error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const createControls = async (req, res) => {
  try {
    const child = await findOwnedChild(req, res);
    if (!child) return;
    const validationError = validateControlInput(req.body || {});
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const existing = await getControl(child._id);
    if (existing) return res.status(409).json({ success: false, message: "Parental controls already exist" });
    const control = await ParentalControl.create({ ...req.body, childId: child._id, parentId: child.parent });
    res.status(201).json({ success: true, message: "Parental controls created", data: control });
  } catch (error) {
    console.error("Create parental controls error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateControls = async (req, res) => {
  try {
    const child = await findOwnedChild(req, res);
    if (!child) return;
    const validationError = validateControlInput(req.body || {}, true);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    const allowedFields = [
      "dailyLimit",
      "sessionLimit",
      "allowedStartTime",
      "allowedEndTime",
      "externalLinksAllowed",
      "isEnabled",
    ];
    const updates = Object.fromEntries(
      allowedFields
        .filter((field) => req.body[field] !== undefined)
        .map((field) => [field, req.body[field]])
    );
    const control = await ParentalControl.findOneAndUpdate(
      { childId: child._id },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!control) return res.status(404).json({ success: false, message: "Parental controls not found" });
    res.json({ success: true, message: "Parental controls updated", data: control });
  } catch (error) {
    console.error("Update parental controls error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const setControlsEnabled = (enabled) => async (req, res) => {
  try {
    const child = await findOwnedChild(req, res);
    if (!child) return;
    const control = await ParentalControl.findOneAndUpdate(
      { childId: child._id },
      { $set: { isEnabled: enabled } },
      { new: true }
    );
    if (!control) return res.status(404).json({ success: false, message: "Parental controls not found" });
    res.json({ success: true, message: `Parental controls ${enabled ? "enabled" : "disabled"}`, data: control });
  } catch (error) {
    console.error("Set parental controls status error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getExternalLinks = async (req, res) => {
  try {
    const child = await findOwnedChild(req, res);
    if (!child) return;
    const control = await getControl(child._id);
    if (!control) return res.status(404).json({ success: false, message: "Parental controls not found" });
    res.json({ success: true, externalLinksAllowed: control.externalLinksAllowed });
  } catch (error) {
    console.error("Get external link controls error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createControls,
  getControls,
  updateControls,
  enableControls: setControlsEnabled(true),
  disableControls: setControlsEnabled(false),
  getExternalLinks,
};