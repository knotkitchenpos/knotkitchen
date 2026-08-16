import React, { useCallback, useEffect, useRef, useState } from "react";
import { listMedia, uploadMedia, deleteMedia } from "../../https/storefrontApi";

/**
 * Media Library (§6, §7).
 *
 * Doubles as a manager and a picker:
 *   <MediaLibrary />                          → management view
 *   <MediaLibrary mode="picker" onSelect .../> → "Choose Existing Image"
 *
 * The picker is what fulfils the image-reuse requirement: an employee uploads
 * burger.jpg once and can then attach it to any number of products without
 * re-uploading.
 */
const MediaLibrary = ({ mode = "manage", folder, onSelect, onClose }) => {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listMedia({ search: search || undefined, folder, limit: 60 });
      setAssets(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't load your media library.");
    } finally {
      setLoading(false);
    }
  }, [search, folder]);

  // Debounced so typing in the search box doesn't hammer the API.
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Client-side pre-checks for fast feedback; the server re-validates the
    // real bytes regardless.
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be 5MB or smaller.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }

    try {
      setUploading(true);
      setError("");
      const res = await uploadMedia(file, { folder: folder || "general" });
      const asset = res.data.data;
      setAssets((prev) => [asset, ...prev]);
      if (mode === "picker") onSelect?.(asset);
    } catch (err) {
      setError(err.response?.data?.message || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (asset) => {
    if (!window.confirm(`Delete "${asset.fileName}"? Products using it will lose their image.`)) return;
    try {
      await deleteMedia(asset._id);
      setAssets((prev) => prev.filter((a) => a._id !== asset._id));
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't delete this image.");
    }
  };

  const grid = (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search images…"
          aria-label="Search media library"
          className="flex-1 min-w-[180px] px-4 py-2 rounded-xl bg-[#111B2E] border border-[#26344B] text-sm text-[#F5F7FA] focus:outline-none focus:border-accent"
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          onChange={handleUpload}
          className="hidden"
          id="media-upload-input"
        />
        <label
          htmlFor="media-upload-input"
          className={`px-4 py-2 rounded-xl font-semibold text-sm cursor-pointer transition-colors ${
            uploading ? "bg-slate-600 text-slate-300" : "bg-accent text-white hover:opacity-90"
          }`}
        >
          {uploading ? "Uploading…" : "⬆ Upload Image"}
        </label>
      </div>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-400 bg-red-500/10 p-2 rounded-lg">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="aspect-square rounded-xl bg-[#162238] animate-pulse" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-2" aria-hidden="true">🖼️</div>
          <p className="text-[#AEB8CA] font-medium">No images yet</p>
          <p className="text-sm text-[#77839A] mt-1">
            Upload your first image to use it on products and your website.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {assets.map((asset) => (
            <div
              key={asset._id}
              className="group relative aspect-square rounded-xl overflow-hidden border border-[#26344B] bg-[#111B2E]"
            >
              <img
                src={asset.thumbnailUrl || asset.url}
                alt={asset.altText || asset.fileName}
                loading="lazy"
                className="w-full h-full object-cover"
              />

              <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                <p className="text-[10px] text-white/80 text-center truncate w-full" title={asset.fileName}>
                  {asset.fileName}
                </p>
                <p className="text-[10px] text-white/50">
                  {asset.width}×{asset.height}
                </p>

                {mode === "picker" ? (
                  <button
                    type="button"
                    onClick={() => onSelect?.(asset)}
                    className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold"
                  >
                    Select
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDelete(asset)}
                    className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-semibold"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  // Picker renders inside a modal; manage view renders inline.
  if (mode === "picker") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <div className="w-full max-w-3xl max-h-[85vh] flex flex-col bg-[#0D1526] border border-[#26344B] rounded-2xl overflow-hidden">
          <div className="shrink-0 flex items-center justify-between p-4 border-b border-[#26344B]">
            <h2 className="font-bold text-[#F5F7FA]">Select an Image</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-lg hover:bg-[#162238] text-[#AEB8CA]"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">{grid}</div>
        </div>
      </div>
    );
  }

  return <div>{grid}</div>;
};

export default MediaLibrary;
