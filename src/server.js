const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const connectDB = require("./config/db");
const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");
const childrenRoutes = require("./routes/children.routes");
const adminRoutes = require("./routes/admin.routes");
const bookRoutes = require("./routes/bookRoutes");
const parentalControlRoutes = require("./routes/parentalControl.routes");
const readingSessionRoutes = require("./routes/readingSession.routes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const reviewRoutes = require("./routes/reviewRoutes");

dotenv.config();

const app = express();

connectDB();

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/children", childrenRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/parental-controls", parentalControlRoutes);
app.use("/api/reading-sessions", readingSessionRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/reviews", reviewRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Backend server is running",
  });
});

app.use("/api/health", healthRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});