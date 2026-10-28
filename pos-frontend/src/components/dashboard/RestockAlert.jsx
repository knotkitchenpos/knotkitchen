import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { enqueueSnackbar } from "../../utils/notify";
import { answerBackInStock, getRestockAlerts, turnOffProductsFor } from "../../https";
import { acquireSocket, releaseSocket } from "../../socket";
import { qty, unitLabel } from "../../utils/inventory";

/**
 * "Pizza Dough needs restocking: 2 Piece left."
 *
 * When a sale takes an inventory item to its minimum stock (or to nothing),
 * the server sends `inventory:restock` (pos-backend/services/inventory.js) and
 * this card appears on every till of the restaurant. What already needs
 * restocking is shown when the POS opens. Dismissed items stay hidden until
 * the next alert for them, or the next time the POS is opened.
 *
 * It also asks the two questions about the products that use an item
 * (pos-backend/services/stockProducts.js):
 *   - out of stock, with products still on sale: "Pizza Dough is out of
 *     stock. Do you want to turn off all products using this item?"
 *   - restocked (`inventory:back`): "Items are back in stock. Do you want to
 *     turn on the products that were previously turned off due to stock
 *     shortage?"
 * One till answering clears the question on the others (`inventory:answered`).
 */
const RestockAlert = () => {
  const restaurantId = useSelector((s) => s.user?.restaurantId);
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [back, setBack] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!restaurantId) return undefined;
    const socket = acquireSocket(restaurantId);
    // The newest word on an item replaces the old one (low, then out).
    const merge = (list) =>
      setItems((prev) => {
        const next = prev.filter((p) => !list.some((i) => i.ingredientId === p.ingredientId));
        return [...next, ...list.filter((i) => i?.ingredientId)];
      });
    const onRestock = (payload) => merge(payload?.items || []);
    // Stock moved (a sale, a purchase): an item restocked since leaves the card.
    // Only removes; new alerts arrive as inventory:restock, and a dismissed one stays dismissed.
    const onStock = () =>
      getRestockAlerts()
        .then(({ data }) => {
          const still = new Set((data?.data || []).map((i) => i.ingredientId));
          setItems((prev) => prev.filter((p) => still.has(p.ingredientId)));
        })
        .catch(() => {
          /* the card stays as it was */
        });
    const onBack = (payload) => setBack(payload?.products ? payload : null);
    const onAnswered = (payload) => {
      if (payload?.kind === "back") setBack(null);
      if (payload?.kind === "off") {
        setItems((prev) => prev.map((i) => (i.ingredientId === payload.ingredientId ? { ...i, productsOn: 0 } : i)));
      }
    };
    socket.on("inventory:restock", onRestock);
    socket.on("inventory:stock", onStock);
    socket.on("inventory:back", onBack);
    socket.on("inventory:answered", onAnswered);
    getRestockAlerts()
      .then(({ data }) => {
        merge(data?.data || []);
        if (data?.backInStock?.products) setBack(data.backInStock);
      })
      .catch(() => {
        /* the live alert still works without this */
      });
    return () => {
      socket.off("inventory:restock", onRestock);
      socket.off("inventory:stock", onStock);
      socket.off("inventory:back", onBack);
      socket.off("inventory:answered", onAnswered);
      releaseSocket();
    };
  }, [restaurantId]);

  const fail = (err) =>
    enqueueSnackbar(err?.response?.data?.message || "That did not go through. Try again.", { variant: "error" });

  const turnOff = async (item) => {
    setBusy(true);
    try {
      const { data } = await turnOffProductsFor(item.ingredientId);
      const n = data?.data?.count || 0;
      enqueueSnackbar(n ? `${n} product${n === 1 ? "" : "s"} using ${item.name} turned off` : "Nothing was on sale with it", { variant: "success" });
      setItems((prev) => prev.map((i) => (i.ingredientId === item.ingredientId ? { ...i, productsOn: 0 } : i)));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const answerBack = async (turnOn) => {
    setBusy(true);
    try {
      const { data } = await answerBackInStock(turnOn);
      const n = data?.data?.count || 0;
      if (turnOn) enqueueSnackbar(`${n} product${n === 1 ? "" : "s"} turned back on`, { variant: "success" });
      setBack(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // An out-of-stock item with products still on sale asks first, one at a time.
  const asking = items.find((i) => i.status === "out" && i.productsOn > 0);

  if (asking) {
    return (
      <Question
        tone="danger"
        title={`${asking.name} is out of stock.`}
        message={`Do you want to turn off all products using this item? (${asking.productsOn} on sale)`}
        busy={busy}
        onNo={() => setItems((prev) => prev.map((i) => (i === asking ? { ...i, productsOn: 0 } : i)))}
        onYes={() => turnOff(asking)}
        yesLabel="Yes, turn off"
      />
    );
  }

  if (back?.products) {
    return (
      <Question
        title="Items are back in stock."
        message={`Do you want to turn on the products that were previously turned off due to stock shortage? (${back.products} product${back.products === 1 ? "" : "s"}${back.ingredients?.length ? `: ${back.ingredients.join(", ")} back` : ""})`}
        busy={busy}
        onNo={() => answerBack(false)}
        onYes={() => answerBack(true)}
        yesLabel="Yes, turn on"
      />
    );
  }

  if (!items.length) return null;

  const out = items.filter((i) => i.status === "out");
  return (
    <div className="fixed top-3 right-3 z-[65] w-[330px] max-w-[calc(100vw-1.5rem)]">
      <div role="alert" className={`rounded-2xl border-2 ${out.length ? "border-[#DC2626]" : "border-[#F59E0B]"} bg-white shadow-2xl p-4`}>
        <p className={`text-[11px] font-bold uppercase tracking-wide ${out.length ? "text-[#B91C1C]" : "text-[#B45309]"}`}>
          Restock needed
        </p>
        <ul className="mt-1 space-y-1 max-h-[180px] overflow-y-auto">
          {items.map((i) => (
            <li key={i.ingredientId} className="text-[13px] text-[#0F172A]">
              <span className="font-extrabold">{i.name}</span>{" "}
              <span className={i.status === "out" ? "font-bold text-[#B91C1C]" : "text-[#64748B]"}>
                {i.status === "out" ? "is out of stock" : `${qty(i.stockQuantity)} ${unitLabel(i.unit)} left (minimum ${qty(i.reorderLevel)})`}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setItems([])}
            className="flex-1 py-2 rounded-xl border border-[#E2E8F0] text-[#334155] text-sm font-bold hover:bg-[#F8FAFC]"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => {
              setItems([]);
              navigate("/settings?view=inventory");
            }}
            className="flex-1 py-2 rounded-xl bg-[#FD5302] text-white text-sm font-bold hover:bg-[#D64502]"
          >
            View inventory
          </button>
        </div>
      </div>
    </div>
  );
};

/** A yes/no question over the POS, in the till's confirmation style. */
const Question = ({ tone, title, message, busy, onNo, onYes, yesLabel }) => (
  <div className="fixed inset-0 z-[190] bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-[440px] bg-white rounded-2xl shadow-2xl p-6 space-y-4 text-[#0F172A]">
      <div className="flex items-start gap-3">
        <span
          className={`w-10 h-10 rounded-full flex items-center justify-center text-[18px] font-extrabold shrink-0 ${
            tone === "danger" ? "bg-[#FEE2E2] text-[#DC2626]" : "bg-[#DCFCE7] text-[#166534]"
          }`}
          aria-hidden="true"
        >
          {tone === "danger" ? "!" : "✓"}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16.5px] font-extrabold leading-snug">{title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#475569]">{message}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          disabled={busy}
          onClick={onNo}
          className="h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#475569] text-[13px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50"
        >
          No
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onYes}
          className={`h-[40px] px-5 rounded-xl text-white text-[13px] font-extrabold shadow-md disabled:opacity-50 ${
            tone === "danger" ? "bg-[#DC2626] hover:bg-[#B91C1C]" : "bg-[#FD5302] hover:bg-[#D64502]"
          }`}
          autoFocus
        >
          {yesLabel}
        </button>
      </div>
    </div>
  </div>
);

export default RestockAlert;
