/**
 * One-off: store only WebP for photos uploaded before every upload was
 * converted (controllers/mediaController.js). Those originals -- mostly item
 * photos from before the WebP conversion, about half a megabyte each -- were
 * most of the uploads volume.
 *
 * For each media-library row that is not WebP, on local storage, whose file
 * nothing in the database points at (no dish, category, website or restaurant
 * setting, published menu copy or anything else): convert it the way an upload
 * is converted now, write the WebP beside it, point the library row at it,
 * then delete the original and its resized copies (`*.w320.webp` etc.). The
 * row stays, so the photo stays in the owner's library.
 *
 * A file something still points at is left as it is: changing it would mean
 * rewriting that reference too. They are listed.
 *
 * Reports only, unless told to apply. Safe to run again: a converted row is
 * WebP and is skipped.
 *
 *   node scripts/convertMediaToWebp.js           # what it would do
 *   node scripts/convertMediaToWebp.js --apply   # do it
 */
require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const config = require("../config/config");
const MediaAsset = require("../models/mediaAssetModel");
const { toWebp, optionsForFolder } = require("../services/imageCompress");

const APPLY = process.argv.includes("--apply");
// Collections whose text is history, not a live reference to a file.
const NOT_REFERENCES = new Set(["mediaassets", "auditlogs"]);

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/** Every document's JSON, per collection: the database is small, and this finds a key wherever it is nested. */
const loadReferences = async () => {
  const blobs = [];
  for (const { name } of await mongoose.connection.db.listCollections().toArray()) {
    if (NOT_REFERENCES.has(name)) continue;
    const parts = [];
    for await (const doc of mongoose.connection.db.collection(name).find({})) parts.push(JSON.stringify(doc));
    blobs.push({ name, text: parts.join("\n") });
  }
  return (key) => blobs.filter((b) => b.text.includes(key)).map((b) => b.name);
};

/** The original and the resized copies imageThumbnail made of it. */
const removeWithCopies = async (abs) => {
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  for (const name of await fs.readdir(dir)) {
    if (name === base || (name.startsWith(`${base}.w`) && name.endsWith(".webp"))) {
      await fs.unlink(path.join(dir, name));
    }
  }
};

(async () => {
  try {
    await mongoose.connect(config.databaseURI);
    const root = path.resolve(config.uploadsDir);
    const referencedFrom = await loadReferences();

    const rows = await MediaAsset.find({ isDeleted: { $ne: true }, mimeType: { $ne: "image/webp" } });
    let converted = 0;
    let before = 0;
    let after = 0;
    let failed = 0;
    const kept = [];

    for (const row of rows) {
      const label = `${row.storeId}/${row.folder} ${row.storageKey}`;
      if (row.provider && row.provider !== "local") {
        console.log(`  ↷ ${label} — on ${row.provider}, not local storage`);
        continue;
      }
      const abs = path.resolve(root, row.storageKey || "");
      if (!abs.startsWith(root + path.sep)) continue;
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) {
        console.log(`  ↷ ${label} — file missing`);
        continue;
      }
      const refs = referencedFrom(row.storageKey);
      if (refs.length) {
        kept.push({ label, size: stat.size, refs });
        continue;
      }

      try {
        const image = await toWebp(await fs.readFile(abs), optionsForFolder(row.folder));
        const storageKey = row.storageKey.replace(/\.[a-z0-9]+$/i, ".webp");
        before += stat.size;
        after += image.buffer.length;
        if (!APPLY) {
          console.log(`  + ${label} — WOULD convert ${mb(stat.size)} -> ${mb(image.buffer.length)}`);
          converted += 1;
          continue;
        }
        await fs.writeFile(path.join(root, storageKey), image.buffer);
        const url = String(row.url || "").replace(row.storageKey, storageKey);
        await MediaAsset.updateOne(
          { _id: row._id, storageKey: row.storageKey },
          {
            $set: {
              storageKey,
              url,
              thumbnailUrl: url,
              mimeType: image.mimeType,
              size: image.buffer.length,
              width: image.width,
              height: image.height,
              fileName: String(row.fileName || "photo").replace(/\.[a-z0-9]+$/i, "") + ".webp",
            },
          },
        );
        // Only once the row points at the WebP: a failure before this leaves the original in use.
        await removeWithCopies(abs);
        converted += 1;
        console.log(`  ✓ ${label} — ${mb(stat.size)} -> ${mb(image.buffer.length)}`);
      } catch (err) {
        failed += 1;
        console.error(`  ✗ ${label} — ${err.message}`);
      }
    }

    for (const k of kept) console.log(`  = ${k.label} — kept, in use (${k.refs.join(", ")}), ${mb(k.size)}`);
    console.log(
      `\n${APPLY ? "Converted" : "Would convert"} ${converted}: ${mb(before)} -> ${mb(after)}. ` +
        `Kept ${kept.length} in use. Failed ${failed}.${APPLY ? "" : " (report only; --apply to do it)"}`,
    );
    await mongoose.disconnect();
    process.exit(failed ? 1 : 0);
  } catch (error) {
    console.error("Conversion failed:", error);
    process.exit(1);
  }
})();
