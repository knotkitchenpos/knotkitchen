import React from "react";
import { motion } from "framer-motion";
import { FaCheck } from "react-icons/fa6";

const Invoice = ({ orderInfo, setShowInvoice }) => {
  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) {
      return;
    }

    const itemsHTML = (orderInfo?.items || [])
      .map(
        (item) => `
        <tr>
          <td style="padding:6px 0;font-size:12px;">${item.name}</td>
          <td style="padding:6px 0;font-size:12px;text-align:center;">x${item.quantity}</td>
          <td style="padding:6px 0;font-size:12px;text-align:right;">₹${item.price.toFixed(2)}</td>
        </tr>`
      )
      .join("");

    const dateString = new Date(
      orderInfo?.orderDate || Date.now()
    ).toLocaleString("en-US", {
      month: "long",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const receiptHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>KnotKitchen Receipt</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Courier New', Courier, monospace;
              width: 300px;
              margin: 0 auto;
              padding: 20px;
              color: #000;
              background: #fff;
            }
            .header { text-align: center; margin-bottom: 15px; }
            .header h1 { font-size: 20px; letter-spacing: 1px; }
            .header p { font-size: 10px; color: #555; margin-top: 4px; }
            .divider { border-top: 1px dashed #000; margin: 10px 0; }
            .info-row { display: flex; justify-content: space-between; font-size: 11px; margin: 3px 0; }
            .items-table { width: 100%; border-collapse: collapse; margin-top: 5px; }
            .items-table th {
              font-size: 11px;
              text-align: left;
              border-bottom: 1px solid #000;
              padding-bottom: 5px;
            }
            .items-table td { border-bottom: 1px dotted #ccc; }
            .totals { margin-top: 10px; }
            .total-row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; }
            .grand-total {
              display: flex;
              justify-content: space-between;
              font-size: 15px;
              font-weight: bold;
              border-top: 2px solid #000;
              padding-top: 8px;
              margin-top: 6px;
            }
            .payment-info { margin-top: 12px; font-size: 10px; color: #555; }
            .footer { text-align: center; margin-top: 20px; font-size: 10px; color: #555; }
            @media print {
              body { width: 300px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>KnotKitchen</h1>
            <p>Restaurant POS System</p>
            <p>${dateString}</p>
          </div>
          <div class="divider"></div>
          <div class="info-row">
            <span>Order ID:</span>
            <span><strong>#${Math.floor(new Date(orderInfo?.orderDate || Date.now()).getTime())}</strong></span>
          </div>
          <div class="info-row">
            <span>Name:</span>
            <span><strong>${orderInfo?.customerDetails?.name || "N/A"}</strong></span>
          </div>
          <div class="info-row">
            <span>Phone:</span>
            <span>${orderInfo?.customerDetails?.phone || "N/A"}</span>
          </div>
          <div class="info-row">
            <span>Guests:</span>
            <span>${orderInfo?.customerDetails?.guests || 0}</span>
          </div>
          <div class="divider"></div>
          <table class="items-table">
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align:center;">Qty</th>
                <th style="text-align:right;">Price</th>
              </tr>
            </thead>
            <tbody>${itemsHTML}</tbody>
          </table>
          <div class="divider"></div>
          <div class="totals">
            <div class="total-row">
              <span>Subtotal</span>
              <span>₹${(orderInfo?.bills?.total || 0).toFixed(2)}</span>
            </div>
            <div class="total-row">
              <span>Tax (5.25%)</span>
              <span>₹${(orderInfo?.bills?.tax || 0).toFixed(2)}</span>
            </div>
            <div class="grand-total">
              <span>Total</span>
              <span>₹${(orderInfo?.bills?.totalWithTax || 0).toFixed(2)}</span>
            </div>
          </div>
          ${
            orderInfo?.paymentMethod === "Online" && orderInfo?.paymentData
              ? `
            <div class="divider"></div>
            <div class="payment-info">
              <p>Payment Method: ${orderInfo.paymentMethod}</p>
              <p>Razorpay Order ID: ${orderInfo.paymentData.razorpay_order_id || "N/A"}</p>
              <p>Razorpay Payment ID: ${orderInfo.paymentData.razorpay_payment_id || "N/A"}</p>
            </div>`
              : ""
          }
          <div class="divider"></div>
          <div class="footer">
            <p>Thank you for dinning with us!</p>
            <p>Please visit again 😊</p>
          </div>
        </body>
      </html>
    `;

    printWindow.document.write(receiptHTML);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="bg-surface-secondary rounded-2xl shadow-2xl w-full max-w-md border border-border overflow-hidden">
        {/* Receipt Content */}
        <div className="p-6">
          {/* Receipt Header */}
          <div className="flex justify-center mb-4">
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              transition={{ duration: 0.5, type: "spring", stiffness: 150 }}
              className="w-14 h-14 border-4 border-accent rounded-full flex items-center justify-center shadow-lg bg-gradient-brand"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.3, duration: 0.3 }}
                className="text-2xl"
              >
                <FaCheck className="text-white" />
              </motion.span>
            </motion.div>
          </div>

          <h2 className="font-display text-2xl font-bold text-center mb-1 text-content">KnotKitchen</h2>
          <p className="text-content-muted text-center text-sm">Order Receipt - Thank you for your order!</p>

          {/* Order Details */}
          <div className="mt-4 border-t border-border pt-4 text-sm text-content-secondary space-y-1">
            <p className="flex justify-between">
              <span className="text-content-muted">Order ID</span>
              <strong>{Math.floor(new Date(orderInfo.orderDate).getTime())}</strong>
            </p>
            <p className="flex justify-between">
              <span className="text-content-muted">Name</span>
              <strong>{orderInfo.customerDetails.name}</strong>
            </p>
            <p className="flex justify-between">
              <span className="text-content-muted">Phone</span>
              <strong>{orderInfo.customerDetails.phone}</strong>
            </p>
            <p className="flex justify-between">
              <span className="text-content-muted">Guests</span>
              <strong>{orderInfo.customerDetails.guests}</strong>
            </p>
          </div>

          {/* Items Summary */}
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-content mb-2">Items Ordered</h3>
            <div className="space-y-1.5">
              {orderInfo.items.map((item, index) => (
                <div key={index} className="flex justify-between items-center text-sm">
                  <span className="text-content-secondary">
                    {item.name} <span className="text-content-muted">x{item.quantity}</span>
                  </span>
                  <span className="font-semibold">₹{item.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bills Summary */}
          <div className="mt-4 border-t border-border pt-4 text-sm text-content-secondary space-y-1">
            <p className="flex justify-between">
              <span className="text-content-muted">Subtotal</span>
              <span>₹{orderInfo.bills.total.toFixed(2)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-content-muted">Tax</span>
              <span>₹{orderInfo.bills.tax.toFixed(2)}</span>
            </p>
            <p className="flex justify-between font-bold text-content text-base pt-1 border-t border-border">
              <span>Grand Total</span>
              <span>₹{orderInfo.bills.totalWithTax.toFixed(2)}</span>
            </p>
          </div>

          {/* Payment Details */}
          <div className="mt-4 bg-surface-input rounded-xl p-3 text-xs text-content-secondary border border-border space-y-0.5">
            {orderInfo.paymentMethod === "Cash" ? (
              <p className="flex justify-between">
                <span className="text-content-muted">Payment Method</span>
                <strong className="badge badge-available">{orderInfo.paymentMethod}</strong>
              </p>
            ) : (
              <>
                <p className="flex justify-between">
                  <span className="text-content-muted">Payment Method</span>
                  <strong className="badge badge-pending">{orderInfo.paymentMethod}</strong>
                </p>
                <p className="truncate">
                  <span className="text-content-muted">Order ID: </span>
                  <strong>{orderInfo.paymentData?.razorpay_order_id}</strong>
                </p>
                <p className="truncate">
                  <span className="text-content-muted">Payment ID: </span>
                  <strong>{orderInfo.paymentData?.razorpay_payment_id}</strong>
                </p>
              </>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-3 px-6 pb-6">
          <button
            onClick={handlePrint}
            className="btn-secondary !py-3"
          >
            Print Receipt
          </button>
          <button
            onClick={() => setShowInvoice(false)}
            className="btn-primary !py-3"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default Invoice;