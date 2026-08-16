import React, { useState } from "react";
import { enqueueSnackbar } from "notistack";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addMarketplaceOrder } from "../../https/marketplace";

const MarketplaceOrderModal = ({ menus = [], onClose }) => {
  const queryClient = useQueryClient();
  const [items, setItems] = useState([{ name: "", price: "", quantity: 1 }]);
  const [selectedMenuDish, setSelectedMenuDish] = useState("");

  const allDishes = menus.flatMap((menu) =>
    (menu.items || [])
      .filter((item) => item.isAvailable !== false)
      .map((item) => ({ ...item, category: menu.name }))
  );

  const handleAddFromMenu = () => {
    if (!selectedMenuDish) return;
    const dish = allDishes.find((d) => d._id === selectedMenuDish);
    if (!dish) return;
    setItems((prev) => [...prev, { name: dish.name, price: String(dish.price), quantity: 1 }]);
    setSelectedMenuDish("");
  };

  const mutation = useMutation({
    mutationFn: addMarketplaceOrder,
    onSuccess: () => {
      enqueueSnackbar("Marketplace order added!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onClose();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to add order.", { variant: "error" });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const validItems = items.filter((i) => i.name && i.price);
    if (validItems.length === 0) {
      enqueueSnackbar("Add at least one item!", { variant: "warning" });
      return;
    }
    const total = validItems.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
    mutation.mutate({
      customerDetails: {
        name: formData.get("customerName") || "Guest",
        phone: formData.get("customerPhone") || "",
        guests: 1,
      },
      orderStatus: "Pending",
      marketplace: formData.get("marketplace"),
      marketplaceOrderId: formData.get("orderId") || "",
      bills: { total, tax: 0, totalWithTax: total },
      items: validItems.map((i) => ({
        name: i.name,
        price: Number(i.price),
        quantity: Number(i.quantity),
      })),
      paymentMethod: "Online",
    });
  };

  const updateItem = (idx, field, value) => {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  };

  const addItemRow = () => {
    setItems((prev) => [...prev, { name: "", price: "", quantity: 1 }]);
  };

  const removeItemRow = (idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="fixed inset-0 bg-[#0F172A]/60 flex items-center justify-center z-[100] p-4">
      <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-lg border border-[#CBD5E1] max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-[#0F172A] text-xl font-extrabold font-display">Add Marketplace Order</h2>
          <button
            onClick={onClose}
            className="text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg text-2xl leading-none p-1"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[#475569] mb-2 text-sm font-bold">Platform</label>
              <select name="marketplace" className="w-full h-[46px] bg-white border border-[#E2E8F0] rounded-xl px-3 text-[#0F172A] focus:outline-none focus:border-[#5B42F3]" defaultValue="Swiggy" required>
                <option value="Swiggy">Swiggy</option>
                <option value="Zomato">Zomato</option>
                <option value="Manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-[#475569] mb-2 text-sm font-bold">Order ID</label>
              <input name="orderId" placeholder="Optional" className="w-full h-[46px] bg-white border border-[#E2E8F0] rounded-xl px-3 text-[#0F172A] focus:outline-none focus:border-[#5B42F3]" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[#475569] mb-2 text-sm font-bold">Customer Name</label>
              <input name="customerName" placeholder="e.g. Rahul" className="w-full h-[46px] bg-white border border-[#E2E8F0] rounded-xl px-3 text-[#0F172A] focus:outline-none focus:border-[#5B42F3]" required />
            </div>
            <div>
              <label className="block text-[#475569] mb-2 text-sm font-bold">Phone</label>
              <input name="customerPhone" placeholder="Optional" className="w-full h-[46px] bg-white border border-[#E2E8F0] rounded-xl px-3 text-[#0F172A] focus:outline-none focus:border-[#5B42F3]" />
            </div>
          </div>
          {allDishes.length > 0 && (
            <div>
              <label className="block text-[#475569] mb-2 text-sm font-bold">
                Add from Menu
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedMenuDish}
                  onChange={(e) => setSelectedMenuDish(e.target.value)}
                  className="flex-1 h-[46px] bg-white border border-[#E2E8F0] rounded-xl px-3 text-sm text-[#0F172A] focus:outline-none focus:border-[#5B42F3]"
                >
                  <option value="">Select a dish...</option>
                  {allDishes.map((dish) => (
                    <option key={dish._id} value={dish._id}>
                      {dish.name} ({dish.category}) - ₹{dish.price}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddFromMenu}
                  disabled={!selectedMenuDish}
                  className="h-[46px] px-4 rounded-xl border border-[#5B42F3] text-[#5B42F3] font-bold text-sm disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          )}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-[#475569] text-sm font-bold">Items</label>
              <button type="button" onClick={addItemRow} className="text-[#5B42F3] text-sm font-bold hover:underline">
                + Add Item
              </button>
            </div>
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_70px_36px] gap-2 items-center">
                  <input
                    value={item.name}
                    onChange={(e) => updateItem(idx, "name", e.target.value)}
                    placeholder="Item name"
                    className="h-[42px] bg-white border border-[#E2E8F0] rounded-xl px-2.5 text-sm text-[#0F172A] focus:outline-none focus:border-[#5B42F3]"
                  />
                  <input
                    value={item.price}
                    onChange={(e) => updateItem(idx, "price", e.target.value)}
                    placeholder="Price"
                    type="number"
                    className="h-[42px] bg-white border border-[#E2E8F0] rounded-xl px-2.5 text-sm text-[#0F172A] focus:outline-none focus:border-[#5B42F3]"
                  />
                  <input
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                    placeholder="Qty"
                    type="number"
                    min="1"
                    className="h-[42px] bg-white border border-[#E2E8F0] rounded-xl px-2.5 text-sm text-[#0F172A] focus:outline-none focus:border-[#5B42F3]"
                  />
                  <button type="button" onClick={() => removeItemRow(idx)} className="text-accent-red hover:opacity-70 text-lg">
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button type="submit" disabled={mutation.isPending} className="w-full h-[48px] rounded-xl bg-[#5B42F3] text-white font-bold text-base hover:bg-[#4A32E0] disabled:opacity-50">
            {mutation.isPending ? "Adding..." : "Add Marketplace Order"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default MarketplaceOrderModal;