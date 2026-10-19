const User = require("../models/User");
const UserData = require("../models/UserData");

/**
 * Platform-wide rules are the settings administrators save in the console
 * (moderation, lockout, retention). The frontend stores every person's
 * settings under the "prefs" key; for each rule the most recently saved
 * administrator value wins, which is how the frontend worked before.
 *
 * Defaults match the console's settings form.
 */
const DEFAULTS = {
  holdAll: true, // hold every post for review
  flagNames: true, // hold posts that seem to name a person
  linkAllow: true, // hold posts with links outside the allow-list
  lockAttempts: 5, // wrong passwords before an account locks
  logRetention: 365, // days the activity log is kept
  subRetention: 180, // days decided suggestions are kept
  dormantAfter: 0, // days before an unused account is closed (0 = never)
};

const PLATFORM_KEYS = Object.keys(DEFAULTS);

const coerce = (key, value) => {
  if (typeof DEFAULTS[key] === "boolean") return value === true || value === "true";
  if (typeof DEFAULTS[key] === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : DEFAULTS[key];
  }
  return value;
};

const getPlatformSettings = async () => {
  const admins = await User.find({ role: "admin" }).select("_id");
  const docs = await UserData.find({
    key: "prefs",
    user: { $in: admins.map((a) => a._id) },
  });

  const result = { ...DEFAULTS };
  const bestAt = {};

  for (const doc of docs) {
    const values = doc.value && typeof doc.value === "object" ? doc.value : {};
    const savedAt = Number(values.savedAt) || (doc.updatedAt ? doc.updatedAt.getTime() : 0);
    for (const key of PLATFORM_KEYS) {
      if (Object.prototype.hasOwnProperty.call(values, key) && (bestAt[key] === undefined || savedAt >= bestAt[key])) {
        bestAt[key] = savedAt;
        result[key] = coerce(key, values[key]);
      }
    }
  }

  return result;
};

module.exports = { getPlatformSettings, PLATFORM_DEFAULTS: DEFAULTS, PLATFORM_KEYS };
