import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { enqueueSnackbar } from "notistack";
import { getStoreProperties, regenerateTableQr } from "../../https";
import { CARD, drawTableQrCard, qrFromSvg } from "../../utils/tableQrCard";
import { loadBitmap } from "../../utils/printReceipt";

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
 *     The card is now one image drawn at print size (utils/tableQrCard):
 *     the preview shows it, Download saves it and Print sends only it, from
 *     a hidden iframe, so what you see is what comes out.
 */
const PrintTableQRModal = ({ isOpen, onClose, table }) => {
  const queryClient = useQueryClient();
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  /**
   * Replace this table's QR, revoking the old one.
   *
   * The endpoint existed and the client wrapper existed, but nothing in the
   * UI ever called either -- so a QR card that leaked (photographed, or
   * printed and thrown away) could not be revoked from the POS at all. That
   * is what made an abused token permanent rather than momentary.
   */
  const regenerate = useMutation({
    mutationFn: () => regenerateTableQr(table?._id),
    onSuccess: () => {
      enqueueSnackbar("New QR generated. The previous code no longer works.", {
        variant: "success",
      });
      setConfirmingReplace(false);
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      onClose?.();
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Could not regenerate this QR.", {
        variant: "error",
      }),
  });

  // The store's real name. Cached, and harmless if it fails — the card simply
  // falls back to the table's own labelling rather than a made-up brand.
  const { data: propsRes } = useQuery({
    queryKey: ["store-properties"],
    queryFn: getStoreProperties,
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  const storeProps = propsRes?.data?.data || {};
  const restaurantName = storeProps.storeName || storeProps.name || "";
  // Store Properties sends it as restaurantLogo, the field receipts print; the
  // card read `logo` and so never had one.
  const restaurantLogo = storeProps.restaurantLogo || storeProps.logo || "";
  const tableDisplay = table ? table.displayId || table.tableName || `Table ${table.tableNumber}` : "";
  // The server's URL, not one built from this browser's address bar: the
  // short QR host is deployment configuration and the till is served from a
  // different hostname. Composing it here printed the POS's own hostname onto
  // the card. The origin remains the fallback for a deployment with no short
  // host configured.
  const qrUrl =
    table?.qrCode || (table?.qrToken ? `${window.location.origin}/t/${table.qrToken}` : "");

  // The card is drawn once, at print size (utils/tableQrCard), and that one
  // image is the preview, the PNG and what Print sends.
  const qrRef = useRef(null);
  const cardCanvas = useRef(null);
  const [card, setCard] = useState("");
  useEffect(() => {
    if (!isOpen || !table) return undefined;
    let alive = true;
    setCard("");
    (async () => {
      // Fetched like the receipt logo: an /uploads path resolves against the
      // API host, and a logo that will not load is left off rather than
      // failing the card.
      const logo = await loadBitmap(restaurantLogo);
      const canvas = drawTableQrCard({
        canvas: document.createElement("canvas"),
        logo,
        restaurantName,
        tableName: tableDisplay,
        qr: qrUrl ? qrFromSvg(qrRef.current) : null,
      });
      if (!alive) return;
      cardCanvas.current = canvas;
      setCard(canvas.toDataURL("image/png"));
    })();
    return () => {
      alive = false;
    };
  }, [isOpen, table, restaurantLogo, restaurantName, tableDisplay, qrUrl]);

  if (!isOpen || !table) return null;

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /**
   * Save the card as a PNG, at print resolution (A6, 300 dpi). PNG, not JPEG:
   * JPEG softens the edges between QR modules, and a QR that scans on screen
   * can fail once printed small.
   */
  const handleDownloadImage = () => {
    const canvas = cardCanvas.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const safe = String(tableDisplay).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `knotkitchen-qr-${safe || "table"}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, "image/png");
  };

  /** Print exactly the card, at its real A6 size, and nothing else. */
  const handlePrint = () => {
    if (!card) return;
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${esc(tableDisplay)} — QR Card</title>
    <style>
      @page { margin: 10mm; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { margin: 0; display: flex; align-items: flex-start; justify-content: center; }
      img { width: 105mm; height: 148.5mm; display: block; }
    </style>
  </head>
  <body><img src="${card}" alt="QR card for ${esc(tableDisplay)}" /></body>
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

        {/* Preview: the very image Download and Print use. */}
        <div className="rounded-2xl border border-[#E2E8F0] bg-[#F8F4EA] overflow-hidden">
          {card ? (
            <img src={card} alt={`QR card for ${tableDisplay}`} className="block w-full h-auto" />
          ) : (
            <div
              className="flex items-center justify-center text-[12px] font-bold text-[#94A3B8]"
              style={{ aspectRatio: `${CARD.width} / ${CARD.height}` }}
            >
              Preparing the card…
            </div>
          )}
          {/* The QR's outline, off screen: the card draws it from this at print size. */}
          {qrUrl ? <QRCodeSVG ref={qrRef} value={qrUrl} level="H" marginSize={4} style={{ display: "none" }} /> : null}
        </div>

        {/* Replace the code. Destructive to every printed copy, so it asks. */}
        {confirmingReplace ? (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 space-y-2.5">
            <p className="text-[12.5px] font-bold text-[#991B1B]">
              Replace this QR code?
            </p>
            <p className="text-[11.5px] text-[#B91C1C] leading-relaxed">
              The current code stops working immediately. Every printed card for
              this table must be replaced with the new one.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingReplace(false)}
                disabled={regenerate.isPending}
                className="flex-1 py-2 rounded-lg border border-[#E2E8F0] bg-white text-[12px] font-bold text-[#475569] disabled:opacity-60"
              >
                Keep current code
              </button>
              <button
                type="button"
                onClick={() => regenerate.mutate()}
                disabled={regenerate.isPending}
                className="flex-1 py-2 rounded-lg bg-[#DC2626] text-white text-[12px] font-bold disabled:opacity-60"
              >
                {regenerate.isPending ? "Replacing…" : "Replace it"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingReplace(true)}
            className="w-full py-2 rounded-xl border border-[#E2E8F0] text-[11.5px] font-bold text-[#64748B] hover:border-[#FECACA] hover:text-[#B91C1C]"
          >
            Replace QR code (revokes the current one)
          </button>
        )}

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
            disabled={!card}
            className="flex-1 disabled:opacity-50 py-2.5 rounded-xl border border-[#FD5302] text-[#C2410C] text-xs font-bold hover:bg-[#FFF1E8]"
          >
            ⬇ Download PNG
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!card}
            className="flex-1 disabled:opacity-50 py-2.5 rounded-xl bg-[#FD5302] text-white text-xs font-bold hover:bg-[#D64502]"
          >
            🖨️ Print
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintTableQRModal;
