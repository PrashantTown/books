const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Like `protect`, but lets the request through without a user when no token
 * is sent. Used by endpoints that both visitors and signed-in users can call
 * (for example the contact form, which becomes a support ticket).
 *
 * A token that is present but invalid is still rejected, so a stale session
 * never silently turns into an anonymous request.
 */
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || user.status === "suspended" || decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ success: false, message: "Invalid or expired token." });
    }

    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};

module.exports = optionalAuth;
