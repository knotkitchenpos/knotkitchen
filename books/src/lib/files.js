// Bill photos and PDFs. Picked offline, they wait in IndexedDB until sync uploads them.
import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { api } from "./api.js";

const db = () =>
  new Promise((res, rej) => {
    const r = indexedDB.open("kkbooks", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction("files", mode);
    const req = fn(t.objectStore("files"));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
};
export const savePendingFile = (key, blob) => tx("readwrite", (s) => s.put(blob, key));
export const pendingFile = (key) => tx("readonly", (s) => s.get(key));
export const dropPendingFile = (key) => tx("readwrite", (s) => s.delete(key));

// Photos are shrunk to 1600px JPEG: readable, and small on mobile data.
const shrink = (blob) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob((b) => resolve(b || blob), "image/jpeg", 0.75);
    };
    img.onerror = () => resolve(blob);
    img.src = URL.createObjectURL(blob);
  });

export const takePhoto = async () => {
  if (!Capacitor.isNativePlatform()) return null;
  const p = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Camera, quality: 80, width: 1600 });
  const blob = await (await fetch(p.webPath)).blob();
  return { blob: await shrink(blob), name: `bill.${p.format || "jpg"}` };
};

export const fromFileInput = async (file) => {
  if (!file) return null;
  if (file.type === "application/pdf") {
    // The server takes up to 12 MB (Caddy and the route both cap it).
    if (file.size > 12 * 1024 * 1024) throw new Error("That PDF is over 12 MB. Use a photo or a smaller PDF.");
    return { blob: file, name: file.name };
  }
  if (file.type.startsWith("image/")) return { blob: await shrink(file), name: file.name };
  throw new Error("Choose a photo or a PDF.");
};

// Try to upload now; if offline, keep it for sync.
export const storeReceipt = async ({ blob, name }) => {
  try {
    const up = await api("/files", { method: "POST", raw: blob });
    return { id: up.id, type: up.type, name };
  } catch (err) {
    if (err.status) throw err;
    const key = `p${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
    await savePendingFile(key, blob);
    return { pending: key, type: blob.type, name };
  }
};

export const receiptBlob = async (receipt) => (receipt?.pending ? pendingFile(receipt.pending) : api(`/files/${encodeURIComponent(receipt.id)}`));
