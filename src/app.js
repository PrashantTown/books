const express = require("express");
const cors = require("cors");

const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");
const childrenRoutes = require("./routes/children.routes");
const adminRoutes = require("./routes/admin.routes");
const bookRoutes = require("./routes/bookRoutes");
const parentalControlRoutes = require("./routes/parentalControl.routes");
const readingSessionRoutes = require("./routes/readingSession.routes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const reviewRoutes = require("./routes/reviewRoutes");

// Routes added for the Parents Go To frontend
const shelfRoutes = require("./routes/shelf.routes");
const userDataRoutes = require("./routes/userData.routes");
const settingsRoutes = require("./routes/settings.routes");
const communityRoutes = require("./routes/community.routes");
const resourceRoutes = require("./routes/resource.routes");
const supportRoutes = require("./routes/support.routes");
const notificationRoutes = require("./routes/notification.routes");
const auditRoutes = require("./routes/audit.routes");
const familyRoutes = require("./routes/family.routes");
const chatRoutes = require("./routes/chat.routes");
const shareRoutes = require("./routes/share.routes");

const { notFound, errorHandler } = require("./middleware/errorHandler");

/**
 * Builds the Express app without connecting to MongoDB or listening on a
 * port, so tests can import it directly. src/server.js does the connecting.
 */
const createApp = () => {
  const app = express();

  // Behind a hosting proxy (Render, Railway, Heroku…) set TRUST_PROXY=1 so
  // req.ip is the visitor's address and rate limits work per visitor.
  if (process.env.TRUST_PROXY) {
    app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  }

  // CORS_ORIGINS is a comma-separated list, e.g.
  // https://parents-go-to.vercel.app,http://localhost:5500
  // When it is not set every origin is allowed (handy for local development).
  const allowed = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || !allowed.length || allowed.includes(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
    })
  );

  // Basic protective headers (the API only ever returns JSON or images).
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });

  // Screenshots attached to support reports are sent as base64, so allow a
  // little more than the 2 MB file limit.
  app.use(express.json({ limit: "3mb" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/children", childrenRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/books", bookRoutes);
  app.use("/api/parental-controls", parentalControlRoutes);
  app.use("/api/reading-sessions", readingSessionRoutes);
  app.use("/api/wishlist", wishlistRoutes);
  app.use("/api/reviews", reviewRoutes);

  app.use("/api/shelf", shelfRoutes);
  app.use("/api/me/data", userDataRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/community", communityRoutes);
  app.use("/api/resources", resourceRoutes);
  app.use("/api/support", supportRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/audit", auditRoutes);
  app.use("/api/family", familyRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/share", shareRoutes);

  app.get("/", (req, res) => {
    res.json({
      success: true,
      message: "Backend server is running",
    });
  });

  app.use("/api/health", healthRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
