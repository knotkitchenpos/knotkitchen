import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FiFile, FiUploadCloud, FiEye, FiRefreshCw, FiTrash2, FiX, FiDownload, FiAlertTriangle,
} from "react-icons/fi";
import { restaurants as api, errorMessage } from "../api";
import { dt } from "../lib/format";

const kb = (n) => {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};


/** Preview modal. Fetches through the authenticated route, never a raw URL. */
const PreviewModal = ({ storeId, doc, onClose }) => {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let revoked = null;
    api.documentBlobUrl(storeId, doc.id)
      .then((u) => { revoked = u; setUrl(u); })
      .catch((err) => setError(errorMessage(err, "Could not open this document.")));
    // Release the object URL so the bytes don't linger in memory.
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [storeId, doc.id]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPdf = doc.mimeType === "application/pdf";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={doc.name} onClick={(e) => e.stopPropagation()}
        className="flex h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-navy-200 p-4">
          <div className="min-w-0">
            <h3 className="truncate font-bold text-navy-900">{doc.name}</h3>
            <p className="text-xs text-navy-500">{doc.category} · {doc.fileType} · {kb(doc.size)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {url && (
              <a href={url} download={doc.name}
                className="rounded-lg border border-navy-300 p-2 text-navy-600 hover:bg-navy-50"
                aria-label="Download">
                <FiDownload size={16} />
              </a>
            )}
            <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
              <FiX size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto bg-navy-50 p-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!url && !error && <p className="text-sm text-navy-500">Loading…</p>}
          {url && (isPdf
            ? <iframe src={url} title={doc.name} className="h-full w-full rounded-lg bg-white" />
            : <img src={url} alt={doc.name} className="mx-auto max-h-full rounded-lg" />)}
        </div>
      </div>
    </div>
  );
};

const StoreDocuments = ({ storeId }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const uploadRef = useRef(null);
  const replaceRef = useRef(null);
  const replacingId = useRef(null);

  const load = useCallback(async () => {
    try {
      setData(await api.documents(storeId));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Could not load documents."));
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      await api.uploadDocument(storeId, { file, name: file.name, category: "Other Document" });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not upload that file."));
    } finally {
      setBusy("");
    }
  };

  const onReplace = async (e) => {
    const file = e.target.files?.[0];
    const docId = replacingId.current;
    e.target.value = "";
    if (!file || !docId) return;
    setBusy(docId);
    setError("");
    try {
      await api.replaceDocument(storeId, docId, { file, name: file.name });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not update that document."));
    } finally {
      setBusy("");
      replacingId.current = null;
    }
  };

  const doDelete = async (doc) => {
    setBusy(doc.id);
    setError("");
    try {
      await api.deleteDocument(storeId, doc.id);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Could not delete that document."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="rounded-2xl border border-navy-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-navy-700">
          Stored images &amp; documents
        </h2>
        <button type="button" onClick={() => uploadRef.current?.click()} disabled={busy === "upload"}
          className="inline-flex items-center gap-1.5 rounded-xl border border-navy-300 px-3 py-1.5 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50">
          <FiUploadCloud size={13} aria-hidden="true" /> {busy === "upload" ? "Uploading…" : "Upload"}
        </button>
        <input ref={uploadRef} type="file" onChange={onUpload} className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" />
        <input ref={replaceRef} type="file" onChange={onReplace} className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" />
      </div>

      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-navy-500">Loading documents…</p>}

      {data && data.documents.length === 0 && (
        <p className="rounded-xl border border-dashed border-navy-300 p-6 text-center text-sm text-navy-500">
          No documents yet. Documents uploaded during the sales agreement are imported automatically
          when a store is created from it.
        </p>
      )}

      {data && data.documents.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.documents.map((d) => (
            <li key={d.id} className="rounded-xl border border-navy-200 p-3.5">
              <div className="flex items-start gap-3">
                <FiFile className="mt-0.5 shrink-0 text-navy-400" size={18} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-navy-900" title={d.name}>{d.name}</p>
                  <p className="text-xs text-navy-500">{d.category}</p>
                  <p className="mt-1 text-[11px] text-navy-400">
                    {d.fileType} · {kb(d.size)}
                    {d.source === "agreement" && (
                      <span className="ml-1.5 rounded bg-navy-100 px-1.5 py-0.5 text-navy-600">
                        from agreement
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-navy-400">
                    Uploaded {dt(d.uploadedAt)}
                    {d.uploadedByName ? ` by ${d.uploadedByName}` : ""}
                  </p>
                  {d.replacedByName && (
                    <p className="text-[11px] text-navy-400">
                      Updated {dt(d.lastUpdatedAt)} by {d.replacedByName}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setPreview(d)}
                  className="inline-flex items-center gap-1 rounded-lg border border-navy-300 px-2.5 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50">
                  <FiEye size={12} aria-hidden="true" /> Quick view
                </button>
                <button type="button" disabled={busy === d.id}
                  onClick={() => { replacingId.current = d.id; replaceRef.current?.click(); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-navy-300 px-2.5 py-1 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50">
                  <FiRefreshCw size={12} aria-hidden="true" /> {busy === d.id ? "Working…" : "Update"}
                </button>
                {/* §31 — delete is admin-only. Hidden rather than shown and
                    refused; the server enforces it either way. */}
                {data.canDelete && (
                  <button type="button" onClick={() => setConfirmDelete(d)}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">
                    <FiTrash2 size={12} aria-hidden="true" /> Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && !data.canDelete && data.documents.length > 0 && (
        <p className="mt-3 text-xs text-navy-400">
          Only an administrator can delete a document.
        </p>
      )}

      {preview && <PreviewModal storeId={storeId} doc={preview} onClose={() => setPreview(null)} />}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <FiAlertTriangle className="mt-0.5 shrink-0 text-red-600" size={22} aria-hidden="true" />
              <div>
                <h3 className="text-lg font-bold text-navy-900">Delete this document?</h3>
                <p className="mt-1 text-sm text-navy-600">
                  <strong>{confirmDelete.name}</strong> ({confirmDelete.category}) will be permanently
                  removed. The record that it existed, and who deleted it, is kept in the activity log.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirmDelete(null)} disabled={busy === confirmDelete.id}
                className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
                Cancel
              </button>
              <button type="button" onClick={() => doDelete(confirmDelete)} disabled={busy === confirmDelete.id}
                className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
                {busy === confirmDelete.id ? "Deleting…" : "Delete document"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default StoreDocuments;
