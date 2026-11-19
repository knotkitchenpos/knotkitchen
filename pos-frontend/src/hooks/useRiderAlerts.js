import { useEffect } from "react";
import { useSelector } from "react-redux";
import { acquireSocket, releaseSocket } from "../socket";
import { enqueueSnackbar } from "../utils/notify";

/**
 * Tell the till, on whatever screen it is, when one of the store's riders
 * turns a delivery down: the order is back with the store and needs another
 * rider. (The order's own panel shows it too; this is so nobody misses it.)
 */
const useRiderAlerts = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  useEffect(() => {
    if (!restaurantId) return undefined;
    const socket = acquireSocket(restaurantId);
    const seen = new Set();
    const onDelivery = (p) => {
      const r = p?.delivery?.lastRejection;
      if (!r || p.delivery.riderId || !r.at || Date.now() - new Date(r.at).getTime() > 30_000) return;
      const key = `${p.orderId}:${r.at}`;
      if (seen.has(key)) return;
      seen.add(key);
      enqueueSnackbar(`${r.riderName || "A rider"} declined order #${p.orderNumber} (${r.reason}). Assign another rider.`, { variant: "warning", autoHideDuration: 8000 });
    };
    socket.on("delivery:updated", onDelivery);
    return () => {
      socket.off("delivery:updated", onDelivery);
      releaseSocket();
    };
  }, [restaurantId]);
};

export default useRiderAlerts;
