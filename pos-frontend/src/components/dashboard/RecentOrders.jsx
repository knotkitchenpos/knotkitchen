import React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { getOrders, updateOrderStatus } from "../../https/index";
import { formatDateAndTime, getAvatarName } from "../../utils";
import { isReady, isAwaitingAcceptance } from "../../constants/orderStatus";

const RecentOrders = () => {
  const queryClient = useQueryClient();
  const handleStatusChange = ({orderId, orderStatus}) => {
    orderStatusUpdateMutation.mutate({orderId, orderStatus});
  };

  const orderStatusUpdateMutation = useMutation({
    mutationFn: ({orderId, orderStatus}) => updateOrderStatus({orderId, orderStatus}),
    onSuccess: () => {
      enqueueSnackbar("Order status updated successfully!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["orders"] }); // Refresh order list
    },
    onError: () => {
      enqueueSnackbar("Failed to update order status!", { variant: "error" });
    }
  });

  const { data: resData, isError } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      return await getOrders();
    },
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  if (isError) {
    enqueueSnackbar("Something went wrong!", { variant: "error" });
  }

  const orders = resData?.data?.data || [];

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
      <h2 className="text-[#0F172A] text-xl font-extrabold mb-4 font-display">
        Recent Orders
      </h2>
      {orders.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto bg-surface-tertiary rounded-2xl flex items-center justify-center mb-4">
            <span className="text-2xl">🍽️</span>
          </div>
          <p className="text-content-muted font-semibold">No orders yet</p>
          <p className="text-content-muted text-sm mt-1">New orders will appear here</p>
        </div>
      ) : (
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left text-content">
            <thead>
              <tr className="border-b border-border">
                <th className="p-3 text-xs uppercase tracking-wider text-content-muted">Customer</th>
                <th className="p-3 text-xs uppercase tracking-wider text-content-muted">Status</th>
                <th className="p-3 text-xs uppercase tracking-wider text-content-muted">Date & Time</th>
                <th className="p-3 text-xs uppercase tracking-wider text-content-muted">Items</th>
                <th className="p-3 text-xs uppercase tracking-wider text-content-muted">Table</th>
                <th className="p-3 text-xs uppercase tracking-wider text-content-muted">Total</th>
                <th className="p-3 text-xs uppercase tracking-wider text-content-muted text-center">Payment</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order, index) => (
                <tr
                  key={index}
                  className="border-b border-border hover:bg-surface-tertiary/50 transition-colors"
                >
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-brand flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {getAvatarName(order.customerDetails?.name || 'Guest')}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{order.customerDetails?.name || 'Guest'}</p>
                        <p className="text-xs text-content-muted">#{Math.floor(new Date(order.orderDate).getTime()).toString().slice(0, 8)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <select
                      className={`px-3 py-2 rounded-lg border text-sm font-semibold focus:outline-none border-border bg-surface-input ${
                        isReady(order.orderStatus)
                          ? "text-accent-green"
                          : isAwaitingAcceptance(order.orderStatus)
                          ? "text-accent-red"
                          : "text-accent-amber"
                      }`}
                      value={order.orderStatus}
                      onChange={(e) => handleStatusChange({orderId: order._id, orderStatus: e.target.value})}
                    >
                      <option value="Pending">Pending</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Ready">Ready</option>
                      <option value="Completed">Completed</option>
                    </select>
                  </td>
                  <td className="p-4 text-sm text-content-secondary">{formatDateAndTime(order.orderDate)}</td>
                  <td className="p-4 text-sm">{(order.items?.length || 0)} Items</td>
                  <td className="p-4 text-sm">Table {order.table?.tableNo || "N/A"}</td>
                  <td className="p-4 font-semibold">₹{order.bills?.totalWithTax?.toFixed?.(2) ?? order.bills?.totalWithTax}</td>
                  <td className="p-4 text-center">
                    <span className={`badge ${order.paymentMethod === "Cash" ? "badge-available" : "badge-pending"}`}>
                      {order.paymentMethod}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RecentOrders;