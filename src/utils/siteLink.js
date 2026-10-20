/**
 * Links in emails point back at the website. They open the site the request
 * came from when it is one of the allowed sites (CORS_ORIGINS), otherwise
 * SITE_URL, otherwise the first allowed site.
 */
const PAGE = "/reading-for-pleasure.html";

const allowedSites = () =>
  String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);

// The app page, e.g. https://parents-go-to-live.vercel.app/reading-for-pleasure.html
const sitePage = (req) => {
  const allowed = allowedSites();
  const origin = String((req && req.get && req.get("origin")) || "").replace(/\/$/, "");
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (origin && (allowed.includes(origin) || (!allowed.length && local))) return origin + PAGE;
  const site = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (site) return /\.html$/.test(site) ? site : site + PAGE;
  return (allowed[0] || "http://localhost:5500") + PAGE;
};

module.exports = { sitePage };
