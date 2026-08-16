import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import KnotLogo from "../shared/KnotLogo";
import {
  getTotalPrice,
  removeAllItems,
  removeItem,
  setCart,
  updateQuantity,
  updateItemNote,
} from "../../redux/slices/cartSlice";
import {
  removeCustomer,
  setCustomer,
  setSessionId,
  updateTable as updateTableAction,
} from "../../redux/slices/customerSlice";
import { setOrderType } from "../../redux/slices/orderTypeSlice";
import { addHeldOrder, removeHeldOrder } from "../../redux/slices/heldOrdersSlice";
import { addOrder, createTableSession, getTables, updateTable } from "../../https";
import Invoice from "../invoice/Invoice";
import CollectionModal from "./CollectionModal";
import DeliveryModal from "./DeliveryModal";
import TableModal from "./TableModal";

/* ---------- Icons (drawn to match the reference) ---------- */
const IconBag = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);
const IconScooter = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18.5" cy="17.5" r="3.5" />
    <circle cx="5.5" cy="17.5" r="3.5" />
    <path d="M15 6h3l3 7M9 17.5h6M5.5 17.5V13a3 3 0 0 1 3-3H12" />
  </svg>
);
const IconTable = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9h18M5 9v11M19 9v11M8 9V5M16 9V5M2 5h20" />
  </svg>
);
const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);
const IconPencil = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IconClock = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const IconArrowRight = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const ORDER_TYPES = [
  { key: "Collection", label: "Collection", Icon: IconBag },
  { key: "Delivery", label: "Delivery", Icon: IconScooter },
  { key: "Table Service", label: "Table", Icon: IconTable },
];

