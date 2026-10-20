const Project = require("../models/Project");
const { isClientId, text, ms } = require("../utils/validate");

/**
 * Projects: the tiles on the home page and their pages.
 *   GET    /api/projects       everyone (the home page shows them before sign-in)
 *   PUT    /api/projects/:id   admin: add or edit (id is the frontend's id)
 *   DELETE /api/projects/:id   admin: delete (not the two built-in projects)
 *
 * The two projects the site launched with are created the first time the
 * list is read, so a fresh database shows the same tiles as before.
 */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const LOCAL_PAGE = /^[a-z0-9-]+\.html$/;
const LOCAL_IMAGE = /^[a-z0-9_-]+\.(png|jpe?g|svg|webp)$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/i;
const STATUSES = ["open", "soon", "hidden"];
const MAX_PROJECTS = 40;

const BUILT_IN = [
  {
    clientId: "project-reading-for-pleasure",
    slug: "reading-for-pleasure",
    title: "Reading for pleasure",
    status: "open",
    sort: 0,
    link: "reading-for-pleasure.html",
    image: "logo.svg",
    blurb:
      "Curated books and trusted reading resources for children aged 0 to 18, matched to each child’s age and interests — plus a family shelf, a wishlist you can share, and a moderated board for swapping ideas with other parents.",
  },
  {
    clientId: "project-four-voices",
    slug: "four-voices",
    title: "Four Voices",
    status: "soon",
    sort: 10,
    link: "four-voices.html",
    image: "four-voices-logo.jpg",
    blurb: "Four voices at the table, nurturing children’s talk. We are still building this project — take a look at what is on the way.",
  },
];
const BUILT_IN_SLUGS = BUILT_IN.map((b) => b.slug);

const projectOut = (p) => ({
  id: p.clientId,
  slug: p.slug,
  title: p.title,
  blurb: p.blurb,
  status: p.status,
  categories: (p.categories || []).map((c) => ({ id: c.id, name: c.name })),
  sort: p.sort,
  link: p.link,
  image: p.image,
  builtIn: !!p.builtIn,
  by: p.by,
  at: ms(p.updatedAt),
});

const ensureBuiltIns = async () => {
  for (const project of BUILT_IN) {
    if (await Project.exists({ slug: project.slug })) continue;
    try {
      await Project.create({ ...project, builtIn: true });
    } catch (error) {
      if (error.code !== 11000) throw error; // created by a request running at the same time
    }
  }
};

const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

const categoriesFrom = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const c of value.slice(0, 30)) {
    const name = text(c && typeof c === "object" ? c.name : c, 40);
    const id = slugify(c && typeof c === "object" && c.id ? c.id : name);
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
};

const fields = (body, slug) => {
  const title = text(body.title, 120);
  if (!title) return { error: "Give the project a title" };

  const link = text(body.link, 500);
  if (link && !HTTPS.test(link) && !LOCAL_PAGE.test(link)) {
    return { error: "The link must be a page on this site (like four-voices.html) or start with https://" };
  }
  const image = text(body.image, 500);
  if (image && !HTTPS.test(image) && !LOCAL_IMAGE.test(image)) {
    return { error: "The picture must be an image file on this site (like logo.svg) or start with https://" };
  }

  const sort = Number(body.sort);
  return {
    values: {
      title,
      blurb: text(body.blurb, 400),
      status: STATUSES.includes(body.status) ? body.status : "soon",
      // Reading for pleasure uses the book categories instead of its own.
      categories: slug === "reading-for-pleasure" ? [] : categoriesFrom(body.categories),
      sort: Number.isFinite(sort) ? Math.max(-1e6, Math.min(1e6, Math.round(sort))) : 0,
      link,
      image,
    },
  };
};

// GET /api/projects
const listProjects = async (req, res) => {
  try {
    await ensureBuiltIns();
    const items = await Project.find().sort({ sort: 1, createdAt: 1 }).limit(MAX_PROJECTS);
    return res.json({ success: true, items: items.map(projectOut) });
  } catch (error) {
    console.error("List projects error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// PUT /api/projects/:id
const putProject = async (req, res) => {
  try {
    const clientId = req.params.id;
    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    const body = req.body || {};

    let project = await Project.findOne({ clientId });
    // The address of a project page never changes once it exists.
    const slug = project ? project.slug : String(body.slug || "").trim().toLowerCase();
    if (!project) {
      if (!SLUG.test(slug)) {
        return res.status(400).json({ success: false, message: "The web address can use lowercase letters, numbers and hyphens (up to 40)" });
      }
      if (await Project.exists({ slug })) {
        return res.status(409).json({ success: false, message: "Another project already uses that web address" });
      }
      if ((await Project.countDocuments()) >= MAX_PROJECTS) {
        return res.status(400).json({ success: false, message: `There can be at most ${MAX_PROJECTS} projects` });
      }
    }

    const { values, error } = fields(body, slug);
    if (error) return res.status(400).json({ success: false, message: error });

    if (project) {
      Object.assign(project, values, { by: req.user.email });
      await project.save();
    } else {
      project = await Project.create({ ...values, clientId, slug, builtIn: BUILT_IN_SLUGS.includes(slug), by: req.user.email });
    }
    return res.json({ success: true, item: projectOut(project) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Another project already uses that web address" });
    }
    console.error("Save project error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// DELETE /api/projects/:id
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findOne({ clientId: req.params.id });
    if (!project) return res.status(404).json({ success: false, message: "Project not found" });
    if (project.builtIn || BUILT_IN_SLUGS.includes(project.slug)) {
      return res.status(409).json({ success: false, message: "The built-in projects can be hidden but not deleted" });
    }
    await Project.deleteOne({ _id: project._id });
    return res.json({ success: true, message: "Project deleted" });
  } catch (error) {
    console.error("Delete project error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listProjects, putProject, deleteProject, ensureBuiltIns, BUILT_IN_PROJECTS: BUILT_IN };
