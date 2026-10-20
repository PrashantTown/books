const SupportTicket = require("../models/SupportTicket");
const SupportScreenshot = require("../models/SupportScreenshot");
const Counter = require("../models/Counter");
const { notifyAdmins } = require("../utils/notify");
const { writeAudit } = require("../utils/audit");
const { isAdmin, sameUser } = require("../utils/access");
const { isClientId, isEmail, text, ms, lower, hasUnsafeKeys } = require("../utils/validate");
const { emailTeam } = require("../utils/teamMail");
const { sitePage } = require("../utils/siteLink");
const { escapeHtml } = require("../utils/tokens");

// An email to the team about a new message, so nobody has to watch the
// console. Replying to it answers the person who wrote in.
const emailTeamAbout = (ticket, req) => {
  const who = ticket.name ? `${ticket.name} <${ticket.fromEmail}>` : ticket.fromEmail;
  const area = String(ticket.area || "");
  const kind = /^keep me posted/i.test(area) ? "posted" : /^contact page/i.test(area) || ticket.source === "public" ? "contact" : "report";
  const subject =
    kind === "posted"
      ? `Keep me posted: ${ticket.fromEmail}`
      : kind === "contact"
        ? `New message from ${ticket.name || ticket.fromEmail} (${ticket.ref})`
        : `Problem report ${ticket.ref}: ${area}`;
  const consoleLink = `${sitePage(req)}#support`;
  const lines = [
    `From: ${who}`,
    `Topic: ${area}`,
    kind === "report" && ticket.severityText ? `How bad: ${ticket.severityText}` : "",
    `Reference: ${ticket.ref}`,
    "",
    ticket.body,
    "",
    ticket.replyTo ? `Reply to this email to answer them (it goes to ${ticket.replyTo}).` : "",
    `See it in the console: ${consoleLink}`,
  ].filter((l, i, all) => l !== "" || (all[i - 1] !== "" && i > 0));
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1d2a26;max-width:560px">
<p><b>From:</b> ${escapeHtml(who)}<br><b>Topic:</b> ${escapeHtml(area)}${kind === "report" && ticket.severityText ? `<br><b>How bad:</b> ${escapeHtml(ticket.severityText)}` : ""}<br><b>Reference:</b> ${escapeHtml(ticket.ref)}</p>
<p style="white-space:pre-wrap;border-left:3px solid #0D3B32;padding-left:12px">${escapeHtml(ticket.body)}</p>
<p style="font-size:13px;color:#4b5a55">${ticket.replyTo ? `Reply to this email to answer them (it goes to ${escapeHtml(ticket.replyTo)}). ` : ""}<a href="${escapeHtml(consoleLink)}">See it in the console</a>.</p></div>`;
  emailTeam({ subject, text: lines.join("\n"), html, replyTo: ticket.replyTo || ticket.fromEmail }).catch((error) =>
    console.error("Team email error:", error.message)
  );
};

/**
 * Problem reports and contact messages.
 *   POST   /api/support                    send one (signed in, or a visitor via the contact form)
 *   GET    /api/support                    your own (admins: all)
 *   PATCH  /api/support/:id                admin: open / progress / closed
 *   POST   /api/support/:id/screenshot     attach an image (max 2 MB)
 *   GET    /api/support/:id/screenshot     view it
 *   DELETE /api/support/:id/screenshot     remove it
 */

const MAX_SHOT = 2 * 1024 * 1024;
const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const ticketOut = (t) => ({
  ...(t.extra && typeof t.extra === "object" ? t.extra : {}),
  id: t.clientId,
  ref: t.ref,
  at: ms(t.at),
  state: t.state,
  decidedAt: ms(t.decidedAt),
  from: t.fromEmail,
  replyTo: t.replyTo,
  source: t.source,
  name: t.name,
  area: t.area,
  severity: t.severity,
  severityText: t.severityText,
  body: t.body,
  diag: t.diag,
  shot: t.shot && t.shot.name !== undefined ? { name: t.shot.name, type: t.shot.type, size: t.shot.size } : null,
});

const KNOWN = ["id", "ref", "at", "state", "decidedAt", "from", "replyTo", "source", "name", "area", "severity", "severityText", "body", "diag", "shot", "owner"];

const createTicket = async (req, res) => {
  try {
    const b = req.body || {};
    const user = req.user;
    const clientId = b.id || `tk${Date.now()}`;
    const body = text(b.body, 4000);

    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (body.length < 5) return res.status(400).json({ success: false, message: "Tell us what happened — a sentence or two is plenty" });

    const existing = await SupportTicket.findOne({ clientId });
    if (existing) {
      if (user && sameUser(existing.owner, user)) return res.json({ success: true, item: ticketOut(existing) });
      return res.status(409).json({ success: false, message: "That id is already in use" });
    }

    let source;
    let fromEmail;
    let replyTo = text(b.replyTo || "", 254);

    if (user) {
      source = user.role === "admin" ? "admin" : "parent";
      fromEmail = user.email;
      if (!isEmail(replyTo)) replyTo = user.email;
    } else {
      // Visitor using the public contact form.
      source = "public";
      fromEmail = lower(b.from || b.replyTo);
      replyTo = text(b.replyTo || b.from, 254);
      if (!isEmail(fromEmail)) return res.status(400).json({ success: false, message: "Add an email address so we can reply" });
      if (text(b.name, 120).length < 2) return res.status(400).json({ success: false, message: "Tell us what to call you" });
    }

    // Keep the reference the page already showed the person, if it is
    // well-formed and not taken; otherwise number it here.
    let ref = String(b.ref || "").toUpperCase();
    if (!/^PTG-[A-Z0-9]{3,12}$/.test(ref) || (await SupportTicket.exists({ ref }))) {
      ref = `PTG-${1000 + (await Counter.next("supportRef"))}`;
      while (await SupportTicket.exists({ ref })) ref = `PTG-${1000 + (await Counter.next("supportRef"))}`;
    }

    const extra = {};
    for (const [key, value] of Object.entries(b)) if (!KNOWN.includes(key)) extra[key] = value;
    if (JSON.stringify(extra).length > 5000) return res.status(400).json({ success: false, message: "Too much extra data" });
    if (hasUnsafeKeys(extra)) return res.status(400).json({ success: false, message: "Field names can't start with $ or contain dots" });

    const shot = b.shot && typeof b.shot === "object"
      ? { name: text(b.shot.name, 200), type: text(b.shot.type, 60), size: Number(b.shot.size) || 0 }
      : null;

    const ticket = await SupportTicket.create({
      clientId,
      ref,
      owner: user ? user._id : null,
      source,
      fromEmail,
      replyTo,
      name: text(b.name, 120),
      area: text(b.area, 200) || (source === "public" ? "Message from the contact form" : "Somewhere else"),
      severity: ["low", "med", "high"].includes(b.severity) ? b.severity : "med",
      severityText: text(b.severityText, 200),
      body,
      diag: text(b.diag, 1000),
      shot,
      extra,
      at: new Date(),
    });

    if (!user) {
      // Signed-in reporters' pages tell the administrators themselves; a
      // visitor's page can't, so the server does it.
      await notifyAdmins({
        kind: "support",
        tone: "info",
        title: `New message — ${ticket.ref}`,
        body: `From ${ticket.name || ticket.fromEmail} via the contact form.`,
        go: "settings",
        tag: `report-${ticket.clientId}`,
      });
      await writeAudit({ kind: "account", what: `Contact form message received (${ticket.ref})`, who: ticket.fromEmail });
    }

    emailTeamAbout(ticket, req);

    return res.status(201).json({ success: true, item: ticketOut(ticket) });
  } catch (error) {
    console.error("Create support ticket error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const listTickets = async (req, res) => {
  try {
    const query = isAdmin(req.user) ? {} : { owner: req.user._id };
    const tickets = await SupportTicket.find(query).sort({ at: -1 }).limit(1000);
    return res.json({ success: true, items: tickets.map(ticketOut) });
  } catch (error) {
    console.error("List support tickets error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateTicket = async (req, res) => {
  try {
    const { state } = req.body || {};
    if (!["open", "progress", "closed"].includes(state)) {
      return res.status(400).json({ success: false, message: "State must be open, progress or closed" });
    }
    const ticket = await SupportTicket.findOne({ clientId: req.params.id });
    if (!ticket) return res.status(404).json({ success: false, message: "Report not found" });

    ticket.state = state;
    ticket.decidedAt = new Date();
    await ticket.save();
    return res.json({ success: true, item: ticketOut(ticket) });
  } catch (error) {
    console.error("Update support ticket error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const ticketForShot = async (req, res) => {
  const ticket = await SupportTicket.findOne({ clientId: req.params.id });
  if (!ticket) {
    res.status(404).json({ success: false, message: "Report not found" });
    return null;
  }
  if (!isAdmin(req.user) && !sameUser(ticket.owner, req.user)) {
    res.status(403).json({ success: false, message: "You can only see screenshots on your own reports" });
    return null;
  }
  return ticket;
};

// POST /api/support/:id/screenshot  { dataUrl: "data:image/png;base64,..." }
const uploadScreenshot = async (req, res) => {
  try {
    const ticket = await ticketForShot(req, res);
    if (!ticket) return;
    if (!sameUser(ticket.owner, req.user)) {
      return res.status(403).json({ success: false, message: "Only the person who sent the report can attach a screenshot" });
    }

    const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String((req.body && req.body.dataUrl) || ""));
    if (!match) return res.status(400).json({ success: false, message: "Send the image as a base64 data URL" });

    const contentType = match[1].toLowerCase();
    if (!SHOT_TYPES.includes(contentType)) {
      return res.status(400).json({ success: false, message: "Screenshots must be PNG, JPEG, WebP or GIF" });
    }
    const data = Buffer.from(match[2], "base64");
    if (!data.length || data.length > MAX_SHOT) {
      return res.status(413).json({ success: false, message: "Screenshots can be up to 2 MB" });
    }

    await SupportScreenshot.findOneAndUpdate(
      { ticket: ticket._id },
      { $set: { contentType, data, size: data.length } },
      { upsert: true }
    );
    ticket.shot = {
      name: text((req.body && req.body.name) || (ticket.shot && ticket.shot.name) || "screenshot", 200),
      type: contentType,
      size: data.length,
    };
    await ticket.save();

    return res.status(201).json({ success: true, item: ticketOut(ticket) });
  } catch (error) {
    console.error("Upload screenshot error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getScreenshot = async (req, res) => {
  try {
    const ticket = await ticketForShot(req, res);
    if (!ticket) return;
    const shot = await SupportScreenshot.findOne({ ticket: ticket._id });
    if (!shot) return res.status(404).json({ success: false, message: "No screenshot on this report" });

    res.set("Content-Type", shot.contentType);
    res.set("Cache-Control", "private, max-age=300");
    res.set("X-Content-Type-Options", "nosniff");
    return res.send(shot.data);
  } catch (error) {
    console.error("Get screenshot error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteScreenshot = async (req, res) => {
  try {
    const ticket = await ticketForShot(req, res);
    if (!ticket) return;
    await SupportScreenshot.deleteOne({ ticket: ticket._id });
    ticket.shot = null;
    await ticket.save();
    return res.json({ success: true, item: ticketOut(ticket) });
  } catch (error) {
    console.error("Delete screenshot error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { createTicket, listTickets, updateTicket, uploadScreenshot, getScreenshot, deleteScreenshot };
