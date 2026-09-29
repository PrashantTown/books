const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authorized.",
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      const readableRoles = allowedRoles
        .map((role) => role.charAt(0).toUpperCase() + role.slice(1))
        .join(" or ");

      return res.status(403).json({
        success: false,
        message: `Access denied. ${readableRoles} permission required.`,
      });
    }

    next();
  };
};

module.exports = authorize;
