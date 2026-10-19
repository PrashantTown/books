const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // Trimmed, because a pasted connection string often carries a stray
    // space or line break that MongoDB would reject.
    await mongoose.connect(String(process.env.MONGODB_URI || "").trim());

    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;