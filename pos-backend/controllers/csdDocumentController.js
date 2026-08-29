const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const CsdStoreDocument = require("../models/csdStoreDocumentModel");
const storage = require("../services/csdDocumentStorage");
const portal = require("../services/onboardPortalService");
const { csdAudit } = require("../services/csdAuditService");
const { loadStore } = require("./csdRestaurantController");

const { CATEGORIES, categoryForFileKey } = CsdStoreDocument;
const str = (v) => String(v ?? "").trim();

const shape = (d) => ({
  id: String(d._id),
  category: d.category,
  name: d.name,
  originalName: d.originalName,
  mimeType: d.mimeType,
  // Human-facing file type, so the UI shows "PDF" not "application/pdf".
  fileType: (d.mimeType || "").split("/").pop().toUpperCase(),
  size: d.size,
  source: d.source,
  sourceAgreementId: d.sourceAgreementId || null,
  uploadedByName: d.uploadedByName,
  uploadedAt: d.createdAt,
  lastUpdatedAt: d.replacedAt || d.updatedAt,
  replacedByName: d.replacedByName || "",
});

/**
 * Import every file attached to an agreement into a store's documents.
 *
 * The bytes are COPIED, not referenced. The portal can edit or delete an
 * agreement and its individual files, and a store's GST certificate must not
 * vanish because a sales agent tidied up months later. Copying also means the
 * documents survive the portal being unavailable.
 *
 * Never throws: this runs inside store creation, and a document that failed
 * to import must not undo a store that was otherwise created correctly. The
 * per-file outcome is returned so the caller can report it.
 *
 * @returns {{ imported: [], failed: [] }}
 */
const importAgreementDocuments = async ({ agreement, storeId, staff, req }) => {
  const files = agreement?.files || {};
  const imported = [];
  const failed = [];

  for (const [fileKey, file] of Object.entries(files)) {
    const url = file?.url;
    if (!url) continue;

    try {
      const { buffer } = await portal.fetchFile(url);
      const saved = await storage.save({ buffer, storeId });

      const doc = await CsdStoreDocument.create({
        storeId,
        category: categoryForFileKey(fileKey, file.name),
        name: file.name || fileKey,
        originalName: file.name || "",
        storageKey: saved.storageKey,
        mimeType: saved.mimeType,
        size: saved.size,
        checksum: saved.checksum,
        source: "agreement",
        sourceAgreementId: agreement.id,
        sourceFileKey: fileKey,
        uploadedById: staff?._id,
        uploadedByStaffId: staff?.staffId || "",
        uploadedByName: staff?.fullName || "",
      });

      imported.push(shape(doc));
    } catch (err) {
      // A duplicate means a previous import already brought this file in.
      if (err?.code === 11000) continue;
      failed.push({ fileKey, name: file?.name || fileKey, reason: err.message });
    }
  }

  if (imported.length || failed.length) {
    await csdAudit({
      req,
      staff,
      action: "CSD_DOCUMENTS_IMPORTED",
      resource: "CsdStoreDocument",
      entityType: "Store",
      storeId,
      description: `Imported ${imported.length} document(s) from agreement ${agreement.id}${
        failed.length ? `; ${failed.length} failed` : ""
      }`,
      newValue: { imported: imported.map((d) => d.name), failed },
      severity: failed.length ? "WARNING" : "INFO",
    });
  }

  return { imported, failed };
};

/** GET /api/csd/restaurants/:storeId/documents — staff and admin (§31). */
const listDocuments = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    await loadStore(storeId);

    const docs = await CsdStoreDocument.find({ storeId, isDeleted: false })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      data: {
        documents: docs.map(shape),
        categories: CATEGORIES,
        // §31: delete is admin-only. Enforced on the route regardless; this
        // just stops the UI offering a control that would be refused.
        canDelete: req.csdStaff.role === "admin",
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/restaurants/:storeId/documents/:docId/file
 *
 * Streams the bytes. These are never reachable by URL: the storage directory
 * is not served statically, and the key is random and never sent to the
 * client. This route is the only way in, and it requires a CSD session.
 */
const downloadDocument = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    const docId = str(req.params.docId);
    if (!mongoose.Types.ObjectId.isValid(docId)) return next(createHttpError(400, "Invalid document id."));

    // Scoped by storeId as well as id, so a document id from one store cannot
    // be replayed against another.
    const doc = await CsdStoreDocument.findOne({ _id: docId, storeId, isDeleted: false });
    if (!doc) return next(createHttpError(404, "Document not found."));

    let buffer;
    try {
      buffer = await storage.read(doc.storageKey);
    } catch {
      return next(createHttpError(410, "This document's file is no longer available on the server."));
    }

    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Length", buffer.length);
    // nosniff + a CSP that permits nothing: even if a crafted file slipped
    // past the type check, the browser will not execute it.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; object-src 'none'");
    // KYC material must never be cached by a proxy.
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download === "1" ? "attachment" : "inline"}; filename="${encodeURIComponent(doc.name)}"`
    );
    res.status(200).end(buffer);
  } catch (error) {
    next(error);
  }
};

/** Read a raw body for upload. The project has no multer; this is enough. */
const readRawBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        reject(createHttpError(413, `The file is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

