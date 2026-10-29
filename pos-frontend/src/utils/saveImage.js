import { Capacitor, registerPlugin } from "@capacitor/core";
import { enqueueSnackbar } from "./notify";

/**
 * Save a canvas as a PNG file.
 *
 * In a browser: an <a download> link, as it always was. In the phone and
 * tablet app that does nothing (a WebView ignores downloads), so the app's
 * own FileSave plugin saves it (android/.../FileSavePlugin.java): into
 * Pictures/KnotKitchen on Android 10+, through the share sheet on 6-9. An app
 * installed before FileSave existed says to update instead of doing nothing.
 */
const FileSave = registerPlugin("FileSave");

const UPDATE_APP = "Update the KnotKitchen app to download files. ";

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Save any file (the menu CSV). A browser downloads it; the app saves it into
 * Downloads/KnotKitchen (FileSave.saveFile, Android 10+) or offers the share
 * sheet. An app from before saveFile (1.0.185) says to update.
 */
export const saveBlob = async (blob, fileName) => {
  if (!blob) return;
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = fileName;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  if (!Capacitor.isPluginAvailable("FileSave")) {
    enqueueSnackbar(UPDATE_APP + "Or export from a computer.", { variant: "warning" });
    return;
  }
  try {
    const data = await blobToBase64(blob);
    const res = await FileSave.saveFile({ data, fileName, mimeType: blob.type || "application/octet-stream" });
    if (res?.saved) enqueueSnackbar(`Saved to ${res.location}.`, { variant: "success", important: true });
  } catch (err) {
    const old = err?.code === "UNIMPLEMENTED" || /not implemented/i.test(err?.message || "");
    enqueueSnackbar(old ? UPDATE_APP + "Or export from a computer." : err?.message || "The file could not be saved.", {
      variant: old ? "warning" : "error",
    });
  }
};

export const saveCanvasPng = async (canvas, fileName) => {
  if (!canvas) return;

  if (!Capacitor.isNativePlatform()) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = fileName;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, "image/png");
    return;
  }

  if (!Capacitor.isPluginAvailable("FileSave")) {
    enqueueSnackbar("Update the KnotKitchen app to download images. Print works now.", { variant: "warning" });
    return;
  }
  try {
    const data = canvas.toDataURL("image/png").split(",")[1];
    const res = await FileSave.saveImage({ data, fileName, mimeType: "image/png" });
    // The share sheet is its own feedback; a silent save is not.
    if (res?.saved) enqueueSnackbar(`Saved to ${res.location}.`, { variant: "success", important: true });
  } catch (err) {
    enqueueSnackbar(err?.message || "The image could not be saved.", { variant: "error" });
  }
};
