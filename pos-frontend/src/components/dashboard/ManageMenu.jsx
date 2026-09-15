import React, { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import { selectionTypeOf } from "../../utils/modifierGroups";
import { readStoreScoped, writeStoreScoped } from "../../utils/storeSession";
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
  deleteDishes,
  // downloadMenuCsvTemplate — removed from the toolbar per operator
  // feedback; still exported from https/ for anyone who needs to hit the
  // endpoint programmatically.
  exportMenuCsv,
  getMenus,
  importMenuCsv,
  previewMenuCsv,
  saveGroupToDishes,
  deleteGroupFromDishes,
  renameGroupInDishes,
  toggleGroupActive,
  reorderGroups,
  reorderDishes,
  reorderMenus,
  unpublishMenu,
  publishMenu,
  publishSystemCache,
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

/**
 * What to print on a product row in Manage Menu.
 *
 * With "Same price for all channels" ON this is simply the price. With it OFF
 * the product has six channel figures and `price` is just the base the form
 * started from — so the row kept showing a number the operator had already
 * changed. Summarise the channel prices instead: one figure if they agree, a
 * range if they do not.
 */
const displayPrice = (item) => {
  const base = Number(item?.price) || 0;
  if (!item || item.samePrice !== false || !item.channelPrices) return `₹${base}`;

  const values = [
    "posCollection", "posDelivery", "posTable",
    "websiteCollection", "websiteDelivery", "websiteTable",
  ]
    .map((k) => Number(item.channelPrices[k]))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!values.length) return `₹${base}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `₹${min}` : `₹${min} – ₹${max}`;
};

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

  // Drag-and-drop state for the Products tab.
  //   `draggedCategoryIndex` — index of the top-level category row being
  //     dragged in the "All Categories" list.
  //   `draggedProductIndex` — index of the product row being dragged
  //     inside the currently-active category.
  // Both are cleared on drop / drag-end so an aborted drag doesn't leave
  // a phantom reference around.
  const [draggedCategoryIndex, setDraggedCategoryIndex] = useState(null);
  const [draggedProductIndex, setDraggedProductIndex] = useState(null);

  // Optimistic local ordering — set immediately on drop so the row moves
  // BEFORE the network round-trip completes. When the invalidated
  // "menus" query returns fresh data these overrides are cleared so the
  // server order becomes the source of truth again.
  const [categoryOrderOverride, setCategoryOrderOverride] = useState(null);
  const [productOrderOverride, setProductOrderOverride] = useState(null);

  // Generic confirm modal — replaces the old raw `deleteDishMut.mutate`
  // fire-and-forget so every destructive action asks the operator to
  // confirm first. `payload` carries whatever the confirm callback needs
  // (product id, category id, etc.) so the modal itself stays generic.
  const [confirmState, setConfirmState] = useState(null);
  const askConfirm = ({ title, message, confirmLabel = "Delete", tone = "danger", onConfirm }) => {
    setConfirmState({ title, message, confirmLabel, tone, onConfirm });
  };
  const closeConfirm = () => setConfirmState(null);

  // Group Management Form states (Module 4 & 7)
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingCompIndex, setEditingCompIndex] = useState(null);
  const [groupName, setGroupName] = useState("");
  const [groupRequired, setGroupRequired] = useState(false);
  const [groupMax, setGroupMax] = useState("1");
  // OFF by default: the customer may pick as many options as they like. ON
  // caps them at groupMax. Previously a "multiple" group always carried a
  // number, so there was no way to express "no limit".
  const [groupMaxEnabled, setGroupMaxEnabled] = useState(false);
  // Starts EMPTY. A group used to open with a placeholder component already
  // in the list, which then had to be noticed and deleted.
  const [extrasList, setExtrasList] = useState([]);
  const [extraNameInput, setExtraNameInput] = useState("");
  const [extraPriceInput, setExtraPriceInput] = useState("0");
  const [assignedDishIds, setAssignedDishIds] = useState(new Set());

  // Form states for Category/Subcategory
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingSubcategory, setEditingSubcategory] = useState(null);
  const [catPublished, setCatPublished] = useState(true);
  // Only meaningful while Display Status is OFF — they let a hidden category
  // still appear on one surface.
  const [catShowOnPos, setCatShowOnPos] = useState(false);
  const [catShowOnWebsite, setCatShowOnWebsite] = useState(false);
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
  // Only meaningful while Display Status is OFF — they keep the product live
  // on exactly one surface instead of removing it from both.
  const [prodOffOnPos, setProdOffOnPos] = useState(false);
  const [prodOffOnWebsite, setProdOffOnWebsite] = useState(false);
  const [prodImageUrl, setProdImageUrl] = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);
  // Names of modifier groups assigned to the product being created/edited (Module 4) - array preserves selection order
  const [prodAssignedGroupNames, setProdAssignedGroupNames] = useState([]);
  const [selectionType, setSelectionType] = useState("single"); // "single" | "multiple"

  const { data: menusRes, isLoading } = useQuery({ queryKey: ["menus"], queryFn: getMenus });
  const menus = menusRes?.data?.data || [];

  // Persisted registry of created groups so newly-created groups show up
  // in the "Assign Groups / Components" list immediately, even before they
  // are attached to any product.
  // Scoped to the ACTIVE STORE. Under a bare key the browser handed the same
  // groups to every store, so a newly created takeaway opened with the
  // previous one's groups already listed and editing them changed both.
  const [customCreatedGroups, setCustomCreatedGroups] = useState(() => {
    const parsed = readStoreScoped("kk_custom_groups", {});
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  });

  useEffect(() => {
    writeStoreScoped("kk_custom_groups", customCreatedGroups);
  }, [customCreatedGroups]);

  /*
   * Real-time reflection guard.
   *
   * The Manage Menu drills into a `menus[i]` snapshot (`activeCategory`)
   * when the operator opens a category. That snapshot is captured at click
   * time — subsequent invalidations of the "menus" query refresh the top
   * level list but the drilled-in category still points at the STALE
   * items array from the moment it was opened. That's why deleting /
   * hiding / caching a product used to look like nothing happened until
   * the page was refreshed.
   *
   * This effect re-syncs the drilled-in references from the freshly
   * fetched `menus` list on every render. Group view (`activeGroup`) is
   * derived from `allGroupsMap` so it re-syncs automatically via its own
   * useMemo dependency, but the category / subcategory drill needs to be
   * done here explicitly.
   */
  useEffect(() => {
    if (!activeCategory) return;

    // Defensive: while the menus query is still loading (or is between
    // refetches and hasn't returned data yet), an empty `menus` array
    // must NOT be interpreted as "the category was deleted". Otherwise
    // any open drawer / drill-in view gets torn down on every refetch.
    if (isLoading) return;
    if (!Array.isArray(menus) || menus.length === 0) return;

    const fresh = menus.find(
      (m) => String(m?._id) === String(activeCategory._id),
    );
    if (!fresh) {
      // Category was deleted (or the user's tenant scope changed) — pop
      // the drill so we don't render stale rows.
      setActiveCategory(null);
      setActiveSubcategory(null);
      return;
    }
    // Only replace when the reference actually changed to avoid a render
    // loop (menus is refetched every focus / mutation).
    if (fresh !== activeCategory) {
      setActiveCategory(fresh);
    }
    // If the currently drilled-in product view referenced a product that
    // no longer exists (e.g. it was just deleted), close the modal too.
    if (viewingProduct && !(fresh.items || []).some((i) => String(i._id) === String(viewingProduct._id))) {
      setViewingProduct(null);
    }
  }, [menus, activeCategory, viewingProduct, isLoading]);

  // Note: the optimistic `categoryOrderOverride` / `productOrderOverride`
  // are cleared inside the reorderMenusMut / reorderDishesMut success
  // handlers (and on error). We deliberately do NOT clear them on every
  // `menus` change because the useQuery hook returns a new reference on
  // every render (menusRes?.data?.data || []), which would cause the
  // overrides to be cleared before the drop was even acknowledged.

  // Extract all groups across all dishes + registered custom groups (Module 4 §4)
  const allGroupsMap = useMemo(() => {
    const map = new Map();

    // 1. Seed with custom created groups so unattached groups are visible
    Object.values(customCreatedGroups).forEach((g) => {
      if (!g || !g.name) return;
      map.set(g.name, {
        name: g.name,
        required: Boolean(g.required),
        maxSelectionEnabled: g.maxSelectionEnabled === true,
        maxSelections: g.maxSelections || 1,
        isActive: g.isActive !== false,
        sortOrder: Number(g.sortOrder) || 0,
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
              maxSelectionEnabled: group.maxSelectionEnabled === true,
              maxSelections: group.maxSelections || 1,
              // Read from the stored group. These used to live only in React
              // state, so switching a group off survived until the next
              // refetch — including the one after publishing a cache — and it
              // silently came back on.
              isActive: group.isActive !== false,
              sortOrder: Number(group.sortOrder) || 0,
              options: options,
              dishIds: new Set([String(item._id)]),
            });
          } else {
            const entry = map.get(group.name);
            entry.dishIds.add(String(item._id));
            if (options.length) entry.options = options;
            entry.required = Boolean(group.required);
            entry.maxSelectionEnabled = group.maxSelectionEnabled === true;
            entry.maxSelections = group.maxSelections || entry.maxSelections;
            // Off anywhere means off — a group is one thing to the operator.
            if (group.isActive === false) entry.isActive = false;
            if (Number(group.sortOrder)) entry.sortOrder = Number(group.sortOrder);
          }
        });
      });
    });
    return map;
  }, [menus, customCreatedGroups]);

  // Ordered by the persisted sortOrder the reorder endpoint writes. The list
  // used to come out in Map-insertion order, so a reorder reported success and
  // the UI rebuilt itself in the old sequence.
  const groupsList = Array.from(allGroupsMap.values()).sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name),
  );

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
      // Bulk sends groupNames, the single Delete button sends groupName.
      // Missing the array form here left deleted groups showing in the list
      // until the next refetch.
      const removed = Array.isArray(variables?.groupNames)
        ? variables.groupNames
        : [variables?.groupName].filter(Boolean);
      if (removed.length > 0) {
        setCustomCreatedGroups((prev) => {
          const next = { ...prev };
          removed.forEach((name) => delete next[name]);
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
    onSuccess: (res, variables) => {
      enqueueSnackbar(res?.data?.message || "Group status updated!", { variant: "success" });
      // Drop the optimistic local override so the refetched value — which is
      // now genuinely persisted — becomes the single source of truth.
      if (variables?.groupName) {
        setGroupActiveStates((prev) => {
          const next = { ...prev };
          delete next[variables.groupName];
          return next;
        });
      }
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
      : `Delete Group "${targetGroup.name}"? This action cannot be undone.`;

    askConfirm({
      title: attachedCount > 0
        ? `Delete group and detach from ${attachedCount} product${attachedCount === 1 ? "" : "s"}?`
        : "Delete group?",
      message: msg,
      confirmLabel: "Delete Group",
      tone: "danger",
      onConfirm: () => {
        if (attachedCount === 0) {
          // Standalone group — it only lives in the local custom registry,
          // so there's nothing to hit on the server. Remove it locally.
          setCustomCreatedGroups((prev) => {
            const next = { ...prev };
            delete next[targetGroup.name];
            return next;
          });
          enqueueSnackbar(`Group "${targetGroup.name}" deleted.`, { variant: "success" });
          setShowManageGroup(false);
          setActiveGroup(null);
          setEditingGroup(null);
          return;
        }
        deleteGroupMut.mutate({ groupName: targetGroup.name });
      },
    });
  };


  // Only invalidate the draft menu query for Manage Menu UI.
  // POS (system) and Website cache are NOT automatically updated when editing products;
  // they update only when the user manually clicks "Publish POS" or "Publish Web".
  //
  // We use `refetchQueries` (not just `invalidateQueries`) so the fresh data
  // arrives BEFORE the operator's next click — the previous invalidate-only
  // path relied on staleTime + focus refetch and could leave the list
  // showing a just-deleted / just-hidden product until the next reload.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["menus"], exact: true });
    qc.invalidateQueries({ queryKey: ["popular-items"] });
    // Kick a background refetch immediately so the drawer / list re-renders
    // with the new data as soon as the mutation resolves.
    qc.refetchQueries({ queryKey: ["menus"], exact: true });
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
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to delete category", { variant: "error" }),
  });

  const bulkDeleteDishesMut = useMutation({
    mutationFn: deleteDishes,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Products deleted!", { variant: "success" });
      invalidate();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to delete products", { variant: "error" }),
  });

  const deleteDishMut = useMutation({
    mutationFn: deleteDish,
    onSuccess: () => {
      enqueueSnackbar("Product deleted!", { variant: "success" });
      invalidate();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to delete product", { variant: "error" }),
  });

  const toggleAvailabilityMut = useMutation({
    mutationFn: updateDishStatus,
    onSuccess: (res) => {
      // Surface the visibility change immediately so the operator sees the
      // switch update AND the toast — otherwise a silent success looked
      // identical to a no-op until the page was refreshed.
      const msg = res?.data?.message || "Product visibility updated";
      enqueueSnackbar(msg, { variant: "success" });
      invalidate();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update product visibility", { variant: "error" }),
  });

  // Drag-and-drop reorder mutations. These fire the network request in
  // the background; the on-screen order is already updated via the
  // local `*OrderOverride` state so the operator sees the new order
  // instantly. On success we refetch to lock the server order back in.
  const reorderMenusMut = useMutation({
    mutationFn: reorderMenus,
    onSuccess: () => {
      setCategoryOrderOverride(null);
      invalidate();
    },
    onError: (e) => {
      setCategoryOrderOverride(null);
      enqueueSnackbar(e.response?.data?.message || "Failed to reorder categories", { variant: "error" });
      invalidate();
    },
  });
  const reorderDishesMut = useMutation({
    mutationFn: reorderDishes,
    onSuccess: () => {
      setProductOrderOverride(null);
      invalidate();
    },
    onError: (e) => {
      setProductOrderOverride(null);
      enqueueSnackbar(e.response?.data?.message || "Failed to reorder products", { variant: "error" });
      invalidate();
    },
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
        // §Bulk-Add: previously we only sent { groupName, dishIds } which
        // meant a group added from the bulk picker landed on the product
        // with an empty `options` array — the biller then saw the group
        // header but ZERO components in the POS customisation modal.
        // Ship the full group definition (options / required /
        // maxSelections) so the components show up immediately.
        let payload = { groupName: name, dishIds };
        if (bulkGroupPickerMode !== "remove") {
          const src = allGroupsMap.get(name);
          if (src) {
            payload = {
              ...payload,
              required: Boolean(src.required),
              maxSelections: Number(src.maxSelections) || 1,
              options: Array.isArray(src.options)
                ? src.options.map((o) => ({
                    name: String(o?.name || "").trim(),
                    price: Number(o?.price) || 0,
                  }))
                : [],
            };
          }
        }
         
        await mutation.mutateAsync(payload);
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
    setProdOffOnPos(false);
    setProdOffOnWebsite(false);
    setProdScheduleEnabled(false);
    setProdStartTime("09:00");
    setProdEndTime("23:00");
    setProdDaysOfWeek([0, 1, 2, 3, 4, 5, 6]);
    setProdAssignedGroupNames([]);
    setEditingProduct(null);
  };

  const populateProductForm = (item) => {
    setEditingProduct(item);
    const existingGroupNames = Array.isArray(item?.modifierGroups)
      ? item.modifierGroups.map((g) => g?.name).filter(Boolean)
      : [];
    setProdAssignedGroupNames(existingGroupNames);
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
    setProdOffOnPos(item.visibleOnPosWhenOff === true);
    setProdOffOnWebsite(item.visibleOnWebsiteWhenOff === true);
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

  /**
   * What a row is keyed by in `selectedIds`.
   *
   * Groups are derived by name and have no _id, and their rows check
   * `selectedIds.has(group.name)`. Select All mapped `i._id` regardless, so
   * for groups it built a Set of `undefined` and selected nothing — while
   * clicking rows individually worked, because that path used the name.
   */
  // True while the Groups tab is showing the LIST of groups (not the products
  // inside one). That list is what the bulk bar acts on.
  const isGroupsList = activeTab === "groups" && !activeGroup;

  const selectionKey = (entry) => (entry?._id ? String(entry._id) : entry?.name);

  const toggleSelectAll = () => {
    const keys = currentItems.map(selectionKey).filter(Boolean);
    if (keys.length > 0 && keys.every((k) => selectedIds.has(k))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(keys));
    }
  };

  const toggleSelectItem = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const isAllSelected =
    currentItems.length > 0 &&
    currentItems.map(selectionKey).filter(Boolean).every((k) => selectedIds.has(k));

  /**
   * What kind of thing is currently selected. The bulk bar used to assume
   * "category unless we're inside one", so selecting GROUPS offered to
   * "delete selected categories" and then passed group names to the category
   * endpoint, which rejected them as an Invalid ID.
   */
  const selectionScope = isGroupsList ? "group" : activeCategory ? "product" : "category";

  const SCOPE_LABEL = {
    group: { one: "Group", many: "Groups" },
    product: { one: "Product", many: "Products" },
    category: { one: "Category", many: "Categories" },
  };

  const scopeLabel = (n) => (n === 1 ? SCOPE_LABEL[selectionScope].one : SCOPE_LABEL[selectionScope].many);

  /** Turn every selected group on or off in one go. */
  const handleBulkGroupActive = (isActive) => {
    selectedIds.forEach((groupName) => {
      setGroupActiveStates((prev) => ({ ...prev, [groupName]: isActive }));
      toggleGroupActiveMut.mutate({ groupName, isActive });
    });
    setSelectedIds(new Set());
    setShowBulkMenu(false);
  };

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    askConfirm({
      title: `Delete ${count} selected ${scopeLabel(count)}?`,
      message:
        selectionScope === "group"
          ? `The selected ${scopeLabel(count).toLowerCase()} will be removed from every product they are attached to.`
          : selectionScope === "product"
          ? `These products will be removed from "${activeCategory?.name}". Existing orders that referenced them are not affected.`
          : `The selected categories and every product they contain will be removed. Existing orders that referenced them are not affected.`,
      confirmLabel: `Delete ${count} ${scopeLabel(count)}`,
      tone: "danger",
      onConfirm: () => {
        if (selectionScope === "group") {
          // ONE request, for the same reason as products below: a delete per
          // group raced the same Menu document, so the first succeeded and
          // every one after it came back 500.
          deleteGroupMut.mutate({ groupNames: Array.from(selectedIds) });
        } else if (selectionScope === "product") {
          // ONE request. Firing a delete per id raced the same Menu document
          // and 500'd on everything after the first.
          bulkDeleteDishesMut.mutate({
            menuId: activeCategory._id,
            itemIds: Array.from(selectedIds),
          });
        } else {
          // Categories are separate documents, so these do not race.
          selectedIds.forEach((id) => deleteCategoryMut.mutate(id));
        }
        setSelectedIds(new Set());
        setShowBulkMenu(false);
      },
    });
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
          subcategoryId: editingSubcategory?._id || editingSubcategory?.id,
          oldName: typeof editingSubcategory === "string" ? editingSubcategory : editingSubcategory?.name || editingSubcategory?._id || "",
          name: catName,
          description: catDesc,
          dispatchType,
          published: catPublished,
          textColor,
        });
      } else {
        addSubcatMut.mutate({
          menuId: activeCategory._id,
          name: catName,
          description: catDesc,
          dispatchType,
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
          showOnPos: catPublished ? false : catShowOnPos,
          showOnWebsite: catPublished ? false : catShowOnWebsite,
          textColor,
        });
      } else {
        addCategoryMut.mutate({
          name: catName,
          description: catDesc,
          dispatchType,
          published: catPublished,
          showOnPos: catPublished ? false : catShowOnPos,
          showOnWebsite: catPublished ? false : catShowOnWebsite,
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
      menuId: activeCategory?._id,
      category: activeCategory?.name || "",
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
      visibleOnPosWhenOff: prodAvailable ? false : prodOffOnPos,
      visibleOnWebsiteWhenOff: prodAvailable ? false : prodOffOnWebsite,
      imageUrl: prodImageUrl,
      isAvailable: prodAvailable,
      schedule,
      modifierGroups: prodAssignedGroupNames
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
    <div className="flex flex-col md:flex-row h-full w-full bg-[#F8FAFC] overflow-hidden text-[#0F172A]">

      {/* Column 1: Left Navigation Sidebar (a tab row on phones) */}
      <div className="w-full md:w-[200px] shrink-0 border-b md:border-b-0 md:border-r border-[#E2E8F0] bg-white flex flex-row md:flex-col md:py-3">
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
              className={`flex-1 md:flex-none md:w-full text-center md:text-left px-5 py-3 text-[13.5px] font-semibold flex items-center justify-center md:justify-between transition-colors ${
                active
                  ? "text-[#C2410C] bg-[#FFF1E8] border-b-4 md:border-b-0 md:border-r-4 border-[#FD5302] font-bold"
                  : "text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC]"
              }`}
            >
              <span>{tab.label}</span>
              <span className="hidden md:inline"><IconChevronRight /></span>
            </button>
          );
        })}
      </div>

      {/* Column 2: Main List & Action Bar */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col md:h-full bg-white border-r border-[#E2E8F0]">

        {/* Top Header / Action Bar */}
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
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
                        {activeCategory?.name || "Category"}
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
                      <span>{typeof activeGroup === "string" ? activeGroup : activeGroup?.name || "Group"}</span>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Select All Checkbox.
                Hide when the operator has drilled into a specific group
                (Group Contents view) since there's nothing selectable
                there — the group's attached-products list is a read-only
                summary. Every other view can multi-select. */}
            {!(activeTab === "groups" && activeGroup) && (
              <label className="flex items-center gap-2 cursor-pointer select-none text-[13.5px] font-bold text-[#334155] ml-2">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-[#CBD5E1] accent-[#FD5302]"
                />
                <span>Select All</span>
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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

            {/* There is no "Publish Web" button. The customer website reads
                this menu directly, so anything saved here is already live. */}

            {/*
              §UI: the CSV "Download Template" affordance has been removed
              from the header. The template is still available server-side
              (GET /api/menu/csv/template) and is exercised by tests, but
              the operator no longer needs it in the day-to-day Manage Menu
              toolbar — it was noisy and the Export CSV flow is enough to
              seed a starting point for anyone who really needs one.
            */}

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

            <label className="h-[36px] px-3.5 rounded-xl border border-[#FD5302] text-[#C2410C] bg-white text-[12.5px] font-bold flex items-center gap-1 cursor-pointer hover:bg-[#FFF1E8]">
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
                    {/* Attaching or detaching a group only makes sense for a
                        selection of PRODUCTS. On the groups list those two
                        actions had nothing to act on. */}
                    {!isGroupsList && (
                      <>
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
                      </>
                    )}

                    {isGroupsList && (
                      <>
                        <button
                          onClick={() => handleBulkGroupActive(true)}
                          className="w-full text-left px-4 py-2 hover:bg-[#F8FAFC] font-semibold text-[#334155]"
                        >
                          Turn On ({selectedIds.size})
                        </button>
                        <button
                          onClick={() => handleBulkGroupActive(false)}
                          className="w-full text-left px-4 py-2 hover:bg-[#F8FAFC] font-semibold text-[#64748B]"
                        >
                          Turn Off ({selectedIds.size})
                        </button>
                      </>
                    )}

                    <button
                      onClick={handleBulkDelete}
                      className="w-full text-left px-4 py-2 hover:bg-[#FEF2F2] font-semibold text-[#DC2626] border-t border-[#E2E8F0]"
                    >
                      Delete {selectedIds.size} {scopeLabel(selectedIds.size)}
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
                  className="h-[36px] px-3.5 rounded-xl bg-[#FD5302] text-white text-[12.5px] font-bold hover:bg-[#D64502]"
                  title="Add Category"
                >
                  + Add Category
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      // §Add-Subcategory: guarantee the drawer opens by
                      // stopping any bubbling handlers (e.g. a parent
                      // that might have been added as a drag/drop or
                      // selection toggle) and by scheduling the state
                      // updates in a specific, defensive order — reset
                      // any lingering edit references first, close the
                      // OTHER drawers (so a stale showCreateCategory
                      // can't render the wrong title), then open the
                      // subcategory drawer.
                      e.preventDefault();
                      e.stopPropagation();
                      setShowCreateCategory(false);
                      setShowCreateProduct(false);
                      setEditingCategory(null);
                      setEditingSubcategory(null);
                      resetCategoryForm();
                      setShowCreateSubcategory(true);
                    }}
                    className="h-[36px] px-3 rounded-xl border border-[#FD5302] text-[#C2410C] text-[12.5px] font-bold hover:bg-[#FFF1E8]"
                  >
                    + Add Subcategory
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowCreateCategory(false);
                      setShowCreateSubcategory(false);
                      setEditingProduct(null);
                      resetProductForm();
                      setShowCreateProduct(true);
                    }}
                    className="h-[36px] px-3 rounded-xl bg-[#FD5302] text-white text-[12.5px] font-bold hover:bg-[#D64502]"
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
                  setSelectionType("single");
                  setExtrasList([]);
                  setGroupMaxEnabled(false);
                  setAssignedDishIds(new Set());
                  setShowManageGroup(true);
                }}
                className="h-[36px] px-3.5 rounded-xl bg-[#FD5302] text-white text-[12.5px] font-bold hover:bg-[#D64502]"
              >
                + Add Group
              </button>
            )}
          </div>
        </div>

        {/* Main Item List */}
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#E2E8F0]">
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
                        setGroupMaxEnabled(activeGroup.maxSelectionEnabled === true);
                        setSelectionType(selectionTypeOf(activeGroup));
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
                            <span className="font-extrabold text-[#C2410C]">₹{opt.price}</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => {
                                setEditingGroup(activeGroup);
                                setGroupName(activeGroup.name);
                                setGroupRequired(activeGroup.required);
                                setGroupMax(String(activeGroup.maxSelections || 1));
                                setGroupMaxEnabled(activeGroup.maxSelectionEnabled === true);
                                setSelectionType(selectionTypeOf(activeGroup));
                                setExtrasList((activeGroup.options || []).map((o) => ({ name: o?.name || "", price: String(o?.price ?? "0") })));
                                setAssignedDishIds(new Set(activeGroup.dishIds));
                                setExtraNameInput(opt.name);
                                setExtraPriceInput(String(opt.price));
                                setEditingCompIndex(idx);
                                setShowManageGroup(true);
                              }}
                              className="h-[28px] px-2 rounded-lg border border-[#E2E8F0] text-[11px] font-bold text-[#334155] hover:bg-[#FFF1E8]"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                askConfirm({
                                  title: "Delete component?",
                                  message: `Delete component "${opt.name}" from group "${activeGroup.name}"?`,
                                  confirmLabel: "Delete Component",
                                  tone: "danger",
                                  onConfirm: () => {
                                    const updatedOpts = (activeGroup.options || []).filter((_, i) => i !== idx);
                                    saveGroupMut.mutate({
                                      groupName: activeGroup.name,
                                      required: activeGroup.required,
                                      maxSelections: activeGroup.maxSelections,
                                      options: updatedOpts,
                                      dishIds: Array.from(activeGroup.dishIds),
                                    });
                                  },
                                });
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
                          <span className="font-bold text-[#0F172A]">{displayPrice(item)}</span>
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
                        setSelectionType("single");
                        setExtrasList([]);
                        setGroupMaxEnabled(false);
                        setAssignedDishIds(new Set());
                        setEditingGroup(null);
                        setShowManageGroup(true);
                      }}
                      className="h-[36px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502]"
                    >
                      + Add Group
                    </button>
                  </div>
                ) : (
                  groupsList.map((group, index) => {
                    const selected = selectedIds.has(group.name);
                    const isOpen =
                      groupActiveStates[group.name] !== undefined
                        ? groupActiveStates[group.name]
                        : group.isActive !== false;

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
                        className={`px-3 sm:px-6 py-3 sm:py-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-4 gap-y-2 transition-colors ${
                          selected ? "bg-[#FFF1E8]/40" : "hover:bg-[#F8FAFC]"
                        }`}
                      >
                        {/* Left elements: ON/OFF toggle, Checkbox, Group Name */}
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1 basis-full sm:basis-0">
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
                            className="w-4 h-4 rounded border-[#CBD5E1] accent-[#FD5302] shrink-0 cursor-pointer"
                          />

                          {/* Group Name (Clicking opens Group Contents) */}
                          <span
                            onClick={() => {
                              setActiveGroup(group);
                              setSelectedIds(new Set());
                            }}
                            className="font-medium text-[14.5px] text-[#1E293B] cursor-pointer hover:text-[#C2410C] truncate"
                          >
                            {group.name}
                          </span>
                        </div>

                        {/* Right elements: Manage button & Drag handle */}
                        <div className="flex items-center gap-3 sm:gap-4 shrink-0 ml-auto">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingGroup(group);
                              setGroupName(group.name);
                              setGroupRequired(group.required);
                              setGroupMax(String(group.maxSelections || 1));
                              setGroupMaxEnabled(group.maxSelectionEnabled === true);
                              setSelectionType(selectionTypeOf(group));
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
            (() => {
              // Apply optimistic drag order (if any) so the biller sees the
              // new position immediately, before the reorder request round
              // trips.
              const orderedMenus = (() => {
                if (!categoryOrderOverride) return menus;
                const map = new Map(menus.map((m) => [String(m._id), m]));
                const rest = menus.filter((m) => !categoryOrderOverride.includes(String(m._id)));
                return [
                  ...categoryOrderOverride.map((id) => map.get(String(id))).filter(Boolean),
                  ...rest,
                ];
              })();
              return orderedMenus.map((menu, catIndex) => {
              const selected = selectedIds.has(menu._id);
              const isPublished = menu.published !== false;

              return (
                <div
                  key={menu._id}
                  draggable
                  onDragStart={(e) => {
                    setDraggedCategoryIndex(catIndex);
                    try { e.dataTransfer.effectAllowed = "move"; } catch { /* Safari */ }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    try { e.dataTransfer.dropEffect = "move"; } catch { /* Safari */ }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedCategoryIndex === null || draggedCategoryIndex === catIndex) {
                      setDraggedCategoryIndex(null);
                      return;
                    }
                    const next = [...orderedMenus];
                    const [moved] = next.splice(draggedCategoryIndex, 1);
                    next.splice(catIndex, 0, moved);
                    const idOrder = next.map((m) => String(m._id));
                    setCategoryOrderOverride(idOrder);
                    setDraggedCategoryIndex(null);
                    reorderMenusMut.mutate({ menuIds: idOrder });
                  }}
                  onDragEnd={() => setDraggedCategoryIndex(null)}
                  onClick={() => {
                    setActiveCategory(menu);
                    setActiveSubcategory(null);
                    setSelectedIds(new Set());
                  }}
                  className={`px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-4 gap-y-2 transition-colors cursor-pointer ${
                    selected ? "bg-[#FFF1E8]/40" : "hover:bg-[#F8FAFC]"
                  } ${draggedCategoryIndex === catIndex ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1 basis-full sm:basis-0">
                    {/* Selection Checkbox */}
                    <input
                      type="checkbox"
                      checked={selected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelectItem(menu._id)}
                      className="w-4 h-4 rounded border-[#CBD5E1] accent-[#FD5302] shrink-0"
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

                  <div className="flex items-center gap-3 sm:gap-4 shrink-0 ml-auto">
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
                        setBgColor(menu.bgColor || "#FD5302");
                        setCatShowOnPos(menu.showOnPos === true);
                        setCatShowOnWebsite(menu.showOnWebsite === true);
                        setTextColor(menu.textColor || "#ffffff");
                        setShowCreateCategory(true);
                      }}
                      className="h-[34px] px-3.5 rounded-xl border border-[#CBD5E1] text-[#334155] text-[12px] font-bold hover:bg-[#FFF1E8]"
                    >
                      Manage
                    </button>

                    {/* Drag handle affordance — the whole row is draggable
                        but the dots signal "grab me to reorder". */}
                    <span
                      className="text-[#94A3B8] hover:text-[#0F172A] cursor-grab select-none"
                      title="Drag to reorder"
                    >
                      <IconDots />
                    </span>
                  </div>
                </div>
              );
              });
            })()
          ) : (
            /* Inside Category / Subcategory View (Module 2) */
            (() => {
              const rawCategoryItems = activeCategory.items || [];

              // Apply optimistic drag order for the products list so the
              // biller sees the row move immediately, before the reorder
              // request comes back from the server.
              const applyProductOverride = (list) => {
                if (!productOrderOverride) return list;
                const map = new Map(list.map((it) => [String(it._id), it]));
                const rest = list.filter((it) => !productOrderOverride.includes(String(it._id)));
                return [
                  ...productOrderOverride.map((id) => map.get(String(id))).filter(Boolean),
                  ...rest,
                ];
              };
              const allCategoryItems = applyProductOverride(rawCategoryItems);

              // Helper to render product row. `visibleItems` is the array
              // the row lives inside (used for drop-index maths so items
              // hidden by the subcategory filter don't scramble the order
              // stamped on the server).
              const renderProductRow = (item, prodIndex, visibleItems) => {
                const selected = selectedIds.has(item._id);
                const isAvailable = item.isAvailable !== false;

                return (
                  <div
                    key={item._id}
                    draggable
                    onDragStart={(e) => {
                      setDraggedProductIndex(prodIndex);
                      try { e.dataTransfer.effectAllowed = "move"; } catch { /* Safari */ }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      try { e.dataTransfer.dropEffect = "move"; } catch { /* Safari */ }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedProductIndex === null || draggedProductIndex === prodIndex) {
                        setDraggedProductIndex(null);
                        return;
                      }
                      const next = [...visibleItems];
                      const [moved] = next.splice(draggedProductIndex, 1);
                      next.splice(prodIndex, 0, moved);
                      // Preserve the full category order — items not in
                      // `visibleItems` (other subcategories) keep their
                      // existing relative order behind the dragged group.
                      const visibleIds = new Set(visibleItems.map((i) => String(i._id)));
                      const orderedIds = [
                        ...next.map((i) => String(i._id)),
                        ...allCategoryItems
                          .filter((i) => !visibleIds.has(String(i._id)))
                          .map((i) => String(i._id)),
                      ];
                      setProductOrderOverride(orderedIds);
                      setDraggedProductIndex(null);
                      reorderDishesMut.mutate({
                        menuId: activeCategory._id,
                        itemIds: orderedIds,
                      });
                    }}
                    onDragEnd={() => setDraggedProductIndex(null)}
                    onClick={() => setViewingProduct(item)}
                    className={`px-3 sm:px-6 py-3 sm:py-4 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-4 gap-y-2 transition-colors cursor-pointer ${
                      selected ? "bg-[#FFF1E8]/40" : "hover:bg-[#F8FAFC]"
                    } ${draggedProductIndex === prodIndex ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1 basis-full sm:basis-0">
                      <input
                        type="checkbox"
                        checked={selected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelectItem(item._id)}
                        className="w-4 h-4 rounded border-[#CBD5E1] accent-[#FD5302] shrink-0 cursor-pointer"
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
                          <p className="text-[11.5px] font-bold text-[#C2410C] truncate mt-0.5">
                            {item.subcategory}
                          </p>
                        )}
                        {/* Display assigned groups / components summary badges directly on the product row */}
                        {Array.isArray(item.modifierGroups) && item.modifierGroups.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {item.modifierGroups.map((g) => (
                              <span
                                key={g.name}
                                className="px-2 py-0.5 rounded-md bg-[#FFF1E8] text-[#C2410C] text-[10.5px] font-extrabold"
                              >
                                🧩 {g.name} ({(g.options || []).length})
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-4 shrink-0 ml-auto">
                      <span className="font-extrabold text-[14px] text-[#0F172A]">{displayPrice(item)}</span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          populateProductForm(item);
                        }}
                        className="h-[34px] px-3.5 rounded-xl border border-[#CBD5E1] text-[#334155] text-[12px] font-bold hover:bg-[#FFF1E8]"
                      >
                        Manage
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // §Delete-Confirm: the Delete button used to fire
                          // the mutation immediately. Route it through the
                          // shared confirm modal so a mis-tap can't nuke a
                          // product without an explicit "Yes, delete" click.
                          askConfirm({
                            title: "Delete product?",
                            message: `Delete "${item.name}"? This will remove it from the menu. Existing orders that referenced this product are not affected.`,
                            confirmLabel: "Delete Product",
                            tone: "danger",
                            onConfirm: () => {
                              deleteDishMut.mutate({
                                menuId: activeCategory._id,
                                itemId: item._id,
                              });
                            },
                          });
                        }}
                        className="h-[34px] px-3 rounded-xl border border-[#FECACA] text-[#DC2626] text-[12px] font-bold hover:bg-[#FEF2F2]"
                      >
                        Delete
                      </button>

                      {/* Drag handle — the whole row is `draggable` but the
                          dots give the biller a visual affordance to grab. */}
                      <span
                        className="text-[#94A3B8] hover:text-[#0F172A] cursor-grab select-none"
                        title="Drag to reorder"
                      >
                        <IconDots />
                      </span>
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

                return subcategoryItems.map((it, i) => renderProductRow(it, i, subcategoryItems));
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
                      No subcategories or products created in "{activeCategory?.name || "Category"}" yet.
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
                              className="relative p-3 pl-4 rounded-xl border border-[#FFD5BE] bg-gradient-to-br from-[#EEF2FF] to-white shadow-sm hover:border-[#FD5302] hover:shadow-md cursor-pointer transition-all flex items-center justify-between gap-3 overflow-hidden"
                            >
                              {/* Left accent strip — the strongest single cue
                                  that this is a subcategory card, not a product row. */}
                              <span
                                aria-hidden="true"
                                className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#FD5302]"
                              />
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FD5302]/12 text-[#C2410C]">
                                  <IconFolder />
                                </span>
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
                                  className="h-[28px] px-2.5 rounded-lg border border-[#CBD5E1] text-[11.5px] font-bold text-[#334155] hover:bg-[#FFF1E8] hover:border-[#FD5302]"
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
                        <div className="px-3 sm:px-6 py-2.5 bg-white border-b border-[#E2E8F0]">
                          <h4 className="text-[11.5px] font-extrabold text-[#64748B] uppercase tracking-wider">
                            Direct Products ({directProducts.length})
                          </h4>
                        </div>
                        {directProducts.map((it, i) => renderProductRow(it, i, directProducts))}
                      </div>
                    ) : (
                      <div className="p-8 text-center text-[#94A3B8]">
                        <p className="text-[13px] font-semibold text-[#64748B]">No direct products in this category.</p>
                        <p className="text-[11.5px] text-[#94A3B8] mt-0.5">Click a subcategory above to view its products.</p>
                      </div>
                    )
                  ) : (
                    allCategoryItems.map((it, i) => renderProductRow(it, i, allCategoryItems))
                  )}
                </div>
              );
            })()
          )}
        </div>
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
                <label className="text-[12px] font-extrabold text-[#334155]">Description</label>
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

              {/* With Display Status OFF the category is hidden everywhere by
                  default; these let it back onto one surface only. */}
              {!catPublished && (
                <div className="space-y-2 pl-1">
                  {[
                    { label: "POS Visibility", hint: "Show on the POS tills only", on: catShowOnPos, set: setCatShowOnPos },
                    { label: "Website Visibility", hint: "Show on the customer website only", on: catShowOnWebsite, set: setCatShowOnWebsite },
                  ].map(({ label, hint, on, set }) => (
                    <div key={label} className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-[12.5px] text-[#334155] block">{label}</span>
                        <span className="text-[11px] text-[#94A3B8]">{hint}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => set((prev) => !prev)}
                        className={`w-10 h-[22px] rounded-full transition-colors relative shrink-0 ${
                          on ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                        }`}
                      >
                        <span
                          className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform ${
                            on ? "right-[3px]" : "left-[3px]"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}

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
                        className="accent-[#FD5302]"
                      />
                      <span>Collection</span>
                    </label>

                    <label className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold">
                      <input
                        type="checkbox"
                        checked={dispatchDel}
                        onChange={(e) => setDispatchDel(e.target.checked)}
                        className="accent-[#FD5302]"
                      />
                      <span>Delivery</span>
                    </label>

                    <label className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold">
                      <input
                        type="checkbox"
                        checked={dispatchTbl}
                        onChange={(e) => setDispatchTbl(e.target.checked)}
                        className="accent-[#FD5302]"
                      />
                      <span>Table</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Background Color and Text Color are both gone from the
                  category form. Each is still LOADED from the category and
                  sent back unchanged on save, so existing colours survive an
                  edit instead of being reset to the defaults. */}
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

              <div className="flex items-center justify-between border-t border-[#E2E8F0] py-3">
                <span className="font-extrabold text-[#0F172A]">Required Selection</span>
                <input
                  type="checkbox"
                  checked={groupRequired}
                  onChange={(e) => setGroupRequired(e.target.checked)}
                  className="w-5 h-5 accent-[#22C55E]"
                />
              </div>

              {/* Selection Type: Single vs Multiple */}
              <div className="space-y-2 border-b border-[#E2E8F0] pb-3">
                <div>
                  <span className="font-extrabold text-[#0F172A] block">Selection Type</span>
                  <span className="text-[11.5px] font-semibold text-[#64748B]">
                    Single = customer can pick 1 item. Multiple = customer can pick multiple items.
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionType("single");
                      setGroupMax("1");
                    }}
                    className={`h-[40px] px-3 rounded-xl border text-[13px] font-extrabold flex items-center justify-center gap-2 transition-all ${
                      selectionType === "single"
                        ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                        : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${selectionType === "single" ? "bg-white" : "bg-[#94A3B8]"}`} />
                    Single (Choose 1)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionType("multiple");
                      if (Number(groupMax) <= 1) setGroupMax("5");
                    }}
                    className={`h-[40px] px-3 rounded-xl border text-[13px] font-extrabold flex items-center justify-center gap-2 transition-all ${
                      selectionType === "multiple"
                        ? "bg-[#FD5302] text-white border-[#FD5302] shadow-xs"
                        : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full ${selectionType === "multiple" ? "bg-white" : "bg-[#94A3B8]"}`} />
                    Multiple (Choose Many)
                  </button>
                </div>

                {selectionType === "multiple" && (
                  <div className="pt-2.5 mt-1 border-t border-dashed border-[#E2E8F0] space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[12px] font-extrabold text-[#334155] block">Maximum Selection</span>
                        <span className="text-[11px] font-semibold text-[#64748B]">
                          {groupMaxEnabled ? "Cap how many the customer may pick" : "Off — customer may pick any number"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !groupMaxEnabled;
                          setGroupMaxEnabled(next);
                          if (next && Number(groupMax) < 2) setGroupMax("2");
                        }}
                        className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                          groupMaxEnabled ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                        }`}
                      >
                        <span
                          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                            groupMaxEnabled ? "right-1" : "left-1"
                          }`}
                        />
                      </button>
                    </div>

                    {groupMaxEnabled && (
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-bold text-[#64748B]">Max selections allowed</span>
                        <input
                          type="number"
                          min={2}
                          step={1}
                          value={groupMax}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") { setGroupMax(""); return; }
                            const n = Math.max(2, Math.floor(Number(v) || 2));
                            setGroupMax(String(n));
                          }}
                          onBlur={() => {
                            if (!groupMax || Number(groupMax) < 2) setGroupMax("2");
                          }}
                          className="w-[80px] h-[36px] px-2 text-center rounded-xl border border-[#E2E8F0] font-extrabold text-[13.5px]"
                        />
                      </div>
                    )}
                  </div>
                )}
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
                    // Carry the price forward: the next component defaults to
                    // whatever was just entered, so a run of same-priced
                    // components is typed once.
                    setExtraPriceInput(String(numPrice));
                  }}
                  className="w-full h-[36px] rounded-xl bg-[#FD5302] text-white text-[12.5px] font-bold hover:bg-[#D64502]"
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
                            className="text-[#C2410C] font-bold hover:underline text-[11.5px]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              askConfirm({
                                title: "Delete component?",
                                message: `Delete component "${extra.name}" from this group?`,
                                confirmLabel: "Delete Component",
                                tone: "danger",
                                onConfirm: () => {
                                  setExtrasList(extrasList.filter((_, i) => i !== idx));
                                  if (editingCompIndex === idx) {
                                    setEditingCompIndex(null);
                                    setExtraNameInput("");
                                  }
                                },
                              });
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
                            className="w-4 h-4 accent-[#FD5302]"
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
                  // §Groups: a group may now be created / edited WITHOUT
                  // being attached to any product. Standalone groups live
                  // in the local `customCreatedGroups` registry so they
                  // still appear in the Groups list and in the "Bulk Add
                  // Group" picker — the operator can attach them later
                  // from Products → Select → Manage → Add Group.
                  const trimmedName = groupName.trim();
                  // "Single" is a cap of one by definition. "Multiple" only
                  // carries a cap when Maximum Selection is switched on;
                  // otherwise the customer may pick any number.
                  const capOn = selectionType === "single" || groupMaxEnabled;
                  const normalizedMax =
                    selectionType === "single" ? 1 : Math.max(1, Number(groupMax) || 1);
                  const normalizedOptions = extrasList.map((e) => ({
                    name: e.name.trim(),
                    price: Number(e.price) || 0,
                  }));

                  if (!assignedDishIds || assignedDishIds.size === 0) {
                    // Register (or update) the group locally — no server
                    // call needed since it isn't attached to any product
                    // yet. If the operator was renaming an existing
                    // standalone group we also drop the old key so the
                    // list doesn't show duplicates.
                    setCustomCreatedGroups((prev) => {
                      const next = { ...prev };
                      if (editingGroup && editingGroup.name && editingGroup.name !== trimmedName) {
                        delete next[editingGroup.name];
                      }
                      next[trimmedName] = {
                        name: trimmedName,
                        required: Boolean(groupRequired),
                        maxSelectionEnabled: capOn,
                        maxSelections: normalizedMax,
                        options: normalizedOptions,
                      };
                      return next;
                    });
                    enqueueSnackbar(
                      editingGroup
                        ? `Group "${trimmedName}" updated. Attach it to products from the Products tab when you're ready.`
                        : `Group "${trimmedName}" created. Attach it to products from the Products tab when you're ready.`,
                      { variant: "success" },
                    );
                    setShowManageGroup(false);
                    setEditingGroup(null);
                    return;
                  }

                  saveGroupMut.mutate({
                    groupName: trimmedName,
                    oldGroupName: editingGroup ? editingGroup.name : undefined,
                    required: groupRequired,
                    maxSelectionEnabled: capOn,
                    maxSelections: normalizedMax,
                    options: normalizedOptions,
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
              Total Records: {csvPreviewData.totalRows}. The import goes live on your customer website
              straight away. Click <span className="font-extrabold text-[#0F172A]">Publish POS</span> when
              you want the tills to pick it up too.
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
                <h3 className="text-[18px] font-extrabold">{viewingProduct?.name || "Product"}</h3>
                <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded border ${
                  viewingProduct?.isVegetarian !== false
                    ? "bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]"
                    : "bg-[#FEE2E2] text-[#B91C1C] border-[#FCA5A5]"
                }`}>
                  {viewingProduct?.isVegetarian !== false ? "🌱 Veg" : "🔴 Non-Veg"}
                </span>
              </div>
              <button onClick={() => setViewingProduct(null)} className="text-[#94A3B8] hover:text-[#0F172A]">
                <IconX />
              </button>
            </div>

            {viewingProduct?.imageUrl || viewingProduct?.image ? (
              <img src={viewingProduct?.imageUrl || viewingProduct?.image} alt={viewingProduct?.name || "Product"} className="w-full h-44 object-cover rounded-xl border" />
            ) : null}

            <div className="space-y-3 text-[13px]">
              {viewingProduct?.description && (
                <p className="text-[#475569] font-medium leading-relaxed">{viewingProduct.description}</p>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E2E8F0]">
                <div className="p-3 rounded-xl bg-[#F8FAFC] border">
                  <span className="text-[#64748B] text-[11px] font-bold">Standard Price</span>
                  <p className="text-lg font-extrabold text-[#C2410C]">₹{viewingProduct?.price || 0}</p>
                </div>
                <div className="p-3 rounded-xl bg-[#F8FAFC] border">
                  <span className="text-[#64748B] text-[11px] font-bold">Display Status</span>
                  <p className="text-[13px] font-extrabold">
                    {viewingProduct?.isAvailable !== false ? "🟢 Display ON" : "🔴 Display OFF"}
                  </p>
                </div>
              </div>

              {/* Assigned Groups & Components details */}
              {Array.isArray(viewingProduct?.modifierGroups) && viewingProduct.modifierGroups.length > 0 ? (
                <div className="p-3 rounded-xl bg-[#F8FAFC] border space-y-2 text-[12px]">
                  <p className="font-extrabold text-[#0F172A]">Assigned Groups & Components ({viewingProduct.modifierGroups.length})</p>
                  <div className="space-y-1.5">
                    {viewingProduct.modifierGroups.map((g, idx) => (
                      <div key={g?.name || g?._id || idx} className="p-2.5 rounded-lg bg-white border border-[#E2E8F0]">
                        <div className="flex items-center justify-between font-extrabold text-[#0F172A]">
                          <span>🧩 {g?.name || "Group"}</span>
                          <span className="text-[10.5px] font-bold text-[#C2410C] bg-[#FFF1E8] px-2 py-0.5 rounded-md">
                            {g?.required ? "Required" : "Optional"} · max {g?.maxSelections || 1}
                          </span>
                        </div>
                        {Array.isArray(g?.options) && g.options.length > 0 && (
                          <p className="text-[11.5px] font-semibold text-[#475569] mt-1">
                            {g.options.map((o) => `${o?.name || "Item"} (₹${o?.price || 0})`).join(", ")}
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
                  <p className="font-bold text-[#C2410C]">
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
                className="flex-1 h-[42px] rounded-xl bg-[#FD5302] text-white font-bold shadow-md hover:bg-[#D64502]"
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

                {!dispatchAll && (
                  <div className="grid grid-cols-3 gap-2 pt-1 text-[12px]">
                    {[
                      { label: "Collection", on: dispatchCol, set: setDispatchCol },
                      { label: "Delivery", on: dispatchDel, set: setDispatchDel },
                      { label: "Table", on: dispatchTbl, set: setDispatchTbl },
                    ].map(({ label, on, set }) => (
                      <label
                        key={label}
                        className="flex items-center gap-1.5 p-2 rounded-lg bg-[#F8FAFC] border font-bold"
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => set(e.target.checked)}
                          className="accent-[#FD5302]"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                )}
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
                <label className="mt-1 w-full h-[110px] rounded-xl border-2 border-dashed border-[#CBD5E1] bg-[#F8FAFC] flex flex-col items-center justify-center cursor-pointer hover:border-[#FD5302] hover:bg-[#FFF1E8]/30 transition-all text-center p-2 relative overflow-hidden">
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
                    <span className="text-[12px] font-bold text-[#C2410C] animate-pulse">Uploading image…</span>
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
                      <span className="text-[11.5px] font-bold text-[#C2410C] mt-1">Click to upload or replace product image</span>
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

              {/* Display OFF removes the product from both surfaces by
                  default; these keep it live on one of them. */}
              {!prodAvailable && (
                <div className="space-y-2 pl-1">
                  {[
                    { label: "POS Visibility", hint: "Keep selling on the POS tills only", on: prodOffOnPos, set: setProdOffOnPos },
                    { label: "Website Visibility", hint: "Keep selling on the customer website only", on: prodOffOnWebsite, set: setProdOffOnWebsite },
                  ].map(({ label, hint, on, set }) => (
                    <div key={label} className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-[12.5px] text-[#334155] block">{label}</span>
                        <span className="text-[11px] text-[#94A3B8]">{hint}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => set((prev) => !prev)}
                        className={`w-10 h-[22px] rounded-full transition-colors relative shrink-0 ${
                          on ? "bg-[#22C55E]" : "bg-[#CBD5E1]"
                        }`}
                      >
                        <span
                          className={`absolute top-[3px] w-4 h-4 rounded-full bg-white transition-transform ${
                            on ? "right-[3px]" : "left-[3px]"
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Assign Groups (Module 8) */}
              <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
                <div>
                  <label className="text-[12px] font-extrabold text-[#334155] block">Assign Groups / Components</label>
                  <span className="text-[11px] font-medium text-[#64748B]">Groups appear in the exact order you select them</span>
                </div>
                {groupsList.length === 0 ? (
                  <p className="text-[11.5px] text-[#94A3B8]">No groups created yet.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="max-h-[140px] overflow-y-auto space-y-1.5 p-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                      {groupsList.map((g) => {
                        const orderIndex = prodAssignedGroupNames.indexOf(g.name);
                        const checked = orderIndex !== -1;
                        return (
                          <label key={g.name} className="flex items-center justify-between p-1.5 hover:bg-white rounded-lg cursor-pointer text-[12px] font-bold text-[#334155]">
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  if (checked) {
                                    setProdAssignedGroupNames(prodAssignedGroupNames.filter((n) => n !== g.name));
                                  } else {
                                    setProdAssignedGroupNames([...prodAssignedGroupNames, g.name]);
                                  }
                                }}
                                className="w-4 h-4 accent-[#FD5302] shrink-0"
                              />
                              <span className="truncate">{g.name}</span>
                              {checked && (
                                <span className="px-1.5 py-0.2 rounded-full bg-[#FD5302] text-white text-[10px] font-extrabold shrink-0">
                                  #{orderIndex + 1}
                                </span>
                              )}
                            </div>
                            <span className="text-[10.5px] font-semibold text-[#64748B] shrink-0">{(g.options || []).length} Components</span>
                          </label>
                        );
                      })}
                    </div>

                    {prodAssignedGroupNames.length > 0 && (
                      <div className="p-2.5 rounded-xl bg-[#FFF1E8]/60 border border-[#FFD5BE] space-y-1">
                        <span className="text-[11px] font-extrabold text-[#C2410C] uppercase tracking-wider block">
                          Attached Order ({prodAssignedGroupNames.length})
                        </span>
                        <div className="space-y-1">
                          {prodAssignedGroupNames.map((name, idx) => (
                            <div key={name} className="flex items-center justify-between px-2 py-0.5 rounded bg-white border border-[#E2E8F0] text-[11.5px] font-bold text-[#0F172A]">
                              <span className="truncate">#{idx + 1} {name}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {idx > 0 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const next = [...prodAssignedGroupNames];
                                      const temp = next[idx - 1];
                                      next[idx - 1] = next[idx];
                                      next[idx] = temp;
                                      setProdAssignedGroupNames(next);
                                    }}
                                    className="w-4 h-4 rounded text-[#C2410C] hover:bg-[#FFF1E8] text-[10px]"
                                  >▲</button>
                                )}
                                {idx < prodAssignedGroupNames.length - 1 && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const next = [...prodAssignedGroupNames];
                                      const temp = next[idx + 1];
                                      next[idx + 1] = next[idx];
                                      next[idx] = temp;
                                      setProdAssignedGroupNames(next);
                                    }}
                                    className="w-4 h-4 rounded text-[#C2410C] hover:bg-[#FFF1E8] text-[10px]"
                                  >▼</button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                                active ? "bg-[#FD5302] text-white border-[#FD5302]" : "bg-white text-[#64748B] border-[#CBD5E1]"
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
                    <p className="text-[11.5px] font-bold text-[#C2410C]">Separate Prices (POS vs Website)</p>
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
                        className="text-[#C2410C] hover:underline"
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
                              ? "border-[#FD5302] bg-[#FFF1E8]/40"
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
                              className="w-4 h-4 accent-[#FD5302] shrink-0"
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
                    : "bg-[#FD5302] hover:bg-[#D64502]"
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

      {/*
        Shared confirmation modal.

        Every destructive action in Manage Menu (Delete Product,
        Delete Category, Delete Group, Delete Component, Bulk Delete)
        now routes through `askConfirm()` which populates `confirmState`.
        The old `window.confirm()` calls have been replaced so the biller
        never loses an item to an accidental mis-click, and so the
        confirmation UX matches the rest of the app (no native browser
        dialog).
      */}
      {confirmState && (
        <div
          className="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4"
          onClick={closeConfirm}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-[440px] bg-white rounded-2xl shadow-2xl p-6 space-y-4 text-[#0F172A]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span
                className={`w-10 h-10 rounded-full flex items-center justify-center text-[18px] font-extrabold shrink-0 ${
                  confirmState.tone === "danger"
                    ? "bg-[#FEE2E2] text-[#DC2626]"
                    : "bg-[#FFF1E8] text-[#C2410C]"
                }`}
                aria-hidden="true"
              >
                {confirmState.tone === "danger" ? "!" : "?"}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16.5px] font-extrabold text-[#0F172A] leading-snug">
                  {confirmState.title}
                </h3>
                {confirmState.message && (
                  <p className="mt-1 text-[13px] leading-relaxed text-[#475569]">
                    {confirmState.message}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeConfirm}
                className="h-[40px] px-4 rounded-xl border border-[#E2E8F0] text-[#475569] text-[13px] font-bold hover:bg-[#F8FAFC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const fn = confirmState.onConfirm;
                  // Close the modal FIRST so the confirm callback can open
                  // another modal (e.g. success toast + re-render) without
                  // fighting our closeConfirm() call.
                  closeConfirm();
                  if (typeof fn === "function") fn();
                }}
                className={`h-[40px] px-5 rounded-xl text-white text-[13px] font-extrabold shadow-md ${
                  confirmState.tone === "danger"
                    ? "bg-[#DC2626] hover:bg-[#B91C1C]"
                    : "bg-[#FD5302] hover:bg-[#D64502]"
                }`}
                autoFocus
              >
                {confirmState.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManageMenu;
