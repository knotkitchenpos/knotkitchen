import React, { useEffect, useState } from "react";
import { enqueueSnackbar } from "notistack";
import { markOrderAsSeen } from "../../https/marketplace";

const MarketplaceOrderPopup = () => {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    const baseUrl = (import.meta.env.VITE_BACKEND_URL || "").replace(/\/$/, "");
    const es = new EventSource(baseUrl + "/api/marketplace/stream", {
      withCredentials: true,
    });

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "NEW_MARKETPLACE_ORDER") {
          setOrders((prev) => [data.order, ...prev]);
          enqueueSnackbar("New marketplace order received!", { variant: "info" });
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => es.close();
  }, []);

  const dismissOrder = async (orderId) => {
    setOrders((prev) => prev.filter((o) => o._id !== orderId));
    try {
      await markOrderAsSeen(orderId);
    } catch {
      // Ignore errors
    }
  };

  if (orders.length === 0) return null;

  const current = orders[0];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-surface-secondary border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-5 bg-gradient-brand text-white flex items-center justify-between">
          <div>
            <p className="text-xs text-white/80 uppercase tracking-wider font-semibold">
              New Marketplace Order
            </p>
            <h2 className="text-2xl font-display font-bold mt-1">
              {current.marketplace || "Manual"} Order
            </h2>
          </div>
          <span className="bg-white/20 rounded-xl p-2.5 text-xl leading-none text-white">
            &#10005;
          </span>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-content-muted text-sm">Customer</p>
              <p className="font-semibold text-content">
                {current.customerDetails?.name || "Guest"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-content-muted text-sm">Total</p>
              <p className="font-bold text-xl text-accent">
                &#8377;{(current.bills?.totalWithTax || 0).toLocaleString("en-IN")}
              </p>
            </div>
          </div>

          {(current.items || []).map((item, i) => (
            <div key={i} className="flex justify-between text-sm border-t border-border pt-3">
              <span className="text-content">
                {item.quantity || 1} x {item.name || "Item"}
              </span>
              <span className="text-content-muted">
                &#8377;{((item.price || 0) * (item.quantity || 1)).toLocaleString("en-IN")}
              </span>
            </div>
          ))}

          <button
            onClick={() => dismissOrder(current._id)}
            className="btn-primary w-full !py-3"
          >
            OK, Got It
          </button>
        </div>
      </div>
    </div>
  );
};

export default MarketplaceOrderPopup;