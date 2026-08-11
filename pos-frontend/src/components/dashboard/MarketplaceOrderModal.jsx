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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-lg border border-border max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-content text-xl font-semibold font-display">Add Marketplace Order</h2>
          <button
            onClick={onClose}
            className="text-content-muted hover:text-accent-red text-2xl leading-none p-1"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-content-muted mb-2 text-sm font-medium">Platform</label>
              <select name="marketplace" className="w-full bg-surface-input border border-border rounded-xl p-3 text-content focus:outline-none focus:border-accent" defaultValue="Swiggy" required>
                <option value="Swiggy">Swiggy</option>
                <option value="Zomato">Zomato</option>
                <option value="Manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-content-muted mb-2 text-sm font-medium">Order ID</label>
              <input name="orderId" placeholder="Optional" className="w-full bg-surface-input border border-border rounded-xl p-3 text-content focus:outline-none focus:border-accent" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-content-muted mb-2 text-sm font-medium">Customer Name</label>
              <input name="customerName" placeholder="e.g. Rahul" className="w-full bg-surface-input border border-border rounded-xl p-3 text-content focus:outline-none focus:border-accent" required />
            </div>
            <div>
              <label className="block text-content-muted mb-2 text-sm font-medium">Phone</label>
              <input name="customerPhone" placeholder="Optional" className="w-full bg-surface-input border border-border rounded-xl p-3 text-content focus:outline-none focus:border-accent" />
            </div>
          </div>
          {allDishes.length > 0 && (
            <div>
              <label className="block text-content-muted mb-2 text-sm font-medium">
                Add from Menu
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedMenuDish}
                  onChange={(e) => setSelectedMenuDish(e.target.value)}
                  className="flex-1 bg-surface-input border border-border rounded-xl p-3 text-sm text-content focus:outline-none focus:border-accent"
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
                  className="btn-secondary !py-2.5 !px-4 text-sm disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          )}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-content-muted text-sm font-medium">Items</label>
              <button type="button" onClick={addItemRow} className="text-accent text-sm font-semibold hover:text-accent-green">
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
                    className="bg-surface-input border border-border rounded-xl p-2.5 text-sm text-content focus:outline-none focus:border-accent"
                  />
                  <input
                    value={item.price}
                    onChange={(e) => updateItem(idx, "price", e.target.value)}
                    placeholder="Price"
                    type="number"
                    className="bg-surface-input border border-border rounded-xl p-2.5 text-sm text-content focus:outline-none focus:border-accent"
                  />
                  <input
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                    placeholder="Qty"
                    type="number"
                    min="1"
                    className="bg-surface-input border border-border rounded-xl p-2.5 text-sm text-content focus:outline-none focus:border-accent"
                  />
                  <button type="button" onClick={() => removeItemRow(idx)} className="text-accent-red hover:opacity-70 text-lg">
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button type="submit" disabled={mutation.isPending} className="btn-primary w-full !py-3 text-base disabled:opacity-50">
            {mutation.isPending ? "Adding..." : "Add Marketplace Order"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default MarketplaceOrderModal;