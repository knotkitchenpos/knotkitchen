import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import KnotLogo from "../shared/KnotLogo";
import {
  getTotalPrice,
  removeAllItems,
  removeItem,
  removeModifier,
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
import {
  clearDiscount,
  computeDiscountAmount,
  formatDiscountLabel,
  setFixedDiscount,
  setPercentDiscount,
} from "../../redux/slices/discountSlice";
import {
  addOrder,
  createPaymentLink,
  createTableSession,
  addItemsToTableSession,
  getStoreProperties,
  getTables,
  updateTable,
} from "../../https";

import { getMyRestaurant } from "../../https/newModules";
import { getWebsiteSettings } from "../../https/storefrontApi";
import Invoice from "../invoice/Invoice";
import { receiptAddress } from "../../utils/address";
import { toOrderItems } from "../../utils/orderItems";
import CollectionModal from "./CollectionModal";
import DeliveryModal from "./DeliveryModal";
import DiscountModal from "./DiscountModal";
import PaymentMethodModal from "./PaymentMethodModal";
import PaymentLinkResultModal from "./PaymentLinkResultModal";
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
const IconTag = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41 12 22l-9-9V3h10z" />
    <circle cx="7" cy="7" r="1.5" />
  </svg>
);

const ORDER_TYPES = [
  { key: "Collection", label: "Collection", Icon: IconBag },
  { key: "Delivery", label: "Delivery", Icon: IconScooter },
  { key: "Table Service", label: "Table", Icon: IconTable },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const OrderPanel = () => {
  const dispatch = useDispatch();
  const qc = useQueryClient();
  const cart = useSelector((s) => s.cart);
  const user = useSelector((s) => s.user);
  const customer = useSelector((s) => s.customer);
  const orderType = useSelector((s) => s.orderType.orderType);
  const heldOrders = useSelector((s) => s.heldOrders);
  const discount = useSelector((s) => s.discount);
  const subtotal = useSelector(getTotalPrice);

  const [clock, setClock] = useState(new Date());
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [showDiscount, setShowDiscount] = useState(false);
  const [showPaymentMethod, setShowPaymentMethod] = useState(false);
  const [pendingMethod, setPendingMethod] = useState(null); // "cash" | "qr" | "link"
  const [showCollection, setShowCollection] = useState(false);
  const [showDelivery, setShowDelivery] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [invoice, setInvoice] = useState(null);
  const [paymentLinkResult, setPaymentLinkResult] = useState(null);
  const [showHeldOrders, setShowHeldOrders] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const isTable = orderType === "Table Service";
  const isDelivery = orderType === "Delivery";

  const { data: tablesRes } = useQuery({
    queryKey: ["tables"],
    queryFn: getTables,
    enabled: isTable,
  });
  const tables = tablesRes?.data?.data || [];

  /*
   * Restaurant branding + ordering configuration.
   *
   * We reuse two authenticated tenant endpoints already exposed elsewhere:
   *
   *   1. /api/restaurant/me → restaurant.logo + restaurant.name.
   *   2. /api/website/settings → the *authoritative* source for pricing
   *      config (taxPercent, taxInclusive, packagingFee, deliveryFee,
   *      freeDeliveryAbove, minOrderValue, currency…). We use the SAME
   *      config that the server-side orderPricingService uses so the POS
   *      preview matches whatever the backend will ultimately charge.
   *
   * If either endpoint fails we fall back to safe defaults (no tax, no
   * charges, keep going). The BACKEND is still the source of truth: it
   * re-sanitises `bills.*` on every addOrder call (see sanitizeBills in
   * orderController). That means even if a bad tax rate leaks through the
   * client, no persistence-level damage can occur.
   */
  const { data: restaurantRes } = useQuery({
    queryKey: ["restaurant", "me"],
    queryFn: getMyRestaurant,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { data: websiteRes } = useQuery({
    queryKey: ["website", "settings"],
    queryFn: getWebsiteSettings,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { data: propsRes } = useQuery({
    queryKey: ["store-properties"],
    queryFn: getStoreProperties,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const storeProps = propsRes?.data?.data || {};
  const orderTypeToggles = storeProps.orderTypeToggles || { collection: true, delivery: true, table: true };

  const restaurant = restaurantRes?.data?.data;

  const websiteSettings = websiteRes?.data?.data?.settings;
  const ordering = websiteSettings?.ordering || {};
  const restaurantLogo =
    storeProps.restaurantLogo ||
    websiteSettings?.branding?.logo?.url ||
    restaurant?.branding?.logo ||
    restaurant?.logo ||
    "";
  /*
   * Header MUST show the RESTAURANT / STORE name, never the logged-in
   * user's name. We deliberately do NOT fall back to `user.name` any
   * more — that was the bug that surfaced "raja" (staff/owner name)
   * where the restaurant name should be.
   *
   * Resolution order (all tenant-scoped, multi-store safe):
   *   1. Store Properties API (`storeName` — the canonical Module 7
   *      value the operator edits under Settings → Store Properties).
   *   2. /api/restaurant/me `restaurant.name`.
   *   3. Website Settings branding `storeName`.
   *   4. Generic "KnotKitchen Store" placeholder only if none of the
   *      tenant-scoped sources have populated yet (initial page load).
   */
  const restaurantName =
    storeProps.storeName ||
    restaurant?.name ||
    websiteSettings?.branding?.storeName ||
    "";
  const displayName = restaurantName || "KnotKitchen Store";
  const displayInitial = (displayName.trim()[0] || "K").toUpperCase();

  /*
   * ===== Live bill calculation (Module 2 §6) =====
   *
   * Order of operations mirrors the backend orderPricingService exactly so
   * the "Total payable" number the biller sees matches the number the
   * server will save:
   *
   *   1. subtotal       = Σ line.price  (already qty × unit)
   *   2. discountAmount = clamped percent/fixed against subtotal
   *   3. taxableBase    = (subtotal − discount) + packagingFee
   *   4. tax            = taxableBase × taxPercent  (or extracted if inclusive)
   *   5. deliveryFee    = configured fee, waived above freeDeliveryAbove
   *   6. totalWithTax   = subtotal − discount + packagingFee + deliveryFee
   *                       + (taxInclusive ? 0 : tax)
   *
   * Backend fallback rate: if the tenant has never configured
   * ordering.taxPercent we apply 0 % (not the legacy 5.25 %). Any store
   * that wants a specific GST must set it via WebsiteSettings → ordering.
   * This is intentional — silently applying a 5.25 % rate to a store that
   * never asked for it is a real-world compliance risk. The old hardcoded
   * rate was OK for a demo but has to go once real merchants exist.
   */
  const taxPercent = Math.max(0, Math.min(100, Number(ordering.taxPercent) || 0));
  const taxInclusive = !!ordering.taxInclusive;
  const packagingFee = Math.max(0, Number(ordering.packagingFee) || 0);
  const minOrderValue = Math.max(0, Number(ordering.minOrderValue) || 0);
  const currencySymbol = ordering.currencySymbol || "₹";

  const discountAmount = useMemo(
    () => computeDiscountAmount(discount, subtotal),
    [discount, subtotal],
  );

  const postDiscount = Math.max(0, round2(subtotal - discountAmount));

  const deliveryFee = useMemo(() => {
    if (!isDelivery) return 0;
    const fee = Math.max(0, Number(ordering.deliveryFee) || 0);
    const freeAbove = Math.max(0, Number(ordering.freeDeliveryAbove) || 0);
    if (freeAbove > 0 && postDiscount >= freeAbove) return 0;
    return fee;
  }, [isDelivery, ordering.deliveryFee, ordering.freeDeliveryAbove, postDiscount]);

  const taxableBase = round2(postDiscount + packagingFee);
  const tax = useMemo(() => {
    if (taxPercent <= 0) return 0;
    if (taxInclusive) {
      return round2(taxableBase - taxableBase / (1 + taxPercent / 100));
    }
    return round2((taxableBase * taxPercent) / 100);
  }, [taxableBase, taxPercent, taxInclusive]);

  const totalWithTax = round2(
    postDiscount + packagingFee + deliveryFee + (taxInclusive ? 0 : tax),
  );

  const billsForOrder = useMemo(
    () => ({
      subtotal: round2(subtotal),
      total: round2(postDiscount),
      tax,
      totalWithTax,
      discount: round2(discountAmount),
      deliveryFee,
      packagingFee,
    }),
    [subtotal, postDiscount, tax, totalWithTax, discountAmount, deliveryFee, packagingFee],
  );

  // Clear stale discount when the cart empties so a fresh customer doesn't
  // inherit the previous order's discount. Persistence is already disabled
  // for the discount slice, but the in-memory state survives cart mutations.
  useEffect(() => {
    if (cart.length === 0 && discount.mode !== "none") {
      dispatch(clearDiscount());
    }
  }, [cart.length, discount.mode, dispatch]);

  const tableUpdate = useMutation({ mutationFn: (d) => updateTable(d) });

  const paymentLinkMutation = useMutation({
    mutationFn: createPaymentLink,
  });

  /*
   * The single order-create mutation. `variables` carries the chosen
   * paymentMethod so we can decide whether to (a) close the order + open
   * the invoice (cash/qr) or (b) chain a payment-link creation and leave
   * the order pending (link). This is where §5 "do not immediately
   * finalize a Pay by Link order as paid" is enforced on the client.
   */
  const orderMutation = useMutation({
    mutationFn: (d) => addOrder(d),
    onSuccess: async (res, variables) => {
      const data = res.data?.data;
      if (data?.table) {
        setTimeout(
          () => tableUpdate.mutate({ status: "occupied", orderId: data._id, tableId: data.table }),
          800,
        );
      }
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["popular-items"] });
      qc.invalidateQueries({ queryKey: ["tables"] });

      // "Pay via Link" — create the payment link but DO NOT show the invoice
      // and DO NOT clear the cart until the link is generated (so if link
      // creation fails, the operator can retry without re-entering the order).
      if (variables?.paymentMethod === "link") {
        try {
          const linkRes = await paymentLinkMutation.mutateAsync({
            orderId: data._id,
            phone: data.customerDetails?.phone || variables?._phone || "",
            expiresInHours: 24,
          });
          setPaymentLinkResult(linkRes.data?.data);
          setShowPaymentMethod(false);
          setShowCollection(false);
          setShowDelivery(false);
          dispatch(removeAllItems());
          dispatch(removeCustomer());
          dispatch(clearDiscount());
          enqueueSnackbar(
            "Order created. Share the payment link — the order will finalise once the customer pays.",
            { variant: "success" },
          );
        } catch (e) {
          enqueueSnackbar(
            e.response?.data?.message ||
              "Order was created but the payment link could not be generated. Please retry from Orders.",
            { variant: "error" },
          );
          // Even on link failure, the order exists — clear the cart so the
          // biller doesn't re-submit and end up with a duplicate.
          setShowPaymentMethod(false);
          setShowCollection(false);
          setShowDelivery(false);
          dispatch(removeAllItems());
          dispatch(removeCustomer());
          dispatch(clearDiscount());
        }
        return;
      }

      // Cash / QR — show the invoice + close the modals.
      enqueueSnackbar("Order completed!", { variant: "success" });
      setInvoice(data);
      setShowPaymentMethod(false);
      setShowCollection(false);
      setShowDelivery(false);
      setShowTable(false);
      dispatch(removeAllItems());
      dispatch(removeCustomer());
      dispatch(clearDiscount());
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to complete order.", { variant: "error" }),
  });

  /**
   * Adding to a table that is already running an order.
   *
   * The only way to put another dish on an occupied table used to be to start
   * a NEW session for it, which the server refuses -- the table is occupied.
   * So a QR order could never be topped up from the till: Add Item led to the
   * menu, Finish asked for a table, and the table it wanted was the one the
   * diner was already sitting at.
   *
   * The endpoint for appending has existed all along; nothing called it.
   */
  const appendMutation = useMutation({
    mutationFn: ({ sessionId, items, customerCount }) =>
      addItemsToTableSession({ sessionId, items, customerCount }),
    onSuccess: () => {
      enqueueSnackbar("Items added to the table's order.", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["table-sessions"] });
      setShowTable(false);
      dispatch(removeAllItems());
      dispatch(removeCustomer());
      dispatch(clearDiscount());
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to add items to the table.", { variant: "error" }),
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
      dispatch(clearDiscount());
    },
    onError: (e) =>
      enqueueSnackbar(e.response?.data?.message || "Failed to attach order to table.", { variant: "error" }),
  });

  const busy =
    orderMutation.isPending ||
    sessionMutation.isPending ||
    appendMutation.isPending ||
    paymentLinkMutation.isPending;

  /**
   * The session this cart is already attached to, if any.
   *
   * Set by Manage Tables → Add Item before it sends the biller here, and by
   * the session mutation once a table order has been started from the till.
   * Its presence is what turns Finish from "attach to a table" into "add to
   * the order that table already has".
   */
  const activeSessionId = customer.sessionId || customer.table?.activeSessionId || "";
  const count = cart.reduce((n, i) => n + (i.quantity || 1), 0);

  /**
   * Build the order payload. `guests` is intentionally omitted for
   * collection/delivery so the backend uses its schema default of 1 without
   * us pretending we captured a real guest count (Module 2 §4). Table
   * Service still supplies guests via TableModal because table capacity is
   * a real constraint there.
   */
  const buildOrderPayload = ({
    name,
    phone,
    // Module 4 §5 — structured extra customer fields (optional). They flow
    // into customerDetails so the Orders → Order Details view can render
    // Address / City / PIN Code / Delivery Note without a second lookup.
    address,
    city,
    pinCode,
    deliveryNote,
    deliveryAddress,
    apiType,
    table,
    paymentMethod,
  }) => {
    const customerDetails = {};
    if (name) customerDetails.name = name;
    if (phone) customerDetails.phone = phone;
    if (address) customerDetails.address = address;
    if (city) customerDetails.city = city;
    if (pinCode) customerDetails.pinCode = pinCode;
    if (deliveryNote) customerDetails.deliveryNote = deliveryNote;
    return {
      customerDetails,
      orderType: apiType,

      bills: billsForOrder,
      // Mapped, not posted raw: the cart keeps the LINE total in `price`,
      // the API expects the UNIT there with the line in `total`.
      items: toOrderItems(cart),
      // paymentMethod tells the backend which channel the order came from,
      // but the actual "paid" vs "pending" state lives in `payments[]` and
      // for Pay-by-Link is only set to paid by verifyAndCaptureLinkPayment.
      //
      // No default. This used to fall back to "Cash" when no method had been
      // chosen, and the backend treats Cash as taken at the till: the order
      // was created Completed with a paid cash payment against it, for money
      // nobody had collected. An order with no method chosen must reach the
      // server with none, and show a blank payment method until it is paid.
      ...(paymentMethod === "cash"
        ? { paymentMethod: "Cash" }
        : paymentMethod === "qr"
        ? { paymentMethod: "UPI" }
        : paymentMethod === "link"
        ? { paymentMethod: "PaymentLink" }
        : {}),
      ...(deliveryAddress ? { deliveryAddress } : {}),
      ...(table ? { table } : {}),
    };
  };

  /**
   * Client-side pre-submit validation (Module 2 §7).
   *
   * The backend re-runs all of these + a lot more (tenant scoping, table
   * capacity, order-type enum, price sanitisation). This is only here to
   * surface obvious problems immediately so the biller doesn't waste time
   * on a doomed round-trip.
   */
  const guard = () => {
    if (cart.length === 0) {
      enqueueSnackbar("Cart is empty — add products first.", { variant: "warning" });
      return false;
    }
    if (totalWithTax <= 0) {
      enqueueSnackbar("Order total must be greater than zero.", { variant: "warning" });
      return false;
    }
    if (minOrderValue > 0 && postDiscount < minOrderValue) {
      enqueueSnackbar(
        `Minimum order value is ${currencySymbol}${minOrderValue.toFixed(2)}.`,
        { variant: "warning" },
      );
      return false;
    }
    if (isDelivery && ordering.deliveryEnabled === false) {
      enqueueSnackbar("Delivery is disabled in your store settings.", { variant: "warning" });
      return false;
    }
    return true;
  };

  const finish = () => {
    if (!guard()) return;
    // Table Service has its own dedicated flow (session-based); it does not
    // go through the payment-method chooser because payment for a dine-in
    // table is captured later (via /pay/:token or at the till when the
    // session is closed).
    if (isTable) {
      // Already on a table: append rather than ask which table, which is the
      // question the biller has just answered by pressing Add Item on it.
      if (activeSessionId) return appendToSession(activeSessionId);
      return setShowTable(true);
    }
    setShowPaymentMethod(true);
  };

  // Payment method chosen inside PaymentMethodModal → route to the correct
  // customer-details modal or directly complete collection order using the on-page fields.
  const onPickPaymentMethod = (method) => {
    setPendingMethod(method);
    if (isDelivery) {
      setShowCollection(false);
      setShowDelivery(true);
      return;
    }
    // Collection — Customer Name and Phone Number are captured directly on the main page.
    const name = (customer.customerName || "").trim();
    const phone = (customer.customerPhone || "").trim();

    if (method === "link" && !phone) {
      enqueueSnackbar("A phone number is required to send the payment link.", { variant: "warning" });
      return;
    }

    setShowPaymentMethod(false);
    doCollection({ name, phone, chosenMethod: method });
  };

  const doCollection = ({ name, phone, address, city, pinCode, deliveryNote, chosenMethod }) => {
    const payMethod = chosenMethod || pendingMethod;
    if (payMethod === "link" && !phone) {
      enqueueSnackbar("A phone number is required to send the payment link.", { variant: "warning" });
      return;
    }
    if (name || phone) dispatch(setCustomer({ name, phone, guests: 0 }));
    orderMutation.mutate(
      buildOrderPayload({
        name,
        phone,
        address,
        city,
        pinCode,
        deliveryNote,
        apiType: "collection",
        paymentMethod: payMethod,
      }),
      { onSettled: () => {} },
    );
  };

  const doDelivery = ({
    name,
    phone,
    // Module 4 §5 — DeliveryModal now also passes the structured customer
    // fields so they end up on customerDetails alongside deliveryAddress.
    address,
    city,
    pinCode,
    deliveryNote,
    deliveryAddress,
  }) => {
    if (pendingMethod === "link" && !phone) {
      enqueueSnackbar("A phone number is required to send the payment link.", { variant: "warning" });
      return;
    }
    dispatch(setCustomer({ name, phone, guests: 0 }));
    orderMutation.mutate(
      buildOrderPayload({
        name,
        phone,
        address,
        city,
        pinCode,
        deliveryNote,
        deliveryAddress,
        apiType: "delivery",
        paymentMethod: pendingMethod,
      }),
    );
  };


  /** The cart, in the shape both session endpoints expect. */
  const sessionItems = () =>
    cart.map((i) => ({
      menuItemId: i.menuItemId || i._id,
      quantity: i.quantity,
      variantId: i.variantId || null,
      addonIds: i.addonIds || [],
      modifierSelections: i.modifierSelections || {},
      note: i.note || "",
    }));

  const appendToSession = (sessionId, customerCount) => {
    appendMutation.mutate({
      sessionId,
      items: sessionItems(),
      // Omitted unless the biller actually gave a new count: sending one
      // re-validates the table's capacity and overwrites the count the party
      // was seated with.
      ...(customerCount ? { customerCount } : {}),
    });
  };

  const doTable = ({ table, guests }) => {
    dispatch(updateTableAction({ table }));

    // A table picked from the list may already be running an order -- a QR
    // order, or one started earlier at the till. Adding to it is the only
    // thing that can work; asking the server for a second session on the same
    // table is what produced "table is occupied".
    const existing = table.session?._id || table.activeSessionId || "";
    if (existing) {
      dispatch(setSessionId(existing));
      appendToSession(existing, guests);
      return;
    }

    sessionMutation.mutate({
      tableId: table.tableId || table._id,
      items: sessionItems(),
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
      // Persist the discount snapshot too so a resumed order keeps its
      // agreed pricing rather than silently reverting to full price.
      discount: { mode: discount.mode, value: discount.value },
      createdAt: new Date().toISOString(),
    }));
    dispatch(removeAllItems());
    dispatch(removeCustomer());
    dispatch(clearDiscount());
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

    // Re-apply the held discount snapshot, if any.
    if (heldOrder.discount?.mode === "percent") {
      dispatch(setPercentDiscount(heldOrder.discount.value));
    } else if (heldOrder.discount?.mode === "fixed") {
      dispatch(setFixedDiscount(heldOrder.discount.value));
    } else {
      dispatch(clearDiscount());
    }

    dispatch(removeHeldOrder(heldOrder.id));
    setShowHeldOrders(false);
    enqueueSnackbar("Held order resumed.", { variant: "success" });
  };

  const deleteHeldOrder = (heldOrder) => {
    if (window.confirm("Delete this held order? This cannot be undone.")) {
      dispatch(removeHeldOrder(heldOrder.id));
    }
  };

  const money = (n) => `${currencySymbol}${Number(n || 0).toFixed(2)}`;
  const discountLabel = formatDiscountLabel(discount);

  return (
    <aside className="w-[380px] shrink-0 h-full bg-white border-l border-[#E2E8F0] flex flex-col">
      {/* ===== Store header ===== */}
      <div className="px-4 py-3.5 flex items-center gap-3 border-b border-[#E2E8F0] shrink-0">
        <div
          className={`w-[42px] h-[42px] rounded-full flex items-center justify-center shrink-0 overflow-hidden ${
            restaurantLogo ? "bg-white border border-[#E2E8F0]" : "bg-[#0B1120]"
          }`}
          title={displayName}
        >
          {restaurantLogo ? (
            <img
              src={restaurantLogo}
              alt={`${displayName} logo`}
              className="w-full h-full object-contain"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement?.classList.add("bg-[#0B1120]");
                const initial = e.currentTarget.parentElement?.querySelector(
                  "[data-logo-fallback]",
                );
                if (initial) initial.removeAttribute("hidden");
              }}
            />
          ) : (
            <KnotLogo size={26} />
          )}
          {restaurantLogo && (
            <span
              hidden
              data-logo-fallback
              className="text-white font-extrabold text-[16px]"
            >
              {displayInitial}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold text-[#0F172A] truncate leading-tight">
            {displayName}
          </p>
          <p className="text-[11.5px] text-[#94A3B8] truncate">
            Store ID: {user?.storeId || "—"}
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

      {/* ===== Order type tabs (Module 7 §4: Filtered by Order Type Toggles) ===== */}
      <div className="px-4 py-3 shrink-0 flex flex-wrap gap-2">
        {ORDER_TYPES.filter(({ key }) => {
          const k = key === "Table Service" ? "table" : key.toLowerCase();
          return orderTypeToggles[k] !== false;
        }).map(({ key, label, Icon }) => {
          const on = orderType === key;
          return (
            <button
              key={key}
              onClick={() => dispatch(setOrderType(key))}
              className={`flex-1 min-w-[90px] h-[46px] rounded-xl flex items-center justify-center gap-2 text-[13.5px] font-bold border transition-all ${
                on
                  ? "bg-[#FD5302] text-white border-[#FD5302] shadow-[0_6px_16px_-6px_rgba(253,83,2,0.6)]"
                  : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
              }`}
            >
              <Icon />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* ===== Collection Customer Info (directly on page for faster ordering) ===== */}
      {!isTable && !isDelivery && (
        <div className="px-4 pb-3 shrink-0">
          <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-extrabold text-[#0F172A] uppercase tracking-wider flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Customer Info
              </span>
              <span className="text-[10.5px] font-semibold text-[#94A3B8]">Optional for Walk-in</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <input
                  type="text"
                  value={customer.customerName || ""}
                  onChange={(e) =>
                    dispatch(
                      setCustomer({
                        name: e.target.value,
                        phone: customer.customerPhone || "",
                        guests: customer.guests || 0,
                      })
                    )
                  }
                  placeholder="Customer Name"
                  maxLength={120}
                  className="w-full h-[36px] px-3 bg-white rounded-lg border border-[#E2E8F0] text-[13px] font-medium text-[#0F172A] placeholder-[#94A3B8] focus:border-[#FD5302] focus:ring-1 focus:ring-[#FD5302] outline-none transition-all"
                />
              </div>

              <div>
                <input
                  type="tel"
                  value={customer.customerPhone || ""}
                  onChange={(e) =>
                    dispatch(
                      setCustomer({
                        name: customer.customerName || "",
                        phone: e.target.value,
                        guests: customer.guests || 0,
                      })
                    )
                  }
                  placeholder="Phone Number (+91…)"
                  maxLength={20}
                  className="w-full h-[36px] px-3 bg-white rounded-lg border border-[#E2E8F0] text-[13px] font-medium text-[#0F172A] placeholder-[#94A3B8] focus:border-[#FD5302] focus:ring-1 focus:ring-[#FD5302] outline-none transition-all"
                />
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ===== Cart header ===== */}
      <div className="px-4 pb-2 shrink-0 flex items-center justify-between border-b border-[#E2E8F0] pt-1">
        <h3 className="text-[16px] font-extrabold text-[#0F172A] pb-2">Order Cart ({count})</h3>
        <div className="flex items-center gap-3 pb-2">
          {heldOrders.length > 0 && (
            <button
              onClick={() => setShowHeldOrders(true)}
              className="text-[12.5px] font-bold text-[#C2410C] flex items-center gap-1 hover:text-[#C2410C]"
            >
              <IconClock /> Held ({heldOrders.length})
            </button>
          )}
          {cart.length > 0 && (
            <button
              onClick={() => dispatch(removeAllItems())}
              className="text-[12.5px] font-bold text-[#EF4444] flex items-center gap-1 hover:text-[#DC2626]"
            >
              <IconTrash /> Clear Cart
            </button>
          )}
        </div>
      </div>

      {/* ===== Cart items ===== */}
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
          <div className="space-y-5">
            {cart.map((item) => {
              // Split display name into the true product name and any modifier tokens
              // (added via " (+ Modifier1, Modifier2)" by ProductPanel's add flow).
              const nameSplit = String(item.name || "").split(/\s*\(\+\s*/);
              const baseName = nameSplit[0].replace(/\s*\(([^()]+)\)\s*$/, (m, inside) => {
                // Preserve variant suffix like "(Large)" on the base line.
                return item.variant?.name && inside === item.variant.name ? ` (${inside})` : m;
              });
              const modifierStr = nameSplit.length > 1
                ? nameSplit.slice(1).join(" (+ ").replace(/\)\s*$/, "")
                : "";
              const modifierTokens = modifierStr
                ? modifierStr.split(",").map((t) => t.trim()).filter(Boolean)
                : [];

              // Structured modifier entries (from ProductPanel POS customization flow).
              const structuredMods = Array.isArray(item.modifiers) ? item.modifiers : [];

              // `item.price` is the LINE TOTAL (unit x quantity) -- see cartSlice,
              // where addItems and updateQuantity both write
              // `price = pricePerQuantity * quantity`. Subtracting a per-unit
              // modifier figure from it, and then multiplying by quantity again
              // below, counted the quantity twice: a 100 item taken 2x showed
              // 400 on the line while the subtotal correctly said 200.
              const modifiersUnitPrice = structuredMods.reduce(
                (s, m) => s + Number(m?.price || 0) * Number(m?.quantity || 1),
                0,
              );
              const lineQuantity = Math.max(1, Number(item.quantity) || 1);
              // Prefer the stored unit price; fall back to dividing the line
              // total for carts restored from a held order, which predate it.
              const unitPrice =
                Number(item.pricePerQuantity) || Number(item.price || 0) / lineQuantity;
              const baseUnitPrice = Math.max(0, unitPrice - modifiersUnitPrice);

              return (
                <div key={item.id} className="space-y-1">
                  {/* Main line: ❌ + red qty + name + price */}
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => dispatch(removeItem(item.id))}
                      className="shrink-0 text-[#EF4444] hover:text-[#DC2626] text-[18px] leading-none"
                      title="Remove item"
                      aria-label={`Remove ${baseName}`}
                    >
                      ⊗
                    </button>
                    <span className="shrink-0 w-4 text-[14px] font-extrabold text-[#EF4444] text-center">
                      {item.quantity}
                    </span>
                    <p className="flex-1 min-w-0 text-[14px] font-bold text-[#0F172A] truncate leading-tight">
                      {baseName}
                    </p>
                    <span className="shrink-0 text-[14px] font-extrabold text-[#0F172A] w-[72px] text-right">
                      {money(baseUnitPrice * lineQuantity)}
                    </span>
                  </div>

                  {/* Modifier lines from structured selections (POS customization). */}
                  {structuredMods.length > 0 && structuredMods.map((m, idx) => {
                    const modLabel =
                      m.quantity && m.quantity > 1
                        ? `${m.quantity}× ${m.optionName || m.name}`
                        : m.optionName || m.name;
                    const modLineTotal = Number(m.price || 0) * Number(m.quantity || 1) * lineQuantity;
                    return (
                      <div key={`${item.id}-mod-${idx}`} className="flex items-center gap-2.5 pl-6">
                        <button
                          className="shrink-0 text-[#EF4444] hover:text-[#DC2626] text-[16px] leading-none"
                          title="Remove this add-on"
                          aria-label={`Remove ${modLabel}`}
                          onClick={() =>
                            dispatch(removeModifier({ id: item.id, index: idx, kind: "structured" }))
                          }
                        >
                          ⊗
                        </button>
                        <p className="flex-1 min-w-0 text-[13.5px] text-[#475569] truncate">
                          {modLabel}
                        </p>
                        <span className="shrink-0 text-[13.5px] font-semibold text-[#334155] w-[72px] text-right">
                          {money(modLineTotal)}
                        </span>
                      </div>
                    );
                  })}

                  {/* Fallback: parsed modifier tokens from item.name when structured
                      modifiers aren't available (legacy items already in the cart). */}
                  {structuredMods.length === 0 && modifierTokens.length > 0 && modifierTokens.map((tok, idx) => (
                    <div key={`${item.id}-tok-${idx}`} className="flex items-center gap-2.5 pl-6">
                      <button
                        className="shrink-0 text-[#EF4444] hover:text-[#DC2626] text-[16px] leading-none"
                        title="Remove this add-on"
                        aria-label={`Remove ${tok}`}
                        onClick={() =>
                          dispatch(removeModifier({ id: item.id, index: idx, kind: "token" }))
                        }
                      >
                        ⊗
                      </button>
                      <p className="flex-1 min-w-0 text-[13.5px] text-[#475569] truncate">
                        {tok}
                      </p>
                      <span className="shrink-0 text-[13.5px] font-semibold text-[#334155] w-[72px] text-right">
                        {money(0)}
                      </span>
                    </div>
                  ))}

                  {/* Note row */}
                  {item.note && (
                    <div className="pl-6 text-[11.5px] text-[#C2410C] font-semibold truncate">
                      Note: {item.note}
                    </div>
                  )}

                  {/* Centered action row: ❌ ➕ qty ➖ ⚙️ */}
                  <div className="flex items-center justify-center gap-4 pt-1.5">
                    <button
                      onClick={() => dispatch(removeItem(item.id))}
                      className="w-7 h-7 rounded-full border-2 border-[#EF4444] text-[#EF4444] flex items-center justify-center text-[14px] font-bold hover:bg-[#FEE2E2] transition-colors"
                      title="Remove line"
                      aria-label="Remove line"
                    >
                      ×
                    </button>
                    <button
                      onClick={() => dispatch(updateQuantity({ id: item.id, quantity: (item.quantity || 1) + 1 }))}
                      className="w-7 h-7 rounded-full border-2 border-[#22C55E] text-[#22C55E] flex items-center justify-center text-[14px] font-bold hover:bg-[#DCFCE7] transition-colors"
                      title="Increase quantity"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                    <span className="min-w-[16px] text-center text-[14px] font-extrabold text-[#0F172A]">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() =>
                        (item.quantity || 0) <= 1
                          ? dispatch(removeItem(item.id))
                          : dispatch(updateQuantity({ id: item.id, quantity: item.quantity - 1 }))
                      }
                      className="w-7 h-7 rounded-full border-2 border-[#94A3B8] text-[#475569] flex items-center justify-center text-[16px] font-bold hover:bg-[#F1F5F9] transition-colors"
                      title="Decrease quantity"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <button
                      onClick={() => {
                        setNoteFor(item);
                        setNoteText(item.note || "");
                      }}
                      className="w-7 h-7 rounded-full border-2 border-[#FD5302] text-[#C2410C] flex items-center justify-center text-[13px] hover:bg-[#FFF1E8] transition-colors"
                      title="Item settings / add note"
                      aria-label="Item settings"
                    >
                      ⚙
                    </button>
                  </div>
                </div>
              );
            })}
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
            className="text-[13px] font-bold text-[#C2410C] flex items-center gap-1.5 hover:underline"
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

        {/* Discount row — CLICKABLE (Module 2 §1). Shows current label if
            a discount is applied so the biller can see it at a glance. */}
        <button
          type="button"
          onClick={() => setShowDiscount(true)}
          className="w-full flex items-center justify-between text-[13.5px] rounded-lg -mx-1 px-1 py-1 hover:bg-[#F8FAFC] transition-colors"
          disabled={cart.length === 0}
        >
          <span className="flex items-center gap-1.5 text-[#475569]">
            <IconTag />
            <span className="font-semibold">Discount</span>
            {discountLabel && (
              <span className="px-1.5 py-0.5 rounded-md bg-[#FFF1E8] text-[#C2410C] text-[11px] font-extrabold">
                {discountLabel}
              </span>
            )}
          </span>
          <span
            className={`font-bold ${
              discountAmount > 0 ? "text-[#16A34A]" : "text-[#94A3B8]"
            }`}
          >
            {discountAmount > 0 ? `− ${money(discountAmount)}` : "Add"}
          </span>
        </button>

        {packagingFee > 0 && (
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-[#475569]">Packing charge</span>
            <span className="font-bold text-[#0F172A]">{money(packagingFee)}</span>
          </div>
        )}
        {isDelivery && (
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-[#475569]">Delivery charge</span>
            <span className="font-bold text-[#0F172A]">
              {deliveryFee > 0 ? money(deliveryFee) : "Free"}
            </span>
          </div>
        )}
        {tax > 0 && (
          <div className="flex items-center justify-between text-[13.5px]">
            <span className="text-[#475569]">
              GST {taxInclusive ? `(incl. ${taxPercent}%)` : `(${taxPercent}%)`}
            </span>
            <span className="font-bold text-[#0F172A]">{money(tax)}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
          <span className="text-[17px] font-extrabold text-[#0F172A]">Total</span>
          <span className="text-[22px] font-extrabold text-[#C2410C]">{money(totalWithTax)}</span>
        </div>
        {minOrderValue > 0 && postDiscount < minOrderValue && cart.length > 0 && (
          <p className="text-[11px] font-semibold text-[#EF4444]">
            Below minimum order value of {money(minOrderValue)}.
          </p>
        )}
      </div>

      {/* ===== Actions ===== */}
      <div className="px-4 pb-4 shrink-0 grid grid-cols-[1fr_1.35fr] gap-2.5">
        <button
          onClick={hold}
          className="h-[50px] rounded-xl border border-[#FD5302] bg-white text-[#C2410C] text-[14px] font-bold flex items-center justify-center gap-2 hover:bg-[#FFF1E8] transition-colors"
        >
          <IconClock /> Hold Order
        </button>
        <button
          onClick={finish}
          disabled={busy || cart.length === 0}
          className="h-[50px] rounded-xl bg-[#FD5302] text-white text-[14.5px] font-bold flex items-center justify-center gap-2 shadow-[0_8px_20px_-8px_rgba(253,83,2,0.7)] hover:bg-[#D64502] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy
            ? "Processing…"
            : activeSessionId
            ? `Add to ${customer.table?.tableNo ? `Table ${customer.table.tableNo}` : "Table"}`
            : "Finish Order"}{" "}
          {!busy && <IconArrowRight />}
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
              className="w-full rounded-xl border border-[#E2E8F0] p-3 text-[13.5px] resize-none focus:border-[#FD5302]"
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
                className="h-[44px] rounded-xl bg-[#FD5302] text-white text-[14px] font-bold hover:bg-[#D64502]"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Discount modal ===== */}
      {showDiscount && (
        <DiscountModal
          subtotal={subtotal}
          initialMode={discount.mode}
          initialValue={discount.value}
          onClose={() => setShowDiscount(false)}
          onApply={({ mode, value }) => {
            if (mode === "percent") dispatch(setPercentDiscount(value));
            else if (mode === "fixed") dispatch(setFixedDiscount(value));
            else dispatch(clearDiscount());
            setShowDiscount(false);
            enqueueSnackbar("Discount updated.", { variant: "success" });
          }}
          onClear={() => {
            dispatch(clearDiscount());
            setShowDiscount(false);
            enqueueSnackbar("Discount removed.", { variant: "info" });
          }}
        />
      )}

      {/* ===== Payment method chooser ===== */}
      {showPaymentMethod && (
        <PaymentMethodModal
          orderType={orderType}
          bills={billsForOrder}
          busy={busy}
          onClose={() => setShowPaymentMethod(false)}
          onSelect={onPickPaymentMethod}
        />
      )}

      {/* ===== Customer detail capture (routed by method) ===== */}
      {showCollection && (
        <CollectionModal
          initialName={customer.customerName}
          initialPhone={customer.customerPhone}
          total={totalWithTax}
          busy={busy}
          onClose={() => setShowCollection(false)}
          onConfirm={doCollection}
        />
      )}
      {showDelivery && (
        <DeliveryModal
          initialName={customer.customerName}
          initialPhone={customer.customerPhone}
          total={totalWithTax}
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

      {invoice && (
        <Invoice
          orderInfo={invoice}
          setShowInvoice={() => setInvoice(null)}
          // Module 3 §5 — the invoice/receipt header must show the
          // authenticated restaurant's branding, never a hardcoded
          // "KnotKitchen". These come from the same react-query caches
          // that drive the store header at the top of the OrderPanel.
          //
          // Store Properties (Settings → Store Properties) is the
          // CANONICAL source the operator edits; we prefer those
          // fields and fall back to /api/restaurant/me + website
          // settings only when the operator hasn't filled them out.
          // Previously we read only from /api/restaurant/me, so
          // editing store properties never reflected on the receipt.
          restaurantName={displayName}
          restaurantLogo={restaurantLogo}
          restaurantPhone={
            storeProps.ownerPhone ||
            storeProps.contactPersonPhone ||
            restaurant?.phone ||
            websiteSettings?.contact?.phone ||
            ""
          }
          restaurantAddress={receiptAddress({ storeProps, restaurant, websiteSettings })}
        />
      )}

      {paymentLinkResult && (
        <PaymentLinkResultModal
          result={paymentLinkResult}
          onClose={() => setPaymentLinkResult(null)}
        />
      )}

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
                        className="h-9 rounded-lg bg-[#FD5302] px-3 text-[12px] font-bold text-white hover:bg-[#D64502]"
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
