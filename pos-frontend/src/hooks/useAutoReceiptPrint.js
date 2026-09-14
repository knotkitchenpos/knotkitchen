import { useEffect } from "react";
import { io } from "socket.io-client";
import { useSelector } from "react-redux";
import { enqueueSnackbar } from "notistack";
import { getOrderById } from "../https";
import { getActiveStoreId } from "../utils/storeSession";
import { loadPrinterConfig } from "../utils/printerDevice";
import { printOrderReceipt } from "../utils/printReceipt";

/**
 * Auto Receipt Print: every new order prints on this device's printer the
 * moment it arrives -- till, website and table QR alike, before anyone
 * accepts it.
 *
 * All of them announce themselves as `onlineOrder:created` (the name predates
 * the till and QR using it). A round added to a table that already has an
 * order is not a new order and does not print.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || window.location.origin;
const PRINTED_KEY = "kk.autoPrinted.v1";

/**
 * Claim an order for printing, once per device. Two POS tabs open on the same
 * laptop each hear the event; only the first prints.
 * ponytail: localStorage check-and-set, two tabs within the same millisecond
 * could both print; use navigator.locks if that is ever seen.
 */
const claim = (orderId) => {
  try {
    const now = Date.now();
    const seen = JSON.parse(localStorage.getItem(PRINTED_KEY) || "{}");
    for (const [id, at] of Object.entries(seen)) if (now - at > 6 * 3600_000) delete seen[id];
    if (seen[orderId]) return false;
    seen[orderId] = now;
    localStorage.setItem(PRINTED_KEY, JSON.stringify(seen));
    return true;
  } catch {
    return true;
  }
};

const useAutoReceiptPrint = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);

  useEffect(() => {
    if (!restaurantId) return undefined;

    const socket = io(BACKEND_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      query: { restaurantId, storeId: getActiveStoreId() },
    });
    const join = () => socket.emit("joinRestaurant", { restaurantId });

    const onCreated = async (payload) => {
      const config = loadPrinterConfig();
      if (!config.autoPrint || !config.type || !payload?.orderId) return;
      if (!claim(payload.orderId)) return;
      try {
        const order = (await getOrderById(payload.orderId))?.data?.data;
        if (!order) return;
        // The saved order holds only the table's id; the event has its name.
        if (payload.table && typeof payload.table === "object") order.table = payload.table;
        await printOrderReceipt(order, { auto: true, config });
      } catch (err) {
        // Locked for non-payment: the POS is on Billing, nothing to print.
        if (err?.response?.data?.code === "ACCOUNT_LOCKED") return;
        enqueueSnackbar(`Receipt not printed: ${err?.message || "printer error"}`, { variant: "warning" });
      }
    };

    socket.on("connect", join);
    socket.on("onlineOrder:created", onCreated);
    return () => {
      socket.off("connect", join);
      socket.off("onlineOrder:created", onCreated);
      socket.disconnect();
    };
  }, [restaurantId]);
};

export default useAutoReceiptPrint;
