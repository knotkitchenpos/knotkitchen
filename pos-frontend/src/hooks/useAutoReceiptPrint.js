import { useEffect } from "react";
import { io } from "socket.io-client";
import { useSelector } from "react-redux";
import { enqueueSnackbar } from "notistack";
import { getOrderById } from "../https";
import { getActiveStoreId } from "../utils/storeSession";
import { loadPrinterConfig } from "../utils/printerDevice";
import { printKot, printOrderReceipt } from "../utils/printReceipt";
import { SOCKET_URL } from "../config";

/**
 * Auto Receipt Print and Auto KOT: every new order prints on this device's
 * printer the moment it arrives -- till, website and table QR alike, before
 * anyone accepts it. The receipt and the kitchen ticket are separate
 * switches (Settings > Device Configuration).
 *
 * All new orders announce themselves as `onlineOrder:created` (the name
 * predates the till and QR using it). A round added to a table that already
 * has an order is not a new order: no receipt, but the kitchen still needs
 * a ticket for the new lines, which arrive as `kitchen:round`.
 */

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

    const socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      query: { restaurantId, storeId: getActiveStoreId() },
    });
    const join = () => socket.emit("joinRestaurant", { restaurantId });

    const onCreated = async (payload) => {
      const config = loadPrinterConfig();
      if (!config.type || !payload?.orderId) return;
      if (!config.autoPrint && !config.kotPrint) return;
      if (!claim(payload.orderId)) return;
      let order;
      try {
        order = (await getOrderById(payload.orderId))?.data?.data;
        if (!order) return;
        // The saved order holds only the table's id; the event has its name.
        if (payload.table && typeof payload.table === "object") order.table = payload.table;
      } catch (err) {
        // Locked for non-payment: the POS is on Billing, nothing to print.
        if (err?.response?.data?.code === "ACCOUNT_LOCKED") return;
        enqueueSnackbar(`Not printed: ${err?.message || "could not load the order"}`, { variant: "warning" });
        return;
      }
      // Kitchen first: the cook is waiting, the customer copy can follow.
      if (config.kotPrint) {
        await printKot(order, { auto: true, config }).catch((err) =>
          enqueueSnackbar(`KOT not printed: ${err?.message || "printer error"}`, { variant: "warning" }),
        );
      }
      if (config.autoPrint) {
        await printOrderReceipt(order, { auto: true, config }).catch((err) =>
          enqueueSnackbar(`Receipt not printed: ${err?.message || "printer error"}`, { variant: "warning" }),
        );
      }
    };

    // Lines added to a table mid-meal: a ticket for just those lines.
    const onRound = async (payload) => {
      const config = loadPrinterConfig();
      if (!config.kotPrint || !config.type || !payload?.orderId || !payload.items?.length) return;
      if (!claim(`${payload.orderId}:${payload.roundId || payload.items.length}:${payload.at || ""}`)) return;
      try {
        await printKot(
          { _id: payload.orderId, orderNumber: payload.orderNumber, orderType: "dine-in", table: payload.table, createdAt: payload.at },
          { items: payload.items, round: true, auto: true, config },
        );
      } catch (err) {
        enqueueSnackbar(`KOT not printed: ${err?.message || "printer error"}`, { variant: "warning" });
      }
    };

    socket.on("connect", join);
    socket.on("onlineOrder:created", onCreated);
    socket.on("kitchen:round", onRound);
    return () => {
      socket.off("connect", join);
      socket.off("onlineOrder:created", onCreated);
      socket.off("kitchen:round", onRound);
      socket.disconnect();
    };
  }, [restaurantId]);
};

export default useAutoReceiptPrint;
