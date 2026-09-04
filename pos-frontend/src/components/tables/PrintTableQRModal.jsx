import React, { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { getStoreProperties } from "../../https";

/**
 * Print-Ready Table QR Card (§Manage Tables Module 2).
 *
 * Two things were wrong here:
 *
 *  1. The card printed the literal words "KnotKitchen Restaurant". The
 *     component expected a `restaurant` prop that Tables.jsx never passed, so
 *     the fallback was ALL anyone ever saw. It now reads the store's own name
 *     from Store Properties.
 *
 *  2. Printing called window.print() on the live page. The card is a fixed
 *     overlay inside the whole POS app, so what actually reached the printer
 *     depended on print: variants scattered across an app that has no global
 *     print stylesheet — the rest of the page came along, layout collapsed,
 *     and the QR canvas frequently came out blank.
 *
 *     Printing now builds a standalone document containing ONLY the card,
 *     with its own inline CSS and the QR exported from the canvas as a PNG,
 *     and prints that from a hidden iframe. What you see in the preview is
 *     what comes out, independent of the app's styles.
 */
const PrintTableQRModal = ({ isOpen, onClose, table }) => {
  const cardRef = useRef(null);

  // The store's real name. Cached, and harmless if it fails — the card simply
  // falls back to the table's own labelling rather than a made-up brand.
  const { data: propsRes } = useQuery({
    queryKey: ["store-properties"],
    queryFn: getStoreProperties,
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  if (!isOpen || !table) return null;

  const storeProps = propsRes?.data?.data || {};
  const restaurantName = storeProps.storeName || storeProps.name || "";
  const restaurantLogo = storeProps.logo || storeProps.branding?.logo || "";
  const tableDisplay = table.displayId || table.tableName || `Table ${table.tableNumber}`;
  const areaName = table.area || table.floor || "Main Hall";
  const qrUrl = table.qrCode || `${window.location.origin}/t/${table.qrToken || ""}`;

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /**
   * Print exactly the card, and nothing else.
   *
   * The QR is a <canvas>; canvases do not survive being copied as HTML, so it
   * is exported to a data URL and embedded as an <img>.
   */

  /**
   * Save the card as an image file.
   *
   * "Print QR Card" hands the card to the browser's print dialog, where the
   * only way to keep a copy is "Save as PDF" -- a PDF is what you got. This
   * draws the same card onto a canvas and downloads it directly.
   *
   * PNG rather than JPEG deliberately: JPEG's compression softens the hard
   * edges between QR modules, and a QR that scans on screen can fail once it
   * has been printed small. Drawn at 3x so it stays sharp on paper.
   */
  const handleDownloadImage = async () => {
    const qrCanvas = cardRef.current?.querySelector("canvas");

    const S = 3;                 // export scale
    const W = 360;               // card width in CSS px
    const PAD = 26;
    const cx = W / 2;            // horizontal centre

    // Optional logo. Loaded separately with CORS so a remote image cannot
    // taint the canvas and make toDataURL throw -- if it will not load we
    // simply fall back to the plate mark, rather than failing the download.
    const logo = await new Promise((resolve) => {
      if (!restaurantLogo) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = restaurantLogo;
    });

    // Measure first so the card is exactly as tall as its content.
    const logoH = logo ? 46 : 30;
    const nameH = restaurantName ? 26 : 0;
    const qrBox = 214;
    const H = PAD + logoH + nameH + 18 + 34 + 16 + qrBox + 30 + 26 + PAD;

    const c = document.createElement("canvas");
    c.width = W * S;
    c.height = H * S;
    const g = c.getContext("2d");
    g.scale(S, S);
    g.textAlign = "center";
    g.textBaseline = "middle";

    const roundRect = (x, y, w, h, r) => {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    };

    // Card ground + border, matching the preview.
    g.fillStyle = "#FFFFFF";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#FAFAFA";
    roundRect(1, 1, W - 2, H - 2, 16);
    g.fill();
    g.strokeStyle = "#0F172A";
    g.lineWidth = 2;
    g.stroke();

    let y = PAD;

    if (logo) {
      const h = 40;
      const w = Math.min(140, (logo.width / logo.height) * h || h);
      g.drawImage(logo, cx - w / 2, y, w, h);
      y += logoH;
    } else {
      g.font = "24px system-ui, sans-serif";
      g.fillText("\u{1F37D}\uFE0F", cx, y + 14);
      y += logoH;
    }

    if (restaurantName) {
      g.fillStyle = "#0F172A";
      g.font = "800 19px system-ui, -apple-system, Segoe UI, sans-serif";
      g.fillText(String(restaurantName).toUpperCase(), cx, y + 10);
      y += nameH;
    }

    g.fillStyle = "#64748B";
    g.font = "800 11px system-ui, sans-serif";
    g.fillText(String(areaName).toUpperCase(), cx, y + 8);
    y += 18;

    // Table pill.
    const pillText = String(tableDisplay).toUpperCase();
    g.font = "900 14px system-ui, sans-serif";
    const pillW = Math.min(W - 2 * PAD, g.measureText(pillText).width + 34);
    g.fillStyle = "#0F172A";
    roundRect(cx - pillW / 2, y, pillW, 30, 10);
    g.fill();
    g.fillStyle = "#FFFFFF";
    g.fillText(pillText, cx, y + 16);
    y += 34 + 16;

    // QR, in its white surround.
    g.fillStyle = "#FFFFFF";
    roundRect(cx - qrBox / 2, y, qrBox, qrBox, 14);
    g.fill();
    g.strokeStyle = "#E2E8F0";
    g.lineWidth = 2;
    g.stroke();
    if (qrCanvas) {
      const q = qrBox - 24;
      g.drawImage(qrCanvas, cx - q / 2, y + 12, q, q);
    } else {
      g.fillStyle = "#94A3B8";
      g.font = "700 11px system-ui, sans-serif";
      g.fillText("QR unavailable", cx, y + qrBox / 2);
    }
    y += qrBox + 22;

    g.fillStyle = "#C2410C";
    g.font = "900 11px system-ui, sans-serif";
    g.fillText("SCAN CODE TO VIEW MENU & ORDER", cx, y);
    y += 24;

    g.fillStyle = "#94A3B8";
    g.font = "700 10px system-ui, sans-serif";
    g.fillText("Powered by KnotKitchen", cx, y);

    const safe = String(tableDisplay).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const link = document.createElement("a");
    link.download = `knotkitchen-qr-${safe || "table"}.png`;
    link.href = c.toDataURL("image/png");
    link.click();
  };

  const handlePrint = () => {
    const canvas = cardRef.current?.querySelector("canvas");
    const qrImage = canvas ? canvas.toDataURL("image/png") : "";

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${esc(tableDisplay)} — QR Card</title>
    <style>
      @page { margin: 12mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body {
        margin: 0;
        font-family: "Plus Jakarta Sans", Inter, system-ui, -apple-system, sans-serif;
        display: flex; align-items: center; justify-content: center;
      }
      .card {
        width: 320px; border: 3px solid #0F172A; border-radius: 18px;
        padding: 26px 22px; text-align: center; background: #FAFAFA;
      }
      .logo { height: 46px; width: auto; object-fit: contain; margin-bottom: 6px; }
      .brand {
        margin: 0 0 4px; font-size: 19px; font-weight: 800; letter-spacing: -0.01em;
        color: #0F172A; text-transform: uppercase;
      }
      .area {
        margin: 0; font-size: 10px; font-weight: 800; color: #64748B;
        text-transform: uppercase; letter-spacing: 0.09em;
      }
      .table-pill {
        display: inline-block; margin: 16px 0 4px; padding: 8px 18px; border-radius: 11px;
        background: #0F172A; color: #fff; font-size: 13px; font-weight: 800;
        letter-spacing: 0.04em; text-transform: uppercase;
      }
      .qr-frame {
        margin: 14px auto 0; padding: 12px; width: max-content;
        background: #fff; border: 2px solid #E2E8F0; border-radius: 16px;
      }
      .qr-frame img { display: block; width: 176px; height: 176px; }
      .scan {
        margin: 14px 0 0; font-size: 11px; font-weight: 800; color: #FD5302;
        text-transform: uppercase; letter-spacing: 0.14em;
      }
      .footer { margin: 18px 0 0; font-size: 9px; font-weight: 700; color: #94A3B8; }
    </style>
  </head>
  <body>
    <div class="card">
      ${restaurantLogo ? `<img class="logo" src="${esc(restaurantLogo)}" alt="" />` : `<div style="font-size:26px">🍽️</div>`}
      ${restaurantName ? `<h2 class="brand">${esc(restaurantName)}</h2>` : ""}
      <p class="area">${esc(areaName)}</p>
      <div class="table-pill">${esc(tableDisplay)}</div>
      ${
        qrImage
          ? `<div class="qr-frame"><img src="${qrImage}" alt="QR code for ${esc(tableDisplay)}" /></div>`
          : `<p style="margin:20px 0;font-size:11px;color:#94A3B8;font-weight:700">QR unavailable — generate a QR token for this table first.</p>`
      }
      <p class="scan">Scan Code To View Menu &amp; Order</p>
      <p class="footer">Powered by KnotKitchen</p>
    </div>
  </body>
</html>`;

    // A hidden same-origin iframe, rather than window.open, so pop-up blockers
    // cannot silently swallow the print.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);

    const cleanup = () => {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    };

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return cleanup();
      const done = () => setTimeout(cleanup, 500);
      win.onafterprint = done;
      // The logo (if any) must be decoded before printing or it prints blank.
      const imgs = Array.from(win.document.images || []);
      const ready = imgs.length
        ? Promise.all(
            imgs.map((img) =>
              img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
            )
          )
        : Promise.resolve();
      ready.then(() => {
        win.focus();
        win.print();
        // Safari never fires onafterprint for an iframe.
        setTimeout(cleanup, 8000);
      });
    };

    frame.srcdoc = html;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <h3 className="text-sm font-extrabold text-[#0F172A]">Printable Table QR Card</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#475569] text-xl font-bold"
          >
            ×
          </button>
        </div>

        {/* Preview — this is what handlePrint reproduces */}
        <div
          ref={cardRef}
          className="rounded-2xl border-2 border-[#0F172A] p-6 text-center space-y-4 bg-[#FAFAFA]"
        >
          <div className="flex flex-col items-center gap-1.5">
            {restaurantLogo ? (
              <img src={restaurantLogo} alt="" className="h-12 w-auto object-contain mb-1" />
            ) : (
              <span className="text-2xl">🍽️</span>
            )}
            {restaurantName ? (
              <h2 className="text-lg font-black tracking-tight text-[#0F172A] uppercase">
                {restaurantName}
              </h2>
            ) : null}
            <p className="text-[11px] font-extrabold text-[#64748B] uppercase tracking-wider">
              {areaName}
            </p>
          </div>

          <div className="py-2 px-4 rounded-xl bg-[#0F172A] text-white inline-block">
            <span className="text-sm font-black tracking-wide uppercase">{tableDisplay}</span>
          </div>

          <div className="flex flex-col items-center justify-center py-3">
            <div className="p-3 bg-white rounded-2xl border-2 border-[#E2E8F0] shadow-sm">
              {qrUrl ? (
                <QRCodeCanvas
                  value={qrUrl}
                  size={176}
                  level="H"
                  includeMargin
                  aria-label={`QR code for ${tableDisplay}`}
                />
              ) : (
                <div className="w-44 h-44 flex items-center justify-center text-[11px] text-[#94A3B8] font-bold text-center">
                  QR unavailable — generate a QR token for this table first.
                </div>
              )}
            </div>
            <p className="mt-3 text-xs font-black text-[#C2410C] uppercase tracking-widest">
              Scan Code To View Menu &amp; Order
            </p>
          </div>

          <p className="text-[10px] text-[#94A3B8] font-bold">Powered by KnotKitchen</p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-[#E2E8F0] text-xs font-bold text-[#475569] hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDownloadImage}
            className="flex-1 py-2.5 rounded-xl border border-[#FD5302] text-[#C2410C] text-xs font-bold hover:bg-[#FFF1E8]"
          >
            ⬇ Download PNG
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 py-2.5 rounded-xl bg-[#FD5302] text-white text-xs font-bold hover:bg-[#D64502]"
          >
            🖨️ Print
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintTableQRModal;
