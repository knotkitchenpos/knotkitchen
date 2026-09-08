import React from "react";
import { FaLongArrowAltRight } from "react-icons/fa";

const SessionDetailModal = ({
  table,
  session,
  onClose,
  onAddItem,
  onComplete,
  onCancelItem,
  cancelBusy = false,
}) => {
  if (!session) return null;
  const statusColor = { OCCUPIED: "text-accent-amber", OPEN: "text-accent-green", PROCESSING: "text-accent-blue", BILL_REQUESTED: "text-accent-blue", PAYMENT_PENDING: "text-accent-red" };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-lg border border-border">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-content text-xl font-semibold font-display">{table?.name} — Active Session</h2>
          <button onClick={onClose} className="text-content-muted hover:text-accent-red text-2xl leading-none p-1">&times;</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-surface-input border border-border">
            <p className="text-xs text-content-muted">Customers</p>
            <p className="text-lg font-bold text-content">{session.customerCount} / {table?.capacity}</p>
          </div>
          <div className="p-3 rounded-xl bg-surface-input border border-border">
            <p className="text-xs text-content-muted">Status</p>
            <p className={`text-lg font-bold ${statusColor[session.status] || "text-content"}`}>{session.status}</p>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs text-content-muted mb-2">Items ({session.items?.length || 0})</p>
          <div className="max-h-[220px] overflow-y-auto space-y-2 no-scrollbar">
            {(session.items || []).map((item, idx) => {
              const cancelled = item.status === "cancelled";
              return (
                <div
                  key={item._id || idx}
                  className={`flex items-center justify-between bg-surface-input rounded-xl px-4 py-2.5 border border-border ${
                    cancelled ? "opacity-60" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${
                        cancelled ? "text-content-muted line-through" : "text-content"
                      }`}
                    >
                      {item.name}
                    </p>
                    {/* The components the diner actually chose. They are
                        priced into the line, so leaving them off made the
                        total look wrong for no visible reason. */}
                    {(item.modifiers || []).length > 0 && (
                      <p className="text-xs text-content-muted truncate">
                        + {item.modifiers.map((m) => m.name).filter(Boolean).join(", ")}
                      </p>
                    )}
                    <p className="text-xs text-content-muted">
                      x{item.quantity}
                      {cancelled ? (
                        <span className="ml-1.5 text-accent-red font-semibold">
                          Cancelled{item.cancelReason ? ` — ${item.cancelReason}` : ""}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p
                      className={`text-sm font-bold ${
                        cancelled ? "text-content-muted line-through" : "text-content"
                      }`}
                    >
                      ₹{(item.total || item.price * item.quantity || 0).toFixed(2)}
                    </p>
                    {/* Pulling a dish the kitchen has run out of. It comes off
                        the bill and off the diner's own QR page. */}
                    {onCancelItem && !cancelled && (
                      <button
                        onClick={() => onCancelItem(item)}
                        disabled={cancelBusy}
                        title={`Cancel ${item.name}`}
                        aria-label={`Cancel ${item.name}`}
                        className="w-7 h-7 rounded-lg border border-border text-content-muted hover:text-accent-red hover:border-accent-red text-lg leading-none disabled:opacity-40"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {!session.items?.length && <p className="text-center text-content-muted text-sm py-6">No items yet.</p>}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-accent/5 border border-accent/20 flex items-center justify-between mb-5">
          <p className="text-sm font-semibold text-content">Running Total</p>
          <p className="font-display text-lg font-bold text-accent">₹{(session.bills?.totalWithTax || 0).toFixed(2)}</p>
        </div>

        <div className="flex flex-col gap-2">
          <button onClick={onAddItem} className="btn-primary w-full !py-3 flex items-center justify-center gap-2">
            Add Item <FaLongArrowAltRight size={14} />
          </button>
          {/* Completing a table was simply not offered anywhere, so a table
              order could be taken but never finished. */}
          {onComplete && (
            <button
              onClick={onComplete}
              disabled={!(session.bills?.totalWithTax > 0)}
              className="w-full py-3 rounded-xl bg-[#16A34A] text-white text-sm font-bold hover:bg-[#15803D] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Complete Order &amp; Take Payment
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionDetailModal;