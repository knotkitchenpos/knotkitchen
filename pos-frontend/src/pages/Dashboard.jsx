import React, { useState, useEffect } from "react";
import { MdTableBar, MdCategory, MdNotifications } from "react-icons/md";
import { BiSolidDish } from "react-icons/bi";
import Metrics from "../components/dashboard/Metrics";
import RecentOrders from "../components/dashboard/RecentOrders";
import ManageMenu from "../components/dashboard/ManageMenu";
import MarketplaceOrderModal from "../components/dashboard/MarketplaceOrderModal";
import Modal from "../components/dashboard/Modal";
import { enqueueSnackbar } from "notistack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addCategory, addDish, getOrders, getMenus } from "../https";

const buttons = [
  { label: "Add Table", icon: <MdTableBar />, action: "table" },
  { label: "Add Category", icon: <MdCategory />, action: "category" },
  { label: "Add Dishes", icon: <BiSolidDish />, action: "dishes" },
  { label: "Marketplace Order", icon: <MdNotifications />, action: "marketplace" },
];

const tabs = ["Metrics", "Orders", "Payments", "Menu"];

const Dashboard = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Admin Dashboard";
  }, []);

  const queryClient = useQueryClient();

  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isDishModalOpen, setIsDishModalOpen] = useState(false);
  const [isMarketplaceModalOpen, setIsMarketplaceModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("Metrics");

  const { data: menusRes } = useQuery({
    queryKey: ["menus"],
    queryFn: getMenus,
  });
  const { data: ordersRes } = useQuery({
    queryKey: ["orders"],
    queryFn: getOrders,
  });

  const menus = Array.isArray(menusRes?.data?.data) ? menusRes.data.data : [];
  const orders = Array.isArray(ordersRes?.data?.data) ? ordersRes.data.data : [];

  const addCategoryMutation = useMutation({
    mutationFn: addCategory,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Category added successfully!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      setIsCategoryModalOpen(false);
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
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to add dish.", { variant: "error" });
    },
  });

  const handleOpenModal = (action) => {
    if (action === "table") setIsTableModalOpen(true);
    else if (action === "category") setIsCategoryModalOpen(true);
    else if (action === "dishes") setIsDishModalOpen(true);
    else if (action === "marketplace") setIsMarketplaceModalOpen(true);
  };

  const handleCloseCategoryModal = () => setIsCategoryModalOpen(false);
  const handleCloseMarketplaceModal = () => setIsMarketplaceModalOpen(false);
  const handleCloseDishModal = () => setIsDishModalOpen(false);

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

  const totalCash = orders
    .filter((o) => o.paymentMethod === "Cash")
    .reduce((s, o) => s + (o.bills?.totalWithTax || 0), 0);
  const totalOnline = orders
    .filter((o) => o.paymentMethod === "Online")
    .reduce((s, o) => s + (o.bills?.totalWithTax || 0), 0);

  return (
    <div className="flex-1 min-h-0 bg-surface overflow-y-auto no-scrollbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col min-h-full">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-content-muted text-sm">Manage your restaurant</p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-3">
            {buttons.map(({ label, icon, action }) => (
              <button
                key={action}
                onClick={() => handleOpenModal(action)}
                className="btn-secondary !py-2.5 !px-4 text-sm"
              >
                {label} {icon}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mt-8 overflow-x-auto scrollbar-hide pb-1 border-b border-[#E2E8F0]">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={`px-4 py-2.5 rounded-t-xl border border-b-0 text-sm font-bold transition-colors ${
                activeTab === tab
                  ? "bg-[#5B42F3] border-[#5B42F3] text-white"
                  : "bg-white border-[#E2E8F0] text-[#475569] hover:border-[#5B42F3] hover:text-[#5B42F3]"
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="mt-6">
          {activeTab === "Metrics" && <Metrics />}
          {activeTab === "Orders" && <RecentOrders />}
          {activeTab === "Payments" && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
                <p className="text-sm text-content-muted">Total Cash Payments</p>
                <p className="text-3xl font-bold mt-2">₹{totalCash.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
                <p className="text-sm text-content-muted">Total Online Payments</p>
                <p className="text-3xl font-bold mt-2">₹{totalOnline.toLocaleString("en-IN")}</p>
              </div>
              <div className="rounded-xl border border-[#4A32E0] bg-[#5B42F3] p-6 text-white">
                <p className="text-sm text-white/80">Total Revenue</p>
                <p className="text-3xl font-bold mt-2">
                  ₹{(totalCash + totalOnline).toLocaleString("en-IN")}
                </p>
              </div>
            </div>
          )}
          {activeTab === "Menu" && <ManageMenu />}
        </div>
      </div>

      {isTableModalOpen && <Modal setIsTableModalOpen={setIsTableModalOpen} />}

      {/* Marketplace Order Modal */}
      {isMarketplaceModalOpen && (
        <MarketplaceOrderModal menus={menus} onClose={handleCloseMarketplaceModal} />
      )}

      {/* Category Modal */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 bg-[#0F172A]/60 flex items-center justify-center z-[100] p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md border border-[#CBD5E1]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-[#0F172A] text-xl font-extrabold font-display">Add Category</h2>
              <button
                onClick={handleCloseCategoryModal}
                className="text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg text-2xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddCategory} className="space-y-6">
              <div>
                <label className="block text-[#475569] mb-2 text-sm font-bold">
                  Category Name
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="categoryName"
                    placeholder="e.g. Starters, Main Course"
                    className="w-full h-[46px] px-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[#0F172A] focus:outline-none focus:border-[#5B42F3]"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={addCategoryMutation.isPending}
                className="w-full h-[48px] rounded-xl bg-[#5B42F3] text-white font-bold text-base hover:bg-[#4A32E0] disabled:opacity-50"
              >
                {addCategoryMutation.isPending ? "Adding..." : "Add Category"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Dish Modal */}
      {isDishModalOpen && (
        <div className="fixed inset-0 bg-[#0F172A]/60 flex items-center justify-center z-[100] p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-md border border-[#CBD5E1]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-[#0F172A] text-xl font-extrabold font-display">Add Dish</h2>
              <button
                onClick={handleCloseDishModal}
                className="text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg text-2xl leading-none p-1"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddDish} className="space-y-6">
              <div>
                <label className="block text-[#475569] mb-2 text-sm font-bold">
                  Dish Name
                </label>
                <div className="input-container">
                  <input
                    type="text"
                    name="dishName"
                    placeholder="e.g. Butter Chicken"
                    className="w-full h-[46px] px-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[#0F172A] focus:outline-none focus:border-[#5B42F3]"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-[#475569] mb-2 text-sm font-bold">
                  Price (₹)
                </label>
                <div className="input-container">
                  <input
                    type="number"
                    name="dishPrice"
                    placeholder="e.g. 250"
                    className="w-full h-[46px] px-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[#0F172A] focus:outline-none focus:border-[#5B42F3]"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-[#475569] mb-2 text-sm font-bold">
                  Category
                </label>
                <select
                  name="dishCategory"
                  className="w-full h-[46px] bg-white border border-[#E2E8F0] rounded-xl px-3.5 text-[#0F172A] focus:outline-none focus:border-[#5B42F3]"
                  defaultValue=""
                  required
                >
                  <option value="" disabled>Select category</option>
                  {menus.map((menu) => (
                    <option key={menu._id} value={menu._id}>{menu.name}</option>
                  ))}
                </select>
                {menus.length === 0 && (
                  <p className="text-xs text-[#DC2626] mt-2">No categories yet. Add a category first.</p>
                )}
              </div>
              <button
                type="submit"
                disabled={addDishMutation.isPending || menus.length === 0}
                className="w-full h-[48px] rounded-xl bg-[#5B42F3] text-white font-bold text-base hover:bg-[#4A32E0] disabled:opacity-50"
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

export default Dashboard;