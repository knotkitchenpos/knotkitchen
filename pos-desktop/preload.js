/**
 * What the POS page can see of the desktop app: window.knotDesktop.
 *
 * Only the POS origin gets answers (main.js checks the sender), and only
 * these calls exist. The chooser window uses the same preload for its own
 * two messages.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("knotDesktop", {
  /** Printers installed on this computer: [{ name, isDefault }]. */
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  /**
   * Print an HTML document with no dialog.
   * @param {string} html
   * @param {{printer?: string, paperMm?: number, heightMm?: number, copies?: number}} [options]
   */
  printHtml: (html, options) => ipcRenderer.invoke("printers:print", String(html || ""), options || {}),
  /**
   * Raw ESC/POS bytes to a LAN printer's port 9100; no data only checks that a printer answers.
   * @param {string} host  a private IPv4 address
   * @param {Uint8Array|null} [data]
   */
  printLan: (host, data) => ipcRenderer.invoke("printers:lan", String(host || ""), data || null),
});

// chooser.html only.
contextBridge.exposeInMainWorld("knotChooser", {
  onDevices: (fn) => ipcRenderer.on("chooser:devices", (_e, payload) => fn(payload)),
  pick: (id) => ipcRenderer.send("chooser:pick", id),
  cancel: () => ipcRenderer.send("chooser:cancel"),
});
