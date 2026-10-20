/**
 * Loads demo data so the Parents Go To site works straight away:
 *
 *   - an administrator account
 *   - a demo parent ("Sarah") with Harry and Leo, six books, a wishlist and
 *     a reading log (the same sample shelf the frontend used to show)
 *   - two sample parents whose reviews appear on books
 *   - the team's sample resources and some parent suggestions to moderate
 *
 * Usage:
 *   npm run seed            add or refresh the demo data
 *   npm run seed -- --reset remove the demo accounts first, then add them again
 *
 * Credentials come from .env (SEED_*) or the defaults printed at the end.
 * It refuses to run with NODE_ENV=production unless you pass --force.
 */
const crypto = require("crypto");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

dotenv.config();

const User = require("../src/models/User");
const Child = require("../src/models/Child");
const ShelfBook = require("../src/models/ShelfBook");
const ReadingLog = require("../src/models/ReadingLog");
const FamilyProfile = require("../src/models/FamilyProfile");
const BookReview = require("../src/models/BookReview");
const Resource = require("../src/models/Resource");
const Suggestion = require("../src/models/Suggestion");
const CatalogueBook = require("../src/models/CatalogueBook");
const { ensureBuiltIns } = require("../src/controllers/projectController");
const { deleteAccountAndData } = require("../src/utils/accountCleanup");
const { bookKey } = require("../src/controllers/bookReviewController");

const args = process.argv.slice(2);
const RESET = args.includes("--reset");
const FORCE = args.includes("--force");

const ADMIN = {
  name: process.env.SEED_ADMIN_NAME || "Site Administrator",
  email: (process.env.SEED_ADMIN_EMAIL || "admin@parentsgoto.test").toLowerCase(),
  password: process.env.SEED_ADMIN_PASSWORD || "demo1234-admin",
};

const PARENT = {
  name: process.env.SEED_PARENT_NAME || "Sarah",
  email: (process.env.SEED_PARENT_EMAIL || "demo@parentsgoto.test").toLowerCase(),
  password: process.env.SEED_PARENT_PASSWORD || "demo1234",
};

const SAMPLE_PARENTS = [
  { name: "Priya", email: "priya@parentsgoto.test" },
  { name: "Marcus", email: "marcus@parentsgoto.test" },
];

const HOUR = 36e5;
const DAY = 864e5;

