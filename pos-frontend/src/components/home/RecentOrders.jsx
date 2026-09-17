import React from "react";
import { FiArrowRight, FiClipboard } from "react-icons/fi";
import OrderList from "./OrderList";
import { useQuery } from "@tanstack/react-query";
import { getOrders } from "../../https";
import { useNavigate } from "react-router-dom";

const RecentOrders = () => {
  const navigate = useNavigate();
  const { data: ordersRes } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => await getOrders(),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  const orders = ordersRes?.data?.data || [];

  return (
    <div className="card border border-[#E2E8F0] bg-white p-4 shadow-card sm:p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="font-display text-lg font-semibold text-[#0F172A]">Recent Orders</h1>
          <p className="mt-0.5 text-xs text-[#94A3B8]">
            {orders.length} total orders
          </p>
        </div>
        <button
          onClick={() => navigate("/orders")}
          className="flex items-center gap-2 text-sm font-semibold text-[#C2410C] transition-all hover:gap-3"
        >
          View all <FiArrowRight />
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="py-10 text-center text-content-muted">
          <div className="w-14 h-14 mx-auto bg-surface-tertiary rounded-2xl flex items-center justify-center mb-3">
            <FiClipboard size={24} className="text-content-muted" />
          </div>
          <p className="text-sm font-medium">No orders yet</p>
          <p className="text-xs mt-1">Orders will appear here once your customers place them.</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-hide">
          {orders.slice(0, 6).map((order) => (
            <OrderList
              key={order._id}
              order={order}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default RecentOrders;