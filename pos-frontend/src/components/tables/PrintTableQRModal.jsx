import React from "react";
import { useSelector } from "react-redux";
import { QRCodeCanvas } from "qrcode.react";

/**
 * Print-Ready Table QR Card Component (§Manage Tables Module 2).
 * Renders an elegant, printable table QR card with restaurant branding.
 * Does NOT expose internal database IDs or sensitive credentials.
 */
const PrintTableQRModal = ({ isOpen, onClose, table, restaurant }) => {
  if (!isOpen || !table) return null;

  const restaurantName = restaurant?.name || "KnotKitchen Restaurant";
  const restaurantLogo = restaurant?.branding?.logo || restaurant?.logo || "";
  const tableDisplay = table.displayId || table.tableName || `Table ${table.tableNumber}`;
  const areaName = table.area || table.floor || "Main Hall";
  const qrUrl = table.qrCode || `${window.location.origin}/t/${table.qrToken || ""}`;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-fade-in print:p-0 print:bg-white print:static">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-5 print:shadow-none print:border-none print:w-full print:max-w-none">
        {/* Header - Screen only */}
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3 print:hidden">
          <h3 className="text-sm font-extrabold text-[#0F172A]">Printable Table QR Card</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#475569] text-xl font-bold"
          >
            ×
          </button>
        </div>

        {/* Printable Card Frame */}
        <div className="rounded-2xl border-2 border-[#0F172A] p-6 text-center space-y-4 bg-[#FAFAFA] print:border-4 print:p-8">
          {/* Restaurant Logo / Branding */}
          <div className="flex flex-col items-center gap-1.5">
            {restaurantLogo ? (
              <img src={restaurantLogo} alt={restaurantName} className="h-12 w-auto object-contain mb-1" />
            ) : (
              <span className="text-2xl">🍽️</span>
            )}
            <h2 className="text-lg font-black tracking-tight text-[#0F172A] uppercase">{restaurantName}</h2>
            <p className="text-[11px] font-extrabold text-[#64748B] uppercase tracking-wider">{areaName}</p>
          </div>

          {/* Table Display Name */}
          <div className="py-2 px-4 rounded-xl bg-[#0F172A] text-white inline-block">
            <span className="text-sm font-black tracking-wide uppercase">{tableDisplay}</span>
          </div>

          {/* QR Code (rendered locally via qrcode.react — no external dependency) */}
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
            <p className="mt-3 text-xs font-black text-[#5B42F3] uppercase tracking-widest">
              Scan Code To View Menu & Order
            </p>
          </div>

          <p className="text-[10px] text-[#94A3B8] font-bold">
            Powered by KnotKitchen POS
          </p>
        </div>

        {/* Actions - Screen only */}
        <div className="flex gap-2 print:hidden">
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
            className="flex-1 py-2.5 rounded-xl bg-[#5B42F3] text-white text-xs font-bold hover:bg-[#4A32E0]"
          >
            🖨️ Print QR Card
          </button>
        </div>
      </div>
    </div>
  );
};

export default PrintTableQRModal;
