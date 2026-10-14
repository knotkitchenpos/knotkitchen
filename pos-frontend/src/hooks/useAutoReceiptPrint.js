import { useEffect } from "react";
import { useSelector } from "react-redux";
import { enqueueSnackbar } from "notistack";
import { getOrderById } from "../https";
import { kitchenPrinter, loadPrinterConfig } from "../utils/printerDevice";
import { printKot, printOrderReceipt } from "../utils/printReceipt";
import { acquireSocket, releaseSocket } from "../socket";

/**
 * Auto Receipt Print and Auto KOT, two switches per device (Settings > Device
 * Configuration). The KOT goes to the kitchen printer when the device has
 * one, else the receipt printer; the receipt always to the receipt printer.
 *
 * - A till order prints the moment it is rung up (`onlineOrder:created`; the
 *   name predates the till using it).
 * - A customer's order -- table QR, website, Knot Eats -- prints when staff
 *   accept it (`onlineOrder:accepted`), never on arrival: a declined order
 *   never reaches the kitchen.
 * - Dishes added to a table the kitchen already has a ticket for are not a
 *   new order: no receipt, a KOT for just those lines (`kitchen:round`).
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

    const socket = acquireSocket(restaurantId);

    const printNewOrder = async (payload) => {
      const config = loadPrinterConfig();
      // A device with only a kitchen printer still prints its KOTs.
      const wantReceipt = config.autoPrint && config.type;
      const wantKot = config.kotPrint && kitchenPrinter(config).type;
      if (!payload?.orderId || (!wantReceipt && !wantKot)) return;
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
      // A sale taken offline was paid and handed over then: no receipt on its sync, and no KOT
      // when its till printed one (O1). A till without Auto KOT left the ticket to this device.
      if (order.isOffline && (order.kotPrinted || !config.kotPrint)) return;
      // Kitchen first: the cook is waiting, the customer copy can follow.
      if (config.kotPrint) {
        await printKot(order, { auto: true, config }).catch((err) =>
          enqueueSnackbar(`KOT not printed: ${err?.message || "printer error"}`, { variant: "warning" }),
        );
      }
      if (wantReceipt && !order.isOffline) {
        await printOrderReceipt(order, { auto: true, config }).catch((err) =>
          enqueueSnackbar(`Receipt not printed: ${err?.message || "printer error"}`, { variant: "warning" }),
        );
      }
    };

    // D4: a customer's order (table QR, website, Knot Eats) prints when staff accept it, never on arrival.
    const onCreated = (payload) => (payload?.placedVia === "QR" || payload?.source === "WEBSITE" ? undefined : printNewOrder(payload));

    // Lines added to a table mid-meal: a ticket for just those lines.
    const onRound = async (payload) => {
      const config = loadPrinterConfig();
      if (!config.kotPrint || !kitchenPrinter(config).type || !payload?.orderId || !payload.items?.length) return;
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

    socket.on("onlineOrder:created", onCreated);
    socket.on("onlineOrder:accepted", printNewOrder);
    socket.on("kitchen:round", onRound);
    return () => {
      socket.off("onlineOrder:created", onCreated);
      socket.off("onlineOrder:accepted", printNewOrder);
      socket.off("kitchen:round", onRound);
      releaseSocket();
    };
  }, [restaurantId]);
};

export default useAutoReceiptPrint;
