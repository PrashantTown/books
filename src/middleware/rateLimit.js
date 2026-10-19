/**
 * Small in-memory rate limiter for the public endpoints (sign-in, sign-up,
 * forgot password, contact form). It counts requests per key inside a time
 * window and answers 429 once the limit is passed.
 *
 * Memory is per server process. If the API runs on several instances, swap
 * this for a shared store (for example Redis) so limits apply across them.
 *
 * Limits are switched off when NODE_ENV is "test" unless `enabledInTests` is
 * set, so the Jest suites can sign in many times quickly.
 */
const rateLimit = ({ windowMs, max, keyFn, message, enabledInTests = false }) => {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, Math.max(windowMs, 60000));
  if (sweep.unref) sweep.unref();

  return (req, res, next) => {
    if (process.env.NODE_ENV === "test" && !enabledInTests) return next();

    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({
        success: false,
        message: message || "Too many requests. Please wait a moment and try again.",
      });
    }

    return next();
  };
};

/** A limit from the environment (e.g. RATE_LIMIT_LOGIN=100), or the fallback. */
const limitFromEnv = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = rateLimit;
module.exports.limitFromEnv = limitFromEnv;
