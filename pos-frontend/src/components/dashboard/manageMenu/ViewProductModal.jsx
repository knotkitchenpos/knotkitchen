import React from "react";
import { IconX } from "./icons";
import FitImage from "../../shared/FitImage";

/** Read-only product card; "Edit Product" hands the item back to the page's form. */
const ViewProductModal = ({ product, onClose, onEdit }) => (
  <>
  {/* View Product Details Modal (Module 4) */}
  {product && (
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-[480px] bg-white rounded-2xl p-6 shadow-2xl space-y-4 text-[#0F172A]">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-[18px] font-extrabold">{product?.name || "Product"}</h3>
            <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded border ${
              product?.isVegetarian !== false
                ? "bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]"
                : "bg-[#FEE2E2] text-[#B91C1C] border-[#FCA5A5]"
            }`}>
              {product?.isVegetarian !== false ? "🌱 Veg" : "🔴 Non-Veg"}
            </span>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A]">
            <IconX />
          </button>
        </div>
  
        {product?.imageUrl || product?.image ? (
          <FitImage src={product?.imageUrl || product?.image} alt={product?.name || "Product"} className="w-full h-44 rounded-xl border" />
        ) : null}
  
        <div className="space-y-3 text-[13px]">
          {product?.description && (
            <p className="text-[#475569] font-medium leading-relaxed">{product.description}</p>
          )}
  
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E2E8F0]">
            <div className="p-3 rounded-xl bg-[#F8FAFC] border">
              <span className="text-[#64748B] text-[11px] font-bold">Standard Price</span>
              <p className="text-lg font-extrabold text-[#C2410C]">₹{product?.price || 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-[#F8FAFC] border">
              <span className="text-[#64748B] text-[11px] font-bold">Display Status</span>
              <p className="text-[13px] font-extrabold">
                {product?.isAvailable !== false ? "🟢 Display ON" : "🔴 Display OFF"}
              </p>
            </div>
          </div>
  
          {/* Assigned Groups & Components details */}
          {Array.isArray(product?.modifierGroups) && product.modifierGroups.length > 0 ? (
            <div className="p-3 rounded-xl bg-[#F8FAFC] border space-y-2 text-[12px]">
              <p className="font-extrabold text-[#0F172A]">Assigned Groups & Components ({product.modifierGroups.length})</p>
              <div className="space-y-1.5">
                {product.modifierGroups.map((g, idx) => (
                  <div key={g?.name || g?._id || idx} className="p-2.5 rounded-lg bg-white border border-[#E2E8F0]">
                    <div className="flex items-center justify-between font-extrabold text-[#0F172A]">
                      <span>🧩 {g?.name || "Group"}</span>
                      <span className="text-[10.5px] font-bold text-[#C2410C] bg-[#FFF1E8] px-2 py-0.5 rounded-md">
                        {g?.required ? "Required" : "Optional"} · max {g?.maxSelections || 1}
                      </span>
                    </div>
                    {Array.isArray(g?.options) && g.options.length > 0 && (
                      <p className="text-[11.5px] font-semibold text-[#475569] mt-1">
                        {g.options.map((o) => `${o?.name || "Item"} (₹${o?.price || 0})`).join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-[#F8FAFC] border text-[12px] text-[#94A3B8]">
              No groups or components assigned to this product yet.
            </div>
          )}
  
          {product.samePrice === false && product.channelPrices && (
            <div className="p-3 rounded-xl bg-[#F8FAFC] border space-y-1.5 text-[11.5px]">
              <p className="font-extrabold text-[#0F172A] mb-1">Channel Prices</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span>POS Collection: <b>₹{product.channelPrices.posCollection}</b></span>
                <span>POS Delivery: <b>₹{product.channelPrices.posDelivery}</b></span>
                <span>POS Table: <b>₹{product.channelPrices.posTable}</b></span>
                <span>Web Collection: <b>₹{product.channelPrices.websiteCollection}</b></span>
                <span>Web Delivery: <b>₹{product.channelPrices.websiteDelivery}</b></span>
                <span>Web Table: <b>₹{product.channelPrices.websiteTable}</b></span>
              </div>
            </div>
          )}
  
          {product.schedule?.enabled && (
            <div className="p-3 rounded-xl bg-[#F8FAFC] border text-[12px] space-y-1">
              <p className="font-extrabold text-[#0F172A]">Product Time Schedule</p>
              <p className="font-bold text-[#C2410C]">
                {product.schedule.startTime || "09:00"} – {product.schedule.endTime || "23:00"}
              </p>
            </div>
          )}
        </div>
  
        <div className="flex gap-3 pt-3 border-t border-[#E2E8F0]">
          <button
            onClick={onClose}
            className="flex-1 h-[42px] rounded-xl border border-[#CBD5E1] font-bold text-[#475569] hover:bg-[#F8FAFC]"
          >
            Close
          </button>
          <button
            onClick={() => onEdit(product)}
            className="flex-1 h-[42px] rounded-xl bg-[#FD5302] text-white font-bold shadow-md hover:bg-[#D64502]"
          >
            Edit Product
          </button>
        </div>
      </div>
    </div>
  )}
  </>
);

export default ViewProductModal;
