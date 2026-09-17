import React, { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
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
  exportMenuCsv,
  getMenus,
  previewMenuCsv,
  saveGroupToDishes,
  deleteGroupFromDishes,
  toggleGroupActive,
  reorderGroups,
  reorderDishes,
  reorderMenus,
  unpublishMenu,
  publishMenu,
  publishSystemCache,
  updateDishStatus,
} from "../../https";
import { IconChevronRight, IconDoc, IconDots, IconFolder } from "./manageMenu/icons";
import ConfirmDialog from "./manageMenu/ConfirmDialog";
import CsvPreviewModal from "./manageMenu/CsvPreviewModal";
import ViewProductModal from "./manageMenu/ViewProductModal";
import BulkGroupPickerModal from "./manageMenu/BulkGroupPickerModal";
import ProductDrawer from "./manageMenu/ProductDrawer";
import GroupDrawer from "./manageMenu/GroupDrawer";
import CategoryDrawer from "./manageMenu/CategoryDrawer";

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

  // What each drawer is editing (null = create). The form state itself lives
  // in the drawer; the page only says which record to load into it.
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingComponent, setEditingComponent] = useState(null); // { index, name, price }
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingSubcategory, setEditingSubcategory] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [viewingProduct, setViewingProduct] = useState(null);

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
  // they update only when the user clicks "Publish" (Manage Cache > Publish System).
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
      setEditingCategory(null);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to add category", { variant: "error" }),
  });

  const updateCategoryMut = useMutation({
    mutationFn: updateCategory,
    onSuccess: () => {
      enqueueSnackbar("Category updated!", { variant: "success" });
      invalidate();
      setShowCreateCategory(false);
      setEditingCategory(null);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update category", { variant: "error" }),
  });

  const addSubcatMut = useMutation({
    mutationFn: addSubcategory,
    onSuccess: () => {
      enqueueSnackbar("Subcategory added!", { variant: "success" });
      invalidate();
      setShowCreateSubcategory(false);
      setEditingSubcategory(null);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to add subcategory", { variant: "error" }),
  });

  const updateSubcatMut = useMutation({
    mutationFn: updateSubcategory,
    onSuccess: () => {
      enqueueSnackbar("Subcategory updated!", { variant: "success" });
      invalidate();
      setShowCreateSubcategory(false);
      setEditingSubcategory(null);
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Failed to update subcategory", { variant: "error" }),
  });

  const addDishMut = useMutation({
    mutationFn: addDish,
    onSuccess: () => {
      enqueueSnackbar("Product added!", { variant: "success" });
      invalidate();
      setShowCreateProduct(false);
      setEditingProduct(null);
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

  const openProductDrawer = (item) => {
    setEditingProduct(item);
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
              title="Publish draft menu to the POS counters and the customer website"
            >
              Publish
            </button>

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
                    setEditingCategory(null);
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
                  setEditingGroup(null);
                  setEditingComponent(null);
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
                        setEditingComponent(null);
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
                                setEditingComponent({ index: idx, name: opt.name, price: opt.price });
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
                        setEditingGroup(null);
                        setEditingComponent(null);
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
                              setEditingComponent(null);
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
                          openProductDrawer(item);
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

      <CategoryDrawer
        open={showCreateCategory || showCreateSubcategory}
        mode={showCreateSubcategory ? "subcategory" : "category"}
        editing={showCreateSubcategory ? editingSubcategory : editingCategory}
        activeCategory={activeCategory}
        addCategoryMut={addCategoryMut}
        updateCategoryMut={updateCategoryMut}
        addSubcatMut={addSubcatMut}
        updateSubcatMut={updateSubcatMut}
        onClose={() => {
          setShowCreateCategory(false);
          setShowCreateSubcategory(false);
          setEditingCategory(null);
          setEditingSubcategory(null);
        }}
      />

      <GroupDrawer
        open={showManageGroup}
        editing={editingGroup}
        component={editingComponent}
        menus={menus}
        saveGroupMut={saveGroupMut}
        deleteGroupMut={deleteGroupMut}
        askConfirm={askConfirm}
        handleDeleteGroup={handleDeleteGroup}
        setCustomCreatedGroups={setCustomCreatedGroups}
        onClose={() => {
          setShowManageGroup(false);
          setEditingGroup(null);
          setEditingComponent(null);
        }}
      />

      <CsvPreviewModal
        data={csvPreviewData}
        pendingText={csvPendingText}
        invalidate={invalidate}
        onClose={() => {
          setCsvPreviewData(null);
          setCsvPendingText("");
        }}
      />

      <ViewProductModal
        product={viewingProduct}
        onClose={() => setViewingProduct(null)}
        onEdit={(item) => {
          setViewingProduct(null);
          openProductDrawer(item);
        }}
      />

      <ProductDrawer
        open={showCreateProduct}
        editing={editingProduct}
        activeCategory={activeCategory}
        activeSubcategory={activeSubcategory}
        groupsList={groupsList}
        allGroupsMap={allGroupsMap}
        addDishMut={addDishMut}
        updateDishMut={updateDishMut}
        onClose={() => {
          setShowCreateProduct(false);
          setEditingProduct(null);
        }}
      />

      <BulkGroupPickerModal
        mode={bulkGroupPickerMode}
        picked={bulkPickedGroups}
        setPicked={setBulkPickedGroups}
        groups={groupsList}
        selectedCount={selectedIds.size}
        pending={bulkAddGroupMut.isPending || bulkRemoveGroupMut.isPending}
        onClose={() => {
          setBulkGroupPickerMode(null);
          setBulkPickedGroups(new Set());
        }}
        onApply={applyBulkGroupPicker}
      />

      <ConfirmDialog state={confirmState} onClose={closeConfirm} />
    </div>
  );
};

export default ManageMenu;
