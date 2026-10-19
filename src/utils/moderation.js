const { getPlatformSettings } = require("./platformSettings");

/**
 * Server-side copy of the frontend's moderation check (window.PTGModeration
 * in settings.js). It decides whether a new post can be shown straight away
 * or must wait for an administrator.
 *
 * Running it on the server means nobody can skip review by editing the page.
 */

// Hosts that are trusted for links: education, government, libraries and
// children's publishers.
const ALLOWED_HOSTS = /(^|\.)(edu|gov|edu\.au|gov\.au|ac\.uk|gov\.uk|sch\.uk|org\.au)$|librar(y|ies)|penguin|harpercollins|scholastic|bloomsbury|walker|allenandunwin|hachette|macmillan|simonandschuster|randomhouse|usborne|oup\.com|abc\.net\.au|readingrockets\.org|booktrust\.org\.uk/i;

const linkAllowed = (link) => {
  try {
    return ALLOWED_HOSTS.test(new URL(String(link)).hostname);
  } catch (error) {
    return false;
  }
};

// Two capitalised words in a row that are not at the start of a sentence
// usually mean a full name, which could identify a child.
const namesSomeone = (text) =>
  /\b[A-Z][a-z]{1,}\s+[A-Z][a-z]{2,}\b/.test(String(text || "").replace(/(^|[.!?]\s+)[A-Z]/g, "$1x"));

/**
 * @returns {"approved"|"pending"}
 */
const verdictWith = (settings, text, link) => {
  if (settings.holdAll) return "pending";
  if (settings.flagNames && namesSomeone(text)) return "pending";

  const links = (String(text || "").match(/https?:\/\/[^\s<>"']+/gi) || []).concat(link ? [link] : []);
  if (links.length && settings.linkAllow && !links.every(linkAllowed)) return "pending";

  return "approved";
};

const verdict = async (text, link) => verdictWith(await getPlatformSettings(), text, link);

module.exports = { verdict, verdictWith, linkAllowed, namesSomeone };
