import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import {
  addCategory,
  addDish,
  addSubcategory,
  bulkAddGroup,
  bulkRemoveGroup,
  deleteCategory,
  deleteDish,
  exportMenuCsv,
  getMenus,
  importMenuCsv,
  previewMenuCsv,
  saveGroupToDishes,
  toggleDishAvailability,
  unpublishMenu,
  publishMenu,
  uploadMediaAsset,
} from "../../https";

/* ---------- Icons ---------- */
const IconFolder = () => (
  <span className="w-8 h-8 rounded-lg bg-[#FF6A1F]/10 text-[#FF6A1F] flex items-center justify-center shrink-0 font-bold">
    📁
  </span>
);
const IconDoc = () => (
  <span className="w-8 h-8 rounded-lg bg-[#0249FD]/10 text-[#0249FD] flex items-center justify-center shrink-0 font-bold">
    📄
  </span>
);
const IconDots = () => (
  <span className="text-[#94A3B8] font-bold text-lg cursor-grab select-none tracking-tighter">
    :::
  </span>
);
const IconPlus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);
const IconX = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const NAV_TABS = [
  { id: "product", label: "Product" },
  { id: "groups", label: "Groups" },
  { id: "component", label: "Component" },
  { id: "label", label: "Label" },
  { id: "manual", label: "Manual Product" },
  { id: "shorthand", label: "Short Hand" },
  { id: "department", label: "Department" },
  { id: "producttime", label: "Product Time" },
];