/**
 * POST   /api/csd/restaurants/:storeId/documents          — upload (§31: admin + staff)
 * PUT    /api/csd/restaurants/:storeId/documents/:docId   — replace  (§31: admin + staff)
 *
 * Body is the raw file; name and category come from the query string, so no
 * multipart parsing is needed for a single file.
 */
const uploadDocument = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    await loadStore(storeId);

    const docId = str(req.params.docId);
    const replacing = !!docId;

    let existing = null;
    if (replacing) {
      if (!mongoose.Types.ObjectId.isValid(docId)) return next(createHttpError(400, "Invalid document id."));
      existing = await CsdStoreDocument.findOne({ _id: docId, storeId, isDeleted: false });
      if (!existing) return next(createHttpError(404, "Document not found."));
    }

    const category = str(req.query.category) || existing?.category || "Other Document";
    if (!CATEGORIES.includes(category)) return next(createHttpError(400, "Unknown document category."));

    const name = str(req.query.name) || existing?.name || "";
    if (!replacing && !name) return next(createHttpError(400, "Give the document a name."));

    const buffer = await readRawBody(req, storage.MAX_BYTES);

    let saved;
    try {
      saved = await storage.save({ buffer, storeId });
    } catch (err) {
      return next(createHttpError(400, err.message));
    }

    if (replacing) {
      const previousKey = existing.storageKey;
      existing.storageKey = saved.storageKey;
      existing.mimeType = saved.mimeType;
      existing.size = saved.size;
      existing.checksum = saved.checksum;
      existing.category = category;
      if (str(req.query.name)) existing.name = str(req.query.name);
      existing.replacedAt = new Date();
      existing.replacedByName = req.csdStaff.fullName;
      await existing.save();

      // Only drop the old bytes once the new row is safely persisted.
      await storage.remove(previousKey);

      await csdAudit({
        req, staff: req.csdStaff,
        action: "CSD_DOCUMENT_UPDATED",
        resource: "CsdStoreDocument", entityType: "CsdStoreDocument", entityId: existing._id, storeId,
        description: `${req.csdStaff.fullName} updated ${existing.category} for ${storeId}`,
      });

      return res.status(200).json({ success: true, data: shape(existing) });
    }

    const doc = await CsdStoreDocument.create({
      storeId,
      category,
      name,
      originalName: name,
      storageKey: saved.storageKey,
      mimeType: saved.mimeType,
      size: saved.size,
      checksum: saved.checksum,
      source: "upload",
      uploadedById: req.csdStaff._id,
      uploadedByStaffId: req.csdStaff.staffId,
      uploadedByName: req.csdStaff.fullName,
    });

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_DOCUMENT_UPLOADED",
      resource: "CsdStoreDocument", entityType: "CsdStoreDocument", entityId: doc._id, storeId,
      description: `${req.csdStaff.fullName} uploaded ${category} for ${storeId}`,
    });

    res.status(201).json({ success: true, data: shape(doc) });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/csd/restaurants/:storeId/documents/:docId — ADMIN ONLY (§31).
 *
 * The bytes are destroyed; the row is kept as a soft delete. These records
 * answer "was this restaurant licensed when we onboarded them?", so the fact
 * that a certificate existed and was removed, by whom and when, is itself
 * worth keeping.
 */
const deleteDocument = async (req, res, next) => {
  try {
    const storeId = str(req.params.storeId);
    const docId = str(req.params.docId);
    if (!mongoose.Types.ObjectId.isValid(docId)) return next(createHttpError(400, "Invalid document id."));

    const doc = await CsdStoreDocument.findOne({ _id: docId, storeId, isDeleted: false });
    if (!doc) return next(createHttpError(404, "Document not found."));

    await storage.remove(doc.storageKey);

    doc.isDeleted = true;
    doc.deletedAt = new Date();
    doc.deletedByName = req.csdStaff.fullName;
    doc.storageKey = ""; // nothing left to point at
    await doc.save();

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_DOCUMENT_DELETED",
      resource: "CsdStoreDocument", entityType: "CsdStoreDocument", entityId: doc._id, storeId,
      description: `${req.csdStaff.fullName} deleted ${doc.category} (${doc.name}) for ${storeId}`,
      previousValue: { name: doc.name, category: doc.category, size: doc.size },
      severity: "WARNING",
    });

    res.status(200).json({ success: true, data: { id: String(doc._id), deleted: true } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  importAgreementDocuments, listDocuments, downloadDocument, uploadDocument, deleteDocument,
};
