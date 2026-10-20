const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
    },

    role: {
      type: String,
      enum: ["admin", "parent", "student"],
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    },

    lastSeen: {
      type: Date,
      default: null,
    },

    tokenVersion: {
      type: Number,
      default: 0,
    },

    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // Added for the frontend integration -------------------------------

    // Wrong passwords in a row. Reset on a successful sign-in. When it
    // reaches the platform's lockAttempts setting the account is locked.
    failedLogins: {
      type: Number,
      default: 0,
    },

    // True when the account was suspended automatically for too many wrong
    // passwords (as opposed to an administrator suspending it).
    lockedOut: {
      type: Boolean,
      default: false,
    },

    // True after an administrator sets a temporary password, until the
    // person changes it themselves.
    tempPassword: {
      type: Boolean,
      default: false,
    },

    passwordChangedAt: {
      type: Date,
      default: null,
    },

    // "Forgot your password?": a SHA-256 hash of the one-time token in the
    // emailed link (the token itself is never stored), when it stops working,
    // and when the last email was sent (to avoid flooding an inbox).
    resetTokenHash: {
      type: String,
      default: null,
      index: true,
    },
    resetTokenExpires: {
      type: Date,
      default: null,
    },
    resetRequestedAt: {
      type: Date,
      default: null,
    },

    // New accounts confirm their email address by opening an emailed link
    // (only when email is set up). Accounts made before that, by an
    // administrator or by the seed script count as confirmed.
    emailConfirmed: {
      type: Boolean,
      default: true,
    },
    confirmTokenHash: {
      type: String,
      default: null,
      index: true,
    },
    confirmTokenExpires: {
      type: Date,
      default: null,
    },
    confirmSentAt: {
      type: Date,
      default: null,
    },

    // Administrators: a hash of the six-digit sign-in code we emailed them,
    // and when it stops working (only when email is set up).
    adminCodeHash: {
      type: String,
      default: null,
    },
    adminCodeExpires: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);