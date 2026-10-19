const UserData = require("../models/UserData");
const { hasUnsafeKeys } = require("../utils/validate");

/**
 * Per-user JSON documents for small things the frontend keeps:
 *
 *   prefs    settings from the Settings page (display, notifications,
 *            privacy, contact details; for administrators also the
 *            platform rules such as moderation and lockout)
 *   genres   reading interests picked after sign-up
 *   kidLooks avatar and backdrop choices for each child
 *   welcome  which getting-started steps were dismissed
 */
const KEYS = {
  // Includes the profile photo (a small JPEG data URL), hence the room.
  prefs: 300 * 1024,
  genres: 10 * 1024,
  kidLooks: 200 * 1024,
  welcome: 10 * 1024,
};

const checkKey = (req, res) => {
  const { key } = req.params;
  if (!Object.prototype.hasOwnProperty.call(KEYS, key)) {
    res.status(404).json({ success: false, message: `Unknown data key. Use one of: ${Object.keys(KEYS).join(", ")}` });
    return null;
  }
  return key;
};

// GET /api/me/data  (all keys at once)
const getAll = async (req, res) => {
  try {
    const docs = await UserData.find({ user: req.user._id });
    const data = {};
    for (const key of Object.keys(KEYS)) data[key] = null;
    for (const doc of docs) data[doc.key] = doc.value;
    return res.json({ success: true, data });
  } catch (error) {
    console.error("Get user data error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /api/me/data/:key
const getOne = async (req, res) => {
  try {
    const key = checkKey(req, res);
    if (!key) return;
    const doc = await UserData.findOne({ user: req.user._id, key });
    return res.json({ success: true, key, value: doc ? doc.value : null, updatedAt: doc ? doc.updatedAt : null });
  } catch (error) {
    console.error("Get user data error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PUT /api/me/data/:key  { value: <any JSON object> }
const putOne = async (req, res) => {
  try {
    const key = checkKey(req, res);
    if (!key) return;

    const value = req.body ? req.body.value : undefined;
    if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
      return res.status(400).json({ success: false, message: "value must be a JSON object" });
    }
    if (JSON.stringify(value).length > KEYS[key]) {
      return res.status(413).json({ success: false, message: "That is more data than this setting can hold" });
    }
    if (hasUnsafeKeys(value)) {
      return res.status(400).json({ success: false, message: "Keys can't start with $ or contain dots" });
    }

    const doc = await UserData.findOneAndUpdate(
      { user: req.user._id, key },
      { $set: { value } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    return res.json({ success: true, key, value: doc.value, updatedAt: doc.updatedAt });
  } catch (error) {
    console.error("Put user data error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE /api/me/data/:key
const deleteOne = async (req, res) => {
  try {
    const key = checkKey(req, res);
    if (!key) return;
    await UserData.deleteOne({ user: req.user._id, key });
    return res.json({ success: true, message: "Removed" });
  } catch (error) {
    console.error("Delete user data error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getAll, getOne, putOne, deleteOne, USER_DATA_KEYS: Object.keys(KEYS) };