const daysAgo = (n) => {
  const d = new Date(Date.now() - n * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const upsertUser = async ({ name, email, password, role }) => {
  const hash = await bcrypt.hash(password || crypto.randomBytes(18).toString("base64"), 10);
  let user = await User.findOne({ email });
  if (user && user.role !== role) {
    throw new Error(`${email} already exists as a ${user.role}. Use a different SEED_ email or run with --reset.`);
  }
  if (!user) {
    user = await User.create({ name, email, password: hash, role, passwordChangedAt: new Date() });
  } else {
    user.name = name;
    user.password = hash;
    user.status = "active";
    user.lockedOut = false;
    user.failedLogins = 0;
    await user.save();
  }
  return user;
};

const seedShelf = async (parent) => {
  await Promise.all([
    Child.deleteMany({ parent: parent._id }),
    ShelfBook.deleteMany({ owner: parent._id }),
    ReadingLog.deleteMany({ owner: parent._id }),
    FamilyProfile.deleteMany({ user: parent._id }),
  ]);

  await Child.create([
    { parent: parent._id, clientId: "c1", position: 0, name: "Harry", age: 6, band: "5–7", colour: "#B3402E", likes: ["picture", "early", "poetry"] },
    { parent: parent._id, clientId: "c2", position: 1, name: "Leo", age: 9, band: "7–9", colour: "#0A6280", likes: ["graphic", "nonfic"] },
  ]);

  const books = [
    { clientId: "b1", title: "The Gruffalo", author: "Julia Donaldson", category: "picture", ages: "3–5", status: "reading", who: ["c1"], spine: "#0D3B32", pages: 32, page: 18, started: daysAgo(3), notes: "Harry does all the voices. The mouse is his favourite." },
    { clientId: "b2", title: "Frog and Toad Are Friends", author: "Arnold Lobel", category: "early", ages: "5–7", status: "toread", who: ["c1"], spine: "#B3402E", pages: 64, added: daysAgo(16) },
    { clientId: "b3", title: "Charlotte's Web", author: "E. B. White", category: "chapter", ages: "7–9", status: "reading", who: ["c2"], spine: "#0A6280", pages: 184, page: 96, started: daysAgo(9) },
    { clientId: "b4", title: "The Magic School Bus: Inside the Human Body", author: "Joanna Cole", category: "nonfic", ages: "7–9", status: "read", who: ["c2"], spine: "#2C6B4F", pages: 40, page: 40, rating: 5, started: daysAgo(20), finished: daysAgo(6) },
    { clientId: "b5", title: "Goodnight Moon", author: "Margaret Wise Brown", category: "bedtime", ages: "0–3", status: "read", who: [], spine: "#06283C", pages: 32, page: 32, rating: 4, started: daysAgo(48), finished: daysAgo(41) },
    { clientId: "b6", title: "Amulet: The Stonekeeper", author: "Kazu Kibuishi", category: "graphic", ages: "9–12", status: "toread", who: ["c2"], spine: "#123F5B", pages: 192, added: daysAgo(2) },
  ];
  const wishlist = [
    { clientId: "w1", title: "Where the Wild Things Are", author: "Maurice Sendak", category: "picture", ages: "3–5", status: "toread", who: ["c1"], spine: "#E9A13B", notes: "Seen at the library — ask about it." },
    { clientId: "w2", title: "Where the Sidewalk Ends", author: "Shel Silverstein", category: "poetry", ages: "5–7", status: "toread", who: [], spine: "#2F6E86" },
  ];

  await ShelfBook.create([
    ...books.map((b, position) => ({ ...b, owner: parent._id, list: "library", position })),
    ...wishlist.map((b, position) => ({ ...b, owner: parent._id, list: "wishlist", position })),
  ]);

  const sessions = [
    { clientId: "s1", bookId: "b1", childId: "c1", date: daysAgo(1), minutes: 15, page: 18 },
    { clientId: "s2", bookId: "b1", childId: "c1", date: daysAgo(2), minutes: 10, page: 11 },
    { clientId: "s3", bookId: "b1", childId: "c1", date: daysAgo(3), minutes: 20, page: 6 },
    { clientId: "s4", bookId: "b3", childId: "c2", date: daysAgo(1), minutes: 30, page: 96 },
    { clientId: "s5", bookId: "b3", childId: "c2", date: daysAgo(4), minutes: 25, page: 71 },
  ];
  await ReadingLog.create(sessions.map((s, position) => ({ ...s, owner: parent._id, position })));

  await FamilyProfile.create({
    user: parent._id,
    colour: "#0D3B32",
    activity: [{ text: "Shelf set up with six books for Harry and Leo", at: Date.now() }],
  });
};

const seedCommunity = async (admin, samples) => {
  const reviews = [
    {
      clientId: "rv-seed-priya",
      owner: samples[0],
      title: "The Magic School Bus: Inside the Human Body",
      author: "Joanna Cole",
      rating: 5,
      body: "Read this one twice in a week, which has never happened before. The chapters are short enough to stop at the end of one without an argument.",
      ago: 40 * HOUR,
    },
    {
      clientId: "rv-seed-marcus",
      owner: samples[1],
      title: "Goodnight Moon",
      author: "Margaret Wise Brown",
      rating: 3,
      body: "Good for a first bedtime book — short, and the pictures carry most of it. We had outgrown it within a couple of months, so borrow it from the library first.",
      ago: 70 * HOUR,
    },
  ];
  for (const r of reviews) {
    await BookReview.findOneAndUpdate(
      { clientId: r.clientId },
      {
        $set: {
          owner: r.owner._id,
          fromName: r.owner.name,
          bookKey: bookKey(r.title, r.author),
          bookTitle: r.title,
          bookAuthor: r.author,
          rating: r.rating,
          body: r.body,
          at: new Date(Date.now() - r.ago),
          state: "published",
          reason: "",
          decidedBy: admin.email,
          decidedAt: new Date(Date.now() - r.ago + 45 * 60000),
        },
      },
      { upsert: true }
    );
  }

  const resources = [
    { clientId: "post1", title: "How to pick books at the right reading level", body: "A short guide to age bands, why they are only a starting point, and what to do when a child is ahead of or behind the band on their card.", category: "early", ages: "5–7", link: "https://raisingchildren.net.au/guides/activity-guides/letters-words-and-stories/reading-activities-children-2-4-years", state: "published", ago: 120 * HOUR },
    { clientId: "post2", title: "Reading together when you only have ten minutes", body: "Short, honest suggestions for families where bedtime is already tight. Ten minutes counts, and the streak matters more than the length.", category: "bedtime", ages: "3–5", link: "https://raisingchildren.net.au/babies/play-learning/literacy-reading-stories", state: "published", ago: 200 * HOUR },
    { clientId: "post3", title: "Term two reading challenge (draft)", body: "Outline for a challenge families can opt into next term. Still needs the stakeholder to confirm the prizes and the wording about school involvement.", category: "chapter", ages: "7–9", link: "", state: "draft", ago: 8 * HOUR },
  ];
  for (const r of resources) {
    const { ago, ...fields } = r;
    await Resource.findOneAndUpdate(
      { clientId: r.clientId },
      { $set: { ...fields, by: admin.email, createdBy: admin._id, at: new Date(Date.now() - ago) } },
      { upsert: true }
    );
  }

  const suggestions = [
    { clientId: "sub1", title: "Local library storytime, Saturdays 10am", body: "A half-hour session for under-fives at the branch on the main street. Good for the 3–5 band and no booking needed.", category: "picture", ages: "3–5", link: "", state: "pending", ago: 5 * HOUR },
    { clientId: "sub2", title: "Bilingual picture books we borrowed and loved", body: "A short list of dual-language titles that worked well for a five-year-old reading in two languages at home.", category: "bilingual", ages: "3–5", link: "", state: "pending", ago: 26 * HOUR },
    { clientId: "sub3", title: "Reluctant readers: graphic novels that got us going", body: "Suggested for the 9–12 band after a slow year. Would suit anyone whose child says books are boring.", category: "graphic", ages: "9–12", link: "", state: "pending", ago: 50 * HOUR },
    { clientId: "sub4", title: "Ten-minute bedtime stories collection", body: "A collection that reliably lands inside the ten minutes most families have at bedtime.", category: "bedtime", ages: "0–3", link: "https://www.alia.org.au/region/national", state: "approved", ago: 96 * HOUR, decided: 90 * HOUR },
  ];
  for (const s of suggestions) {
    const { ago, decided, ...fields } = s;
    await Suggestion.findOneAndUpdate(
      { clientId: s.clientId },
      {
        $set: {
          ...fields,
          owner: null,
          fromName: "A parent",
          origin: "seed",
          at: new Date(Date.now() - ago),
          reason: "",
          decidedBy: s.state === "approved" ? admin.email : "",
          decidedAt: decided ? new Date(Date.now() - decided) : null,
        },
      },
      { upsert: true }
    );
  }
};

// A starter catalogue for "Discover books", so the tab isn't empty on a new
// site. Administrators can edit, hide or delete these from the console.
const CATALOGUE = [
  { clientId: "cat-seed-gruffalo", title: "The Gruffalo", author: "Julia Donaldson", year: 1999, pages: 32, category: "picture", ages: "3–5", note: "A rhyming read-aloud with a twist at the end. Children soon join in with the repeated lines." },
  { clientId: "cat-seed-possum-magic", title: "Possum Magic", author: "Mem Fox", year: 1983, pages: 32, category: "picture", ages: "3–5", note: "An Australian favourite that travels the country one food at a time." },
  { clientId: "cat-seed-diary-of-a-wombat", title: "Diary of a Wombat", author: "Jackie French", year: 2002, pages: 32, category: "early", ages: "5–7", note: "Very few words on each page, so new readers can try it on their own." },
  { clientId: "cat-seed-where-the-wild-things-are", title: "Where the Wild Things Are", author: "Maurice Sendak", year: 1963, pages: 48, category: "bedtime", ages: "3–5", note: "Short enough for a tired bedtime, with pictures that reward a second look." },
  { clientId: "cat-seed-charlottes-web", title: "Charlotte's Web", author: "E. B. White", year: 1952, pages: 184, category: "chapter", ages: "7–9", note: "Short chapters that suit one a night, and a gentle first book about friendship and loss." },
  { clientId: "cat-seed-matilda", title: "Matilda", author: "Roald Dahl", year: 1988, pages: 240, category: "chapter", ages: "9–12", note: "A good choice for a child who has just found that they love reading." },
];

const seedCatalogue = async (admin) => {
  for (const [i, book] of CATALOGUE.entries()) {
    await CatalogueBook.findOneAndUpdate(
      { clientId: book.clientId },
      { $set: { ...book, source: "other", state: "published", sort: i * 10, by: admin.email } },
      { upsert: true }
    );
  }
};

const main = async () => {
  if (process.env.NODE_ENV === "production" && !FORCE) {
    throw new Error("Refusing to seed with NODE_ENV=production. Pass --force if you really mean it.");
  }
  const uri = String(process.env.MONGODB_URI || "").trim();
  if (!uri) throw new Error("Set MONGODB_URI in .env first.");
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error("MONGODB_URI must start with mongodb+srv:// (check for a missing or extra part when it was pasted)");
  }
  if (ADMIN.password.length < 12) throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.");

  await mongoose.connect(uri);

  if (RESET) {
    for (const email of [ADMIN.email, PARENT.email, ...SAMPLE_PARENTS.map((p) => p.email)]) {
      const user = await User.findOne({ email });
      if (user) await deleteAccountAndData(user);
    }
    await Promise.all([
      BookReview.deleteMany({ clientId: { $in: ["rv-seed-priya", "rv-seed-marcus"] } }),
      Resource.deleteMany({ clientId: { $in: ["post1", "post2", "post3"] } }),
      Suggestion.deleteMany({ clientId: { $in: ["sub1", "sub2", "sub3", "sub4"] } }),
      CatalogueBook.deleteMany({ clientId: { $in: CATALOGUE.map((b) => b.clientId) } }),
    ]);
  }

  const admin = await upsertUser({ ...ADMIN, role: "admin" });
  const parent = await upsertUser({ ...PARENT, role: "parent" });
  const samples = [];
  for (const sample of SAMPLE_PARENTS) samples.push(await upsertUser({ ...sample, role: "parent" }));

  await seedShelf(parent);
  await seedCommunity(admin, samples);
  await seedCatalogue(admin);
  await ensureBuiltIns();

  // Passwords you chose through SEED_* settings are never printed, so they
  // don't end up in hosting or CI logs. Only the built-in demo ones are shown.
  const shown = (key, value) => (process.env[key] ? `(your ${key})` : value);
  console.log("\nDemo data is ready.\n");
  console.log(`  Parent         ${PARENT.email}  /  ${shown("SEED_PARENT_PASSWORD", PARENT.password)}`);
  console.log(`  Administrator  ${ADMIN.email}  /  ${shown("SEED_ADMIN_PASSWORD", ADMIN.password)}`);
  if (!process.env.SEED_ADMIN_PASSWORD || !process.env.SEED_PARENT_PASSWORD) {
    console.log("\nChange the demo passwords before sharing the site.\n");
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(`Seed failed: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
