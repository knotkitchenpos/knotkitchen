# KnotKitchen POS for Windows

An Electron shell around the live POS at `https://business.knotkitchen.com`, the
same way the Android app wraps it. Every deploy of `pos-frontend` reaches the
counter with no reinstall.

What the shell adds over a browser:

- **Silent receipt printing** through the printer's Windows driver. Settings ›
  Device Configuration lists the installed printers; pick one and receipts and
  Auto Receipt Print go straight to it, no dialog. (`window.knotDesktop.printHtml`)
- Device pickers for Web Bluetooth / WebUSB / Web Serial printers (`chooser.html`).
- Keeps the display awake, remembers the window size, opens outside links in
  the computer's browser, shows `offline.html` when the POS cannot be reached.

## Build

```bash
cd pos-desktop
npm ci
npm run smoke    # boots, lists printers, exits
npm run dist     # dist/KnotKitchen-POS-Setup-<version>.exe
```

GitHub Actions: **Build Windows App** runs on every push touching this folder and
uploads the installer as the `knotkitchen-pos-windows` artifact:

```bash
gh run download <run-id> -n knotkitchen-pos-windows
```

The installer is unsigned, so Windows SmartScreen warns on first run
("More info" › "Run anyway"). Adding the `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` repository secrets (a code-signing certificate) removes
that with no other change.

## Pointing at another POS

`KK_POS_URL=http://localhost:5173 npm start` loads a local dev server instead.
