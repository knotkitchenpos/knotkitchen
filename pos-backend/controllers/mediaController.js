const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const MediaAsset = require("../models/mediaAssetModel");
const storage = require("../services/storage");
const { validateImage } = require("../services/imageValidator");
const { resolveTenantFromUser, tenantFilter } = require("../services/tenantContext");

/**
 * Media Library (§6, §7, §25).
 *
 * Tenant isolation rule for every handler in this file:
 *   the storeId/restaurantId come from resolveTenantFromUser(req.user),
 *   NEVER from req.body/req.query. Cross-store access is therefore impossible
 *   even if a client sends another store's ids.
 */

const ALLOWED_FOLDERS = ["general", "products", "categories", "logo", "cover", "offers", "gallery"];

const toPublicAsset = (doc) => ({
  _id: doc._id,
  fileName: doc.fileName,
  url: doc.url,
  thumbnailUrl: doc.thumbnailUrl || doc.url,
  mimeType: doc.mimeType,
  size: doc.size,
  width: doc.width,
  height: doc.height,
  altText: doc.altText,
  folder: doc.folder,
  tags: doc.tags,
  usage: doc.usage,
  provider: doc.provider,
  createdAt: doc.createdAt,
});

/** GET /api/media — paginated, searchable library listing for this store. */
const listMedia = async (req, res, next) => {
  try {
    const tenant = await resolveTenantFromUser(req.user);
    const scope = tenantFilter(tenant);
    if (!scope) {
      return res.status(200).json({ success: true, data: [], pagination: { total: 0, page: 1, pages: 0 } });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const filter = { ...scope, isDeleted: { $ne: true } };

    if (req.query.folder && ALLOWED_FOLDERS.includes(req.query.folder)) {
      filter.folder = req.query.folder;
    }

    // Escape the search term so a user cannot inject regex control characters.
    if (req.query.search) {
      const safe = String(req.query.search).trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (safe) {
        filter.$and = [{ $or: [{ fileName: new RegExp(safe, "i") }, { altText: new RegExp(safe, "i") }] }];
      }
    }

    const [assets, total] = await Promise.all([
      MediaAsset.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      MediaAsset.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: assets.map(toPublicAsset),
      pagination: { total, page, pages: Math.ceil(total / limit), limit },
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/media — upload a new image into this store's library. */
const uploadMedia = async (req, res, next) => {
  try {
    const tenant = await resolveTenantFromUser(req.user);
    if (!tenant.storeId) {
      return next(createHttpError(400, "Your account is not linked to a store yet."));
    }

    if (!req.uploadedFile?.buffer) {
      return next(createHttpError(400, "No image file provided."));
    }

    // Validate the REAL bytes, not the declared content-type.
    const validation = validateImage({
      buffer: req.uploadedFile.buffer,
      fileName: req.uploadedFile.fileName,
    });
    if (!validation.ok) return next(createHttpError(400, validation.error));

    const folder = ALLOWED_FOLDERS.includes(req.body?.folder) ? req.body.folder : "general";

    const stored = await storage.upload({
      buffer: req.uploadedFile.buffer,
      fileName: validation.fileName,
      mimeType: validation.mimeType,
      storeId: tenant.storeId,
      folder,
    });

    try {
      const asset = await MediaAsset.create({
        storeId: tenant.storeId,
        restaurantId: tenant.restaurantId,
        outletId: tenant.outletId,
        fileName: validation.fileName,
        storageKey: stored.storageKey,
        provider: stored.provider,
        mimeType: validation.mimeType,
        size: req.uploadedFile.buffer.length,
        width: stored.width || validation.width,
        height: stored.height || validation.height,
        url: stored.url,
        thumbnailUrl: stored.thumbnailUrl || stored.url,
        altText: String(req.body?.altText || "").slice(0, 200),
        folder,
        uploadedBy: req.user?._id || null,
      });

      return res.status(201).json({ success: true, message: "Image uploaded", data: toPublicAsset(asset) });
    } catch (dbError) {
      // §32: the file landed in storage but the DB write failed. Remove the
      // orphan so we don't accumulate unreferenced objects//storage cost.
      await storage.remove(stored.storageKey).catch(() => {});
      throw dbError;
    }
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/media/:id — update alt text / folder metadata. */
const updateMedia = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(404, "Media not found."));

    const tenant = await resolveTenantFromUser(req.user);
    const scope = tenantFilter(tenant);
    if (!scope) return next(createHttpError(404, "Media not found."));

    const update = {};
    if (typeof req.body?.altText === "string") update.altText = req.body.altText.slice(0, 200);
    if (ALLOWED_FOLDERS.includes(req.body?.folder)) update.folder = req.body.folder;

    const asset = await MediaAsset.findOneAndUpdate(
      { _id: id, ...scope, isDeleted: { $ne: true } },
      update,
      { new: true }
    );
    // Same 404 for "missing" and "another store's" — no existence leak.
    if (!asset) return next(createHttpError(404, "Media not found."));

    res.status(200).json({ success: true, data: toPublicAsset(asset) });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/media/:id — soft-delete the record, remove the stored object. */
const deleteMedia = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(404, "Media not found."));

    const tenant = await resolveTenantFromUser(req.user);
    const scope = tenantFilter(tenant);
    if (!scope) return next(createHttpError(404, "Media not found."));

    const asset = await MediaAsset.findOne({ _id: id, ...scope, isDeleted: { $ne: true } });
    if (!asset) return next(createHttpError(404, "Media not found."));

    // Soft-delete first: if the provider call fails we still hide the asset
    // from the library rather than leaving a broken-image reference.
    asset.isDeleted = true;
    asset.deletedAt = new Date();
    await asset.save();

    await storage.remove(asset.storageKey).catch((err) => {
      console.warn("Media object removal failed (record already soft-deleted):", err.message);
    });

    res.status(200).json({ success: true, message: "Image deleted" });
  } catch (error) {
    next(error);
  }
};

module.exports = { listMedia, uploadMedia, updateMedia, deleteMedia, toPublicAsset, ALLOWED_FOLDERS };
