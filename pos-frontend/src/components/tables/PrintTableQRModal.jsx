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
            onClick={handlePrint}
            className="flex-1 py-2.5 rounded-xl bg-[#FD5302] text-white text-xs font-bold hover:bg-[#D64502]"
          >
            🖨️ Print QR Card
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintTableQRModal;
