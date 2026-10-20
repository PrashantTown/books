/**
 * Adds an administrator account.
 *
 *   node scripts/add-admin.js --email someone@example.com --name "Their Name"
 *
 * The account gets a long random password that nobody knows. The person
 * chooses their own with "Forgot your password?" on the sign-in page (email
 * must be set up on the server), then signs in as Administrator; each time,
 * a six-digit code is emailed to them.
 *
 *   node scripts/add-admin.js --email you@example.com --promote
 *
 * --promote turns an existing parent account with that email into an
 * administrator (keeping its password). Without it, parent accounts are left
 * alone.
 *
 * Also runs from GitHub: Actions > Database tasks > Run workflow > add-admin.
 */
const crypto = require("crypto");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

dotenv.config();

const User = require("../src/models/User");
const { writeAudit } = require("../src/utils/audit");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
};

const main = async () => {
  const email = arg("--email").toLowerCase();
  const name = arg("--name") || email.split("@")[0];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error("Give a valid --email");

  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) throw new Error("Set MONGODB_URI first");
  await mongoose.connect(uri);

  const promote = process.argv.includes("--promote");
  const existing = await User.findOne({ email });
  if (existing && existing.role !== "admin" && !(promote && existing.role === "parent")) {
    throw new Error(`${email} already has a ${existing.role} account. Use a different email, or tick "promote" to make that parent account an administrator.`);
  }
  if (existing && existing.role === "parent") {
    existing.role = "admin";
    existing.status = "active";
    existing.lockedOut = false;
    existing.emailConfirmed = true;
    existing.tokenVersion += 1; // sign it out everywhere, so it signs in again as an administrator
    await existing.save();
    await writeAudit({ kind: "account", what: "Parent account made an administrator", who: "setup", detail: email, user: existing._id });
    console.log(`${email} is now an administrator (it was a parent account; its password is unchanged).`);
    console.log("Next: sign in with that email and choose Administrator.");
    await mongoose.disconnect();
    return;
  }
  if (existing) {
    existing.status = "active";
    existing.lockedOut = false;
    existing.emailConfirmed = true;
    await existing.save();
    console.log(`${email} is already an administrator (access restored if it was locked).`);
  } else {
    const user = await User.create({
      name: String(name).slice(0, 120),
      email,
      password: await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10),
      role: "admin",
      emailConfirmed: true,
    });
    await writeAudit({ kind: "account", what: "Administrator account added", who: "setup", detail: email, user: user._id });
    console.log(`Administrator added: ${email}`);
  }
  console.log('Next: they open the site, choose "Forgot your password?", set a password from the emailed link, then sign in as Administrator.');
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(`Add admin failed: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
