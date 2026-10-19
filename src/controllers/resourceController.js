const Resource = require("../models/Resource");
const { isAdmin } = require("../utils/access");
const { isClientId, text, ms, toDate } = require("../utils/validate");

/**
 * Guides and links the team publishes from the admin console.
 *   GET    /api/resources        published (admins also see drafts)
 *   POST   /api/resources        admin: create
 *   PUT    /api/resources/:id    admin: edit
 *   DELETE /api/resources/:id    admin: delete
 */

const resourceOut = (r) => ({
  id: r.clientId,
  title: r.title,
  body: r.body,
  category: r.category,
  ages: r.ages,
  link: r.link,
  state: r.state,
  at: ms(r.at),
  by: r.by,
});

const fields = (body) => {
  const title = text(body.title, 200);
  if (!title) return { error: "Give the post a title" };
  const link = text(body.link, 2000);
  if (link) {
    try {
      const url = new URL(link);
      if (!["http:", "https:"].includes(url.protocol)) return { error: "The link must start with http:// or https://" };
    } catch (error) {
      return { error: "The link must start with http:// or https://" };
    }
  }
  return {
    values: {
      title,
      body: text(body.body, 4000),
      category: text(body.category, 40),
      ages: text(body.ages, 20),
      link,
      state: body.state === "published" ? "published" : "draft",
    },
  };
};

const listResources = async (req, res) => {
  try {
    const query = isAdmin(req.user) ? {} : { state: "published" };
    const items = await Resource.find(query).sort({ at: -1 }).limit(500);
    return res.json({ success: true, items: items.map(resourceOut) });
  } catch (error) {
    console.error("List resources error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const createResource = async (req, res) => {
  try {
    const body = req.body || {};
    const clientId = body.id || `post${Date.now().toString(36)}`;
    if (!isClientId(clientId)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (await Resource.exists({ clientId })) return res.status(409).json({ success: false, message: "That id is already in use" });

    const { values, error } = fields(body);
    if (error) return res.status(400).json({ success: false, message: error });

    const resource = await Resource.create({
      ...values,
      clientId,
      by: req.user.email,
      createdBy: req.user._id,
      at: toDate(body.at, new Date()),
    });
    return res.status(201).json({ success: true, item: resourceOut(resource) });
  } catch (error) {
    console.error("Create resource error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const updateResource = async (req, res) => {
  try {
    const resource = await Resource.findOne({ clientId: req.params.id });
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });

    const { values, error } = fields({ ...resourceOut(resource), ...(req.body || {}) });
    if (error) return res.status(400).json({ success: false, message: error });

    Object.assign(resource, values);
    resource.by = req.user.email;
    resource.at = new Date();
    await resource.save();
    return res.json({ success: true, item: resourceOut(resource) });
  } catch (error) {
    console.error("Update resource error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteResource = async (req, res) => {
  try {
    const result = await Resource.deleteOne({ clientId: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ success: false, message: "Resource not found" });
    return res.json({ success: true, message: "Resource deleted" });
  } catch (error) {
    console.error("Delete resource error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { listResources, createResource, updateResource, deleteResource };
