import React, { useEffect, useState } from "react";
import { FiUser, FiCoffee, FiPlus, FiShoppingBag, FiTruck, FiGrid } from "react-icons/fi";
import MenuContainer from "../components/menu/MenuContainer";
import CustomerInfo from "../components/menu/CustomerInfo";
import CartInfo from "../components/menu/CartInfo";
import Bill from "../components/menu/Bill";
import { useDispatch, useSelector } from "react-redux";
import { setOrderType } from "../redux/slices/orderTypeSlice";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addCategory, addDish, getMenus } from "../https";
import { enqueueSnackbar } from "notistack";

const ORDER_TYPES = [
  { key: "Collection", label: "Collection", icon: <FiShoppingBag size={16} /> },
  { key: "Delivery", label: "Delivery", icon: <FiTruck size={16} /> },
  { key: "Table Service", label: "Table Service", icon: <FiGrid size={16} /> },
];

const Menu = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Menu";
  }, []);

  const customerData = useSelector((state) => state.customer);
  const orderType = useSelector((state) => state.orderType.orderType);
  const dispatch = useDispatch();
  const queryClient = useQueryClient();

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isDishModalOpen, setIsDishModalOpen] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);

  const { data: menusRes } = useQuery({
    queryKey: ["menus"],
    queryFn: getMenus,
  });

  const menus = menusRes?.data?.data || [];

  const addCategoryMutation = useMutation({
    mutationFn: addCategory,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Category added successfully!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      setIsCategoryModalOpen(false);
      setIsAddMenuOpen(false);
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to add category.", { variant: "error" });
    },
  });

  const addDishMutation = useMutation({
    mutationFn: addDish,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Dish added successfully!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      setIsDishModalOpen(false);
      setIsAddMenuOpen(false);
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to add dish.", { variant: "error" });
    },
  });

  const handleAddCategory = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const name = formData.get("categoryName");
    addCategoryMutation.mutate({ name });
  };

  const handleAddDish = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const name = formData.get("dishName");
    const price = Number(formData.get("dishPrice"));
    const category = formData.get("dishCategory");
    const menu = menus.find((m) => m._id === category);
    addDishMutation.mutate({ name, price, category: menu?.name || category, menuId: category });
  };

  return (
    <div className="flex-1 min-h-0 bg-surface overflow-y-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col min-h-full">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-start gap-4 mt-6">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold">Menu / EPOS</h1>
              <p className="text-content-muted text-sm">
                Select items to add to the order
              </p>
            </div>
            {/* "+" Quick Add Button */}
            <button
              onClick={() => setIsAddMenuOpen(true)}
              className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center shadow-card hover:bg-accent/90 hover:scale-105 transition-all"
              title="Add category or dish"
            >
              <FiPlus size={22} />
            </button>
          </div>

          <div className="lg:ml-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Order Type Controls */}
            <div className="flex items-center bg-surface-input border border-border rounded-xl p-1 gap-1">
              {ORDER_TYPES.map((ot) => {
                const isActive = orderType === ot.key;
                return (
                  <button
                    key={ot.key}
                    onClick={() => dispatch(setOrderType(ot.key))}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                      isActive
                        ? "bg-accent text-white shadow-card"
                        : "text-content-secondary hover:text-content hover:bg-surface-tertiary"
                    }`}
                    title={`${ot.label} order`}
                  >
                    {ot.icon}
                    <span>{ot.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Customer/Table info */}
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-surface-input border border-border">
              <div className="w-10 h-10 rounded-full bg-gradient-brand flex items-center justify-center text-white">
                <FiUser size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-content">
                  {customerData.customerName || "Customer Name"}
                </p>
                <p className="text-xs text-content-muted">
                  {orderType === "Table Service"
                    ? customerData.table?.tableNo
                      ? `Table: ${customerData.table.tableNo}`
                      : "Select a table from the Tables page"
                    : orderType}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Table Service: show the selected table with its capacity and occupancy */}
        {orderType === "Table Service" && (
          <div className="mt-5 p-4 rounded-xl border border-dashed border-accent/40 bg-accent/5 flex items-center gap-3">
            <FiGrid size={20} className="text-accent flex-shrink-0" />
            <div className="text-sm flex-1">
              <p className="font-semibold text-content">
                {customerData.table?.tableNo
                  ? `Table ${customerData.table.tableNo} selected`
                  : "Table Service selected"}
              </p>
              <p className="text-content-muted text-xs">
                {customerData.table?.tableNo
                  ? `Capacity: ${customerData.table.capacity} customers | Current occupancy: ${customerData.table.occupancy || 0}`
                  : "Go to the Tables page and tap an available table to start the order."}
              </p>
            </div>
          </div>
        )}

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6">
          {/* Menu Container - Left */}
          <div className="lg:col-span-3">
            <MenuContainer />
          </div>

          {/* Right Sidebar - Order Summary */}
          <div className="lg:col-span-1">
            <div className="card p-4 space-y-4 lg:sticky lg:top-20">
              <div className="flex items-center gap-3 pb-4 border-b border-border">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent">
                  <FiCoffee size={20} />
                </div>
                <div>
                  <h2 className="font-display font-semibold text-lg">Order Summary</h2>
                  <p className="text-xs text-content-muted">Current cart</p>
                </div>
              </div>
              <CustomerInfo />
              <CartInfo />
              <div className="pt-4 border-t border-border">
                <Bill />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Menu Modal (pick Category or Dish) */}
      {isAddMenuOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-md border border-border">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-content text-xl font-semibold font-display">Add to Menu</h2>
              <button
                onClick={() => setIsAddMenuOpen(false)}
                className="text-content-muted hover:text-accent-red text-2xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => { setIsCategoryModalOpen(true); setIsAddMenuOpen(false); }}
                className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-surface-input hover:border-accent hover:text-accent transition-colors"
              >
                <span className="text-content font-medium">Add Category</span>
                <span className="text-accent text-xl font-bold">＋</span>
              </button>
              <button
                onClick={() => { setIsDishModalOpen(true); setIsAddMenuOpen(false); }}
                className="w-full flex items-center justify-between p-4 rounded-xl border border-border bg-surface-input hover:border-accent hover:text-accent transition-colors"
              >
                <span className="text-content font-medium">Add Dish</span>
                <span className="text-accent text-xl font-bold">＋</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-md border border-border">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-content text-xl font-semibold font-display">Add Category</h2>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="text-content-muted hover:text-accent-red text-2xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddCategory} className="space-y-6">
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Category Name
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="categoryName"
                    placeholder="e.g. Starters, Main Course"
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={addCategoryMutation.isPending}
                className="btn-primary w-full !py-3 text-base disabled:opacity-50"
              >
                {addCategoryMutation.isPending ? "Adding..." : "Add Category"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Dish Modal */}
      {isDishModalOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface-secondary p-6 rounded-2xl shadow-2xl w-full max-w-md border border-border">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-content text-xl font-semibold font-display">Add Dish</h2>
              <button
                onClick={() => setIsDishModalOpen(false)}
                className="text-content-muted hover:text-accent-red text-2xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddDish} className="space-y-6">
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Dish Name
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="dishName"
                    placeholder="e.g. Butter Chicken"
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Price (₹)
                </label>
                <div className="input-container">
                  <input
                    type="number"
                    name="dishPrice"
                    placeholder="e.g. 250"
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-content-muted mb-2 text-sm font-medium">
                  Category
                </label>
                <select
                  name="dishCategory"
                  className="w-full bg-surface-input border border-border rounded-xl p-3.5 text-content focus:outline-none focus:border-accent"
                  defaultValue=""
                  required
                >
                  <option value="" disabled>Select category</option>
                  {menus.map((menu) => (
                    <option key={menu._id} value={menu._id}>{menu.name}</option>
                  ))}
                </select>
                {menus.length === 0 && (
                  <p className="text-xs text-accent-red mt-2">No categories yet. Add a category first.</p>
                )}
              </div>
              <button
                type="submit"
                disabled={addDishMutation.isPending || menus.length === 0}
                className="btn-primary w-full !py-3 text-base disabled:opacity-50"
              >
                {addDishMutation.isPending ? "Adding..." : "Add Dish"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Menu;