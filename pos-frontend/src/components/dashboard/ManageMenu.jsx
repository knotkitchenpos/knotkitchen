import React, { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import {
  addCategory,
  updateCategory,
  addDish,
  updateDish,
  addSubcategory,
  updateSubcategory,
  bulkAddGroup,
  bulkRemoveGroup,
  deleteCategory,
  deleteDish,
  downloadMenuCsvTemplate,
  exportMenuCsv,
  getMenus,
  importMenuCsv,
  previewMenuCsv,
  saveGroupToDishes,
  deleteGroupFromDishes,
  renameGroupInDishes,
  toggleGroupActive,
  reorderGroups,
  unpublishMenu,
  publishMenu,
  publishSystemCache,
  publishWebsiteCache,
  uploadMediaAsset,
  updateDishStatus,
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
  { id: "product", label: "Products" },
  { id: "groups", label: "Groups" },
];

const ManageMenu = () => {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("product");

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkMenu, setShowBulkMenu] = useState(false);

  // Drill-down navigation state
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeSubcategory, setActiveSubcategory] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);

  // Drawers & Modals
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showCreateSubcategory, setShowCreateSubcategory] = useState(false);
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [showManageGroup, setShowManageGroup] = useState(false);
  const [csvPreviewData, setCsvPreviewData] = useState(null); // Module 5 preview modal state
  const [csvPendingText, setCsvPendingText] = useState("");

  // Drag and drop state for groups list (Module: Groups List UI Redesign)
  const [draggedGroupIndex, setDraggedGroupIndex] = useState(null);
  const [groupActiveStates, setGroupActiveStates] = useState({});

  // Group Management Form states (Module 4 & 7)
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingCompIndex, setEditingCompIndex] = useState(null);
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

  // Product Form & View states (Module 4)
  const [editingProduct, setEditingProduct] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);
  const [prodAvailable, setProdAvailable] = useState(true);
  const [prodScheduleEnabled, setProdScheduleEnabled] = useState(false);
  const [prodStartTime, setProdStartTime] = useState("09:00");
  const [prodEndTime, setProdEndTime] = useState("23:00");
  const [prodDaysOfWeek, setProdDaysOfWeek] = useState([0, 1, 2, 3, 4, 5, 6]);

  // Form states for Product
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
  // Names of modifier groups assigned to the product being created/edited (Module 4)
  const [prodAssignedGroupNames, setProdAssignedGroupNames] = useState(new Set());

  const { data: menusRes, isLoading } = useQuery({ queryKey: ["menus"], queryFn: getMenus });
  const menus = menusRes?.data?.data || [];

  // Persisted registry of created groups so newly-created groups show up
  // in the "Assign Groups / Components" list immediately, even before they
  // are attached to any product.
  const [customCreatedGroups, setCustomCreatedGroups] = useState(() => {
    try {
      const raw = localStorage.getItem("kk_custom_groups");
      const parsed = raw ? JSON.parse(raw) : {};
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("kk_custom_groups", JSON.stringify(customCreatedGroups));
    } catch {
      /* ignore storage quota / private mode */
    }
  }, [customCreatedGroups]);

  // Extract all groups across all dishes + registered custom groups (Module 4 §4)
  const allGroupsMap = useMemo(() => {
    const map = new Map();

    // 1. Seed with custom created groups so unattached groups are visible
    Object.values(customCreatedGroups).forEach((g) => {
      if (!g || !g.name) return;
      map.set(g.name, {
        name: g.name,
        required: Boolean(g.required),
        maxSelections: g.maxSelections || 1,
        options: Array.isArray(g.options) ? g.options : [],
        dishIds: new Set(),
      });
    });

    // 2. Merge groups from all dishes across all menus
    const safeMenus = Array.isArray(menus) ? menus : [];
    safeMenus.forEach((menu) => {
      if (!menu) return;
      (menu.items || []).forEach((item) => {
        if (!item) return;
        (item.modifierGroups || []).forEach((group) => {
          if (!group || !group.name) return;
          const options = Array.isArray(group.options) ? group.options : [];
          if (!map.has(group.name)) {
            map.set(group.name, {
              name: group.name,
              required: Boolean(group.required),
              maxSelections: group.maxSelections || 1,
              options: options,
              dishIds: new Set([String(item._id)]),
            });
          } else {
            const entry = map.get(group.name);
            entry.dishIds.add(String(item._id));
            if (options.length) entry.options = options;
            entry.required = Boolean(group.required);
            entry.maxSelections = group.maxSelections || entry.maxSelections;
          }
        });
      });
    });
    return map;
  }, [menus, customCreatedGroups]);

  const groupsList = Array.from(allGroupsMap.values());

  const saveGroupMut = useMutation({
    mutationFn: saveGroupToDishes,
    onSuccess: (res, variables) => {
      enqueueSnackbar(res?.data?.message || "Group saved!", { variant: "success" });
      if (variables?.groupName) {
        setCustomCreatedGroups((prev) => ({
          ...prev,
          [variables.groupName]: {
            name: variables.groupName,
            required: Boolean(variables.required),
            maxSelections: Number(variables.maxSelections) || 1,
            options: Array.isArray(variables.options) ? variables.options : [],
          },
        }));
      }
      invalidate();
      setShowManageGroup(false);
      setEditingGroup(null);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to save group", { variant: "error" }),
  });

  const deleteGroupMut = useMutation({
    mutationFn: deleteGroupFromDishes,
    onSuccess: (res, variables) => {
      enqueueSnackbar(res?.data?.message || "Group deleted!", { variant: "success" });
      if (variables?.groupName) {
        setCustomCreatedGroups((prev) => {
          const next = { ...prev };
          delete next[variables.groupName];
          return next;
        });
      }
      invalidate();
      setShowManageGroup(false);
      setActiveGroup(null);
      setEditingGroup(null);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to delete group", { variant: "error" }),
  });

  const toggleGroupActiveMut = useMutation({
    mutationFn: toggleGroupActive,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Group status updated!", { variant: "success" });
      invalidate();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update group status", { variant: "error" }),
  });

  const reorderGroupsMut = useMutation({
    mutationFn: reorderGroups,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Groups reordered!", { variant: "success" });
      invalidate();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to reorder groups", { variant: "error" }),
  });

  const handleDeleteGroup = (targetGroup) => {
    if (!targetGroup) return;
    const attachedCount = targetGroup?.dishIds?.size || 0;
    const msg = attachedCount > 0
      ? `Delete Group "${targetGroup.name}"? It is attached to ${attachedCount} product(s). This will safely unassign the group without deleting products or orders.`
      : `Delete Group "${targetGroup.name}"?`;
    if (window.confirm(msg)) {
      deleteGroupMut.mutate({ groupName: targetGroup.name });
    }
  };


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

  const updateCategoryMut = useMutation({
    mutationFn: updateCategory,
    onSuccess: () => {
      enqueueSnackbar("Category updated!", { variant: "success" });
      invalidate();
      setShowCreateCategory(false);
      resetCategoryForm();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update category", { variant: "error" }),
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

  const updateSubcatMut = useMutation({
    mutationFn: updateSubcategory,
    onSuccess: () => {
      enqueueSnackbar("Subcategory updated!", { variant: "success" });
      invalidate();
      setShowCreateSubcategory(false);
      resetCategoryForm();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update subcategory", { variant: "error" }),
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

  const updateDishMut = useMutation({
    mutationFn: updateDish,
    onSuccess: () => {
      enqueueSnackbar("Product updated!", { variant: "success" });
      invalidate();
      setShowCreateProduct(false);
      setEditingProduct(null);
      resetProductForm();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update product", { variant: "error" }),
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

  const bulkAddGroupMut = useMutation({
    mutationFn: bulkAddGroup,
    onSuccess: () => {
      enqueueSnackbar("Group added to selected items!", { variant: "success" });
      invalidate();
      setSelectedIds(new Set());
      setShowBulkMenu(false);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to add group to selected items", { variant: "error" }),
  });

  const bulkRemoveGroupMut = useMutation({
    mutationFn: bulkRemoveGroup,
    onSuccess: () => {
      enqueueSnackbar("Group removed from selected items!", { variant: "success" });
      invalidate();
      setSelectedIds(new Set());
      setShowBulkMenu(false);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to remove group from selected items", { variant: "error" }),
  });

  // Bulk group picker (Module: Bulk Group Assign).
  //
  // Instead of typing a group name into a native prompt, the operator now
  // opens a picker modal listing every group that exists in the tenant.
  // They tick the ones they want and confirm — the same dishIds selection
  // is applied to each picked group via bulkAddGroup / bulkRemoveGroup.
  const [bulkGroupPickerMode, setBulkGroupPickerMode] = useState(null); // "add" | "remove" | null
  const [bulkPickedGroups, setBulkPickedGroups] = useState(new Set());

  const openBulkGroupPicker = (mode) => {
    if (!selectedIds || selectedIds.size === 0) {
      enqueueSnackbar("Select at least one product first.", { variant: "warning" });
      return;
    }
    setBulkPickedGroups(new Set());
    setBulkGroupPickerMode(mode);
    setShowBulkMenu(false);
  };

  const handleBulkAddGroup = () => openBulkGroupPicker("add");
  const handleBulkRemoveGroup = () => openBulkGroupPicker("remove");

  const applyBulkGroupPicker = async () => {
    const picked = Array.from(bulkPickedGroups);
    if (picked.length === 0) {
      enqueueSnackbar("Pick at least one group.", { variant: "warning" });
      return;
    }
    const dishIds = Array.from(selectedIds);
    const mutation = bulkGroupPickerMode === "remove" ? bulkRemoveGroupMut : bulkAddGroupMut;
    // Fire mutations sequentially so react-query invalidation only lands
    // once at the end, and so the backend sees serialised menu writes.
    try {
      for (const name of picked) {
        // eslint-disable-next-line no-await-in-loop
        await mutation.mutateAsync({ groupName: name, dishIds });
      }
      enqueueSnackbar(
        `${bulkGroupPickerMode === "remove" ? "Removed" : "Added"} ${picked.length} group${
          picked.length === 1 ? "" : "s"
        } ${bulkGroupPickerMode === "remove" ? "from" : "to"} ${dishIds.length} product${
          dishIds.length === 1 ? "" : "s"
        }.`,
        { variant: "success" },
      );
    } catch (e) {
      enqueueSnackbar(
        e.response?.data?.message || "Bulk group operation failed. See snackbar for details.",
        { variant: "error" },
      );
    } finally {
      setBulkGroupPickerMode(null);
      setBulkPickedGroups(new Set());
    }
  };


  const resetCategoryForm = () => {
    setCatName("");
    setCatDesc("");
    setDispatchAll(true);
    setDispatchCol(true);
    setDispatchDel(true);
    setDispatchTbl(true);
    setBgColor("#0249fd");
    setTextColor("#ffffff");
    setCatPublished(true);
    setEditingCategory(null);
    setEditingSubcategory(null);
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
    setProdAvailable(true);
    setProdScheduleEnabled(false);
    setProdStartTime("09:00");
    setProdEndTime("23:00");
    setProdDaysOfWeek([0, 1, 2, 3, 4, 5, 6]);
    setProdAssignedGroupNames(new Set());
    setEditingProduct(null);
  };

  const populateProductForm = (item) => {
    setEditingProduct(item);
    const existingGroupNames = Array.isArray(item?.modifierGroups)
      ? item.modifierGroups.map((g) => g?.name).filter(Boolean)
      : [];
    setProdAssignedGroupNames(new Set(existingGroupNames));
    setProdName(item.name || "");
    setProdDesc(item.description || "");
    setProdPrice(String(item.price ?? "100"));
    setProdSamePrice(item.samePrice !== false);
    setChannelPrices({
      posCollection: String(item.channelPrices?.posCollection ?? item.price ?? "100"),
      posDelivery: String(item.channelPrices?.posDelivery ?? item.price ?? "100"),
      posTable: String(item.channelPrices?.posTable ?? item.price ?? "100"),
      websiteCollection: String(item.channelPrices?.websiteCollection ?? item.price ?? "100"),
      websiteDelivery: String(item.channelPrices?.websiteDelivery ?? item.price ?? "100"),
      websiteTable: String(item.channelPrices?.websiteTable ?? item.price ?? "100"),
    });
    setProdVeg(item.isVegetarian !== false);
    setProdDisplay(item.displayTarget || "both");
    setProdImageUrl(item.imageUrl || item.image || "");
    const dt = item.dispatchType || { collection: true, delivery: true, table: true };
    setDispatchAll(Boolean(dt.collection && dt.delivery && dt.table));
    setDispatchCol(Boolean(dt.collection));
    setDispatchDel(Boolean(dt.delivery));
    setDispatchTbl(Boolean(dt.table));
    setProdAvailable(item.isAvailable !== false);
    const sch = item.schedule || {};
    setProdScheduleEnabled(Boolean(sch.enabled));
    setProdStartTime(sch.startTime || "09:00");
    setProdEndTime(sch.endTime || "23:00");
    setProdDaysOfWeek(Array.isArray(sch.daysOfWeek) && sch.daysOfWeek.length ? sch.daysOfWeek : [0, 1, 2, 3, 4, 5, 6]);
    setShowCreateProduct(true);
  };


  // Subcategories calculation inside activeCategory
  const categorySubcategories = useMemo(() => {
    if (!activeCategory) return [];
    const set = new Set();
    (activeCategory.subcategories || []).forEach((s) => {
      const name = typeof s === "string" ? s : s?.name;
      if (name) set.add(name);
    });
    (activeCategory.items || []).forEach((i) => {
      if (i?.subcategory) set.add(i.subcategory);
    });
    return Array.from(set);
  }, [activeCategory]);

  // Selection handlers
  const safeMenus = Array.isArray(menus) ? menus : [];
  const currentItems = useMemo(() => {
    if (activeTab === "groups") {
      if (activeGroup) {
        return safeMenus
          .flatMap((m) => (Array.isArray(m?.items) ? m.items : []))
          .filter((item) => item && activeGroup.dishIds.has(String(item._id)));
      }
      return groupsList;
    }

    if (!activeCategory) {
      return safeMenus;
    }

    const categoryDishes = Array.isArray(activeCategory.items) ? activeCategory.items : [];
    if (activeSubcategory) {
      return categoryDishes.filter((item) => item.subcategory === activeSubcategory);
    }
    return categoryDishes;
  }, [activeTab, activeGroup, activeCategory, activeSubcategory, safeMenus, groupsList]);

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
      if (editingSubcategory) {
        updateSubcatMut.mutate({
          menuId: activeCategory._id,
          subcategoryId: editingSubcategory._id,
          oldName: typeof editingSubcategory === "string" ? editingSubcategory : editingSubcategory.name,
          name: catName,
          description: catDesc,
          dispatchType,
          published: catPublished,
          bgColor,
          textColor,
        });
      } else {
        addSubcatMut.mutate({
          menuId: activeCategory._id,
          name: catName,
          description: catDesc,
          dispatchType,
          bgColor,
          textColor,
        });
      }
    } else {
      if (editingCategory) {
        updateCategoryMut.mutate({
          menuId: editingCategory._id,
          name: catName,
          description: catDesc,
          dispatchType,
          published: catPublished,
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

    const schedule = {
      enabled: prodScheduleEnabled,
      startTime: prodStartTime || "09:00",
      endTime: prodEndTime || "23:00",
      daysOfWeek: prodDaysOfWeek,
    };

    const payload = {
      menuId: activeCategory._id,
      category: activeCategory.name,
      subcategory: activeSubcategory || undefined,
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
      isAvailable: prodAvailable,
      schedule,
      modifierGroups: Array.from(prodAssignedGroupNames)
        .map((name) => {
          const g = allGroupsMap.get(name);
          if (!g) return { name, required: false, maxSelections: 1, options: [] };
          return {
            name: g.name,
            required: Boolean(g.required),
            maxSelections: g.maxSelections || 1,
            options: Array.isArray(g.options) ? g.options : [],
          };
        }),
    };

    if (editingProduct) {
      updateDishMut.mutate({ ...payload, itemId: editingProduct._id });
    } else {
      addDishMut.mutate(payload);
    }
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

        {/* Top Header / Action Bar */}
        <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {/* Back Button */}
            {activeTab === "product" && activeSubcategory && (
              <button
                onClick={() => {
                  setActiveSubcategory(null);
                  setSelectedIds(new Set());
                }}
                className="h-8 px-2.5 rounded-lg border border-[#E2E8F0] text-[12.5px] font-bold text-[#475569] hover:bg-[#F8FAFC] flex items-center gap-1"
              >
                ← Back
              </button>
            )}
            {activeTab === "product" && activeCategory && !activeSubcategory && (
              <button
                onClick={() => {
                  setActiveCategory(null);
                  setSelectedIds(new Set());
                }}
                className="h-8 px-2.5 rounded-lg border border-[#E2E8F0] text-[12.5px] font-bold text-[#475569] hover:bg-[#F8FAFC] flex items-center gap-1"
              >
                ← Back
              </button>
            )}
            {activeTab === "groups" && activeGroup && (
              <button
                onClick={() => {
                  setActiveGroup(null);
                  setSelectedIds(new Set());
                }}
                className="h-8 px-2.5 rounded-lg border border-[#E2E8F0] text-[12.5px] font-bold text-[#475569] hover:bg-[#F8FAFC] flex items-center gap-1"
              >
                ← Back
              </button>
            )}

            {/* Breadcrumbs Navigation */}
            <div className="flex items-center gap-1.5 text-[14px] font-extrabold text-[#0F172A]">
              {activeTab === "product" ? (
                <>
                  <span
                    className={activeCategory ? "text-[#64748B] font-semibold cursor-pointer hover:text-[#0F172A]" : ""}
                    onClick={() => {
                      setActiveCategory(null);
                      setActiveSubcategory(null);
                      setSelectedIds(new Set());
                    }}
                  >
                    Products
                  </span>
                  {activeCategory && (
                    <>
                      <span className="text-[#94A3B8]">/</span>
                      <span
                        className={activeSubcategory ? "text-[#64748B] font-semibold cursor-pointer hover:text-[#0F172A]" : ""}
                        onClick={() => {
                          setActiveSubcategory(null);
                          setSelectedIds(new Set());
                        }}
                      >
                        {activeCategory.name}
                      </span>
                    </>
                  )}
                  {activeSubcategory && (
                    <>
                      <span className="text-[#94A3B8]">/</span>
                      <span>{activeSubcategory}</span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span
                    className={activeGroup ? "text-[#64748B] font-semibold cursor-pointer hover:text-[#0F172A]" : ""}
                    onClick={() => {
                      setActiveGroup(null);
                      setSelectedIds(new Set());
                    }}
                  >
                    Groups
                  </span>
                  {activeGroup && (
                    <>
                      <span className="text-[#94A3B8]">/</span>
                      <span>{activeGroup.name}</span>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Select All Checkbox */}
            {(!activeTab === "groups" || !activeGroup) && (
              <label className="flex items-center gap-2 cursor-pointer select-none text-[13.5px] font-bold text-[#334155] ml-2">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-[#CBD5E1] accent-[#5B42F3]"
                />
                <span>Select All</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Cache Publishing Buttons (Module 9) */}
            <button
              onClick={async () => {
                try {
                  const res = await publishSystemCache();
                  enqueueSnackbar(res.data?.message || "System Cache updated!", { variant: "success" });
                  // Force POS Product Panel + Manage Menu to refetch so any
                  // just-toggled isAvailable / price / group changes go live
                  // immediately instead of showing the previous snapshot.
                  await qc.invalidateQueries({ queryKey: ["menus"] });
                  await qc.refetchQueries({ queryKey: ["menus", "system"] });
                  await qc.invalidateQueries({ queryKey: ["popular-items"] });
                } catch (e) {
                  enqueueSnackbar("Failed to publish system cache", { variant: "error" });
                }
              }}
              className="h-[36px] px-3.5 rounded-xl bg-[#0F172A] text-white text-[12.5px] font-bold hover:bg-[#1E293B]"
              title="Publish draft menu to POS counters"
            >
              Publish POS
            </button>

            <button
              onClick={async () => {
                try {
                  const res = await publishWebsiteCache();
                  enqueueSnackbar(res.data?.message || "Website Cache updated!", { variant: "success" });
                  // Force any cached storefront/menu queries to refetch so the
                  // customer website reflects the freshly published snapshot.
                  await qc.invalidateQueries({ queryKey: ["menus"] });
                  await qc.invalidateQueries({ queryKey: ["storefront"] });
                  await qc.invalidateQueries({ queryKey: ["storefront-menu"] });
                  await qc.invalidateQueries({ queryKey: ["website", "settings"] });
                } catch (e) {
                  enqueueSnackbar("Failed to publish website cache", { variant: "error" });
                }
              }}
              className="h-[36px] px-3.5 rounded-xl bg-[#22C55E] text-white text-[12.5px] font-bold hover:bg-[#16A34A]"
              title="Publish draft menu to live customer website"
            >
              Publish Web
            </button>

            {/* Download Template, Export CSV & Import CSV Buttons */}
            <button
              onClick={async () => {
                try {
                  const res = await downloadMenuCsvTemplate();
                  const url = window.URL.createObjectURL(new Blob([res.data]));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "knotkitchen_menu_template.csv";
                  a.click();
                  enqueueSnackbar("CSV Template downloaded!", { variant: "success" });
                } catch (e) {
                  enqueueSnackbar("Failed to download CSV template", { variant: "error" });
                }
              }}
              className="h-[36px] px-3.5 rounded-xl border border-[#CBD5E1] bg-white text-[#334155] text-[12.5px] font-bold hover:bg-[#F8FAFC]"
              title="Download sample Menu CSV template"
            >
              Download Template
            </button>

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

            {/* Bulk Manage Button — ONLY VISIBLE WHEN 1+ ITEMS ARE SELECTED */}
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

            {/* Action Buttons based on Context */}
            {activeTab === "product" ? (
              !activeCategory ? (
                <button
                  onClick={() => {
                    resetCategoryForm();
                    setShowCreateCategory(true);
                  }}
                  className="h-[36px] px-3.5 rounded-xl bg-[#5B42F3] text-white text-[12.5px] font-bold hover:bg-[#4A32E0]"
                  title="Add Category"
                >
                  + Add Category
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
              )
            ) : (
              <button
                onClick={() => {
                  setGroupName("");
                  setGroupRequired(false);
                  setGroupMax("1");
                  setExtrasList([{ name: "", price: "0" }]);
                  setAssignedDishIds(new Set());
                  setShowManageGroup(true);
                }}
                className="h-[36px] px-3.5 rounded-xl bg-[#5B42F3] text-white text-[12.5px] font-bold hover:bg-[#4A32E0]"
              >
                + Add Group
              </button>
            )}
          </div>
        </div>

        {/* Main Item List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#E2E8F0]">
          {isLoading ? (
            <div className="p-12 text-center text-[#94A3B8]">Loading menu data…</div>
          ) : currentItems.length === 0 && !activeGroup && (activeTab === "groups" || !categorySubcategories.length) ? (
            <div className="p-12 text-center text-[#94A3B8]">
              {activeTab === "groups"
                ? "No groups created yet."
                : activeCategory
                ? activeSubcategory
                  ? "No dishes in this subcategory."
                  : "No dishes in this category."
                : "No categories created yet."}
            </div>
          ) : activeTab === "groups" ? (
            activeGroup ? (
              /* Group Detail View (Level 1 Groups) */
              <div className="p-6 space-y-6">
                <div className="p-5 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-extrabold text-[#0F172A]">{activeGroup.name}</h3>
                    <p className="text-[13px] font-semibold text-[#64748B] mt-1">
                      Selection:{" "}
                      <span className="font-bold text-[#0F172A]">
                        {activeGroup.required ? "Required" : "Optional"}
                      </span>{" "}
                      | Max Selections:{" "}
                      <span className="font-bold text-[#0F172A]">{activeGroup.maxSelections}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingGroup(activeGroup);
                        setGroupName(activeGroup.name);
                        setGroupRequired(activeGroup.required);
                        setGroupMax(String(activeGroup.maxSelections || 1));
                        setExtrasList((activeGroup.options || []).map((o) => ({ name: o?.name || "", price: String(o?.price ?? "0") })));
                        setAssignedDishIds(new Set(activeGroup.dishIds));
                        setShowManageGroup(true);
                      }}
                      className="h-[38px] px-4 rounded-xl bg-[#0F172A] text-white text-[13px] font-bold hover:bg-[#1E293B]"
                    >
                      Edit Group
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(activeGroup)}
                      className="h-[38px] px-3.5 rounded-xl border border-[#FECACA] text-[#DC2626] text-[12.5px] font-bold hover:bg-[#FEF2F2]"
                    >
                      Delete Group
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-[14px] font-extrabold text-[#0F172A]">
                    Components ({(activeGroup.options || []).length})
                  </h4>
                  {(activeGroup.options || []).length === 0 ? (
                    <p className="text-[13px] text-[#94A3B8]">No components added to this group yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(activeGroup.options || []).map((opt, idx) => (
                        <div key={idx} className="p-3 rounded-xl border border-[#E2E8F0] bg-white flex items-center justify-between text-[13px]">
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-[#0F172A] block truncate">{opt.name}</span>
                            <span className="font-extrabold text-[#5B42F3]">₹{opt.price}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => {
                                setEditingGroup(activeGroup);
                                setGroupName(activeGroup.name);
                                setGroupRequired(activeGroup.required);
                                setGroupMax(String(activeGroup.maxSelections || 1));
                                setExtrasList((activeGroup.options || []).map((o) => ({ name: o?.name || "", price: String(o?.price ?? "0") })));
                                setAssignedDishIds(new Set(activeGroup.dishIds));
                                setExtraNameInput(opt.name);
                                setExtraPriceInput(String(opt.price));
                                setEditingCompIndex(idx);
                                setShowManageGroup(true);
                              }}
                              className="h-[28px] px-2 rounded-lg border border-[#E2E8F0] text-[11px] font-bold text-[#334155] hover:bg-[#EEF0FE]"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm(`Delete component "${opt.name}" from group?`)) {
                                  const updatedOpts = (activeGroup.options || []).filter((_, i) => i !== idx);
                                  saveGroupMut.mutate({
                                    groupName: activeGroup.name,
                                    required: activeGroup.required,
                                    maxSelections: activeGroup.maxSelections,
                                    options: updatedOpts,
                                    dishIds: Array.from(activeGroup.dishIds),
                                  });
                                }
                              }}
                              className="h-[28px] px-2 rounded-lg border border-[#FECACA] text-[11px] font-bold text-[#DC2626] hover:bg-[#FEF2F2]"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-4 border-t border-[#E2E8F0]">
                  <h4 className="text-[14px] font-extrabold text-[#0F172A]">
                    Attached Products ({activeGroup.dishIds?.size || 0})
                  </h4>
                  {currentItems.length === 0 ? (
                    <p className="text-[13px] text-[#94A3B8]">No products assigned to this group yet.</p>
                  ) : (
                    <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-2xl bg-white overflow-hidden">
                      {currentItems.map((item) => (
                        <div key={item._id} className="p-3.5 flex items-center justify-between text-[13px]">
                          <div className="flex items-center gap-3">
                            <IconDoc />
                            <div>
                              <p className="font-bold text-[#0F172A]">{item.name}</p>
                              <p className="text-[11px] text-[#64748B]">{item.category}</p>
                            </div>
                          </div>
                          <span className="font-bold text-[#0F172A]">₹{item.price}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Groups List (Level 0 Groups Redesign matching screenshot) */
              <div className="divide-y divide-[#E2E8F0]">
                {groupsList.length === 0 ? (
                  <div className="p-12 text-center text-[#94A3B8] space-y-3">
                    <p className="font-bold text-[15px] text-[#475569]">No Groups Found</p>
                    <button
                      onClick={() => {
                        setGroupName("");
                        setGroupRequired(false);
                        setGroupMax("1");
                        setExtrasList([{ name: "", price: "0" }]);
                        setAssignedDishIds(new Set());
                        setEditingGroup(null);
                        setShowManageGroup(true);
                      }}
                      className="h-[36px] px-4 rounded-xl bg-[#5B42F3] text-white text-[13px] font-bold hover:bg-[#4A32E0]"
                    >
                      + Add Group
                    </button>
                  </div>
                ) : (
                  groupsList.map((group, index) => {
                    const selected = selectedIds.has(group.name);
                    const isOpen = groupActiveStates[group.name] !== undefined ? groupActiveStates[group.name] : true;

                    return (
                      <div
                        key={group.name}
                        draggable
                        onDragStart={() => setDraggedGroupIndex(index)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedGroupIndex !== null && draggedGroupIndex !== index) {
                            const newList = [...groupsList];
                            const [moved] = newList.splice(draggedGroupIndex, 1);
                            newList.splice(index, 0, moved);
                            setDraggedGroupIndex(null);
                            reorderGroupsMut.mutate({ groupOrder: newList.map((g) => g.name) });
                          }
                        }}
                        className={`px-6 py-3.5 flex items-center justify-between gap-4 transition-colors ${
                          selected ? "bg-[#EEF0FE]/40" : "hover:bg-[#F8FAFC]"
                        }`}
                      >
                        {/* Left elements: ON/OFF toggle, Checkbox, Group Name */}
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          {/* ON/OFF Switch */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextState = !isOpen;
                              setGroupActiveStates((prev) => ({ ...prev, [group.name]: nextState }));
                              toggleGroupActiveMut.mutate({ groupName: group.name, isActive: nextState });
                            }}
                            className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                              isOpen ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                            }`}
                            title={isOpen ? "Group Active" : "Group Inactive"}
                          >
                            <span
                              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                                isOpen ? "right-0.5" : "left-0.5"
                              }`}
                            />
                          </button>

                          {/* Selection Checkbox */}
                          <input
                            type="checkbox"
                            checked={selected}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSelectItem(group.name)}
                            className="w-4 h-4 rounded border-[#CBD5E1] accent-[#5B42F3] shrink-0 cursor-pointer"
                          />

                          {/* Group Name (Clicking opens Group Contents) */}
                          <span
                            onClick={() => {
                              setActiveGroup(group);
                              setSelectedIds(new Set());
                            }}
                            className="font-medium text-[14.5px] text-[#1E293B] cursor-pointer hover:text-[#5B42F3] truncate"
                          >
                            {group.name}
                          </span>
                        </div>

                        {/* Right elements: Manage button & Drag handle */}
                        <div className="flex items-center gap-4 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingGroup(group);
                              setGroupName(group.name);
                              setGroupRequired(group.required);
                              setGroupMax(String(group.maxSelections || 1));
                              setExtrasList((group.options || []).map((o) => ({ name: o?.name || "", price: String(o?.price ?? "0") })));
                              setAssignedDishIds(new Set(group.dishIds));
                              setShowManageGroup(true);
                            }}
                            className="h-[34px] px-4 rounded-lg bg-[#0F172A] text-white text-[12.5px] font-bold hover:bg-[#1E293B]"
                          >
                            Manage
                          </button>

                          {/* Six-Dot Drag Handle ⠿ */}
                          <span
                            className="text-[#94A3B8] hover:text-[#0F172A] font-extrabold text-[16px] cursor-grab select-none tracking-tighter"
                            title="Drag to reorder"
                          >
                            ⠿
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )
          ) : !activeCategory ? (
            /* Main Categories List (Level 0 Products) */
            menus.map((menu) => {
              const selected = selectedIds.has(menu._id);
              const isPublished = menu.published !== false;

              return (
                <div
                  key={menu._id}
                  onClick={() => {
                    setActiveCategory(menu);
                    setActiveSubcategory(null);
                    setSelectedIds(new Set());
                  }}
                  className={`px-6 py-4 flex items-center justify-between gap-4 transition-colors cursor-pointer ${
                    selected ? "bg-[#EEF0FE]/40" : "hover:bg-[#F8FAFC]"
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    {/* Selection Checkbox */}
                    <input
                      type="checkbox"
                      checked={selected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelectItem(menu._id)}
                      className="w-4 h-4 rounded border-[#CBD5E1] accent-[#5B42F3] shrink-0"
                    />

                    {/* Status Toggle Switch */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
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

                    {/* Folder Icon */}
                    <IconFolder />

                    {/* Category Name */}
                    <span className="font-extrabold text-[15px] text-[#0F172A] truncate">
                      {menu.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCategory(menu);
                        setCatName(menu.name);
                        setCatDesc(menu.description || "");
                        setCatPublished(menu.published !== false);
                        const dt = menu.dispatchType || { collection: true, delivery: true, table: true };
                        setDispatchAll(Boolean(dt.collection && dt.delivery && dt.table));
                        setDispatchCol(Boolean(dt.collection));
                        setDispatchDel(Boolean(dt.delivery));
                        setDispatchTbl(Boolean(dt.table));
                        setBgColor(menu.bgColor || "#5b45b0");
                        setTextColor(menu.textColor || "#ffffff");
                        setShowCreateCategory(true);
                      }}
                      className="h-[34px] px-3.5 rounded-xl border border-[#CBD5E1] text-[#334155] text-[12px] font-bold hover:bg-[#EEF0FE]"
                    >
                      Manage
                    </button>

                    <IconDots />
                  </div>
                </div>
              );
            })
          ) : (
            /* Inside Category / Subcategory View (Module 2) */
            (() => {
              const allCategoryItems = activeCategory.items || [];

              // Helper to render product row
              const renderProductRow = (item) => {
                const selected = selectedIds.has(item._id);
                const isAvailable = item.isAvailable !== false;

                return (
                  <div
                    key={item._id}
                    onClick={() => setViewingProduct(item)}
                    className={`px-6 py-4 flex items-center justify-between gap-4 transition-colors cursor-pointer ${
                      selected ? "bg-[#EEF0FE]/40" : "hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={selected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelectItem(item._id)}
                        className="w-4 h-4 rounded border-[#CBD5E1] accent-[#5B42F3] shrink-0 cursor-pointer"
                      />

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleAvailabilityMut.mutate({ menuId: activeCategory._id, itemId: item._id });
                        }}
                        title={isAvailable ? "Display ON (Available)" : "Display OFF (Hidden)"}
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

                      {item.imageUrl || item.image ? (
                        <img src={item.imageUrl || item.image} alt={item.name} className="w-8 h-8 rounded-lg object-cover shrink-0 border" />
                      ) : (
                        <IconDoc />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-extrabold text-[15px] text-[#0F172A] truncate">{item.name}</p>
                          <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${
                            item.isVegetarian !== false
                              ? "bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]"
                              : "bg-[#FEE2E2] text-[#B91C1C] border-[#FCA5A5]"
                          }`}>
                            {item.isVegetarian !== false ? "🌱 Veg" : "🔴 Non-Veg"}
                          </span>
                        </div>
                        {item.subcategory && (
                          <p className="text-[11.5px] font-bold text-[#5B42F3] truncate mt-0.5">
                            {item.subcategory}
                          </p>
                        )}
                        {/* Display assigned groups / components summary badges directly on the product row */}
                        {Array.isArray(item.modifierGroups) && item.modifierGroups.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {item.modifierGroups.map((g) => (
                              <span
                                key={g.name}
                                className="px-2 py-0.5 rounded-md bg-[#EEF0FE] text-[#5B42F3] text-[10.5px] font-extrabold"
                              >
                                🧩 {g.name} ({(g.options || []).length})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <span className="font-extrabold text-[14px] text-[#0F172A]">₹{item.price}</span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          populateProductForm(item);
                        }}
                        className="h-[34px] px-3.5 rounded-xl border border-[#CBD5E1] text-[#334155] text-[12px] font-bold hover:bg-[#EEF0FE]"
                      >
                        Manage
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteDishMut.mutate({ menuId: activeCategory._id, itemId: item._id });
                        }}
                        className="h-[34px] px-3 rounded-xl border border-[#FECACA] text-[#DC2626] text-[12px] font-bold hover:bg-[#FEF2F2]"
                      >
                        Delete
                      </button>

                      <IconDots />
                    </div>
                  </div>
                );
              };

              // Case A: Inside Subcategory View (Level 2)
              if (activeSubcategory) {
                const subcategoryItems = allCategoryItems.filter((i) => i.subcategory === activeSubcategory);

                if (subcategoryItems.length === 0) {
                  return (
                    <div className="p-12 text-center text-[#94A3B8]">
                      <span className="text-3xl block mb-2">📦</span>
                      <p className="font-bold text-[14px] text-[#475569]">This subcategory is empty</p>
                      <p className="text-[12px] text-[#94A3B8] mt-1">
                        No products added to "{activeSubcategory}" yet.
                      </p>
                    </div>
                  );
                }

                return subcategoryItems.map(renderProductRow);
              }

              // Case B: Inside Category View (Level 1)
              const hasSubcategories = categorySubcategories.length > 0;
              const directProducts = allCategoryItems.filter(
                (i) => !i.subcategory || i.subcategory.trim() === ""
              );

              // Empty Category State: No subcategories and no products at all
              if (!hasSubcategories && allCategoryItems.length === 0) {
                return (
                  <div className="p-12 text-center text-[#94A3B8]">
                    <span className="text-3xl block mb-2">📁</span>
                    <p className="font-bold text-[14px] text-[#475569]">This category is empty</p>
                    <p className="text-[12px] text-[#94A3B8] mt-1">
                      No subcategories or products created in "{activeCategory.name}" yet.
                    </p>
                  </div>
                );
              }

              return (
                <div>
                  {/* Subcategories Section */}
                  {hasSubcategories && (
                    <div className="p-4 bg-[#F8FAFC] border-b border-[#E2E8F0]">
                      <h4 className="text-[11.5px] font-extrabold text-[#64748B] uppercase tracking-wider mb-2.5">
                        Subcategories ({categorySubcategories.length})
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {categorySubcategories.map((subcat) => {
                          const count = allCategoryItems.filter((i) => i.subcategory === subcat).length;
                          return (
                            <div
                              key={subcat}
                              onClick={() => {
                                setActiveSubcategory(subcat);
                                setSelectedIds(new Set());
                              }}
                              className="p-3 bg-white rounded-xl border border-[#E2E8F0] shadow-sm hover:border-[#5B42F3] hover:shadow-md cursor-pointer transition-all flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <IconFolder />
                                <div className="min-w-0 flex-1">
                                  <p className="font-extrabold text-[14px] text-[#0F172A] truncate">{subcat}</p>
                                  <p className="text-[11px] font-bold text-[#64748B]">{count} Product(s)</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const subcatObj = (activeCategory.subcategories || []).find(
                                      (s) => (typeof s === "string" ? s : s?.name) === subcat
                                    );
                                    setEditingSubcategory(subcatObj || { name: subcat });
                                    setCatName(subcat);
                                    setCatDesc(typeof subcatObj === "object" ? subcatObj?.description || "" : "");
                                    setCatPublished(typeof subcatObj === "object" ? subcatObj?.published !== false : true);
                                    const dt = typeof subcatObj === "object" && subcatObj?.dispatchType
                                      ? subcatObj.dispatchType
                                      : { collection: true, delivery: true, table: true };
                                    setDispatchAll(Boolean(dt.collection && dt.delivery && dt.table));
                                    setDispatchCol(Boolean(dt.collection));
                                    setDispatchDel(Boolean(dt.delivery));
                                    setDispatchTbl(Boolean(dt.table));
                                    setBgColor(typeof subcatObj === "object" ? subcatObj?.bgColor || "#0249fd" : "#0249fd");
                                    setTextColor(typeof subcatObj === "object" ? subcatObj?.textColor || "#ffffff" : "#ffffff");
                                    setShowCreateSubcategory(true);
                                  }}
                                  className="h-[28px] px-2.5 rounded-lg border border-[#CBD5E1] text-[11.5px] font-bold text-[#334155] hover:bg-[#EEF0FE] hover:border-[#5B42F3]"
                                >
                                  Manage
                                </button>
                                <IconChevronRight />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Direct Products Section (or all products if category has no subcategories) */}
                  {hasSubcategories ? (
                    directProducts.length > 0 ? (
                      <div>
                        <div className="px-6 py-2.5 bg-white border-b border-[#E2E8F0]">
                          <h4 className="text-[11.5px] font-extrabold text-[#64748B] uppercase tracking-wider">
                            Direct Products ({directProducts.length})
                          </h4>
                        </div>
                        {directProducts.map(renderProductRow)}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-[#94A3B8]">
                        <p className="text-[13px] font-semibold text-[#64748B]">No direct products in this category.</p>
                        <p className="text-[11.5px] text-[#94A3B8] mt-0.5">Click a subcategory above to view its products.</p>
                      </div>
                    )
                  ) : (
                    allCategoryItems.map(renderProductRow)
                  )}
                </div>
              );
            })()
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
              <p>If you want to add a series of extra options to this group, click on Add New Extra and enter the details.</p>
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


      {/* Drawers: Create / Manage Category / Subcategory Slide-Over Drawer */}
      {(showCreateCategory || showCreateSubcategory) && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
          <div className="w-full max-w-[420px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
              <h3 className="text-[18px] font-extrabold">
                {editingCategory
                  ? "Manage Category"
                  : editingSubcategory
                  ? "Manage Subcategory"
                  : showCreateSubcategory
                  ? "Create Subcategory"
                  : "Create Category"}
              </h3>
              <button
                onClick={() => {
                  setShowCreateCategory(false);
                  setShowCreateSubcategory(false);
                  resetCategoryForm();
                }}
                className="text-[#94A3B8] hover:text-[#0F172A]"
              >
                <IconX />
              </button>
            </div>

            <div className="space-y-4 flex-1 text-[13px]">
              <div>
                <label className="text-[12px] font-extrabold text-[#334155]">
                  {showCreateSubcategory ? "Subcategory Name" : "Category Name"}
                </label>
                <input
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder={showCreateSubcategory ? "e.g. Chicken Burgers" : "e.g. Burgers"}
                  className="w-full h-[40px] px-3 mt-1 rounded-xl border border-[#E2E8F0] font-bold text-[13.5px]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-extrabold text-[#334155]">Description</label>
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

              {/* Display ON/OFF Toggle (Module 3) */}
              <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                <div>
                  <span className="font-extrabold text-[13px] text-[#0F172A] block">Display Status</span>
                  <span className="text-[11px] text-[#64748B]">
                    {catPublished ? "Display ON — Visible on POS & Website" : "Display OFF — Hidden from POS & Website"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setCatPublished((prev) => !prev)}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                    catPublished ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      catPublished ? "right-1" : "left-1"
                    }`}
                  />
                </button>
              </div>

              {/* Dispatch Type (Collection, Delivery, Table) */}
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
                disabled={
                  addCategoryMut.isPending ||
                  updateCategoryMut.isPending ||
                  addSubcatMut.isPending ||
                  updateSubcatMut.isPending
                }
                className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
              >
                {addCategoryMut.isPending ||
                updateCategoryMut.isPending ||
                addSubcatMut.isPending ||
                updateSubcatMut.isPending
                  ? "Saving…"
                  : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer: Manage / Create Group Drawer */}
      {showManageGroup && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
          <div className="w-full max-w-[440px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
              <h3 className="text-[18px] font-extrabold">
                {editingGroup ? `Manage Group: ${editingGroup.name}` : "Create Group"}
              </h3>
              <button
                onClick={() => {
                  setShowManageGroup(false);
                  setEditingGroup(null);
                  setEditingCompIndex(null);
                }}
                className="text-[#94A3B8] hover:text-[#0F172A]"
              >
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

              {/* Add Components Section (Module 6: Groups -> Components) */}
              <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-3">
                <h4 className="font-extrabold text-[13.5px] text-[#0F172A]">Components</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-bold text-[#64748B] block mb-1">Component Name *</label>
                    <input
                      value={extraNameInput}
                      onChange={(e) => setExtraNameInput(e.target.value)}
                      placeholder="e.g. Meat"
                      className="w-full h-[36px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[12.5px]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-[#64748B] block mb-1">Price ₹ *</label>
                    <input
                      type="number"
                      min={0}
                      value={extraPriceInput}
                      onChange={(e) => setExtraPriceInput(e.target.value)}
                      placeholder="e.g. 100"
                      className="w-full h-[36px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[12.5px]"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!extraNameInput || !extraNameInput.trim()) {
                      enqueueSnackbar("Component Name is required.", { variant: "warning" });
                      return;
                    }
                    const numPrice = Number(extraPriceInput);
                    if (!Number.isFinite(numPrice) || numPrice < 0) {
                      enqueueSnackbar("Component Price must be a valid non-negative number.", { variant: "warning" });
                      return;
                    }
                    if (editingCompIndex !== null) {
                      const copy = [...extrasList];
                      copy[editingCompIndex] = { name: extraNameInput.trim(), price: String(numPrice) };
                      setExtrasList(copy);
                      setEditingCompIndex(null);
                      enqueueSnackbar("Component updated!", { variant: "success" });
                    } else {
                      setExtrasList([...extrasList, { name: extraNameInput.trim(), price: String(numPrice) }]);
                    }
                    setExtraNameInput("");
                    setExtraPriceInput("50");
                  }}
                  className="w-full h-[36px] rounded-xl bg-[#5B42F3] text-white text-[12.5px] font-bold hover:bg-[#4A32E0]"
                >
                  {editingCompIndex !== null ? "Update Component" : "+ Add Component"}
                </button>

                {extrasList.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-[#E2E8F0]">
                    {extrasList.map((extra, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-white border border-[#E2E8F0] text-[12.5px]">
                        <span className="font-bold text-[#0F172A]">{extra.name} — ₹{extra.price}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setExtraNameInput(extra.name);
                              setExtraPriceInput(String(extra.price));
                              setEditingCompIndex(idx);
                            }}
                            className="text-[#5B42F3] font-bold hover:underline text-[11.5px]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Delete component "${extra.name}"?`)) {
                                setExtrasList(extrasList.filter((_, i) => i !== idx));
                                if (editingCompIndex === idx) {
                                  setEditingCompIndex(null);
                                  setExtraNameInput("");
                                }
                              }
                            }}
                            className="text-[#DC2626] font-bold hover:underline text-[11.5px]"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Product Association */}
              <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
                <h4 className="font-extrabold text-[13px] text-[#0F172A]">Assign to Products</h4>
                <div className="max-h-[160px] overflow-y-auto space-y-1.5 p-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                  {(Array.isArray(menus) ? menus : [])
                    .flatMap((m) => (Array.isArray(m?.items) ? m.items : []))
                    .map((item) => {
                      if (!item || !item._id) return null;
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

            <div className="pt-4 border-t border-[#E2E8F0] space-y-2">
              <button
                onClick={() => {
                  if (!groupName || !groupName.trim()) {
                    enqueueSnackbar("Group Name is required.", { variant: "warning" });
                    return;
                  }
                  for (const comp of extrasList) {
                    if (!comp.name || !comp.name.trim()) {
                      enqueueSnackbar("All components must have a valid name.", { variant: "warning" });
                      return;
                    }
                    const p = Number(comp.price);
                    if (!Number.isFinite(p) || p < 0) {
                      enqueueSnackbar(`Price for component "${comp.name}" must be numeric and cannot be negative.`, { variant: "warning" });
                      return;
                    }
                  }
                  // Explicit product assignment is required (§Groups).
                  // Previously an empty selection defaulted to "attach to
                  // every product" — which the operator almost never wants.
                  // Force them to opt-in to at least one product first.
                  if (!assignedDishIds || assignedDishIds.size === 0) {
                    enqueueSnackbar(
                      'Select at least one product under "Assign to Products" before saving the group.',
                      { variant: "warning" },
                    );
                    return;
                  }
                  saveGroupMut.mutate({
                    groupName: groupName.trim(),
                    oldGroupName: editingGroup ? editingGroup.name : undefined,
                    required: groupRequired,
                    maxSelections: Number(groupMax) || 1,
                    options: extrasList.map((e) => ({ name: e.name.trim(), price: Number(e.price) || 0 })),
                    dishIds: Array.from(assignedDishIds),
                  });
                }}
                disabled={saveGroupMut.isPending}
                className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
              >
                {saveGroupMut.isPending ? "Saving Group…" : "Save Changes"}
              </button>

              {editingGroup && (
                <button
                  type="button"
                  onClick={() => handleDeleteGroup(editingGroup)}
                  disabled={deleteGroupMut.isPending}
                  className="w-full h-[40px] rounded-xl border border-[#FECACA] text-[#DC2626] text-[13px] font-extrabold hover:bg-[#FEF2F2] disabled:opacity-50"
                >
                  {deleteGroupMut.isPending ? "Deleting…" : "Delete Group"}
                </button>
              )}
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

      {/* View Product Details Modal (Module 4) */}
      {viewingProduct && (
        <div className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-[480px] bg-white rounded-2xl p-6 shadow-2xl space-y-4 text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-[18px] font-extrabold">{viewingProduct.name}</h3>
                <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded border ${
                  viewingProduct.isVegetarian !== false
                    ? "bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]"
                    : "bg-[#FEE2E2] text-[#B91C1C] border-[#FCA5A5]"
                }`}>
                  {viewingProduct.isVegetarian !== false ? "🌱 Veg" : "🔴 Non-Veg"}
                </span>
              </div>
              <button onClick={() => setViewingProduct(null)} className="text-[#94A3B8] hover:text-[#0F172A]">
                <IconX />
              </button>
            </div>

            {viewingProduct.imageUrl || viewingProduct.image ? (
              <img src={viewingProduct.imageUrl || viewingProduct.image} alt={viewingProduct.name} className="w-full h-44 object-cover rounded-xl border" />
            ) : null}

            <div className="space-y-3 text-[13px]">
              {viewingProduct.description && (
                <p className="text-[#475569] font-medium leading-relaxed">{viewingProduct.description}</p>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E2E8F0]">
                <div className="p-3 rounded-xl bg-[#F8FAFC] border">
                  <span className="text-[#64748B] text-[11px] font-bold">Standard Price</span>
                  <p className="text-lg font-extrabold text-[#5B42F3]">₹{viewingProduct.price}</p>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAFC] border">
                  <span className="text-[#64748B] text-[11px] font-bold">Display Status</span>
                  <p className="text-[13px] font-extrabold">
                    {viewingProduct.isAvailable !== false ? "🟢 Display ON" : "🔴 Display OFF"}
                  </p>
                </div>
              </div>

              {/* Assigned Groups & Components details */}
              {Array.isArray(viewingProduct.modifierGroups) && viewingProduct.modifierGroups.length > 0 ? (
                <div className="p-3 rounded-xl bg-[#F8FAFC] border space-y-2 text-[12px]">
                  <p className="font-extrabold text-[#0F172A]">Assigned Groups & Components ({viewingProduct.modifierGroups.length})</p>
                  <div className="space-y-1.5">
                    {viewingProduct.modifierGroups.map((g) => (
                      <div key={g.name} className="p-2.5 rounded-lg bg-white border border-[#E2E8F0]">
                        <div className="flex items-center justify-between font-extrabold text-[#0F172A]">
                          <span>🧩 {g.name}</span>
                          <span className="text-[10.5px] font-bold text-[#5B42F3] bg-[#EEF0FE] px-2 py-0.5 rounded-md">
                            {g.required ? "Required" : "Optional"} · max {g.maxSelections || 1}
                          </span>
                        </div>
                        {Array.isArray(g.options) && g.options.length > 0 && (
                          <p className="text-[11.5px] font-semibold text-[#475569] mt-1">
                            {g.options.map((o) => `${o.name} (₹${o.price})`).join(", ")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-[#F8FAFC] border text-[12px] text-[#94A3B8]">
                  No groups or components assigned to this product yet.
                </div>
              )}

              {viewingProduct.samePrice === false && viewingProduct.channelPrices && (
                <div className="p-3 rounded-xl bg-[#F8FAFC] border space-y-1.5 text-[11.5px]">
                  <p className="font-extrabold text-[#0F172A] mb-1">Channel Prices</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span>POS Collection: <b>₹{viewingProduct.channelPrices.posCollection}</b></span>
                    <span>POS Delivery: <b>₹{viewingProduct.channelPrices.posDelivery}</b></span>
                    <span>POS Table: <b>₹{viewingProduct.channelPrices.posTable}</b></span>
                    <span>Web Collection: <b>₹{viewingProduct.channelPrices.websiteCollection}</b></span>
                    <span>Web Delivery: <b>₹{viewingProduct.channelPrices.websiteDelivery}</b></span>
                    <span>Web Table: <b>₹{viewingProduct.channelPrices.websiteTable}</b></span>
                  </div>
                </div>
              )}

              {viewingProduct.schedule?.enabled && (
                <div className="p-3 rounded-xl bg-[#F8FAFC] border text-[12px] space-y-1">
                  <p className="font-extrabold text-[#0F172A]">Product Time Schedule</p>
                  <p className="font-bold text-[#5B42F3]">
                    {viewingProduct.schedule.startTime || "09:00"} – {viewingProduct.schedule.endTime || "23:00"}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-3 border-t border-[#E2E8F0]">
              <button
                onClick={() => setViewingProduct(null)}
                className="flex-1 h-[42px] rounded-xl border border-[#CBD5E1] font-bold text-[#475569] hover:bg-[#F8FAFC]"
              >
                Close
              </button>
              <button
                onClick={() => {
                  const item = viewingProduct;
                  setViewingProduct(null);
                  populateProductForm(item);
                }}
                className="flex-1 h-[42px] rounded-xl bg-[#5B42F3] text-white font-bold shadow-md hover:bg-[#4A32E0]"
              >
                Edit Product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer: Create / Edit Product Slide-Over Drawer */}
      {showCreateProduct && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex justify-end">
          <div className="w-full max-w-[420px] bg-white h-full shadow-2xl flex flex-col p-6 overflow-y-auto text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-4 mb-4">
              <h3 className="text-[18px] font-extrabold">
                {editingProduct ? "Edit Product" : "Create Product"}
              </h3>
              <button
                onClick={() => {
                  setShowCreateProduct(false);
                  resetProductForm();
                }}
                className="text-[#94A3B8] hover:text-[#0F172A]"
              >
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

              {/* Product Image Click-to-Upload / Replace / Remove */}
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

              {/* Veg / Non-Veg & Display Target & Availability Status */}
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

              {/* Display ON/OFF availability toggle switch */}
              <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]">
                <div>
                  <span className="font-extrabold text-[13px] text-[#0F172A] block">Display Status</span>
                  <span className="text-[11px] text-[#64748B]">
                    {prodAvailable ? "Display ON — Available for ordering" : "Display OFF — Hidden / Out of stock"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setProdAvailable((prev) => !prev)}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                    prodAvailable ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      prodAvailable ? "right-1" : "left-1"
                    }`}
                  />
                </button>
              </div>

              {/* Assign Groups (Module 8) */}
              <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
                <label className="text-[12px] font-extrabold text-[#334155]">Assign Groups / Components</label>
                {groupsList.length === 0 ? (
                  <p className="text-[11.5px] text-[#94A3B8]">No groups created yet.</p>
                ) : (
                  <div className="max-h-[140px] overflow-y-auto space-y-1.5 p-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                    {groupsList.map((g) => {
                      const checked = prodAssignedGroupNames.has(g.name);
                      return (
                        <label key={g.name} className="flex items-center justify-between p-1.5 hover:bg-white rounded-lg cursor-pointer text-[12px] font-bold text-[#334155]">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = new Set(prodAssignedGroupNames);
                                if (next.has(g.name)) next.delete(g.name);
                                else next.add(g.name);
                                setProdAssignedGroupNames(next);
                              }}
                              className="w-4 h-4 accent-[#5B42F3]"
                            />
                            <span>{g.name}</span>
                          </div>
                          <span className="text-[10.5px] font-semibold text-[#64748B]">{(g.options || []).length} Components</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Product Time & Availability Schedule (Module 4) */}
              <div className="pt-2 border-t border-[#E2E8F0] space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-extrabold text-[13px] text-[#0F172A] block">Product Time & Schedule</span>
                    <span className="text-[11px] text-[#64748B]">Set time-based availability</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={prodScheduleEnabled}
                    onChange={(e) => setProdScheduleEnabled(e.target.checked)}
                    className="w-5 h-5 accent-[#22C55E]"
                  />
                </div>

                {prodScheduleEnabled && (
                  <div className="space-y-3 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[12px]">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="font-bold text-[#64748B]">Available From</label>
                        <input
                          type="time"
                          value={prodStartTime}
                          onChange={(e) => setProdStartTime(e.target.value)}
                          className="w-full h-[34px] px-2 mt-0.5 rounded-lg border border-[#CBD5E1] font-bold text-[12px]"
                        />
                      </div>
                      <div>
                        <label className="font-bold text-[#64748B]">Available Until</label>
                        <input
                          type="time"
                          value={prodEndTime}
                          onChange={(e) => setProdEndTime(e.target.value)}
                          className="w-full h-[34px] px-2 mt-0.5 rounded-lg border border-[#CBD5E1] font-bold text-[12px]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-bold text-[#64748B] block mb-1">Active Days</label>
                      <div className="flex gap-1">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((dayName, idx) => {
                          const active = prodDaysOfWeek.includes(idx);
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                if (active) setProdDaysOfWeek(prodDaysOfWeek.filter((d) => d !== idx));
                                else setProdDaysOfWeek([...prodDaysOfWeek, idx].sort());
                              }}
                              className={`flex-1 h-[28px] rounded text-[10.5px] font-extrabold border ${
                                active ? "bg-[#5B42F3] text-white border-[#5B42F3]" : "bg-white text-[#64748B] border-[#CBD5E1]"
                              }`}
                            >
                              {dayName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
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
                disabled={addDishMut.isPending || updateDishMut.isPending}
                className="w-full h-[46px] rounded-xl bg-[#0F172A] text-white text-[14px] font-extrabold shadow-lg hover:bg-[#1E293B] disabled:opacity-50"
              >
                {addDishMut.isPending || updateDishMut.isPending ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Bulk Group Picker — appears after choosing "+ Add Group
          to Selected" or "− Remove Group from Selected" from the
          selection Manage menu. Lists every existing group so the
          operator can simply tick which ones to apply to the current
          product selection instead of typing group names. */}
      {bulkGroupPickerMode && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-[460px] max-h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] px-5 py-4">
              <div>
                <h3 className="text-[16px] font-extrabold">
                  {bulkGroupPickerMode === "remove"
                    ? "Remove Groups from Selected Products"
                    : "Add Groups to Selected Products"}
                </h3>
                <p className="text-[11.5px] text-[#94A3B8] mt-0.5">
                  {bulkGroupPickerMode === "remove"
                    ? `Pick which groups to detach from ${selectedIds.size} selected product${selectedIds.size === 1 ? "" : "s"}.`
                    : `Pick which groups to attach to ${selectedIds.size} selected product${selectedIds.size === 1 ? "" : "s"}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBulkGroupPickerMode(null);
                  setBulkPickedGroups(new Set());
                }}
                className="text-[#94A3B8] hover:text-[#0F172A] text-2xl leading-none"
                aria-label="Close bulk group picker"
              >
                ×
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {groupsList.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[#94A3B8] space-y-2">
                  <p className="font-bold text-[#475569]">No groups exist yet.</p>
                  <p>Create a group first from the Groups tab, then come back to bulk-assign it.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[12px] font-bold text-[#64748B] pb-2 border-b border-[#E2E8F0] mb-2">
                    <span>{bulkPickedGroups.size} of {groupsList.length} selected</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setBulkPickedGroups(new Set(groupsList.map((g) => g.name)))
                        }
                        className="text-[#5B42F3] hover:underline"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkPickedGroups(new Set())}
                        className="text-[#94A3B8] hover:text-[#DC2626]"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {groupsList.map((g) => {
                      const checked = bulkPickedGroups.has(g.name);
                      return (
                        <label
                          key={g.name}
                          className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer text-[13px] font-bold transition-colors ${
                            checked
                              ? "border-[#5B42F3] bg-[#EEF0FE]/40"
                              : "border-[#E2E8F0] hover:bg-[#F8FAFC]"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = new Set(bulkPickedGroups);
                                if (next.has(g.name)) next.delete(g.name);
                                else next.add(g.name);
                                setBulkPickedGroups(next);
                              }}
                              className="w-4 h-4 accent-[#5B42F3] shrink-0"
                            />
                            <span className="truncate text-[#0F172A]">{g.name}</span>
                          </div>
                          <span className="text-[10.5px] font-semibold text-[#64748B] shrink-0 ml-2">
                            {(g.options || []).length} component{(g.options || []).length === 1 ? "" : "s"}
                            {g.dishIds?.size ? ` · on ${g.dishIds.size} product${g.dishIds.size === 1 ? "" : "s"}` : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-[#E2E8F0] px-5 py-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setBulkGroupPickerMode(null);
                  setBulkPickedGroups(new Set());
                }}
                className="h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#475569] text-[13px] font-bold hover:bg-[#F8FAFC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyBulkGroupPicker}
                disabled={
                  bulkPickedGroups.size === 0 ||
                  bulkAddGroupMut.isPending ||
                  bulkRemoveGroupMut.isPending
                }
                className={`h-[40px] px-5 rounded-xl text-white text-[13px] font-extrabold shadow-md disabled:opacity-50 ${
                  bulkGroupPickerMode === "remove"
                    ? "bg-[#DC2626] hover:bg-[#B91C1C]"
                    : "bg-[#5B42F3] hover:bg-[#4A32E0]"
                }`}
              >
                {bulkAddGroupMut.isPending || bulkRemoveGroupMut.isPending
                  ? "Applying…"
                  : bulkGroupPickerMode === "remove"
                  ? `Remove ${bulkPickedGroups.size || ""} Group${bulkPickedGroups.size === 1 ? "" : "s"}`
                  : `Add ${bulkPickedGroups.size || ""} Group${bulkPickedGroups.size === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageMenu;
