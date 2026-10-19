const crypto = require("crypto");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isEmail = (value) => EMAIL.test(String(value || "").trim());

const isObjectId = (value) => /^[0-9a-fA-F]{24}$/.test(String(value || ""));

/**
 * Ids the frontend generates for its records ("b1", "bd-x7k2m9p0",
 * "tk1729351234-3", "th-…"). Letters, digits and a few separators only.
 */
const isClientId = (value) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(String(value || ""));

const randomToken = (length = 10) => {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += abc[bytes[i] % abc.length];
  return out;
};

const newClientId = (prefix) => `${prefix}${randomToken(10)}`;

/** Trim a value to a string no longer than `max` characters. */
const text = (value, max = 1000) => String(value == null ? "" : value).trim().slice(0, max);

/** Milliseconds since 1970 for a Date (or null), the way the frontend stores times. */
const ms = (date) => (date ? new Date(date).getTime() : null);

/** A Date from a millisecond timestamp, a date string or a Date; fallback when invalid. */
const toDate = (value, fallback = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  const d = new Date(typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(d.getTime()) ? fallback : d;
};

const lower = (value) => String(value || "").trim().toLowerCase();

/**
 * True when a JSON value has an object key MongoDB treats specially (starting
 * with "$" or containing "."). Such values are refused rather than stored.
 */
const hasUnsafeKeys = (value, depth = 0) => {
  if (depth > 20 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => hasUnsafeKeys(v, depth + 1));
  return Object.keys(value).some((k) => k.startsWith("$") || k.includes(".") || hasUnsafeKeys(value[k], depth + 1));
};

module.exports = {
  isEmail,
  isObjectId,
  isClientId,
  randomToken,
  newClientId,
  text,
  ms,
  toDate,
  lower,
  hasUnsafeKeys,
};
