/**
 * KnotKitchen POS for Windows.
 *
 * Same idea as the Android app (pos-frontend/capacitor.config.ts): a shell
 * around the live POS at business.knotkitchen.com, so every deploy reaches
 * the counter with no reinstall. What a browser cannot do on a Windows
 * counter is done here:
 *
 *   - print a receipt silently through the printer the driver installed,
 *     with no dialog (window.knotDesktop.printHtml, see preload.js)
 *   - list those printers so Device Configuration can pick one
 *   - answer Web Bluetooth / WebUSB / Web Serial device pickers, which
 *     Electron has no UI for (chooser.html)
 *   - keep the display awake while the POS is open
 *
 * Nothing of the POS itself lives here. If the POS cannot be reached the
 * window shows offline.html.
 */

const path = require("path");
const fs = require("fs");
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  powerSaveBlocker,
  shell,
} = require("electron");

const POS_URL = process.env.KK_POS_URL || "https://business.knotkitchen.com/";
const POS_ORIGIN = new URL(POS_URL).origin;
const SMOKE = process.argv.includes("--smoke");

// One POS window per computer. A second launch focuses the first.
if (!app.requestSingleInstanceLock()) app.quit();

/* ------------------------------------------------------------ window state */

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

const loadState = () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
};

const saveState = (win) => {
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    /* a lost window position is not worth an error */
  }
};

/* ------------------------------------------------------------ device pickers */

/**
 * Electron fires these events instead of showing a picker. The POS uses
 * navigator.bluetooth.requestDevice / navigator.usb.requestDevice /
 * navigator.serial.requestPort for receipt printers, so a small window lists
 * what was found and the operator clicks one.
 *
 * Bluetooth keeps firing as more devices are discovered; the list window is
 * updated in place and the callback is answered once.
 */
let chooser = null; // { win, kind, answer, devices }

const openChooser = (parent, kind, devices, answer) => {
  if (chooser && chooser.kind === kind && !chooser.win.isDestroyed()) {
    chooser.devices = devices;
    chooser.answer = answer;
    chooser.win.webContents.send("chooser:devices", { kind, devices });
    return;
  }
  closeChooser("");
  const win = new BrowserWindow({
    parent,
    modal: true,
    width: 420,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: kind === "bluetooth" ? "Choose a Bluetooth printer" : kind === "usb" ? "Choose a USB printer" : "Choose a port",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  chooser = { win, kind, answer, devices };
  win.loadFile(path.join(__dirname, "chooser.html"));
  win.webContents.on("did-finish-load", () => win.webContents.send("chooser:devices", { kind, devices }));
  win.on("closed", () => {
    // Closing the window without a pick cancels the request in the page.
    if (chooser && chooser.win === win) {
      const { answer } = chooser;
      chooser = null;
      try {
        answer("");
      } catch {
        /* already answered */
      }
    }
  });
};

const closeChooser = (deviceId) => {
  if (!chooser) return;
  const { win, answer } = chooser;
  chooser = null;
  try {
    answer(deviceId);
  } catch {
    /* already answered */
  }
  if (!win.isDestroyed()) win.close();
};

ipcMain.on("chooser:pick", (_e, deviceId) => closeChooser(String(deviceId || "")));
ipcMain.on("chooser:cancel", () => closeChooser(""));

const wireDevicePickers = (win) => {
  const wc = win.webContents;

  wc.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    openChooser(
      win,
      "bluetooth",
      devices.map((d) => ({ id: d.deviceId, name: d.deviceName || "Unnamed device" })),
      callback,
    );
  });

  wc.session.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    const devices = (details.deviceList || []).map((d) => ({
      id: d.deviceId,
      name: d.productName || `USB ${Number(d.vendorId).toString(16)}:${Number(d.productId).toString(16)}`,
    }));
    openChooser(win, "usb", devices, callback);
  });

  wc.session.on("select-serial-port", (event, portList, _webContents, callback) => {
    event.preventDefault();
    const devices = (portList || []).map((p) => ({ id: p.portId, name: p.displayName || p.portName || p.portId }));
    openChooser(win, "serial", devices, callback);
  });

  // getDevices() / getPorts() after a pick, without asking again.
  wc.session.setDevicePermissionHandler((details) => details.origin === POS_ORIGIN);
  wc.session.setPermissionCheckHandler((_wc, permission, origin) => {
    if (["usb", "serial", "hid", "bluetooth"].includes(permission)) return origin === POS_ORIGIN;
    return true;
  });
  wc.session.setPermissionRequestHandler((_wc, _permission, callback, details) => {
    const origin = details?.requestingUrl ? new URL(details.requestingUrl).origin : "";
    callback(origin === POS_ORIGIN);
  });
};

/* ---------------------------------------------------------------- printing */

/** The printers Windows knows about: [{ name, isDefault }]. */
const listPrinters = async (wc) => {
  const printers = await wc.getPrintersAsync();
  return printers.map((p) => ({ name: p.name, isDefault: Boolean(p.isDefault), status: p.status }));
};

/**
 * Print an HTML document silently to a named printer (or the default one).
 *
 * The POS renders the receipt to an image at the paper's width and wraps it
 * in HTML (pos-frontend/src/utils/printReceipt.js), so all this has to do is
 * hand it to the driver with the right paper width and no margins. The page
 * height follows the receipt so a roll printer does not feed a full A4.
 */
