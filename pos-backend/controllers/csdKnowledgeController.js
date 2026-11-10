const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Article = require("../models/csdKnowledgeModel");

const str = (v) => String(v ?? "").trim();
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SHORTCUT = /^[a-z0-9][a-z0-9-]{0,39}$/;

const view = (a) => ({
  id: String(a._id),
  title: a.title,
  category: a.category,
  body: a.body,
  quickReply: a.quickReply,
  shortcut: a.shortcut,
  archived: !!a.archived,
  updatedAt: a.updatedAt,
  updatedByName: a.updatedByName || a.createdByName || "",
});

/** GET /api/csd/knowledge?q=&category= */
const listArticles = async (req, res, next) => {
  try {
    const filters = { archived: false };
    const category = str(req.query.category);
    if (category) filters.category = category;
    const q = str(req.query.q).slice(0, 80);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filters.$or = [{ title: rx }, { body: rx }, { quickReply: rx }, { shortcut: rx }];
    }
    const [rows, categories] = await Promise.all([
      Article.find(filters).sort({ category: 1, title: 1 }).limit(300).lean(),
      Article.distinct("category", { archived: false }),
    ]);
    res.status(200).json({ success: true, data: { articles: rows.map(view), categories: categories.sort() } });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/knowledge/quick-replies — what the WhatsApp composer offers after "/". */
const listQuickReplies = async (req, res, next) => {
  try {
    const rows = await Article.find({ archived: false, quickReply: { $gt: "" } }, { title: 1, shortcut: 1, quickReply: 1 }).sort({ shortcut: 1, title: 1 }).limit(300).lean();
    res.status(200).json({ success: true, data: rows.map((a) => ({ id: String(a._id), title: a.title, shortcut: a.shortcut, text: a.quickReply })) });
  } catch (error) {
    next(error);
  }
};

const readBody = (b) => {
  const fields = {
    title: str(b.title),
    category: str(b.category) || "General",
    body: String(b.body ?? "").slice(0, 20000),
    quickReply: String(b.quickReply ?? "").trim().slice(0, 4000),
    shortcut: str(b.shortcut).replace(/^\//, "").toLowerCase(),
  };
  const fieldErrors = {};
  if (fields.title.length < 2) fieldErrors.title = "Give the article a title.";
  if (fields.title.length > 200) fieldErrors.title = "Keep the title under 200 characters.";
  if (fields.category.length > 60) fieldErrors.category = "Keep the category short.";
  if (fields.shortcut && !SHORTCUT.test(fields.shortcut)) fieldErrors.shortcut = "Letters, numbers and hyphens only, like printer-setup.";
  if (fields.shortcut && !fields.quickReply) fieldErrors.quickReply = "A shortcut needs a quick reply to insert.";
  if (!fields.body.trim() && !fields.quickReply) fieldErrors.body = "Write the article or a quick reply.";
  return { fields, fieldErrors };
};

const duplicateShortcut = (err) =>
  err?.code === 11000 ? createHttpError(400, "That shortcut is already used.", { fieldErrors: { shortcut: "That shortcut is already used." } }) : err;

/** POST /api/csd/knowledge */
const createArticle = async (req, res, next) => {
  try {
    const { fields, fieldErrors } = readBody(req.body || {});
    if (Object.keys(fieldErrors).length) return next(createHttpError(400, "Check the highlighted fields.", { fieldErrors }));
    const name = req.csdStaff.fullName || req.csdStaff.staffId;
    const a = await Article.create({ ...fields, createdById: req.csdStaff._id, createdByName: name, updatedByName: name });
    res.status(201).json({ success: true, data: view(a.toObject()) });
  } catch (error) {
    next(duplicateShortcut(error));
  }
};

/** PATCH /api/csd/knowledge/:id */
const updateArticle = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid article."));
    const { fields, fieldErrors } = readBody(req.body || {});
    if (Object.keys(fieldErrors).length) return next(createHttpError(400, "Check the highlighted fields.", { fieldErrors }));
    const a = await Article.findOneAndUpdate(
      { _id: id, archived: false },
      { $set: { ...fields, updatedByName: req.csdStaff.fullName || req.csdStaff.staffId } },
      { new: true }
    ).lean();
    if (!a) return next(createHttpError(404, "Article not found."));
    res.status(200).json({ success: true, data: view(a) });
  } catch (error) {
    next(duplicateShortcut(error));
  }
};

/** DELETE /api/csd/knowledge/:id — admin only. Archives, so nothing is lost. */
const archiveArticle = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid article."));
    const a = await Article.findOneAndUpdate({ _id: id, archived: false }, { $set: { archived: true, updatedByName: req.csdStaff.fullName || req.csdStaff.staffId } }, { new: true }).lean();
    if (!a) return next(createHttpError(404, "Article not found."));
    res.status(200).json({ success: true, data: { archived: true } });
  } catch (error) {
    next(error);
  }
};

module.exports = { listArticles, listQuickReplies, createArticle, updateArticle, archiveArticle };
