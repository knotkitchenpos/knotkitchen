/**
 * Receipt & E-Bill Service
 * Formats structured receipt data for orders, bills, and table sessions.
 */

const { isSettled } = require("../constants/orderStatus");
const { formatAddress } = require("./address");
const { resolveItemAmounts } = require("./orderItemAmounts");

const formatPaymentMethod = (method) => {
  const m = String(method || "").trim().toUpperCase();
  if (m === "CASH") return "Paid by Cash";
  if (m === "QR" || m === "QR_CODE" || m === "TABLE_QR") return "Paid by QR Code";
  if (m === "ONLINE" || m === "CARD" || m === "UPI" || m === "NETBANKING") return "Paid Online";
  if (m === "PAYMENT_LINK" || m === "PAYMENTLINK") return "Paid by Payment Link";
  return method ? `Paid by ${method}` : "Paid by Cash";
};

const buildReceipt = ({
  order,
  bill,
  tableSession,
  restaurant,
  outlet,
}) => {
  // Resolve restaurant details
  const restaurantInfo = {
    id: restaurant?._id || restaurant?.storeId || "N/A",
    name: restaurant?.storeName || restaurant?.name || "Knot Kitchen",
    // Flattened here, once, rather than by each thing that renders a
    // receipt. Empty when unset -- renderers omit the line; the old
    // "Main Street" default printed a fictional address on real bills.
    address: formatAddress(restaurant?.address),
    phone: restaurant?.ownerPhone || restaurant?.phone || "N/A",
  };

  // Resolve outlet details
  const outletInfo = {
    id: outlet?._id || order?.outletId || tableSession?.outletId || "main",
    name: outlet?.name || "Main Outlet",
  };

  // Resolve items
  let rawItems = [];
  if (tableSession?.items?.length) {
    rawItems = tableSession.items;
  } else if (order?.items?.length) {
    rawItems = order.items;
  } else if (bill?.items?.length) {
    rawItems = bill.items;
  }

  // `total || price * quantity` looked reasonable but multiplied the quantity
  // in twice for POS orders, which store the LINE total in `price` and left
  // `total` at 0. resolveItemAmounts settles which is which -- including for
  // orders written before that was fixed. See services/orderItemAmounts.js.
  const items = rawItems.map((item) => {
    const { quantity, unitPrice, lineTotal } = resolveItemAmounts(item);
    return {
      name: item.name || "Item",
      price: unitPrice,
      quantity,
      total: lineTotal,
      modifiers: item.modifiers || [],
    };
  });

  const quantities = items.reduce((acc, curr) => acc + curr.quantity, 0);

  // Resolve financial breakdown
  let subtotal = 0;
  let taxes = 0;
  let charges = 0;
  let total = 0;

  if (tableSession?.bills) {
    subtotal = tableSession.bills.subtotal || 0;
    taxes = tableSession.bills.tax || 0;
    charges = tableSession.bills.charges || tableSession.bills.additionalCharges || 0;
    total = tableSession.bills.totalWithTax || (subtotal + taxes + charges);
  } else if (bill?.bills) {
    subtotal = bill.bills.subtotal || 0;
    taxes = bill.bills.tax || 0;
    charges = bill.bills.charges || 0;
    total = bill.bills.totalWithTax || bill.dueAmount || (subtotal + taxes + charges);
  } else if (order?.bills) {
    subtotal = order.bills.subtotal || 0;
    taxes = order.bills.tax || 0;
    charges = (order.bills.packagingFee || 0) + (order.bills.deliveryFee || 0) + (order.bills.charges || 0);
    total = order.bills.totalWithTax || order.bills.total || (subtotal + taxes + charges);
  } else {
    subtotal = items.reduce((sum, i) => sum + i.total, 0);
    total = subtotal;
  }

  // Customer details
  const customerDetails =
    tableSession?.customerDetails ||
    order?.customerDetails ||
    bill?.customerDetails ||
    {};

  const customerInformation = {
    name: customerDetails.name || tableSession?.customerName || "",
    phone: customerDetails.phone || tableSession?.customerPhone || "",
  };

  // Payment status & payment method
  let paymentStatus = "PENDING";
  let rawPaymentMethod = "CASH";

  if (tableSession?.payment) {
    paymentStatus = tableSession.payment.status === "PAID" || tableSession.status === "CLOSED" ? "PAID" : tableSession.payment.status || "PENDING";
    rawPaymentMethod = tableSession.payment.method || "CASH";
  } else if (bill?.status) {
    paymentStatus = bill.status === "PAID" ? "PAID" : "PENDING";
    rawPaymentMethod = bill.paymentMethod || "CASH";
  } else if (order?.orderStatus) {
    // Was an exact match on the two lowercase spellings, so a receipt for an
    // order finished through the POS (canonical "Completed") or the
    // auto-complete sweep ("Served" / "Delivered") printed PENDING.
    paymentStatus = isSettled(order.orderStatus) ? "PAID" : "PENDING";
    rawPaymentMethod = order.paymentMethod || (order.payments && order.payments[0]?.method) || "CASH";
  }

  // Order number & date/time
  // The number the CUSTOMER is quoted has to be the one the operator can look
  // up. Every POS screen shows `order.orderNumber` (a 6-digit id from
  // orderNumberService, e.g. #834180) falling back to the tail of the Mongo
  // id -- but this chain never read orderNumber at all, so an e-bill quoted
  // six hex characters of the ObjectId instead. Nobody could match a bill to
  // an order.
  //
  // Order of preference mirrors the POS exactly, including for marketplace
  // orders, where the screens also show our own number rather than Swiggy's.
  const orderNumber =
    tableSession?.sessionCode ||
    order?.orderNumber ||
    order?.marketplaceOrderId ||
    bill?.billNumber ||
    (order?._id ? order._id.toString().slice(-6).toUpperCase() : "N/A");

  const dateTime =
    tableSession?.openedAt ||
    order?.orderDate ||
    order?.createdAt ||
    bill?.createdAt ||
    new Date();

  const receipt = {
    restaurant: restaurantInfo,
    outlet: outletInfo,
    orderNumber,
    dateTime: new Date(dateTime).toISOString(),
    customerInformation,
    items,
    quantities,
    subtotal,
    taxes,
    charges,
    total,
    paymentStatus,
    paymentMethod: formatPaymentMethod(rawPaymentMethod),
  };

  // If table order, attach table details and full accumulated bill
  if (tableSession || order?.table) {
    const tableNumber =
      tableSession?.tableId?.tableNumber ||
      tableSession?.tableNumber ||
      order?.table?.tableNumber ||
      order?.table;

    receipt.tableOrder = {
      tableNumber: tableNumber || "N/A",
      tableSessionCode: tableSession?.sessionCode || orderNumber,
      accumulatedBill: total,
    };
  }

  return receipt;
};

module.exports = {
  formatPaymentMethod,
  buildReceipt,
};