const printHtml = (html, { printer = "", paperMm = 80, heightMm = 0, copies = 1 } = {}) =>
  new Promise((resolve, reject) => {
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    const done = (err) => {
      if (!win.isDestroyed()) win.destroy();
      err ? reject(err) : resolve(true);
    };
    const timer = setTimeout(() => done(new Error("Printing timed out.")), 30000);

    win.webContents.once("did-finish-load", () => {
      const widthMicrons = Math.max(20, Number(paperMm) || 80) * 1000;
      const heightMicrons = Math.max(30, (Number(heightMm) || 0) + 8) * 1000;
      win.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printer || undefined,
          copies: Math.min(5, Math.max(1, Number(copies) || 1)),
          margins: { marginType: "none" },
          pageSize: { width: widthMicrons, height: heightMicrons },
        },
        (ok, reason) => {
          clearTimeout(timer);
          done(ok ? null : new Error(reason || "The printer refused the job."));
        },
      );
    });
    win.webContents.once("did-fail-load", (_e, _code, desc) => {
      clearTimeout(timer);
      done(new Error(desc || "Could not load the receipt."));
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(html || ""))}`);
  });

const trusted = (event) => {
  try {
    return new URL(event.senderFrame.url).origin === POS_ORIGIN;
  } catch {
    return false;
  }
};

ipcMain.handle("printers:list", (event) => (trusted(event) ? listPrinters(event.sender) : []));
ipcMain.handle("printers:print", (event, html, options) => {
  if (!trusted(event)) throw new Error("Not allowed.");
  return printHtml(html, options || {});
});

/* ------------------------------------------------------------------ updates */

/**
 * The POS pages update on every deploy; this updates the app around them.
 * Feed: the desktop-latest GitHub release (package.json build.publish), filled
 * by .github/workflows/build-windows-app.yml. A till stays open all day, so it
 * checks every few hours and offers a restart; "Later" installs silently the
 * next time the app is closed.
 */
const UPDATE_EVERY_MS = 4 * 60 * 60 * 1000;

const startUpdates = () => {
  if (!app.isPackaged) return;
  // Required here: reading autoUpdater builds the updater, which smoke runs never need.
  const { autoUpdater } = require("electron-updater");
  // An 'error' with no listener throws. Offline, or nothing published yet, is not worth a dialog.
  autoUpdater.on("error", (e) => console.error("update:", e?.message || e));
  let asking = false;
  autoUpdater.on("update-downloaded", async ({ version }) => {
    if (asking || !main) return;
    asking = true;
    const { response } = await dialog.showMessageBox(main, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `KnotKitchen POS ${version} is ready to install.`,
      detail: "Restart now (about 10 seconds), or it installs the next time the app is closed.",
    });
    asking = false;
    if (response === 0) autoUpdater.quitAndInstall(true, true); // silent, and reopen
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {}); // reported by 'error'
  check();
  setInterval(check, UPDATE_EVERY_MS);
};

/* ------------------------------------------------------------------- window */

let main = null;

const createWindow = () => {
  const state = loadState();
  main = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width || 1280,
    height: state.height || 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#080F1F",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    title: "KnotKitchen POS",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (state.maximized) main.maximize();

  wireDevicePickers(main);

  // Links that leave the POS (payment pages, the customer website, help)
  // open in the computer's browser, not inside the till.
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(POS_ORIGIN) || url.startsWith("about:blank")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  main.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    // -3 is ABORTED: a navigation we replaced ourselves, not a failure.
    if (!isMainFrame || code === -3) return;
    main.loadFile(path.join(__dirname, "offline.html"), { query: { back: url || POS_URL } });
  });

  main.on("resize", () => saveState(main));
  main.on("move", () => saveState(main));
  main.on("close", () => saveState(main));
  main.on("closed", () => {
    main = null;
  });

  main.loadURL(POS_URL);
};

const buildMenu = () => {
  const template = [
    {
      label: "POS",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => main && main.loadURL(POS_URL) },
        { label: "Full screen", accelerator: "F11", click: () => main && main.setFullScreen(!main.isFullScreen()) },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About KnotKitchen POS",
          click: () =>
            dialog.showMessageBox(main, {
              type: "info",
              title: "KnotKitchen POS",
              message: `KnotKitchen POS ${app.getVersion()}`,
              detail: `Loads ${POS_URL}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
            }),
        },
        { label: "Open in browser", click: () => shell.openExternal(POS_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

app.on("second-instance", () => {
  if (!main) return;
  if (main.isMinimized()) main.restore();
  main.focus();
});

app.whenReady().then(async () => {
  if (SMOKE) {
    // CI / local check: the app boots, can talk to the print spooler, exits.
    const win = new BrowserWindow({ show: false });
    const printers = await listPrinters(win.webContents).catch((e) => ({ error: e.message }));
    process.stdout.write(`${JSON.stringify({ version: app.getVersion(), printers })}\n`);
    app.exit(0);
    return;
  }
  // The till is watched all day; Windows must not blank it mid-service.
  powerSaveBlocker.start("prevent-display-sleep");
  buildMenu();
  createWindow();
  startUpdates();
});

app.on("window-all-closed", () => app.quit());

// Only the POS origin may be loaded in the main window.
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (url.startsWith(POS_ORIGIN) || url.startsWith("file:") || url.startsWith("data:")) return;
    event.preventDefault();
    shell.openExternal(url);
  });
});
