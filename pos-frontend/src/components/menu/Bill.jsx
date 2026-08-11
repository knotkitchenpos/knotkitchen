import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { getTotalPrice, removeAllItems } from "../../redux/slices/cartSlice";
import {
  addOrder,
  createOrderRazorpay,
  createTableSession,
  getTables,
  updateTable,
  verifyPaymentRazorpay,
} from "../../https/index";
import { enqueueSnackbar } from "notistack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  removeCustomer,
  setSessionId,
  updateGuests,
  updateTable as updateTableAction,
} from "../../redux/slices/customerSlice";
import Invoice from "../invoice/Invoice";
import TableSelectModal from "../tables/TableSelectModal";

function loadScript(src) {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

const Bill = () => {
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const customerData = useSelector((state) => state.customer);
  const cartData = useSelector((state) => state.cart);
  const orderType = useSelector((state) => state.orderType.orderType);
  const total = useSelector(getTotalPrice);
  const taxRate = 5.25;
  const tax = (total * taxRate) / 100;
  const totalPriceWithTax = total + tax;

  const [paymentMethod, setPaymentMethod] = useState();
  const [showInvoice, setShowInvoice] = useState(false);
  const [orderInfo, setOrderInfo] = useState();
  const [showTableSelect, setShowTableSelect] = useState(false);
  const [tableServiceGuestCount, setTableServiceGuestCount] = useState(1);

  const { data: tablesRes } = useQuery({
    queryKey: ["tables"],
    queryFn: getTables,
    enabled: orderType === "Table Service",
  });
  const tables = tablesRes?.data?.data || [];

  const tableSessionMutation = useMutation({
    mutationFn: (reqData) => createTableSession(reqData),
    onSuccess: (resData) => {
      const session = resData.data?.data;
      enqueueSnackbar("Items attached to table session!", { variant: "success" });
      if (session?._id) dispatch(setSessionId(session._id));
      queryClient.invalidateQueries({ queryKey: ["tables"] });
      queryClient.invalidateQueries({ queryKey: ["table-sessions"] });
      dispatch(removeAllItems());
      dispatch(removeCustomer());
      setShowTableSelect(false);
      setTableServiceGuestCount(1);
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to attach items to table.", { variant: "error" });
    },
  });

  const handleTableServiceOrder = () => {
    if (cartData.length === 0) {
      enqueueSnackbar("Cart is empty. Add items first!", { variant: "warning" });
      return;
    }
    if (!customerData.table?.tableId) {
      enqueueSnackbar("Please select a table.", { variant: "warning" });
      return;
    }
    const capacity = Number(customerData.table.capacity) || 4;
    const guests = Math.max(1, Number(tableServiceGuestCount) || 1);
    if (guests > capacity) {
      enqueueSnackbar(
        `Table ${customerData.table.tableNo} has a maximum capacity of ${capacity} customers.`,
        { variant: "error" }
      );
      return;
    }
    const items = cartData.map((item) => ({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      variantId: item.variantId || null,
      addonIds: item.addonIds || [],
      modifierSelections: item.modifierSelections || {},
      note: item.note || "",
    }));
    tableSessionMutation.mutate({
      tableId: customerData.table.tableId,
      items,
      customerCount: guests,
      customerName: customerData.customerName || "",
      customerPhone: customerData.customerPhone || "",
    });
  };

  const handleSelectTable = (table) => {
    dispatch(updateTableAction({ table }));
    enqueueSnackbar(`Table ${table.tableNo} selected!`, { variant: "success" });
    setShowTableSelect(false);
  };

  const orderMutation = useMutation({
    mutationFn: (reqData) => addOrder(reqData),
    onSuccess: (resData) => {
      const { data } = resData.data;
      setOrderInfo(data);
      const tableData = { status: "Booked", orderId: data._id, tableId: data.table };
      setTimeout(() => tableUpdateMutation.mutate(tableData), 1500);
      enqueueSnackbar("Order Placed!", { variant: "success" });
      setShowInvoice(true);
    },
    onError: (error) => console.log(error),
  });

  const tableUpdateMutation = useMutation({
    mutationFn: (reqData) => updateTable(reqData),
    onSuccess: () => {
      dispatch(removeCustomer());
      dispatch(removeAllItems());
    },
    onError: (error) => console.log(error),
  });

  const handlePlaceOrder = async () => {
    if (orderType === "Table Service") {
      handleTableServiceOrder();
      return;
    }
    if (!paymentMethod) {
      enqueueSnackbar("Please select a payment method!", { variant: "warning" });
      return;
    }
    const table = customerData.table;
    if (table?.capacity) {
      const capacity = Number(table.capacity);
      const guests = Math.max(1, Number(customerData.guests) || 1);
      if (guests > capacity) {
        enqueueSnackbar(`Table ${table.tableNo} has a maximum capacity of ${capacity} customers.`, { variant: "error" });
        return;
      }
    }

    const baseOrderData = {
      customerDetails: {
        name: customerData.customerName,
        phone: customerData.customerPhone,
        guests: customerData.guests,
      },
      orderStatus: "In Progress",
      bills: { total, tax, totalWithTax: totalPriceWithTax },
      items: cartData,
      table: customerData.table?.tableId,
      paymentMethod,
    };

    if (paymentMethod === "Online") {
      try {
        const res = await loadScript("https://checkout.razorpay.com/v1/checkout.js");
        if (!res) {
          enqueueSnackbar("Razorpay SDK failed to load. Are you online?", { variant: "warning" });
          return;
        }
        const { data } = await createOrderRazorpay({ amount: totalPriceWithTax.toFixed(2) });
        const options = {
          key: `${import.meta.env.VITE_RAZORPAY_KEY_ID}`,
          amount: data.order.amount,
          currency: data.order.currency,
          name: "KnotKitchen",
          description: "Secure Payment for Your Meal",
          order_id: data.order.id,
          handler: async function (response) {
            const verification = await verifyPaymentRazorpay(response);
            enqueueSnackbar(verification.data.message, { variant: "success" });
            const orderData = {
              ...baseOrderData,
              paymentData: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
              },
            };
            setTimeout(() => orderMutation.mutate(orderData), 1500);
          },
          prefill: { name: customerData.name, email: "", contact: customerData.phone },
          theme: { color: "#025cca" },
        };
        const rzp = new window.Razorpay(options);
        rzp.open();
      } catch (error) {
        console.log(error);
        enqueueSnackbar("Payment Failed!", { variant: "error" });
      }
    } else {
      orderMutation.mutate(baseOrderData);
    }
  };

  const handlePrintReceipt = () => {
    if (cartData.length === 0) {
      enqueueSnackbar("Cart is empty. Add items first!", { variant: "warning" });
      return;
    }
    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) {
      enqueueSnackbar("Popup blocked! Please allow popups for this site.", { variant: "error" });
      return;
    }
    const date = new Date().toLocaleString("en-US", {
      month: "long",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const itemsHTML = cartData
      .map(
        (item) => `<tr><td style="padding:6px 0;font-size:12px;">${item.name}</td><td style="padding:6px 0;font-size:12px;text-align:center;">x${item.quantity}</td><td style="padding:6px 0;font-size:12px;text-align:right;">Rs.${item.price.toFixed(2)}</td></tr>`
      )
      .join("");
    const receiptHTML = `<!DOCTYPE html><html><head><title>KnotKitchen Receipt</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;width:300px;margin:0 auto;padding:20px;color:#000;background:#fff}.header{text-align:center;margin-bottom:15px}.header h1{font-size:20px}.header p{font-size:10px;color:#555;margin-top:4px}.divider{border-top:1px dashed #000;margin:10px 0}.info-row{display:flex;justify-content:space-between;font-size:11px;margin:3px 0}.items-table{width:100%;border-collapse:collapse;margin-top:5px}.items-table th{font-size:11px;text-align:left;border-bottom:1px solid #000;padding-bottom:5px}.items-table td{border-bottom:1px dotted #ccc}.totals{margin-top:10px}.total-row{display:flex;justify-content:space-between;font-size:12px;margin:4px 0}.grand-total{display:flex;justify-content:space-between;font-size:15px;font-weight:bold;border-top:2px solid #000;padding-top:8px;margin-top:6px}.footer{text-align:center;margin-top:20px;font-size:10px;color:#555}@media print{body{width:300px}}</style></head><body><div class="header"><h1>KnotKitchen</h1><p>Restaurant POS System</p><p>${date}</p></div><div class="divider"></div><div class="info-row"><span>Customer:</span><span><strong>${customerData.customerName || "Walk-in"}</strong></span></div><div class="info-row"><span>Phone:</span><span>${customerData.customerPhone || "N/A"}</span></div><div class="info-row"><span>Guests:</span><span>${customerData.guests || 0}</span></div><div class="info-row"><span>Order ID:</span><span>#${customerData.orderId || "N/A"}</span></div><div class="info-row"><span>Table:</span><span>${customerData.table?.tableNo || "N/A"}</span></div><div class="divider"></div><table class="items-table"><thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th></tr></thead><tbody>${itemsHTML}</tbody></table><div class="divider"></div><div class="totals"><div class="total-row"><span>Subtotal</span><span>Rs.${total.toFixed(2)}</span></div><div class="total-row"><span>Tax (5.25%)</span><span>Rs.${tax.toFixed(2)}</span></div><div class="grand-total"><span>Total</span><span>Rs.${totalPriceWithTax.toFixed(2)}</span></div></div><div class="divider"></div><div class="footer"><p>Thank you for dinning with us!</p><p>Please visit again :)</p></div></body></html>`;
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
  };

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-content-muted">Items({cartData.length})</p>
          <h1 className="text-content font-semibold">Rs.{total.toFixed(2)}</h1>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-content-muted">Tax (5.25%)</p>
          <h1 className="text-content font-semibold">Rs.{tax.toFixed(2)}</h1>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <p className="text-sm font-semibold text-content">Total</p>
          <h1 className="font-display text-xl font-bold gradient-text">Rs.{totalPriceWithTax.toFixed(2)}</h1>
        </div>
      </div>

      {orderType === "Table Service" ? (
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-content-muted mb-2">Table</p>
            {customerData.table?.tableNo ? (
              <div className="flex items-center justify-between p-3.5 rounded-xl border border-accent/40 bg-accent/10">
                <div>
                  <p className="text-sm font-semibold text-content">Table {customerData.table.tableNo}</p>
                  <p className="text-xs text-content-muted">
                    Capacity {customerData.table.capacity} | Occupancy {customerData.table.occupancy || 0}
                  </p>
                </div>
                <button onClick={() => setShowTableSelect(true)} className="text-xs font-semibold text-accent hover:underline">
                  Change
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowTableSelect(true)}
                className="w-full py-3.5 rounded-xl border border-dashed border-accent/40 bg-accent/5 text-accent text-sm font-semibold hover:bg-accent/10 transition-colors"
              >
                + Select Table
              </button>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-content-muted mb-2">Customer Count</label>
            <input
              type="number"
              min="1"
              max={customerData.table?.capacity || 4}
              value={tableServiceGuestCount}
              onChange={(e) => {
                setTableServiceGuestCount(e.target.value);
                dispatch(updateGuests(e.target.value));
              }}
              className="w-full bg-surface-input border border-border rounded-xl p-3 text-content focus:outline-none focus:border-accent"
            />
            {customerData.table?.capacity && (
              <p className="text-[10px] text-content-muted mt-1">Max {customerData.table.capacity} customers on this table</p>
            )}
          </div>
          <button
            onClick={handleTableServiceOrder}
            disabled={tableSessionMutation.isPending}
            className="btn-primary w-full py-3 disabled:opacity-50"
          >
            {tableSessionMutation.isPending ? "Attaching..." : "Attach Order to Table"}
          </button>
          <p className="text-[10px] text-content-muted text-center">
            The table stays occupied and the bill remains open — payment is not completed here.
          </p>
        </div>
      ) : (
        <>
          <div>
            <p className="text-xs font-medium text-content-muted mb-2">Payment Method</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setPaymentMethod("Cash")}
                className={`py-3 rounded-xl font-semibold text-sm border transition-all ${
                  paymentMethod === "Cash"
                    ? "bg-accent text-white border-accent shadow-md shadow-accent/20"
                    : "bg-surface-input text-content-muted border-border hover:border-accent"
                }`}
              >
                Cash
              </button>
              <button
                onClick={() => setPaymentMethod("Online")}
                className={`py-3 rounded-xl font-semibold text-sm border transition-all ${
                  paymentMethod === "Online"
                    ? "bg-accent text-white border-accent shadow-md shadow-accent/20"
                    : "bg-surface-input text-content-muted border-border hover:border-accent"
                }`}
              >
                Online
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <button onClick={handlePrintReceipt} className="btn-secondary py-3">Print Receipt</button>
            <button onClick={handlePlaceOrder} className="btn-primary py-3">Place Order</button>
          </div>
        </>
      )}

      {showTableSelect && (
        <TableSelectModal
          tables={tables}
          onClose={() => setShowTableSelect(false)}
          onSelect={handleSelectTable}
        />
      )}
      {showInvoice && <Invoice orderInfo={orderInfo} setShowInvoice={setShowInvoice} />}
    </>
  );
};

export default Bill;