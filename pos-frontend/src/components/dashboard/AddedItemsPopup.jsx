import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { enqueueSnackbar } from "notistack";
import { listPendingAdditions, resolveAddedItems } from "../../https/storefrontApi";
import useAlertBeep from "../../hooks/useAlertBeep";
import useArmed from "../../hooks/useArmed";
import { acquireSocket, releaseSocket } from "../../socket";


/**
 * "Added Items" — a diner at a table that is already mid-meal has ordered more.
 *
 * These are deliberately NOT a new order. The extra items land on the table's
 * existing ticket as status "pending" (see routes/qrRoute), so the till reviews
 * just what was added instead of re-approving the whole meal, and the table
 * keeps one order and one bill.
 *
 * Accept sends them to the kitchen; Cancel drops them and the bill falls back.
 * The alert sounds until one or the other is chosen, because the diner is
 * sitting there waiting either way.
 *
 * The live event alone is not enough: a till that was closed, reloading or
 * asleep when the diner ordered never heard it, and the lines sat on the bill
 * unreviewed. So the server's list of tables with additions still pending is
 * the source of truth, fetched on every (re)connect and whenever the page is
 * looked at again.
 */
const AddedItemsPopup = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  // Which lines the operator ticked. Empty means "the whole batch", which is
  // what the single Cancel button used to do and stays the default.
  const [picked, setPicked] = useState({});

  useAlertBeep(queue.length > 0);

  // What is on screen, readable from socket handlers without re-subscribing.
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    if (!restaurantId) return undefined;

    const socket = acquireSocket(restaurantId);

    // The card is a copy of the moment the diner added the items. Another till
    // may since have accepted them, declined one, or cancelled a dish from
    // Orders. Ask the server what is STILL pending: cards on screen keep their
    // place with just those lines, cards it no longer lists go, new ones join
    // the end.
    const catchUp = async () => {
      // A live card that lands while the list is in flight is not in the
      // answer yet; only cards that were already showing can be dropped.
      const before = new Set(queueRef.current.map((p) => String(p.orderId)));
      try {
        const { data } = await listPendingAdditions();
        const fresh = new Map((data?.data || []).map((p) => [String(p.orderId), p]));
        setQueue((prev) => {
          const unseen = new Map(fresh); // updaters may run twice: never mutate `fresh`
          const kept = [];
          for (const p of prev) {
            const id = String(p.orderId);
            if (fresh.has(id)) kept.push({ ...p, pendingItems: fresh.get(id).pendingItems });
            else if (!before.has(id)) kept.push(p);
            unseen.delete(id);
          }
          return [...kept, ...unseen.values()];
        });
        setPicked({});
      } catch {
        /* offline or signed out: the next event, or the next look, retries */
      }
    };
    const onOrderChanged = (payload) => {
      const id = String(payload?.orderId || "");
      if (id && queueRef.current.some((p) => String(p.orderId) === id)) catchUp();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") catchUp();
    };

    const onAdded = (payload) => {
      if (!payload?.orderId) return;
      setQueue((prev) => {
        // One table, one card: a diner adding twice in quick succession should
        // replace the pending list rather than stack two alerts for one ticket.
        const rest = prev.filter((p) => String(p.orderId) !== String(payload.orderId));
        return [...rest, payload];
      });
      try {
        enqueueSnackbar(
          `Added items · Table ${payload.displayId || payload.tableNumber || "?"}`,
          { variant: "info" },
        );
      } catch {
        /* a failed toast must not break the alert */
      }
    };

    socket.on("tableOrder:itemsAdded", onAdded);
    socket.on("onlineOrder:status", onOrderChanged);
    socket.on("connect", catchUp);
    if (socket.connected) catchUp();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      socket.off("tableOrder:itemsAdded", onAdded);
      socket.off("onlineOrder:status", onOrderChanged);
      socket.off("connect", catchUp);
      document.removeEventListener("visibilitychange", onVisible);
      releaseSocket();
    };
  }, [restaurantId]);

  // Taps land nowhere until this card, at this size, has been up a moment.
  const armed = useArmed(`${queue[0]?.orderId}:${queue[0]?.pendingItems?.length}`);

  if (queue.length === 0) return null;
  const current = queue[0];
  // By id, never by position: a status echo can remove this card before the
  // HTTP reply, and dropping "the first card" then threw away the next table.
  const drop = (id) => {
    setPicked({});
    setQueue((prev) => prev.filter((p) => String(p.orderId) !== String(id)));
  };

  const decide = async (action, itemIds) => {
    if (!armed) return;
    setBusy(true);
    try {
      const res = await resolveAddedItems(current.orderId, action, itemIds);
      enqueueSnackbar(res?.data?.message || "Updated.", {
        variant: action === "accept" ? "success" : "info",
      });
      drop(current.orderId);
    } catch (e) {
      enqueueSnackbar(e?.response?.data?.message || "Could not update the order.", {
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const cancelWholeOrder = () => {
    if (!armed) return;
    // Voiding a table's whole ticket is not the same decision as declining an
    // addition, and it cannot be undone from here.
    if (!window.confirm("Cancel this table's ENTIRE order? Every item on the ticket is voided.")) {
      return;
    }
    decide("cancel_order");
  };

  const label = current.displayId || `Table ${current.tableNumber ?? "?"}`;
  const items = Array.isArray(current.pendingItems) ? current.pendingItems : [];
  const selectedIds = Object.keys(picked).filter((id) => picked[id]);

  return (
    <div className="fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#F59E0B]">
              Added Items
            </p>
            <h3 className="text-[17px] font-extrabold text-[#0F172A] truncate">{label}</h3>
            <p className="text-[12px] text-[#64748B]">
              Added to this table&apos;s existing order — not a new order.
            </p>
          </div>
          <span className="text-2xl shrink-0" aria-hidden="true">
            🍽️
          </span>
        </div>

        <div className="max-h-[220px] overflow-y-auto rounded-xl border border-[#E2E8F0] divide-y divide-[#E2E8F0]">
          {items.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-[#94A3B8] text-center">
              No line items in this request.
            </p>
          ) : (
            items.map((it, i) => {
              const id = it._id ? String(it._id) : "";
              const mods = (it.modifiers || [])
                .map((m) => m.name)
                .filter(Boolean)
                .join(", ");
              return (
                <label
                  key={id || i}
                  className="px-3 py-2 flex items-center gap-3 text-[13px] cursor-pointer hover:bg-[#F8FAFC]"
                >
                  <input
                    type="checkbox"
                    checked={!!picked[id]}
                    disabled={!id || busy}
                    onChange={(e) => {
                      if (!armed) return;
                      setPicked((prev) => ({ ...prev, [id]: e.target.checked }));
                    }}
                    className="w-4 h-4 accent-[#DC2626] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#0F172A] truncate">
                      {it.quantity || 1}× {it.name || "Item"}
                    </p>
                    {mods && <p className="text-[11px] text-[#64748B] truncate">+ {mods}</p>}
                  </div>
                  <span className="shrink-0 font-extrabold text-[#0F172A]">
                    ₹{Number(it.total || 0).toFixed(2)}
                  </span>
                </label>
              );
            })
          )}
        </div>

        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => decide("reject", selectedIds)}
              disabled={busy}
              className="h-[44px] rounded-xl border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] text-[13.5px] font-bold hover:bg-[#FEE2E2] disabled:opacity-60"
            >
              {selectedIds.length ? `Cancel ${selectedIds.length} Item(s)` : "Cancel All Items"}
            </button>
            <button
              type="button"
              onClick={() => decide("accept")}
              disabled={busy}
              className="h-[44px] rounded-xl bg-[#22C55E] text-white text-[13.5px] font-extrabold hover:bg-[#16A34A] disabled:opacity-60"
            >
              {busy ? "Working…" : "Accept Items"}
            </button>
          </div>
          {/* Voiding the table's whole ticket, not just this addition. Kept
              visually apart from the two routine buttons so it is not the one
              hit by mistake during service. */}
          <button
            type="button"
            onClick={cancelWholeOrder}
            disabled={busy}
            className="w-full h-[38px] rounded-xl border border-[#E2E8F0] text-[#DC2626] text-[12.5px] font-bold hover:bg-[#FEF2F2] disabled:opacity-60"
          >
            Cancel Entire Order
          </button>
          <p className="text-[11px] text-[#94A3B8] text-center">
            Tick items to cancel only those — otherwise the whole addition is cancelled.
          </p>
        </div>

        {queue.length > 1 && (
          <p className="text-[11px] font-bold text-[#94A3B8] text-center">
            {queue.length - 1} more table(s) waiting…
          </p>
        )}
      </div>
    </div>
  );
};

export default AddedItemsPopup;