const ManageMenu = () => {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("product");

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkMenu, setShowBulkMenu] = useState(false);

  // Category management drill-down
  const [activeCategory, setActiveCategory] = useState(null);

  // Drawers & Modals
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showCreateSubcategory, setShowCreateSubcategory] = useState(false);
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [showManageGroup, setShowManageGroup] = useState(false);
  const [csvPreviewData, setCsvPreviewData] = useState(null); // Module 5 preview modal state
  const [csvPendingText, setCsvPendingText] = useState("");

  // Group Management Form states (Module 4)
  const [groupName, setGroupName] = useState("");
  const [groupRequired, setGroupRequired] = useState(false);
  const [groupMax, setGroupMax] = useState("1");
  const [extrasList, setExtrasList] = useState([{ name: "Extra Cheese", price: "20" }]);
  const [extraNameInput, setExtraNameInput] = useState("");
  const [extraPriceInput, setExtraPriceInput] = useState("20");
  const [assignedDishIds, setAssignedDishIds] = useState(new Set());

  // Form states for Category/Subcategory
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const [dispatchAll, setDispatchAll] = useState(true);
  const [dispatchCol, setDispatchCol] = useState(true);
  const [dispatchDel, setDispatchDel] = useState(true);
  const [dispatchTbl, setDispatchTbl] = useState(true);
  const [bgColor, setBgColor] = useState("#0249fd");
  const [textColor, setTextColor] = useState("#ffffff");

  // Form states for Product (Module 2)
  const [prodName, setProdName] = useState("");
  const [prodDesc, setProdDesc] = useState("");
  const [prodPrice, setProdPrice] = useState("100");
  const [prodSamePrice, setProdSamePrice] = useState(true);
  const [channelPrices, setChannelPrices] = useState({
    posCollection: "100",
    posDelivery: "100",
    posTable: "100",
    websiteCollection: "100",
    websiteDelivery: "100",
    websiteTable: "100",
  });
  const [prodVeg, setProdVeg] = useState(true);
  const [prodDisplay, setProdDisplay] = useState("both"); // both, system, website
  const [prodImageUrl, setProdImageUrl] = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);

  const { data: menusRes, isLoading } = useQuery({ queryKey: ["menus"], queryFn: getMenus });
  const menus = menusRes?.data?.data || [];

  // Extract all groups across all dishes (Module 4 §4)
  const allGroupsMap = useMemo(() => {
    const map = new Map();
    menus.forEach((menu) => {
      (menu.items || []).forEach((item) => {
        (item.modifierGroups || []).forEach((group) => {
          if (!map.has(group.name)) {
            map.set(group.name, {
              name: group.name,
              required: Boolean(group.required),
              maxSelections: group.maxSelections || 1,
              options: group.options || [],
              dishIds: new Set([String(item._id)]),
            });
          } else {
            map.get(group.name).dishIds.add(String(item._id));
          }
        });
      });
    });
    return map;
  }, [menus]);

  const groupsList = Array.from(allGroupsMap.values());

  const saveGroupMut = useMutation({
    mutationFn: saveGroupToDishes,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Group saved!", { variant: "success" });
      invalidate();
      setShowManageGroup(false);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to save group", { variant: "error" }),
  });


  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["menus"] });
    qc.invalidateQueries({ queryKey: ["popular-items"] });
  };

  const addCategoryMut = useMutation({
    mutationFn: addCategory,
    onSuccess: () => {
      enqueueSnackbar("Main Category added!", { variant: "success" });
      invalidate();
      setShowCreateCategory(false);
      resetCategoryForm();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to add category", { variant: "error" }),
  });

  const addSubcatMut = useMutation({
    mutationFn: addSubcategory,
    onSuccess: () => {
      enqueueSnackbar("Subcategory added!", { variant: "success" });
      invalidate();
      setShowCreateSubcategory(false);
      resetCategoryForm();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to add subcategory", { variant: "error" }),
  });

  const addDishMut = useMutation({
    mutationFn: addDish,
    onSuccess: () => {
      enqueueSnackbar("Product added!", { variant: "success" });
      invalidate();
      setShowCreateProduct(false);
      resetProductForm();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to add product", { variant: "error" }),
  });

  const deleteCategoryMut = useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      enqueueSnackbar("Category deleted!", { variant: "success" });
      invalidate();
    },
  });

  const deleteDishMut = useMutation({
    mutationFn: deleteDish,
    onSuccess: () => {
      enqueueSnackbar("Dish deleted!", { variant: "success" });
      invalidate();
    },
  });

  const toggleAvailabilityMut = useMutation({
    mutationFn: updateDishStatus,
    onSuccess: () => invalidate(),
  });

  const resetCategoryForm = () => {
    setCatName("");
    setCatDesc("");
    setDispatchAll(true);
    setDispatchCol(true);
    setDispatchDel(true);
    setDispatchTbl(true);
    setBgColor("#0249fd");
    setTextColor("#ffffff");
  };

  const resetProductForm = () => {
    setProdName("");
    setProdDesc("");
    setProdPrice("100");
    setProdSamePrice(true);
    setChannelPrices({
      posCollection: "100",
      posDelivery: "100",
      posTable: "100",
      websiteCollection: "100",
      websiteDelivery: "100",
      websiteTable: "100",
    });
    setProdVeg(true);
    setProdDisplay("both");
    setProdImageUrl("");
    setDispatchAll(true);
    setDispatchCol(true);
    setDispatchDel(true);
    setDispatchTbl(true);
  };


  // Selection handlers
  const currentItems = activeCategory ? (activeCategory.items || []) : menus;

  const toggleSelectAll = () => {
    if (selectedIds.size === currentItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentItems.map((i) => i._id)));
    }
  };

  const toggleSelectItem = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const isAllSelected = currentItems.length > 0 && selectedIds.size === currentItems.length;

  const handleBulkDelete = () => {
    if (!window.confirm(`Delete ${selectedIds.size} selected item(s)?`)) return;
    selectedIds.forEach((id) => {
      if (activeCategory) {
        deleteDishMut.mutate({ menuId: activeCategory._id, itemId: id });
      } else {
        deleteCategoryMut.mutate(id);
      }
    });
    setSelectedIds(new Set());
    setShowBulkMenu(false);
  };

  const handleSaveCategory = () => {
    if (!catName.trim()) {
      enqueueSnackbar("Category name is required.", { variant: "warning" });
      return;
    }
    const dispatchType = dispatchAll
      ? { collection: true, delivery: true, table: true }
      : { collection: dispatchCol, delivery: dispatchDel, table: dispatchTbl };

    if (showCreateSubcategory && activeCategory) {
      addSubcatMut.mutate({
        menuId: activeCategory._id,
        name: catName,
        description: catDesc,
        dispatchType,
        bgColor,
        textColor,
      });
    } else {
      addCategoryMut.mutate({
        name: catName,
        description: catDesc,
        dispatchType,
        bgColor,
        textColor,
      });
    }
  };

  const handleSaveProduct = () => {
    if (!prodName.trim() || !activeCategory) {
      enqueueSnackbar("Product name is required.", { variant: "warning" });
      return;
    }

    const priceNum = Number(prodPrice);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      enqueueSnackbar("Price cannot be negative.", { variant: "warning" });
      return;
    }

    // Module 2 §5: Validate non-negative channel prices if samePrice is false
    if (!prodSamePrice) {
      for (const [k, v] of Object.entries(channelPrices)) {
        if (Number(v) < 0) {
          enqueueSnackbar(`Channel price for ${k} cannot be negative.`, { variant: "warning" });
          return;
        }
      }
    }

    const dispatchType = dispatchAll
      ? { collection: true, delivery: true, table: true }
      : { collection: dispatchCol, delivery: dispatchDel, table: dispatchTbl };

    addDishMut.mutate({
      menuId: activeCategory._id,
      category: activeCategory.name,
      name: prodName,
      price: priceNum,
      description: prodDesc,
      dispatchType,
      bgColor,
      textColor,
      samePrice: prodSamePrice,
      channelPrices: prodSamePrice
        ? undefined
        : {
            posCollection: Number(channelPrices.posCollection) || priceNum,
            posDelivery: Number(channelPrices.posDelivery) || priceNum,
            posTable: Number(channelPrices.posTable) || priceNum,
            websiteCollection: Number(channelPrices.websiteCollection) || priceNum,
            websiteDelivery: Number(channelPrices.websiteDelivery) || priceNum,
            websiteTable: Number(channelPrices.websiteTable) || priceNum,
          },
      isVegetarian: prodVeg,
      displayTarget: prodDisplay,
      imageUrl: prodImageUrl,
    });
  };


  return (
    <div className="flex h-full w-full bg-[#F8FAFC] overflow-hidden text-[#0F172A]">

      {/* Column 1: Left Navigation Sidebar */}
      <div className="w-[200px] shrink-0 border-r border-[#E2E8F0] bg-white flex flex-col py-3">
        {NAV_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setActiveCategory(null);
                setSelectedIds(new Set());
              }}
              className={`w-full text-left px-5 py-3 text-[13.5px] font-semibold flex items-center justify-between transition-colors ${
                active
                  ? "text-[#5B42F3] bg-[#EEF0FE] border-r-4 border-[#5B42F3] font-bold"
                  : "text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC]"
              }`}
            >
              <span>{tab.label}</span>
              <IconChevronRight />
            </button>
          );
        })}
      </div>

      {/* Column 2: Main List & Action Bar */}
      <div className="flex-1 min-w-0 flex flex-col h-full bg-white border-r border-[#E2E8F0]">

        {/* Top Header / Action Bar (Module 1 §1: No permanent top Manage button!) */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {activeCategory && (
              <button
                onClick={() => {
                  setActiveCategory(null);
                  setSelectedIds(new Set());
                }}
                className="h-8 px-2.5 rounded-lg border border-[#E2E8F0] text-[12.5px] font-bold text-[#475569] hover:bg-[#F8FAFC]"
              >
                ← Back
              </button>
            )}

            {/* Select All Checkbox (Module 1 §3) */}
            <label className="flex items-center gap-2 cursor-pointer select-none text-[13.5px] font-bold text-[#334155]">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-[#CBD5E1] accent-[#5B42F3]"
              />
              <span>Select All</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            {/* Export CSV & Import CSV Buttons (Module 5 §1 & §2) */}
            <button
              onClick={async () => {
                try {
                  const res = await exportMenuCsv();
                  const url = window.URL.createObjectURL(new Blob([res.data]));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "knotkitchen_menu.csv";
                  a.click();
                  enqueueSnackbar("CSV exported!", { variant: "success" });
                } catch (e) {
                  enqueueSnackbar("Failed to export CSV", { variant: "error" });
                }
              }}
              className="h-[36px] px-3.5 rounded-xl border border-[#CBD5E1] bg-white text-[#334155] text-[12.5px] font-bold hover:bg-[#F8FAFC]"
            >
              Export CSV
            </button>

            <label className="h-[36px] px-3.5 rounded-xl border border-[#5B42F3] text-[#5B42F3] bg-white text-[12.5px] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#EEF0FE]">
              <span>Import CSV</span>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  setCsvPendingText(text);
                  try {
                    const res = await previewMenuCsv(text);
                    setCsvPreviewData(res.data.data);
                  } catch (err) {
                    const msgs = err.response?.data?.errors || [err.response?.data?.message || "Invalid CSV"];
                    enqueueSnackbar(`CSV Errors: ${msgs.join(" | ")}`, { variant: "error" });
                  }
                  e.target.value = "";
                }}
              />
            </label>

            {/* Bulk Manage Button — ONLY VISIBLE WHEN 1+ ITEMS ARE SELECTED (Module 1 §4) */}
            {selectedIds.size > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowBulkMenu((b) => !b)}
                  className="h-[38px] px-4 rounded-xl bg-[#0F172A] text-white text-[13px] font-bold flex items-center gap-1.5 shadow-md hover:bg-[#1E293B]"
                >
                  Manage ({selectedIds.size})
                </button>

                {showBulkMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-[#E2E8F0] rounded-xl shadow-xl z-50 py-1 text-[13px]">
                    <button
                      onClick={handleBulkAddGroup}
                      className="w-full text-left px-4 py-2 hover:bg-[#F8FAFC] font-semibold text-[#334155]"
                    >
                      + Add Group to Selected
                    </button>
                    <button
                      onClick={handleBulkRemoveGroup}
                      className="w-full text-left px-4 py-2 hover:bg-[#F8FAFC] font-semibold text-[#64748B]"
                    >
                      - Remove Group from Selected
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      className="w-full text-left px-4 py-2 hover:bg-[#FEF2F2] font-semibold text-[#DC2626] border-t border-[#E2E8F0]"
                    >
                      Delete Items ({selectedIds.size})
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Add Main Category (+) button (Module 1 §2) */}
            {!activeCategory ? (
              <button
                onClick={() => {
                  resetCategoryForm();
                  setShowCreateCategory(true);
                }}
                className="w-9 h-9 rounded-xl border border-[#E2E8F0] text-[#0F172A] hover:bg-[#F8FAFC] flex items-center justify-center text-[20px] font-bold"
                title="Add Main Category"
              >
                +
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    resetCategoryForm();
                    setShowCreateSubcategory(true);
                  }}
                  className="h-[36px] px-3 rounded-xl border border-[#5B42F3] text-[#5B42F3] text-[12.5px] font-bold hover:bg-[#EEF0FE]"
                >
                  + Add Subcategory
                </button>
                <button
                  onClick={() => {
                    resetProductForm();
                    setShowCreateProduct(true);
                  }}
                  className="h-[36px] px-3 rounded-xl bg-[#5B42F3] text-white text-[12.5px] font-bold hover:bg-[#4A32E0]"
                >
                  + Add Product
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Main Item List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0]">
          {isLoading ? (
            <div className="p-12 text-center text-[#94A3B8]">Loading menu data…</div>
          ) : currentItems.length === 0 ? (
            <div className="p-12 text-center text-[#94A3B8]">
              {activeCategory ? "No dishes in this category." : "No categories created yet."}
            </div>
          ) : activeTab === "groups" ? (
            /* Groups / Add-ons List (Module 4 §2) */
            groupsList.map((group) => {
              const selected = selectedIds.has(group.name);

              return (
                <div
                  key={group.name}
                  className={`px-6 py-4 flex items-center justify-between gap-4 transition-colors ${
                    selected ? "bg-[#EEF0FE]/40" : "hover:bg-[#F8FAFC]"
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelectItem(group.name)}
                      className="w-4 h-4 rounded border-[#CBD5E1] accent-[#5B42F3] shrink-0"
                    />

                    <span className="w-2.5 h-2.5 rounded-full bg-[#0249FD] shrink-0" />

                    <div>
                      <p className="font-extrabold text-[15px] text-[#0F172A] truncate">
                        {group.name}
                      </p>
                      <p className="text-[11.5px] font-bold text-[#64748B] truncate">
                        {group.options.length} Extra(s) · {group.dishIds.size} Product(s) attached
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <button
                      onClick={() => {
                        setGroupName(group.name);
                        setGroupRequired(group.required);
                        setGroupMax(String(group.maxSelections || 1));
                        setExtrasList(group.options.map((o) => ({ name: o.name, price: String(o.price) })));
                        setAssignedDishIds(new Set(group.dishIds));
                        setShowManageGroup(true);
                      }}
                      className="h-[36px] px-4 rounded-xl bg-[#0F172A] text-white text-[12.5px] font-bold hover:bg-[#1E293B] shadow-sm"
                    >
                      Manage
                    </button>

                    <IconDots />
                  </div>
                </div>
              );
            })
          ) : !activeCategory ? (
            /* Main Categories List (Module 1 §5) */
            menus.map((menu) => {
              const selected = selectedIds.has(menu._id);
              const isPublished = menu.published !== false;

              return (
                <div
                  key={menu._id}
                  className={`px-6 py-4 flex items-center justify-between gap-4 transition-colors ${
                    selected ? "bg-[#EEF0FE]/40" : "hover:bg-[#F8FAFC]"
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    {/* Selection Checkbox */}
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelectItem(menu._id)}
                      className="w-4 h-4 rounded border-[#CBD5E1] accent-[#5B42F3] shrink-0"
                    />

                    {/* Status Toggle Switch (green/grey) */}
                    <button
                      onClick={() => {
                        if (isPublished) unpublishMenu(menu._id).then(invalidate);
                        else publishMenu(menu._id).then(invalidate);
                      }}
                      className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
                        isPublished ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                          isPublished ? "right-1" : "left-1"
                        }`}
                      />
                    </button>

                    {/* Orange Folder Icon */}
                    <IconFolder />

                    {/* Category Name */}
                    <span className="font-extrabold text-[15px] text-[#0F172A] truncate">
                      {menu.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {/* Category Manage Button (Module 1 §5) */}
                    <button
                      onClick={() => {
                        setActiveCategory(menu);
                        setSelectedIds(new Set());
                      }}
                      className="h-[36px] px-4 rounded-xl bg-[#0F172A] text-white text-[12.5px] font-bold hover:bg-[#1E293B] shadow-sm"
                    >
                      Manage
                    </button>

                    {/* Drag Handle Dots */}
                    <IconDots />
                  </div>
                </div>
              );
            })
          ) : (
            /* Inside Main Category: Products & Subcategories (Module 1 §6) */
            (activeCategory.items || []).map((item) => {
              const selected = selectedIds.has(item._id);
              const isAvailable = item.isAvailable !== false;

              return (
                <div
                  key={item._id}
                  className={`px-6 py-4 flex items-center justify-between gap-4 transition-colors ${
                    selected ? "bg-[#EEF0FE]/40" : "hover:bg-[#F8FAFC]"
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelectItem(item._id)}
                      className="w-4 h-4 rounded border-[#CBD5E1] accent-[#5B42F3] shrink-0"
                    />

                    <button
                      onClick={() => toggleAvailabilityMut.mutate({ menuId: activeCategory._id, itemId: item._id })}
                      className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
                        isAvailable ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                      }`}
                    >
                      <span
                        className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                          isAvailable ? "right-1" : "left-1"
                        }`}
                      />
                    </button>

                    <IconDoc />

                    <div className="min-w-0">
                      <p className="font-extrabold text-[15px] text-[#0F172A] truncate">
                        {item.name}
                      </p>
                      {item.subcategory && (
                        <p className="text-[11.5px] font-bold text-[#5B42F3] truncate">
                          {item.subcategory}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-extrabold text-[14px] text-[#0F172A]">
                      ₹{item.price}
                    </span>

                    <button
                      onClick={() => {
                        deleteDishMut.mutate({ menuId: activeCategory._id, itemId: item._id });
                      }}
                      className="h-[36px] px-3.5 rounded-xl border border-[#FECACA] text-[#DC2626] text-[12px] font-bold hover:bg-[#FEF2F2]"
                    >
                      Delete
                    </button>

                    <IconDots />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Column 3: Right Steps Panel (Matching reference screenshots 1 & 4) */}
      <div className="w-[280px] shrink-0 bg-[#1C2638] text-white p-6 flex flex-col space-y-6 overflow-y-auto">
        <h3 className="text-[18px] font-extrabold tracking-tight">
          {activeTab === "groups" ? "Group's Steps" : "Category's Steps"}
        </h3>

        {activeTab === "groups" ? (
          <div className="space-y-4 text-[12.5px] leading-relaxed text-[#CBD5E1]">
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full border border-white/40 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">01</span>
              <p>Create groups of different dishes that you offer (example, Toppings for 15 inch pizza, Sauce & Salad for wraps, Create your own toppings for 14 inch pizza etc).</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full border border-white/40 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">02</span>
              <p>Create the group by clicking on the Group tab at the top right corner.</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full border border-white/40 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">03</span>
              <p>Click on Save Changes.</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full border border-white/40 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">04</span>
              <p>Once the Group is made, click on Manage to customise.</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full border border-white/40 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">05</span>
              <p>If you want to add a series of components to this group, click on Add New Component and select from the list that pops up.</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="w-6 h-6 rounded-full border border-white/40 text-white font-bold flex items-center justify-center shrink-0 text-[11px]">06</span>
              <p>Add in the rest of the details as required and click on Save Changes.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5 text-[13px] leading-relaxed text-[#CBD5E1]">
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full border-2 border-white/30 text-white font-extrabold flex items-center justify-center shrink-0 text-[12px]">01</span>
              <p>Categorise the dishes according to the time of day they're served.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full border-2 border-white/30 text-white font-extrabold flex items-center justify-center shrink-0 text-[12px]">02</span>
              <p>Click on the Product time button at the top right corner of the page.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full border-2 border-white/30 text-white font-extrabold flex items-center justify-center shrink-0 text-[12px]">03</span>
              <p>Enter the name of the dish and the timing through which it is served.</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-7 h-7 rounded-full border-2 border-white/30 text-white font-extrabold flex items-center justify-center shrink-0 text-[12px]">04</span>
              <p>Click on Save Changes.</p>
            </div>
          </div>
        )}
      </div>


      {/* Drawers: Create Category / Subcategory Slide-Over Drawer (Reference Image 2) */}
      {(showCreateCategory || showCreateSubcategory) && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
          <div className="w-full max-w-[420px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
              <h3 className="text-[18px] font-extrabold">
                {showCreateSubcategory ? "Create Subcategory" : "Create Category"}
              </h3>
              <button
                onClick={() => {
                  setShowCreateCategory(false);
                  setShowCreateSubcategory(false);
                }}
                className="text-[#94A3B8] hover:text-[#0F172A]"
              >
                <IconX />
              </button>
            </div>

            <div className="space-y-4 flex-1 text-[13px]">
              <div>
                <label className="text-[12px] font-extrabold text-[#334155]">Category Name</label>
                <input
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="e.g. Pizzas"
                  className="w-full h-[40px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[13.5px]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-extrabold text-[#334155]">Category Description</label>
                  <span className="text-[10.5px] text-[#94A3B8] font-bold">{catDesc.length}/200</span>
                </div>
                <textarea
                  maxLength={200}
                  rows={3}
                  value={catDesc}
                  onChange={(e) => setCatDesc(e.target.value)}
                  placeholder="Description..."
                  className="w-full p-3 mt-1 rounded-xl border border-[#E2E8F0] font-medium text-[13px] resize-none"
                />
              </div>

              {/* Module 1 §7: Dispatch Type (Collection, Delivery, Table - all ON by default) */}
              <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[13px] text-[#0F172A]">Dispatch Type</span>
                  <label className="flex items-center gap-2 font-bold text-[12px] text-[#64748B]">
                    <span>All</span>
                    <input
                      type="checkbox"
                      checked={dispatchAll}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setDispatchAll(val);
                        setDispatchCol(val);
                        setDispatchDel(val);
                        setDispatchTbl(val);
                      }}
                      className="w-5 h-5 accent-[#22C55E]"
                    />
                  </label>
                </div>

                {!dispatchAll && (
                  <div className="grid grid-cols-3 gap-2 pt-1 text-[12px]">
                    <label className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold">
                      <input
                        type="checkbox"
                        checked={dispatchCol}
                        onChange={(e) => setDispatchCol(e.target.checked)}
                        className="accent-[#5B42F3]"
                      />
                      <span>Collection</span>
                    </label>

                    <label className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold">
                      <input
                        type="checkbox"
                        checked={dispatchDel}
                        onChange={(e) => setDispatchDel(e.target.checked)}
                        className="accent-[#5B42F3]"
                      />
                      <span>Delivery</span>
                    </label>

                    <label className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold">
                      <input
                        type="checkbox"
                        checked={dispatchTbl}
                        onChange={(e) => setDispatchTbl(e.target.checked)}
                        className="accent-[#5B42F3]"
                      />
                      <span>Table</span>
                    </label>
                  </div>
                )}
              </div>

              <div className="space-y-3 pt-2 border-t border-[#E2E8F0]">
                <div>
                  <label className="text-[12px] font-extrabold text-[#334155]">Background Color</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="flex-1 h-[38px] px-3 rounded-xl border border-[#E2E8F0] font-bold"
                    />
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="w-9 h-9 rounded-lg cursor-pointer border"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[12px] font-extrabold text-[#334155]">Text Color</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="flex-1 h-[38px] px-3 rounded-xl border border-[#E2E8F0] font-bold"
                    />
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-9 h-9 rounded-lg cursor-pointer border"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#E2E8F0]">
              <button
                onClick={handleSaveCategory}
                disabled={addCategoryMut.isPending || addSubcatMut.isPending}
                className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
              >
                {addCategoryMut.isPending || addSubcatMut.isPending ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer: Manage Group & Extras (Module 4) */}
      {showManageGroup && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
          <div className="w-full max-w-[440px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
              <h3 className="text-[18px] font-extrabold">Manage Group: {groupName || "New Group"}</h3>
              <button onClick={() => setShowManageGroup(false)} className="text-[#94A3B8] hover:text-[#0F172A]">
                <IconX />
              </button>
            </div>

            <div className="space-y-5 flex-1 text-[13px]">
              <div>
                <label className="text-[12px] font-extrabold text-[#334155]">Group Name</label>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Extra Toppings"
                  className="w-full h-[40px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[13.5px]"
                />
              </div>

              <div className="flex items-center justify-between border-t border-b border-[#E2E8F0] py-3">
                <span className="font-extrabold text-[#0F172A]">Required Selection</span>
                <input
                  type="checkbox"
                  checked={groupRequired}
                  onChange={(e) => setGroupRequired(e.target.checked)}
                  className="w-5 h-5 accent-[#22C55E]"
                />
              </div>

              {/* Add New Extra Section */}
              <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
                <h4 className="font-extrabold text-[13.5px] text-[#0F172A]">Add New Extra</h4>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={extraNameInput}
                    onChange={(e) => setExtraNameInput(e.target.value)}
                    placeholder="e.g. Extra Cheese"
                    className="h-[36px] px-3 rounded-xl border border-[#E2E8F0] font-bold"
                  />
                  <input
                    type="number"
                    min={0}
                    value={extraPriceInput}
                    onChange={(e) => setExtraPriceInput(e.target.value)}
                    placeholder="Price ₹"
                    className="h-[36px] px-3 rounded-xl border border-[#E2E8F0] font-bold"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!extraNameInput.trim()) {
                      enqueueSnackbar("Extra name is required.", { variant: "warning" });
                      return;
                    }
                    if (Number(extraPriceInput) < 0) {
                      enqueueSnackbar("Extra price cannot be negative.", { variant: "warning" });
                      return;
                    }
                    setExtrasList([...extrasList, { name: extraNameInput.trim(), price: extraPriceInput }]);
                    setExtraNameInput("");
                    setExtraPriceInput("20");
                  }}
                  className="w-full h-[36px] rounded-xl bg-[#5B42F3] text-white text-[12.5px] font-bold hover:bg-[#4A32E0]"
                >
                  + Add Extra
                </button>

                {extrasList.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-[#E2E8F0]">
                    {extrasList.map((extra, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#E2E8F0] text-[12.5px]">
                        <span className="font-bold text-[#0F172A]">{extra.name} — ₹{extra.price}</span>
                        <button
                          onClick={() => setExtrasList(extrasList.filter((_, i) => i !== idx))}
                          className="text-[#DC2626] font-bold hover:underline text-[11.5px]"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Product Association */}
              <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
                <h4 className="font-extrabold text-[13px] text-[#0F172A]">Assign to Products</h4>
                <div className="max-h-[160px] overflow-y-auto space-y-1.5 p-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  {menus.flatMap((m) => m.items || []).map((item) => {
                    const assigned = assignedDishIds.has(String(item._id));
                    return (
                      <label key={item._id} className="flex items-center gap-2 p-1.5 hover:bg-white rounded-lg cursor-pointer text-[12.5px] font-bold text-[#334155]">
                        <input
                          type="checkbox"
                          checked={assigned}
                          onChange={() => {
                            const next = new Set(assignedDishIds);
                            if (next.has(String(item._id))) next.delete(String(item._id));
                            else next.add(String(item._id));
                            setAssignedDishIds(next);
                          }}
                          className="w-4 h-4 accent-[#5B42F3]"
                        />
                        <span>{item.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-[#E2E8F0]">
              <button
                onClick={() => {
                  if (!groupName.trim()) {
                    enqueueSnackbar("Group name is required.", { variant: "warning" });
                    return;
                  }
                  saveGroupMut.mutate({
                    groupName: groupName.trim(),
                    required: groupRequired,
                    maxSelections: Number(groupMax) || 1,
                    options: extrasList.map((e) => ({ name: e.name, price: Number(e.price) || 0 })),
                    dishIds: Array.from(assignedDishIds),
                  });
                }}
                disabled={saveGroupMut.isPending}
                className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
              >
                {saveGroupMut.isPending ? "Saving Group…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: CSV Import Preview (Module 5 §6) */}
      {csvPreviewData && (
        <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-[500px] bg-white rounded-2xl p-6 shadow-2xl space-y-4 text-[#0F172A]">
            <h3 className="text-[18px] font-extrabold">CSV Import Preview</h3>

            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-[#B91C1C] text-[12.5px] font-bold">
              ⚠️ Warning: {csvPreviewData.warning || "This import will replace the existing menu completely."}
            </div>

            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div className="p-3 rounded-xl bg-[#F8FAFC] border">
                <span className="text-[#64748B] text-[11px] font-bold">Categories</span>
                <p className="text-lg font-extrabold">{csvPreviewData.categoriesCount}</p>
              </div>
              <div className="p-3 rounded-xl bg-[#F8FAFC] border">
                <span className="text-[#64748B] text-[11px] font-bold">Subcategories</span>
                <p className="text-lg font-extrabold">{csvPreviewData.subcategoriesCount}</p>
              </div>
              <div className="p-3 rounded-xl bg-[#F8FAFC] border">
                <span className="text-[#64748B] text-[11px] font-bold">Products</span>
                <p className="text-lg font-extrabold">{csvPreviewData.productsCount}</p>
              </div>
              <div className="p-3 rounded-xl bg-[#F8FAFC] border">
                <span className="text-[#64748B] text-[11px] font-bold">Groups & Extras</span>
                <p className="text-lg font-extrabold">{csvPreviewData.groupsCount} Groups ({csvPreviewData.extrasCount} Extras)</p>
              </div>
            </div>

            <div className="text-[12px] text-[#64748B] font-semibold">
              Total Records: {csvPreviewData.totalRows}. After importing, click <span className="font-extrabold text-[#0F172A]">Update System Cache</span> and <span className="font-extrabold text-[#0F172A]">Update Website Cache</span> to publish changes.
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setCsvPreviewData(null)}
                className="flex-1 h-[42px] rounded-xl border border-[#CBD5E1] text-[#475569] font-extrabold hover:bg-[#F8FAFC]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await importMenuCsv(csvPendingText);
                    enqueueSnackbar(res.data.message || "Menu completely replaced!", { variant: "success" });
                    invalidate();
                    setCsvPreviewData(null);
                    setCsvPendingText("");
                  } catch (err) {
                    enqueueSnackbar(err.response?.data?.message || "Failed to replace menu", { variant: "error" });
                  }
                }}
                className="flex-1 h-[42px] rounded-xl bg-[#DC2626] text-white font-extrabold shadow-md hover:bg-[#B91C1C]"
              >
                Replace Menu Completely
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer: Create Product Slide-Over Drawer (Reference Image 3) */}
      {showCreateProduct && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
          <div className="w-full max-w-[420px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
              <h3 className="text-[18px] font-extrabold">Create Product</h3>
              <button onClick={() => setShowCreateProduct(false)} className="text-[#94A3B8] hover:text-[#0F172A]">
                <IconX />
              </button>
            </div>

            <div className="space-y-4 flex-1 text-[13px]">
              <div>
                <label className="text-[12px] font-extrabold text-[#334155]">Menu Name</label>
                <input
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  placeholder="e.g. Margherita Pizza"
                  className="w-full h-[40px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[13.5px]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-extrabold text-[#334155]">Product Description</label>
                  <span className="text-[10.5px] text-[#94A3B8] font-bold">{prodDesc.length}/200</span>
                </div>
                <textarea
                  maxLength={200}
                  rows={2}
                  value={prodDesc}
                  onChange={(e) => setProdDesc(e.target.value)}
                  placeholder="Description..."
                  className="w-full p-3 mt-1 rounded-xl border border-[#E2E8F0] font-medium text-[13px] resize-none"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[13px] text-[#0F172A]">Dispatch Type</span>
                  <label className="flex items-center gap-2 font-bold text-[12px] text-[#64748B]">
                    <span>All</span>
                    <input
                      type="checkbox"
                      checked={dispatchAll}
                      onChange={(e) => {
                        const val = e.target.checked;
                        setDispatchAll(val);
                        setDispatchCol(val);
                        setDispatchDel(val);
                        setDispatchTbl(val);
                      }}
                      className="w-5 h-5 accent-[#22C55E]"
                    />
                  </label>
                </div>
              </div>

              {/* Product Image Click-to-Upload / Replace (Module 7) */}
              <div className="pt-2 border-t border-[#E2E8F0]">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-extrabold text-[#334155]">Product Image</label>
                  {prodImageUrl && (
                    <button
                      type="button"
                      onClick={() => setProdImageUrl("")}
                      className="text-[11px] font-bold text-[#DC2626] hover:underline"
                    >
                      Remove Image
                    </button>
                  )}
                </div>
                <label className="mt-1 w-full h-[110px] rounded-xl border-2 border-dashed border-[#CBD5E1] bg-[#F8FAFC] flex flex-col items-center justify-center cursor-pointer hover:border-[#5B42F3] hover:bg-[#EEF0FE]/30 transition-all text-center p-2 relative overflow-hidden">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/jpg"
                    className="hidden"
                    disabled={uploadingImg}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      // Module 7 §3: File validation
                      if (!file.type.startsWith("image/")) {
                        enqueueSnackbar("Please select a valid image file (PNG, JPG, WEBP).", { variant: "error" });
                        return;
                      }
                      if (file.size > 5 * 1024 * 1024) {
                        enqueueSnackbar("Image file size must be less than 5MB.", { variant: "error" });
                        return;
                      }

                      const formData = new FormData();
                      formData.append("file", file);
                      formData.append("folder", "products");

                      setUploadingImg(true);
                      try {
                        const res = await uploadMediaAsset(formData);
                        const uploadedUrl = res.data?.data?.url;
                        if (uploadedUrl) {
                          setProdImageUrl(uploadedUrl);
                          enqueueSnackbar("Product image uploaded successfully!", { variant: "success" });
                        }
                      } catch (err) {
                        const url = prompt("Upload failed. Enter image URL instead:", prodImageUrl);
                        if (url) setProdImageUrl(url.trim());
                      } finally {
                        setUploadingImg(false);
                        e.target.value = "";
                      }
                    }}
                  />
                  {uploadingImg ? (
                    <span className="text-[12px] font-bold text-[#5B42F3] animate-pulse">Uploading image…</span>
                  ) : prodImageUrl ? (
                    <div className="relative h-full w-full flex items-center justify-center">
                      <img src={prodImageUrl} alt="Product" className="h-full object-contain rounded-lg" />
                      <span className="absolute bottom-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                        Click to Replace
                      </span>
                    </div>
                  ) : (
                    <>
                      <span className="text-2xl">📸</span>
                      <span className="text-[11.5px] font-bold text-[#5B42F3] mt-1">Click to upload or replace product image</span>
                      <span className="text-[10px] text-[#94A3B8] font-semibold">PNG, JPG, WEBP up to 5MB</span>
                    </>
                  )}
                </label>
              </div>

              {/* Veg / Non-Veg (Module 2 §6) & Display Target (Module 2 §7) */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E2E8F0]">
                <div>
                  <label className="text-[12px] font-extrabold text-[#334155]">Dietary</label>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setProdVeg(true)}
                      className={`flex-1 h-[36px] rounded-xl font-bold text-[12px] border ${
                        prodVeg ? "bg-[#DCFCE7] border-[#22C55E] text-[#15803D]" : "border-[#E2E8F0] text-[#64748B]"
                      }`}
                    >
                      Veg
                    </button>
                    <button
                      type="button"
                      onClick={() => setProdVeg(false)}
                      className={`flex-1 h-[36px] rounded-xl font-bold text-[12px] border ${
                        !prodVeg ? "bg-[#FEE2E2] border-[#EF4444] text-[#B91C1C]" : "border-[#E2E8F0] text-[#64748B]"
                      }`}
                    >
                      Non-Veg
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[12px] font-extrabold text-[#334155]">Display Target</label>
                  <select
                    value={prodDisplay}
                    onChange={(e) => setProdDisplay(e.target.value)}
                    className="w-full h-[36px] px-2 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[12.5px]"
                  >
                    <option value="both">Both (System & Website)</option>
                    <option value="system">System (POS Only)</option>
                    <option value="website">Website Only</option>
                  </select>
                </div>
              </div>

              {/* Price & Separate Channel Prices (Module 2 §3 & §4) */}
              <div className="pt-2 border-t border-[#E2E8F0] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-extrabold text-[#0F172A]">Same Price for All Channels</label>
                  <input
                    type="checkbox"
                    checked={prodSamePrice}
                    onChange={(e) => setProdSamePrice(e.target.checked)}
                    className="w-5 h-5 accent-[#22C55E]"
                  />
                </div>

                {prodSamePrice ? (
                  <div>
                    <label className="text-[11.5px] font-bold text-[#94A3B8]">Product Price (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={prodPrice}
                      onChange={(e) => setProdPrice(e.target.value)}
                      className="w-full h-[38px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold"
                    />
                  </div>
                ) : (
                  <div className="space-y-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                    <p className="text-[11.5px] font-bold text-[#5B42F3]">Separate Prices (POS vs Website)</p>
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <label className="font-bold text-[#64748B]">POS Collection</label>
                        <input
                          type="number"
                          min={0}
                          value={channelPrices.posCollection}
                          onChange={(e) => setChannelPrices({ ...channelPrices, posCollection: e.target.value })}
                          className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-[#64748B]">POS Delivery</label>
                        <input
                          type="number"
                          min={0}
                          value={channelPrices.posDelivery}
                          onChange={(e) => setChannelPrices({ ...channelPrices, posDelivery: e.target.value })}
                          className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-[#64748B]">POS Table</label>
                        <input
                          type="number"
                          min={0}
                          value={channelPrices.posTable}
                          onChange={(e) => setChannelPrices({ ...channelPrices, posTable: e.target.value })}
                          className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                        />
                      </div>

                      <div>
                        <label className="font-bold text-[#64748B]">Web Collection</label>
                        <input
                          type="number"
                          min={0}
                          value={channelPrices.websiteCollection}
                          onChange={(e) => setChannelPrices({ ...channelPrices, websiteCollection: e.target.value })}
                          className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-[#64748B]">Web Delivery</label>
                        <input
                          type="number"
                          min={0}
                          value={channelPrices.websiteDelivery}
                          onChange={(e) => setChannelPrices({ ...channelPrices, websiteDelivery: e.target.value })}
                          className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-[#64748B]">Web Table</label>
                        <input
                          type="number"
                          min={0}
                          value={channelPrices.websiteTable}
                          onChange={(e) => setChannelPrices({ ...channelPrices, websiteTable: e.target.value })}
                          className="w-full h-[32px] px-2 rounded-lg border border-[#CBD5E1] font-bold"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-[#E2E8F0]">
              <button
                onClick={handleSaveProduct}
                disabled={addDishMut.isPending}
                className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
              >
                {addDishMut.isPending ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageMenu;
