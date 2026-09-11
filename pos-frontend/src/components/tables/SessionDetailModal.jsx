import React from "react";
import { itemExtras } from "../../utils/orderItems";
import { FaLongArrowAltRight } from "react-icons/fa";

const SessionDetailModal = ({
  table,
  session,
  onClose,
  onAddItem,
  onComplete,
  onCancelItem,
  onRelease,
  releaseBusy = false,
  cancelBusy = false,
}) => {
  // A table stranded WITHOUT a session is the case that had no way out at
  // all: this returned null, so clicking the table opened nothing. It now
  // renders, and the only thing it offers is the release.
  const statusColor = { OCCUPIED: "text-accent-amber", OPEN: "text-accent-green", PROCESSING: "text-accent-blue", BILL_REQUESTED: "text-accent-blue", PAYMENT_PENDING: "text-accent-red" };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-lg border border-border">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-content text-xl font-semibold font-display">
            {table?.name} — {session ? "Active Session" : "No Active Order"}
          </h2>
          <button onClick={onClose} className="text-content-muted hover:text-accent-red text-2xl leading-none p-1">&times;</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-surface-input border border-border">
            <p className="text-xs text-content-muted">Customers</p>
            <p className="text-lg font-bold text-content">{session?.customerCount ?? 0} / {table?.capacity}</p>
          </div>
          <div className="p-3 rounded-xl bg-surface-input border border-border">
            <p className="text-xs text-content-muted">Status</p>
            <p className={`text-lg font-bold ${statusColor[session?.status] || "text-content"}`}>
              {session?.status || "No active order"}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs text-content-muted mb-2">Items ({session?.items?.length || 0})</p>
          <div className="max-h-[220px] overflow-y-auto space-y-2 no-scrollbar">
            {(session?.items || []).map((item, idx) => {
              const cancelled = item.status === "cancelled";
              const lineQty = Math.max(1, Number(item.quantity) || 1);
              const extras = itemExtras(item);
              return (
                <div
                  key={item._id || idx}
                  className={`bg-surface-input rounded-xl px-4 py-2.5 border border-border ${
                    cancelled ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-semibold truncate ${
                        cancelled ? "text-content-muted line-through" : "text-content"
                      }`}
                    >
                      {item.name}
                    </p>
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

                  {/* The components the diner chose, each on its own row with
                      what it cost. They are priced into the line, so a bill
                      that only names them leaves the total unaccountable. */}
                  {extras.map((extra, x) => (
                    <div key={x} className="flex items-center gap-3 mt-1.5 pl-3">
                      <span className="w-0.5 self-stretch rounded bg-border shrink-0" aria-hidden="true" />
                      <p className="min-w-0 flex-1 text-xs text-content-muted truncate">
                        {extra.quantity > 1 ? `${extra.quantity}× ${extra.name}` : extra.name}
                      </p>
                      <p className="text-xs font-semibold text-content-muted shrink-0">
                        {extra.price ? `₹${(extra.price * extra.quantity * lineQty).toFixed(2)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              );
            })}
            {!session?.items?.length && <p className="text-center text-content-muted text-sm py-6">No items yet.</p>}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-accent/5 border border-accent/20 flex items-center justify-between mb-5">
          <p className="text-sm font-semibold text-content">Running Total</p>
          <p className="font-display text-lg font-bold text-accent">₹{(session?.bills?.totalWithTax || 0).toFixed(2)}</p>
        </div>

        <div className="flex flex-col gap-2">
          {session && (
            <button onClick={onAddItem} className="btn-primary w-full !py-3 flex items-center justify-center gap-2">
              Add Item <FaLongArrowAltRight size={14} />
            </button>
          )}
          {/* Completing a table was simply not offered anywhere, so a table
              order could be taken but never finished. */}
          {onComplete && session && (
            <button
              onClick={onComplete}
              disabled={!(session?.bills?.totalWithTax > 0)}
              className="w-full py-3 rounded-xl bg-[#16A34A] text-white text-sm font-bold hover:bg-[#15803D] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Complete Order &amp; Take Payment
            </button>
          )}
          {/* The way out when there is nothing to take payment for. A party
              that cancelled everything leaves a zero total, which disables
              the button above and used to strand the table for good. */}
          {onRelease && (
            <button
              onClick={onRelease}
              disabled={releaseBusy}
              className="w-full py-3 rounded-xl border border-border text-content-muted text-sm font-bold hover:text-accent-red hover:border-accent-red disabled:opacity-50"
            >
              {releaseBusy ? "Releasing…" : "Release Table"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionDetailModal;