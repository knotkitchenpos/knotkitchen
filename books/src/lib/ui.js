// Small UI helpers: escaping, bottom sheets, toasts, confirm, sharing files.
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// Every piece of user text goes through esc() before it reaches innerHTML.
export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const uid = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

export const toast = (msg, ms = 2600) => {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
};

// Closing a sheet ourselves pops its history entry; the sheet under it must not take that as Back.
let skipPop = 0;
const openSheets = [];
window.addEventListener("popstate", () => {
  if (skipPop > 0) skipPop--;
  else openSheets.at(-1)?.();
});

/**
 * A bottom sheet. `body` is HTML (already escaped). onSave(bodyEl) may return
 * false (or a promise of false) to keep the sheet open. Returns close().
 */
export const openSheet = ({ title, body, full = true, saveLabel = "Save", onSave, onMount, onClose, actions = [] }) => {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const sheet = document.createElement("div");
  sheet.className = `sheet${full ? " full" : ""}`;
  sheet.innerHTML = `
    <header><h3>${esc(title)}</h3><button type="button" data-close>Close</button></header>
    <div class="body">${body}</div>
    ${onSave || actions.length ? `<footer>${actions.map((a, i) => `<button type="button" class="btn ${a.cls || ""}" data-act="${i}">${esc(a.label)}</button>`).join("")}${onSave ? `<button type="button" class="btn primary" data-save>${esc(saveLabel)}</button>` : ""}</footer>` : ""}`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scrim.remove();
    sheet.remove();
    openSheets.splice(openSheets.indexOf(close), 1);
    onClose?.();
    // The screen behind skips redraws while a sheet is open; it catches up now.
    if (!openSheets.length) window.dispatchEvent(new Event("sheets-closed"));
  };
  // Android back button closes the top sheet.
  history.pushState({ sheet: true }, "");
  openSheets.push(close);
  const closeAndBack = () => {
    if (closed) return;
    close();
    if (history.state?.sheet) {
      skipPop++;
      history.back();
    }
  };
  scrim.onclick = closeAndBack;
  sheet.querySelector("[data-close]").onclick = closeAndBack;
  const bodyEl = sheet.querySelector(".body");
  sheet.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => actions[Number(b.dataset.act)].onClick(closeAndBack, bodyEl)));
  const save = sheet.querySelector("[data-save]");
  if (save) {
    save.onclick = async () => {
      save.disabled = true;
      try {
        if ((await onSave(bodyEl)) !== false) closeAndBack();
      } catch (err) {
        toast(err.message || "Could not save");
      } finally {
        save.disabled = false;
      }
    };
  }
  document.body.append(scrim, sheet);
  onMount?.(bodyEl, closeAndBack);
  return closeAndBack;
};

export const confirmBox = (message, yes = "Delete") =>
  new Promise((resolve) => {
    let answer = false;
    openSheet({
      title: "Are you sure?",
      full: false,
      body: `<p>${esc(message)}</p>`,
      onClose: () => resolve(answer),
      actions: [
        { label: "Cancel", onClick: (c) => c() },
        { label: yes, cls: "danger", onClick: (c) => { answer = true; c(); } },
      ],
    });
  });

// Field helpers for forms inside a sheet.
export const field = (label, name, value = "", attrs = "") =>
  `<label class="f"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;
export const select = (label, name, options, value) =>
  `<label class="f"><span>${esc(label)}</span><select name="${name}">${options
    .map((o) => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(t)}</option>`;
    })
    .join("")}</select></label>`;
export const check = (label, name, on) => `<label class="check"><input type="checkbox" name="${name}"${on ? " checked" : ""}> ${esc(label)}</label>`;
export const val = (root, name) => root.querySelector(`[name="${name}"]`)?.value?.trim() ?? "";
export const checked = (root, name) => !!root.querySelector(`[name="${name}"]`)?.checked;

const toBase64 = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

// Share a generated file (PDF/CSV/JSON): the share sheet on the phone, a download in a browser.
export const shareFile = async (filename, blob, title) => {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Cache });
    await Share.share({ title: title || filename, files: [uri] });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
