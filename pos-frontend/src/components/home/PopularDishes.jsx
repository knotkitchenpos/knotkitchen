import React from "react";
import { FiArrowRight } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMenus, getOrders } from "../../https";

const PopularDishes = () => {
  const navigate = useNavigate();

  const { data: menusRes } = useQuery({
    queryKey: ["menus"],
    queryFn: getMenus,
  });
  const { data: ordersRes } = useQuery({
    queryKey: ["orders"],
    queryFn: getOrders,
  });

  const menus = menusRes?.data?.data || [];
  const orders = ordersRes?.data?.data || [];

  // Compute real order counts per dish from orders
  const dishOrderCounts = {};
  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const id = item.menuItemId || item._id;
      if (id) dishOrderCounts[id] = (dishOrderCounts[id] || 0) + (item.quantity || 1);
    });
  });

  // Flatten all dishes with their real order counts
  const allDishes = [];
  menus.forEach((menu) => {
    (menu.items || []).forEach((item) => {
      allDishes.push({
        ...item,
        category: menu.name,
        categoryId: menu._id,
        numberOfOrders: dishOrderCounts[item._id] || 0,
      });
    });
  });

  // Sort by order count descending, take top 5
  const popularDishes = allDishes
    .sort((a, b) => b.numberOfOrders - a.numberOfOrders)
    .slice(0, 5);

  return (
    <div className="card border border-[#E2E8F0] bg-white p-4 shadow-card sm:p-6">
      <div className="flex justify-between items-center mb-4">
          <h1 className="font-display text-lg font-semibold text-[#0F172A]">Popular Dishes</h1>
        <button
          onClick={() => navigate("/menu")}
          className="flex items-center gap-2 text-sm font-semibold text-[#2563EB] transition-all hover:gap-3"
        >
          View all <FiArrowRight />
        </button>
      </div>

      {popularDishes.length === 0 ? (
        <div className="py-10 text-center text-content-muted">
          <p className="text-4xl mb-2">🍽️</p>
          <p className="text-sm">No dishes yet. Add your menu from the Dashboard and your popular dishes will show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {popularDishes.map((dish, index) => (
            <div
              key={dish._id}
              onClick={() => navigate("/menu", { state: { selectedCategoryId: dish.categoryId } })}
              className="flex items-center gap-4 p-3 rounded-xl bg-surface-input border border-border hover:border-accent/40 hover:shadow-md transition-all group cursor-pointer"
            >
              <span className="font-bold text-lg text-content-muted w-7">{String(index + 1).padStart(2, "0")}</span>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#5B42F3] to-[#7C3AED] text-lg font-bold text-white transition-transform group-hover:scale-110">
                {dish.name?.[0]?.toUpperCase() || "D"}
              </div>
              <div className="flex-1">
                <h1 className="font-semibold text-sm">{dish.name}</h1>
                <p className="text-xs text-content-muted">
                  <span className="text-accent font-semibold">{dish.numberOfOrders}</span> orders
                </p>
              </div>
              <span className="text-content-muted text-lg">›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PopularDishes;