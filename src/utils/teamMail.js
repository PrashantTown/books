/**
 * Emails for the team: contact-page messages, "Keep me posted" sign-ups and
 * problem reports. They go to SUPPORT_EMAIL (one or more addresses, comma
 * separated) or, when that isn't set, to every active administrator.
 * Replying to the email answers the person who wrote in.
 *
 * Nothing is sent while email isn't set up (see mailer.js); the messages are
 * still in the console either way.
 */
const User = require("../models/User");
const { sendMail, mailEnabled } = require("./mailer");

// Demo addresses that can't receive mail (e.g. admin@parentsgoto.test).
const undeliverable = (email) => /\.(test|invalid|example|localhost)$/i.test(String(email || "").split("@")[1] || "");

const teamAddresses = async () => {
  const listed = String(process.env.SUPPORT_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (listed.length) return listed;
  const admins = await User.find({ role: "admin", status: "active" }).select("email");
  return admins.map((a) => a.email).filter((e) => !undeliverable(e));
};

const emailTeam = async ({ subject, text, html, replyTo }) => {
  if (!mailEnabled()) return 0;
  const to = await teamAddresses();
  let sent = 0;
  for (const address of to) {
    try {
      await sendMail({ to: address, subject, text, html, replyTo });
      sent += 1;
    } catch (error) {
      console.error(`Team email to ${address} failed:`, error.message);
    }
  }
  return sent;
};

module.exports = { emailTeam, teamAddresses, undeliverable };