const OrderPanel = () => {
  const dispatch = useDispatch();
  const qc = useQueryClient();
  const cart = useSelector((s) => s.cart);
  const user = useSelector((s) => s.user);
  const customer = useSelector((s) => s.customer);
  const orderType = useSelector((s) => s.orderType.orderType);
  const heldOrders = useSelector((s) => s.heldOrders);
  const subtotal = useSelector(getTotalPrice);

  const discount = 0;
  const taxRate = 5.25;
  const tax = (subtotal * taxRate) / 100;
  const total = subtotal - discount + tax;

  const [clock, setClock] = useState(new Date());
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [showCollection, setShowCollection] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [showHeldOrders, setShowHeldOrders] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const isTable = orderType === "Table Service";

  const { data: tablesRes } = useQuery({
    queryKey: ["tables"],
    queryFn: getTables,
    enabled: isTable,
  });
  const tables = tablesRes?.data?.data || [];

  const tableUpdate = useMutation({ mutationFn: (d) => updateTable(d) });

  const orderMutation = useMutation({
    mutationFn: (d) => addOrder(d),
    onSuccess: (res) => {
      const data = res.data?.data;
      setInvoice(data);
      if (data?.table) {
        setTimeout(
          () => tableUpdate.mutate({ status: "occupied", orderId: data._id, tableId: data.table }),
          800
        );
      }
      enqueueSnackbar("Order completed!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["popular-items"] });
      qc.invalidateQueries({ queryKey: ["tables"] });
      setShowCollection(false);
      setShowDelivery(false);
      setShowTable(false);
      dispatch(removeAllItems());
      dispatch(removeCustomer());
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to complete order.", { variant: "error" }),
  });

  const sessionMutation = useMutation({
    mutationFn: (d) => createTableSession(d),
    onSuccess: (res) => {
      const s = res.data?.data;
      if (s?._id) dispatch(setSessionId(s._id));
      enqueueSnackbar("Order attached to table!", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["table-sessions"] });
      setShowTable(false);
      dispatch(removeAllItems());
      dispatch(removeCustomer());
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to attach order to table.", { variant: "error" }),
  });

  const busy = orderMutation.isPending || sessionMutation.isPending;
  const count = cart.reduce((n, i) => n + (i.quantity || 1), 0);

  const base = ({ name, phone, deliveryAddress, apiType, table }) => ({
    customerDetails: { name, phone, guests: 1 },
    orderType: apiType,
    bills: { subtotal, total: subtotal, tax, totalWithTax: total, discount },
    items: cart,
    paymentMethod: "Cash",
    ...(deliveryAddress ? { deliveryAddress } : {}),
    ...(table ? { table } : {}),
  });

  const guard = () => {
    if (cart.length === 0) {
      enqueueSnackbar("Cart is empty — add products first.", { variant: "warning" });
      return false;
    }
    return true;
  };

  const finish = () => {
    if (!guard()) return;
    if (orderType === "Delivery") return setShowDelivery(true);
    if (isTable) return setShowTable(true);
    setShowCollection(true);
  };

  const doCollection = ({ name, phone }) => {
    dispatch(setCustomer({ name, phone, guests: 1 }));
    orderMutation.mutate(base({ name, phone, apiType: "collection" }));
  };

  const doDelivery = ({ name, phone, deliveryAddress }) => {
    dispatch(setCustomer({ name, phone, guests: 1 }));
    orderMutation.mutate(base({ name, phone, deliveryAddress, apiType: "delivery" }));
  };

  const doTable = ({ table, guests }) => {
    dispatch(updateTableAction({ table }));
    sessionMutation.mutate({
      tableId: table.tableId,
      items: cart.map((i) => ({
        menuItemId: i.menuItemId,
        quantity: i.quantity,
        variantId: i.variantId || null,
        addonIds: i.addonIds || [],
        modifierSelections: i.modifierSelections || {},
        note: i.note || "",
      })),
      customerCount: guests,
      customerName: customer.customerName || "",
      customerPhone: customer.customerPhone || "",
    });
  };

  const hold = () => {
    if (!guard()) return;

    dispatch(addHeldOrder({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      items: cart,
      customer: {
        customerName: customer.customerName,
        customerPhone: customer.customerPhone,
        guests: customer.guests,
        table: customer.table,
        sessionId: customer.sessionId,
      },
      orderType,
      createdAt: new Date().toISOString(),
    }));
    dispatch(removeAllItems());
    dispatch(removeCustomer());
    dispatch(setOrderType("Collection"));
    setShowHeldOrders(false);
    enqueueSnackbar("Order held. The cart is ready for the next customer.", { variant: "success" });
  };

  const resumeHeldOrder = (heldOrder) => {
    if (cart.length > 0) {
      enqueueSnackbar("Finish or hold the current order before resuming another one.", { variant: "warning" });
      return;
    }

    const savedCustomer = heldOrder.customer || {};
    dispatch(setCart(heldOrder.items || []));
    dispatch(removeCustomer());
    dispatch(setCustomer({
      name: savedCustomer.customerName || "",
      phone: savedCustomer.customerPhone || "",
      guests: savedCustomer.guests || 0,
    }));
    if (savedCustomer.table) dispatch(updateTableAction({ table: savedCustomer.table }));
    if (savedCustomer.sessionId) dispatch(setSessionId(savedCustomer.sessionId));
    dispatch(setOrderType(heldOrder.orderType || "Collection"));
    dispatch(removeHeldOrder(heldOrder.id));
    setShowHeldOrders(false);
    enqueueSnackbar("Held order resumed.", { variant: "success" });
  };

  const deleteHeldOrder = (heldOrder) => {
    if (window.confirm("Delete this held order? This cannot be undone.")) {
      dispatch(removeHeldOrder(heldOrder.id));
    }
  };

  const money = (n) => `₹${Number(n || 0).toFixed(2)}`;

  return (
    <aside className="w-[380px] shrink-0 h-full bg-white border-l border-[#E2E8F0] flex flex-col">
      {/* ===== Store header ===== */}
      <div className="px-4 py-3.5 flex items-center gap-3 border-b border-[#E2E8F0] shrink-0">
        <div className="w-[42px] h-[42px] rounded-full bg-[#0B1120] flex items-center justify-center shrink-0">
          <KnotLogo size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold text-[#0F172A] truncate leading-tight">
            {user.name || "KnotKitchen Store"}
          </p>
          <p className="text-[11.5px] text-[#94A3B8] truncate">
            Store ID: {user.storeId || "—"}
          </p>
        </div>
        <span className="px-2 py-[3px] rounded-full bg-[#DCFCE7] text-[#15803D] text-[10.5px] font-bold flex items-center gap-1 shrink-0">
          <span className="w-[5px] h-[5px] rounded-full bg-[#22C55E]" /> Online
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[#94A3B8]"><IconClock /></span>
          <div className="text-right leading-tight">
            <p className="text-[12.5px] font-bold text-[#0F172A]">
              {clock.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-[10px] text-[#94A3B8]">
              {clock.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>
      </div>

      {/* ===== Order type tabs ===== */}
      <div className="px-4 py-3 shrink-0 grid grid-cols-3 gap-2">
        {ORDER_TYPES.map(({ key, label, Icon }) => {
          const on = orderType === key;
          return (
            <button
              key={key}
              onClick={() => dispatch(setOrderType(key))}
              className={`h-[46px] rounded-xl flex items-center justify-center gap-2 text-[13.5px] font-bold border transition-all ${
                on
                  ? "bg-[#5B42F3] text-white border-[#5B42F3] shadow-[0_6px_16px_-6px_rgba(91,66,243,0.6)]"
                  : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
              }`}
            >
              <Icon />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* ===== Cart header ===== */}
      <div className="px-4 pb-2 shrink-0 flex items-center justify-between border-b border-[#E2E8F0] pt-1">
        <h3 className="text-[16px] font-extrabold text-[#0F172A] pb-2">Order Cart ({count})</h3>
        <div className="flex items-center gap-3 pb-2">
          {heldOrders.length > 0 && (
            <button
              onClick={() => setShowHeldOrders(true)}
              className="text-[12.5px] font-bold text-[#5B42F3] flex items-center gap-1 hover:text-[#4A32E0]"
            >
              <IconClock /> Held ({heldOrders.length})
            </button>
          )}
          {cart.length > 0 && (
            <button
              onClick={() => {
                dispatch(removeAllItems());
              }}
              className="text-[12.5px] font-bold text-[#EF4444] flex items-center gap-1 hover:text-[#DC2626]"
            >
              <IconTrash /> Clear Cart
            </button>
          )}
        </div>
      </div>

      {/* ===== Cart items — NO IMAGES ===== */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {cart.length === 0 ? (
          <div className="text-center py-14">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#F1F5F9] flex items-center justify-center text-[#94A3B8] mb-2">
              <IconBag />
            </div>
            <p className="text-[13.5px] font-bold text-[#334155]">Cart is empty</p>
            <p className="text-[12px] text-[#94A3B8] mt-0.5">Tap a product to add it.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cart.map((item) => (
              <div key={item.id} className="flex items-center gap-2.5">
                {/* Name + variant */}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-[#0F172A] truncate leading-tight">
                    {item.name}
                  </p>
                  {item.variant?.name && (
                    <p className="text-[12px] text-[#94A3B8] leading-tight">{item.variant.name}</p>
                  )}
                  {item.note && (
                    <p className="text-[11px] text-[#5B42F3] font-semibold truncate leading-tight">
                      {item.note}
                    </p>
                  )}
                </div>

                {/* Qty stepper */}
                <div className="flex items-center gap-2 rounded-lg border border-[#E2E8F0] px-1.5 h-[30px] shrink-0">
                  <button
                    onClick={() =>
                      (item.quantity || 0) <= 1
                        ? dispatch(removeItem(item.id))
                        : dispatch(updateQuantity({ id: item.id, quantity: item.quantity - 1 }))
                    }
                    className="w-[18px] text-[#475569] hover:text-[#5B42F3] text-[15px] font-bold leading-none"
                  >
                    −
                  </button>
                  <span className="text-[13px] font-extrabold text-[#0F172A] min-w-[14px] text-center">
                    {item.quantity}
                  </span>
                  <button
                    onClick={() => dispatch(updateQuantity({ id: item.id, quantity: item.quantity + 1 }))}
                    className="w-[18px] text-[#475569] hover:text-[#5B42F3] text-[15px] font-bold leading-none"
                  >
                    +
                  </button>
                </div>

                {/* Price */}
                <span className="text-[14px] font-extrabold text-[#0F172A] w-[62px] text-right shrink-0">
                  {money(item.price)}
                </span>

                {/* Remove */}
                <button
                  onClick={() => {
                    dispatch(removeItem(item.id));
                  }}
                  className="text-[#CBD5E1] hover:text-[#EF4444] text-[18px] leading-none shrink-0 w-4"
                  title="Remove item"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Add item note ===== */}
      {cart.length > 0 && (
        <div className="px-4 pb-3 shrink-0">
          <button
            onClick={() => {
              const last = cart[cart.length - 1];
              setNoteFor(last);
              setNoteText(last.note || "");
            }}
            className="text-[13px] font-bold text-[#5B42F3] flex items-center gap-1.5 hover:underline"
          >
            <IconPencil /> Add Item Note
          </button>
        </div>
      )}

      {/* ===== Summary ===== */}
      <div className="px-4 py-3 border-t border-[#E2E8F0] shrink-0 space-y-2">
        <div className="flex items-center justify-between text-[13.5px]">
          <span className="text-[#475569]">Subtotal</span>
          <span className="font-bold text-[#0F172A]">{money(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-[13.5px]">
          <span className="text-[#475569]">Discount</span>
          <span className="font-bold text-[#16A34A]">- {money(discount)}</span>
        </div>
        <div className="flex items-center justify-between text-[13.5px]">
          <span className="text-[#475569]">Tax</span>
          <span className="font-bold text-[#0F172A]">{money(tax)}</span>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
          <span className="text-[17px] font-extrabold text-[#0F172A]">Total</span>
          <span className="text-[22px] font-extrabold text-[#5B42F3]">{money(total)}</span>
        </div>
      </div>

      {/* ===== Actions ===== */}
      <div className="px-4 pb-4 shrink-0 grid grid-cols-[1fr_1.35fr] gap-2.5">
        <button
          onClick={hold}
          className="h-[50px] rounded-xl border border-[#5B42F3] bg-white text-[#5B42F3] text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#EEF0FE] transition-colors"
        >
          <IconClock /> Hold Order
        </button>
        <button
          onClick={finish}
          disabled={busy}
          className="h-[50px] rounded-xl bg-[#5B42F3] text-white text-[14.5px] font-bold flex items-center justify-center gap-2 shadow-[0_8px_20px_-8px_rgba(91,66,243,0.7)] hover:bg-[#4A32E0] disabled:opacity-50 transition-colors"
        >
          {busy ? "Processing…" : "Finish Order"} {!busy && <IconArrowRight />}
        </button>
      </div>

      {/* ===== Note modal ===== */}
      {noteFor && (
        <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-xl p-5">
            <h3 className="text-[17px] font-extrabold text-[#0F172A]">Add Item Note</h3>
            <p className="text-[12.5px] text-[#94A3B8] mt-1 mb-3">
              Note for <span className="font-bold text-[#334155]">{noteFor.name}</span>
            </p>
            <textarea
              rows={3}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="e.g. Extra spicy, no onions…"
              className="w-full rounded-xl border border-[#E2E8F0] p-3 text-[13.5px] resize-none focus:border-[#5B42F3]"
            />
            <div className="grid grid-cols-2 gap-2.5 mt-4">
              <button
                onClick={() => setNoteFor(null)}
                className="h-[44px] rounded-xl border border-[#E2E8F0] text-[#334155] text-[14px] font-bold hover:bg-[#F8FAFC]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  dispatch(updateItemNote({ id: noteFor.id, note: noteText.trim() }));
                  setNoteFor(null);
                }}
                className="h-[44px] rounded-xl bg-[#5B42F3] text-white text-[14px] font-bold hover:bg-[#4A32E0]"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Finish-order modals ===== */}
      {showCollection && (
        <CollectionModal
          initialName={customer.customerName}
          initialPhone={customer.customerPhone}
          total={total}
          busy={busy}
          onClose={() => setShowCollection(false)}
          onConfirm={doCollection}
        />
      )}
      {showDelivery && (
        <DeliveryModal
          initialName={customer.customerName}
          initialPhone={customer.customerPhone}
          total={total}
          busy={busy}
          onClose={() => setShowDelivery(false)}
          onConfirm={doDelivery}
        />
      )}
      {showTable && (
        <TableModal
          tables={tables}
          busy={busy}
          onClose={() => setShowTable(false)}
          onConfirm={doTable}
        />
      )}

      {invoice && <Invoice orderInfo={invoice} setShowInvoice={() => setInvoice(null)} />}

      {showHeldOrders && (
        <div className="fixed inset-0 z-[95] bg-[#0F172A]/55 flex items-center justify-center p-4">
          <div className="w-full max-w-[500px] max-h-[80vh] overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
              <div>
                <h3 className="text-[18px] font-extrabold text-[#0F172A]">Held Orders</h3>
                <p className="mt-1 text-[12.5px] text-[#94A3B8]">Resume an order when the customer is ready.</p>
              </div>
              <button
                onClick={() => setShowHeldOrders(false)}
                className="h-8 w-8 rounded-lg text-[20px] leading-none text-[#94A3B8] hover:bg-[#FEF2F2] hover:text-[#DC2626]"
                aria-label="Close held orders"
              >
                ×
              </button>
            </div>
            <div className="max-h-[calc(80vh-88px)] overflow-y-auto p-4">
              <div className="space-y-2.5">
                {heldOrders.map((heldOrder, index) => {
                  const itemCount = (heldOrder.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
                  const heldTotal = (heldOrder.items || []).reduce((sum, item) => sum + Number(item.price || 0), 0);
                  const customerName = heldOrder.customer?.customerName || "Walk-in customer";
                  return (
                    <div key={heldOrder.id} className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-extrabold text-[#0F172A]">
                          {customerName}
                        </p>
                        <p className="mt-0.5 text-[12px] text-[#64748B]">
                          {heldOrder.orderType || "Collection"} · {itemCount} item{itemCount === 1 ? "" : "s"} · {money(heldTotal)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#94A3B8]">Held order #{heldOrders.length - index}</p>
                      </div>
                      <button
                        onClick={() => resumeHeldOrder(heldOrder)}
                        className="h-9 rounded-lg bg-[#5B42F3] px-3 text-[12px] font-bold text-white hover:bg-[#4A32E0]"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => deleteHeldOrder(heldOrder)}
                        className="h-9 w-9 rounded-lg border border-[#FECACA] text-[18px] leading-none text-[#DC2626] hover:bg-[#FEF2F2]"
                        title="Delete held order"
                        aria-label="Delete held order"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

export default OrderPanel;
