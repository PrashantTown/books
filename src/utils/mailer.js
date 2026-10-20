/**
 * Sends email (password reset links) through an email service's web API, so
 * it works on hosts that block SMTP, like Render's free plan.
 *
 * Settings (environment variables):
 *   BREVO_API_KEY    an API key from brevo.com (free: 300 emails a day), or
 *   RESEND_API_KEY   an API key from resend.com (needs your own domain)
 *   MAIL_FROM        the sender address, verified with that service
 *   MAIL_FROM_NAME   the sender name (default "Parents Go To")
 *   MAIL_PROVIDER    "brevo", "resend" or "log"; worked out from the keys when
 *                    not set. "log" prints emails instead of sending them
 *                    (local development and tests).
 *
 * With none of these set, no email is sent and "Forgot your password?" tells
 * the administrators instead.
 */

const TIMEOUT_MS = 10000;
const outbox = []; // emails "sent" in log mode, newest last (tests read these)

const provider = () => {
  const named = String(process.env.MAIL_PROVIDER || "").trim().toLowerCase();
  if (named) return named;
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return "";
};

const from = () => ({
  email: String(process.env.MAIL_FROM || "").trim(),
  name: String(process.env.MAIL_FROM_NAME || "Parents Go To").trim(),
});

const mailEnabled = () => {
  const p = provider();
  if (p === "log") return true;
  if (p === "brevo") return Boolean(process.env.BREVO_API_KEY && from().email);
  if (p === "resend") return Boolean(process.env.RESEND_API_KEY && from().email);
  return false;
};

const post = async (url, headers, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`The email service answered ${res.status}${detail ? `: ${detail}` : ""}`);
    }
  } finally {
    clearTimeout(timer);
  }
};

// sendMail({ to, subject, text, html }) resolves once the service accepts it.
const sendMail = async ({ to, subject, text, html }) => {
  const sender = from();
  switch (provider()) {
    case "brevo":
      return post(
        "https://api.brevo.com/v3/smtp/email",
        { "api-key": process.env.BREVO_API_KEY },
        { sender, to: [{ email: to }], subject, textContent: text, htmlContent: html }
      );
    case "resend":
      return post(
        "https://api.resend.com/emails",
        { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        { from: `${sender.name} <${sender.email}>`, to: [to], subject, text, html }
      );
    case "log":
      outbox.push({ to, subject, text, html, at: Date.now() });
      if (outbox.length > 50) outbox.shift();
      if (process.env.NODE_ENV !== "test") console.log(`[mail] to ${to}: ${subject}\n${text}\n`);
      return undefined;
    default:
      throw new Error("Email isn't set up (see src/utils/mailer.js)");
  }
};

module.exports = { sendMail, mailEnabled, mailOutbox: outbox };
