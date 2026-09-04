import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { enqueueSnackbar } from "notistack";
import { getMenus, getPopularItems } from "../../https";
import { addItems } from "../../redux/slices/cartSlice";
import { ModalShell } from "./ModalShell";

/* ---------- Reference tile palette ---------- */
const TILE_COLORS = [
  "#F97316", "#F97316", "#F97316", "#F4511E", "#EF4444",
  "#2563EB", "#2563EB", "#2563EB", "#2563EB", "#2563EB",
  "#F0A020", "#F0A020", "#16A34A", "#16A34A", "#16A34A",
  "#9A3412", "#9A3412", "#9A3412", "#9A3412",
];

/* ---------- Schedule + pricing helpers (business logic preserved) ---------- */
const nowMins = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const parseT = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};
const inSchedule = (s) => {
  if (!s?.enabled) return true;
  const n = nowMins();
  const a = parseT(s.startTime);
  const b = parseT(s.endTime);
  if (a === null || b === null) return true;
  const days = s.daysOfWeek || [];
  if (!days.includes(new Date().getDay())) return false;
  return a <= b ? n >= a && n <= b : n >= a || n <= b;
};
/**
 * The product's list price for the till's current order type.
 *
 * "Same price for all channels" OFF stores posCollection / posDelivery /
 * posTable on the product; the POS used to ignore them and always show
 * item.price, so the operator saw one figure and the bill used another.
 */
const CHANNEL_KEY = { Delivery: "posDelivery", "Table Service": "posTable", Collection: "posCollection" };

const channelPrice = (item, orderType) => {
  const base = item?.price;
  if (!item || item.samePrice !== false || !item.channelPrices) return base;
  const value = Number(item.channelPrices[CHANNEL_KEY[orderType] || "posCollection"]);
  return Number.isFinite(value) && value > 0 ? value : base;
};

const activePrice = (item, orderType) => {
  const listPrice = channelPrice(item, orderType);
  if (!item?.priceRules?.length) return listPrice;
  const n = nowMins();
  const today = new Date().getDay();
  const rule = item.priceRules.find((r) => {
    if (!r.isActive) return false;
    if (!(r.daysOfWeek || []).includes(today)) return false;
    const a = parseT(r.startTime);
    const b = parseT(r.endTime);
    if (a === null || b === null) return true;
    return a <= b ? n >= a && n <= b : n >= a || n <= b;
  });
  return rule ? rule.price : listPrice;
};

/* ---------- Icons ---------- */
const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
const IconPlus = ({ size = 16, w = 2.4 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconGrid = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const IconList = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);
const IconChevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

/* ---------- Veg / Non-veg square marker ---------- */
const DietMark = ({ veg }) => (
  <span
    className="absolute top-1.5 left-1.5 w-[14px] h-[14px] rounded-[3px] bg-white border-[1.5px] flex items-center justify-center shadow-sm"
    style={{ borderColor: veg ? "#16A34A" : "#DC2626" }}
    title={veg ? "Vegetarian" : "Non-Vegetarian"}
  >
    <span
      className="w-[6px] h-[6px] rounded-full"
      style={{ background: veg ? "#16A34A" : "#DC2626" }}
    />
  </span>
);

/**
 * POS main ordering surface (§1, §3).
 *
 * Design contract enforced by this file — do not casually break these:
 *   - No "Products" H1 header (§1)
 *   - Top toolbar shows ONLY: Search, Add Category, Add Product, view toggle (§1)
 *   - Category chips do NOT expose a delete button (§1). Menu editing lives
 *     under Settings → Manage Menu.
 *   - Product cards show ONLY veg-mark, image, name, price (§3). No plus
 *     button, no metadata, no controls.
 *   - The ENTIRE product card is a click target for add-to-cart (§3).
 *   - Products with required variants/modifiers still go through the existing
 *     required-selection flow — we surface a snackbar prompting the operator
 *     to open the item to complete the mandatory choices. (The full modifier
 *     modal lives in AddProductModal; this panel intentionally does not
 *     re-implement it.)
 */
const ProductPanel = ({ onAddCategory, onAddProduct }) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const cart = useSelector((s) => s.cart);
  // "Collection" | "Delivery" | "Table Service" — drives Dispatch Type filtering below.
  const orderType = useSelector((s) => s.orderType.orderType);

  const [view, setView] = useState("grid");
  const [q, setQ] = useState("");
  const [catId, setCatId] = useState(null);
  const [subcat, setSubcat] = useState(null);

  // POS Product Customization Modal (Module 8)
  const [customizingItem, setCustomizingItem] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [selectedModifiers, setSelectedModifiers] = useState({});

  const { data: menusRes, isLoading } = useQuery({
    queryKey: ["menus", "system"],
    queryFn: () => getMenus({ source: "system" }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });


  // Dispatch Type maps the POS order type onto the category's own flags.
  // Absent or all-off means "no restriction", so categories created before
  // this behave exactly as they always did.
  const dispatchKeyFor = (type) =>
    type === "Delivery" ? "delivery" : type === "Table Service" ? "table" : "collection";

  const allowsOrderType = (menu, type) => {
    const dt = menu?.dispatchType;
    if (!dt) return true;
    if (!dt.collection && !dt.delivery && !dt.table) return true;
    return dt[dispatchKeyFor(type)] !== false;
  };

  const menus = useMemo(() => {
    const all = menusRes?.data?.data || [];
    return all.filter(
      (m) =>
        // Display Status ON, or hidden everywhere EXCEPT the POS.
        (m.published !== false || m.showOnPos === true) &&
        allowsOrderType(m, orderType) &&
        inSchedule(m.schedule),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menusRes, orderType]);

  useEffect(() => {
    const id = location.state?.selectedCategoryId;
    if (id && menus.some((m) => m._id === id)) {
      setCatId(id);
      setSubcat(null);
    }
  }, [location.state, menus]);

  const category = catId ? menus.find((m) => m._id === catId) : null;

  const categoryItems = useMemo(() => {
    if (!category?.items) return [];
    return category.items
      // Hide out-of-stock items on POS (Module: Availability §Hide OOS)
      .filter((i) => i && (i.isAvailable !== false || i.visibleOnPosWhenOff === true) && inSchedule(i.schedule))
      .map((i) => ({ ...i, categoryId: category._id, categoryName: category.name }));
  }, [category]);

  const subcats = useMemo(() => {
    const seen = new Set();
    const out = [];
    categoryItems.forEach((i) => {
      const s = (i.subcategory || "").trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    });
    return out;
  }, [categoryItems]);

  const hasSubcats = subcats.length > 0;

  useEffect(() => {
    setSubcat(null);
  }, [catId]);

  const allItems = useMemo(
    () =>
      menus.flatMap((m) =>
        (m.items || [])
          // Hide out-of-stock items across search + all lists
          .filter((i) => i && (i.isAvailable !== false || i.visibleOnPosWhenOff === true) && inSchedule(i.schedule))
          .map((i) => ({ ...i, categoryId: m._id, categoryName: m.name }))
      ),
    [menus]
  );

  const searching = q.trim().length > 0;
  const searchResults = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return allItems.filter(
      (i) =>
        i.name?.toLowerCase().includes(s) ||
        i.categoryName?.toLowerCase().includes(s) ||
        (i.subcategory || "").toLowerCase().includes(s)
    );
  }, [q, allItems]);

  const showPopular = !searching && !category;
  const { data: popRes, isLoading: popLoading } = useQuery({
    queryKey: ["popular-items"],
    queryFn: () => getPopularItems({ limit: 12, days: 30 }),
    enabled: showPopular,
    staleTime: 60_000,
  });
  const popular = useMemo(
    () =>
      (popRes?.data?.data || []).filter(
        (i) => i && (i.isAvailable !== false || i.visibleOnPosWhenOff === true) && inSchedule(i.schedule),
      ),
    [popRes]
  );

  const catProducts = useMemo(() => {
    if (!category) return [];
    if (hasSubcats && !subcat) return [];
    return categoryItems.filter((i) =>
      !subcat ? true : (i.subcategory || "").trim().toLowerCase() === subcat.trim().toLowerCase()
    );
  }, [category, hasSubcats, subcat, categoryItems]);

  const products = searching ? searchResults : showPopular ? popular : catProducts;

  /**
   * Click-to-add (§3).
   *
   * If the product declares required modifier groups OR multiple variants,
   * the operator must open the full product modal to make the mandatory
   * choice (we surface a snackbar directing them to do that, so a cheapest-
   * variant-picked-silently bug can't happen at the counter).
   *
   * Simple products with no required choices go straight into the cart.
   */
  const openCustomization = (item) => {
    setCustomizingItem(item);
    if (item.variants?.length) setSelectedVariantId(item.variants[0]._id || item.variants[0].id || item.variants[0].name);
    else setSelectedVariantId(null);
    setSelectedModifiers({});
  };

  /**
   * Modifier selection model.
   *
   * Historically `selectedModifiers[groupName]` was a `string[]` of option
   * ids — i.e. every option was either "selected once" or "not selected".
   * That meant an operator could NOT ask for "2 × Tomato + 1 × Onion" from
   * a Toppings group, and it also made deselecting a radio-style pick
   * clunky (radios can't be untoggled by clicking).
   *
   * We now use `{ [groupName]: { [optionId]: qty } }`. Any entry with
   * qty > 0 counts as selected; qty of 0 (or missing key) means unselected.
   * `maxSelections` is enforced on the SUM of quantities within a group so
   * a "max 3" Toppings group can be filled by 2 Tomato + 1 Onion, or by
   * 3 Tomato, etc.
   */
  const setPosModifierQty = (group, optionId, delta) => {
    setSelectedModifiers((prev) => {
      const groupMap = { ...(prev[group.name] || {}) };
      const current = Number(groupMap[optionId] || 0);
      const nextForOption = Math.max(0, current + delta);

      // Enforce group-level maxSelections when INCREASING (a decrement can
      // never violate the cap).
      if (delta > 0) {
        const max = Math.max(1, Number(group.maxSelections) || 1);
        const totalForGroup = Object.values(groupMap).reduce(
          (s, q) => s + (Number(q) || 0),
          0,
        );
        if (totalForGroup + 1 > max) {
          // Silently cap — snackbar would spam the operator on rapid taps.
          return prev;
        }
      }

      if (nextForOption === 0) {
        delete groupMap[optionId];
      } else {
        groupMap[optionId] = nextForOption;
      }

      return { ...prev, [group.name]: groupMap };
    });
  };

  const clearPosModifierGroup = (groupName) => {
    setSelectedModifiers((prev) => {
      const next = { ...prev };
      delete next[groupName];
      return next;
    });
  };

  const calculatedPosUnitPrice = useMemo(() => {
    if (!customizingItem) return 0;
    let basePrice = activePrice(customizingItem, orderType);
    if (customizingItem.variants?.length) {
      const v = customizingItem.variants.find((v) => String(v._id || v.id || v.name) === selectedVariantId);
      if (v) basePrice = v.price;
    }
    let extras = 0;
    for (const group of customizingItem.modifierGroups || []) {
      const chosenMap = selectedModifiers[group.name] || {};
      (group.options || []).forEach((opt) => {
        const optId = String(opt._id || opt.id || opt.name);
        const qty = Number(chosenMap[optId] || 0);
        if (qty > 0) {
          extras += Number(opt.price || 0) * qty;
        }
      });
    }
    return basePrice + extras;
  }, [customizingItem, selectedVariantId, selectedModifiers]);

  const handlePosCustomizedAdd = () => {
    if (!customizingItem) return;
    for (const group of customizingItem.modifierGroups || []) {
      const chosenMap = selectedModifiers[group.name] || {};
      const totalQty = Object.values(chosenMap).reduce(
        (s, q) => s + (Number(q) || 0),
        0,
      );
      if (group.required && totalQty === 0) {
        enqueueSnackbar(`Please select an option for "${group.name}".`, { variant: "warning" });
        return;
      }
    }

    let basePrice = activePrice(customizingItem, orderType);
    let variantObj = null;
    if (customizingItem.variants?.length) {
      variantObj = customizingItem.variants.find((v) => String(v._id || v.id || v.name) === selectedVariantId) || customizingItem.variants[0];
      basePrice = variantObj.price;
    }

    const selectedList = [];
    let extraCost = 0;

    for (const group of customizingItem.modifierGroups || []) {
      const chosenMap = selectedModifiers[group.name] || {};
      (group.options || []).forEach((opt) => {
        const optId = String(opt._id || opt.id || opt.name);
        const qty = Number(chosenMap[optId] || 0);
        if (qty > 0) {
          const lineTotal = Number(opt.price || 0) * qty;
          extraCost += lineTotal;
          selectedList.push({
            groupId: group._id,
            groupName: group.name,
            optionId: opt._id,
            optionName: opt.name,
            quantity: qty,
            price: Number(opt.price || 0),
          });
        }
      });
    }

    const finalUnitPrice = basePrice + extraCost;
    const optionNamesStr = selectedList
      .map((s) => (s.quantity > 1 ? `${s.quantity}× ${s.optionName}` : s.optionName))
      .join(", ");
    const displayName = `${customizingItem.name}${variantObj ? ` (${variantObj.name})` : ""}${optionNamesStr ? ` (+ ${optionNamesStr})` : ""}`;

    dispatch(
      addItems({
        id: Date.now() + Math.random(),
        menuItemId: customizingItem._id,
        variantId: variantObj?._id || null,
        addonIds: [],
        modifierSelections: selectedList,
        name: displayName,
        pricePerQuantity: Number(finalUnitPrice),
        quantity: 1,
        price: Number(finalUnitPrice),
        addons: [],
        modifiers: selectedList,
        variant: variantObj ? { name: variantObj.name, price: variantObj.price } : null,
        isCombo: customizingItem.isCombo || false,
      })
    );

    enqueueSnackbar(`Added ${displayName} to order`, { variant: "success" });
    setCustomizingItem(null);
  };

  const add = (item) => {
    if (item.isAvailable === false) {
      enqueueSnackbar(`${item.name} is out of stock`, { variant: "error" });
      return;
    }
    if ((item.modifierGroups || []).length > 0 || (item.variants || []).length > 1) {
      openCustomization(item);
      return;
    }

    let price = activePrice(item, orderType);
    let label = "";
    let variant = null;
    if ((item.variants || []).length === 1) {
      variant = item.variants[0];
      price = variant.price;
      label = ` (${variant.name})`;
    }
    dispatch(
      addItems({
        id: Date.now() + Math.random(),
        menuItemId: item._id,
        variantId: variant?._id || null,
        addonIds: [],
        modifierSelections: {},
        name: `${item.name}${label}`,
        pricePerQuantity: Number(price || 0),
        quantity: 1,
        price: Number(price || 0),
        addons: [],
        modifiers: [],
        variant: variant ? { name: variant.name, price: variant.price } : null,
        isCombo: item.isCombo || false,
      })
    );
  };

  const heading = searching
    ? `Search Results (${searchResults.length})`
    : showPopular
    ? "Popular Items"
    : hasSubcats && !subcat
    ? `${category.name} · Subcategories`
    : subcat
    ? `${category.name} · ${subcat}`
    : category?.name || "";

  return (
    <div className="flex-1 min-w-0 h-full flex flex-col bg-white">
      {/*
        §1: Top toolbar only. NO "Products" heading. Only:
          - Search
          - Add Category
          - Add Product
          - Grid / List toggle
      */}
      <div className="px-5 pt-4 pb-3 shrink-0 flex items-center gap-2.5">
        <div className="relative flex-1 max-w-[440px]">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]">
            <IconSearch />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search product or category..."
            className="w-full h-[40px] pl-10 pr-9 rounded-xl border border-[#E2E8F0] bg-white text-[13.5px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#FD5302]"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#EF4444] text-lg leading-none"
            >
              ×
            </button>
          )}
        </div>

        <button
          onClick={onAddCategory}
          className="h-[40px] px-3.5 rounded-xl border border-[#FD5302] text-[#C2410C] bg-white text-[13px] font-bold flex items-center gap-1.5 hover:bg-[#FFF1E8] transition-colors"
        >
          <IconPlus size={14} /> Add Category
        </button>

        <button
          onClick={onAddProduct}
          className="h-[40px] px-3.5 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold flex items-center gap-1.5 hover:bg-[#D64502] transition-colors"
        >
          <IconPlus size={14} /> Add Product
        </button>

        <div className="ml-auto flex items-center rounded-xl border border-[#E2E8F0] overflow-hidden h-[40px]">
          <button
            onClick={() => setView("grid")}
            className={`w-[40px] h-full flex items-center justify-center transition-colors ${
              view === "grid" ? "bg-[#FD5302] text-white" : "bg-white text-[#94A3B8] hover:text-[#0F172A]"
            }`}
            title="Grid view"
          >
            <IconGrid />
          </button>
          <button
            onClick={() => setView("list")}
            className={`w-[40px] h-full flex items-center justify-center border-l border-[#E2E8F0] transition-colors ${
              view === "list" ? "bg-[#FD5302] text-white" : "bg-white text-[#94A3B8] hover:text-[#0F172A]"
            }`}
            title="List view"
          >
            <IconList />
          </button>
        </div>
      </div>

      {/*
        §1: Category chips.
        - NO delete "×" button.
        - Add-Category tile at the end remains so the operator has a fast
          in-context add.
      */}
      {!searching && (
        <div className="px-5 pb-3 shrink-0">
          <div className="flex flex-wrap gap-1.5 max-h-[132px] overflow-y-auto no-scrollbar">
            {menus.map((m, i) => {
              const on = category?._id === m._id;
              return (
                <button
                  key={m._id}
                  onClick={() => setCatId(on ? null : m._id)}
                  style={{ background: TILE_COLORS[i % TILE_COLORS.length] }}
                  className={`h-[38px] px-3.5 rounded-lg text-white text-[12.5px] font-bold leading-tight max-w-[220px] truncate transition-all ${
                    on ? "ring-[3px] ring-[#0F172A]/25 shadow-md scale-[1.02]" : "hover:brightness-110"
                  }`}
                  title={m.name}
                >
                  {m.name}
                </button>
              );
            })}

            <button
              onClick={onAddCategory}
              className="h-[38px] px-3.5 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-[#475569] text-[12.5px] font-bold flex items-center gap-1 hover:border-[#FD5302] hover:text-[#C2410C] transition-colors"
            >
              <IconPlus size={13} /> Add Category
            </button>
          </div>

          {category && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
              <button onClick={() => setCatId(null)} className="text-[#94A3B8] font-semibold hover:text-[#C2410C]">
                All Categories
              </button>
              <span className="text-[#CBD5E1]"><IconChevron /></span>
              <button
                onClick={() => setSubcat(null)}
                className={`font-bold ${subcat ? "text-[#94A3B8] hover:text-[#C2410C]" : "text-[#C2410C]"}`}
              >
                {category.name}
              </button>
              {subcat && (
                <>
                  <span className="text-[#CBD5E1]"><IconChevron /></span>
                  <span className="font-bold text-[#C2410C]">{subcat}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Section heading (the ONLY heading on this screen). */}
      <div className="px-5 pb-2 shrink-0 flex items-center justify-between">
        <h2 className="text-[16px] font-extrabold text-[#0F172A]">{heading}</h2>
        {showPopular && menus.length > 0 && (
          <button
            onClick={() => setCatId(menus[0]._id)}
            className="text-[12.5px] font-bold text-[#C2410C] underline underline-offset-2"
          >
            View All
          </button>
        )}
        {subcat && (
          <button
            onClick={() => setSubcat(null)}
            className="text-[12.5px] font-bold text-[#C2410C] underline underline-offset-2"
          >
            Back to {category.name}
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-9 h-9 rounded-full border-[3px] border-[#FD5302] border-t-transparent animate-spin" />
          </div>
        ) : menus.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[15px] font-bold text-[#0F172A]">No categories yet</p>
            <p className="text-[13px] text-[#94A3B8] mt-1">Create your first category to start adding products.</p>
            <button onClick={onAddCategory} className="mt-4 h-[42px] px-5 rounded-xl bg-[#FD5302] text-white text-[14px] font-bold">
              Add Category
            </button>
          </div>
        ) : !searching && category && hasSubcats && !subcat ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {subcats.map((s) => {
              const n = categoryItems.filter(
                (i) => (i.subcategory || "").trim().toLowerCase() === s.toLowerCase()
              ).length;
              return (
                <button
                  key={s}
                  onClick={() => setSubcat(s)}
                  className="text-left p-4 rounded-xl border border-[#E2E8F0] bg-white hover:border-[#FD5302] hover:shadow-md transition-all"
                >
                  <p className="text-[15px] font-extrabold text-[#0F172A]">{s}</p>
                  <p className="text-[12px] text-[#94A3B8] mt-1">{n} items</p>
                </button>
              );
            })}
          </div>
        ) : popLoading && showPopular ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 rounded-full border-[3px] border-[#FD5302] border-t-transparent animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-16 text-[14px] text-[#94A3B8]">
            {searching
              ? "No products match your search."
              : showPopular
              ? "No popular items yet — pick a category above."
              : "No products in this section."}
          </div>
        ) : view === "grid" ? (
          /*
            §3 + §46: Compact product grid.
            - MORE columns on wider screens (up to 7) so more products are visible.
            - Card content: veg-mark + image + name + price ONLY.
            - Whole card is a click target (button element).
            - Touch target height stays >= 128px which is comfortable on 10"
              touchscreen POS displays (§47).
          */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2.5">
            {products.map((item) => {
              const img = item.imageThumbnailUrl || item.imageUrl || item.image;
              const price = item.variants?.length
                ? item.variants[0].price
                : activePrice(item, orderType);
              const inCart = cart.find((c) => c.menuItemId === item._id);
              const off = item.isAvailable === false;
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => add(item)}
                  disabled={off}
                  aria-label={`Add ${item.name} to cart`}
                  className={`group text-left rounded-xl border border-[#E2E8F0] bg-white overflow-hidden transition-all ${
                    off
                      ? "opacity-55 cursor-not-allowed"
                      : "hover:border-[#FD5302] hover:shadow-md active:scale-[0.98]"
                  }`}
                >
                  {/* Image with veg mark overlay (top-left) */}
                  <div className="relative w-full aspect-[4/3] bg-[#F1F5F9]">
                    {img ? (
                      <img src={img} alt={item.name} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-2xl">🍽️</span>
                    )}
                    <DietMark veg={item.isVegetarian !== false} />
                    {inCart && (
                      <span className="absolute top-1.5 right-1.5 min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#16A34A] text-white text-[10.5px] font-extrabold flex items-center justify-center shadow">
                        {inCart.quantity}
                      </span>
                    )}
                  </div>

                  {/* Name + price */}
                  <div className="px-2.5 py-2">
                    <p className="text-[12.5px] font-bold text-[#0F172A] leading-tight line-clamp-2 min-h-[32px]">
                      {item.name}
                    </p>
                    <p className="text-[14px] font-extrabold text-[#0F172A] mt-1">
                      ₹{Number(price || 0).toFixed(0)}
                    </p>
                    {off && (
                      <p className="text-[10px] font-bold text-[#DC2626] mt-0.5">Out of stock</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* List view — same click-to-add contract as grid */
          <div className="space-y-2">
            {products.map((item) => {
              const img = item.imageThumbnailUrl || item.imageUrl || item.image;
              const price = item.variants?.length ? item.variants[0].price : activePrice(item, orderType);
              const off = item.isAvailable === false;
              const inCart = cart.find((c) => c.menuItemId === item._id);
              return (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => add(item)}
                  disabled={off}
                  className={`w-full text-left flex items-center gap-3 p-2.5 rounded-xl border border-[#E2E8F0] bg-white transition-all ${
                    off
                      ? "opacity-55 cursor-not-allowed"
                      : "hover:border-[#FD5302] hover:shadow-sm active:scale-[0.99]"
                  }`}
                >
                  <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-[#F1F5F9] shrink-0 flex items-center justify-center">
                    {img ? <img src={img} alt={item.name} className="w-full h-full object-cover" /> : "🍽️"}
                    <DietMark veg={item.isVegetarian !== false} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-bold text-[#0F172A] truncate">{item.name}</p>
                    <p className="text-[11.5px] text-[#94A3B8] truncate">
                      {item.categoryName || item.category}
                      {item.subcategory ? ` · ${item.subcategory}` : ""}
                    </p>
                  </div>
                  <span className="text-[14px] font-extrabold text-[#0F172A] shrink-0">
                    ₹{Number(price || 0).toFixed(0)}
                  </span>
                  {inCart && (
                    <span className="min-w-[22px] h-[22px] px-2 rounded-full bg-[#16A34A] text-white text-[11px] font-extrabold flex items-center justify-center shrink-0">
                      {inCart.quantity}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* POS Product Customization Modal (Module 8) */}
      {customizingItem && (
        <ModalShell
          title={`Customize ${customizingItem.name}`}
          onClose={() => setCustomizingItem(null)}
          width={480}
        >
          <div className="space-y-4 text-[#0F172A]">
            {/* Variants selection */}
            {customizingItem.variants?.length > 1 && (
              <div className="space-y-2">
                <label className="text-[12px] font-extrabold text-[#334155]">Select Size / Variant</label>
                <div className="grid grid-cols-2 gap-2">
                  {customizingItem.variants.map((v) => (
                    <button
                      key={v._id || v.id || v.name}
                      type="button"
                      onClick={() => setSelectedVariantId(v._id || v.id || v.name)}
                      className={`p-2.5 rounded-xl border text-[12.5px] font-bold text-left transition-all ${
                        selectedVariantId === (v._id || v.id || v.name)
                          ? "border-[#FD5302] bg-[#FFF1E8] text-[#C2410C]"
                          : "border-[#E2E8F0] hover:bg-[#F8FAFC]"
                      }`}
                    >
                      <div>{v.name}</div>
                      <div className="text-[13px] font-extrabold">₹{v.price}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/*
              Modifier Groups / Components selection.

              §UI-Redesign: components are now shown as compact chip-style
              cards in a responsive grid so a group with many options fits
              on one screen without scrolling. Each chip shows ONLY the
              component name and its price. Tapping a chip toggles the
              selection (adds it with qty 1, or removes it). The visible
              `− 0 +` stepper has been removed per operator feedback — it
              was fiddly for touch input and confused the biller when the
              menu declares single-choice groups (max 1). The underlying
              `setPosModifierQty` logic that supports multi-quantity in
              certain groups is still available programmatically, but the
              day-to-day UI is now a clean tap-to-toggle picker.
            */}
            {(customizingItem.modifierGroups || []).map((group, index) => {
              const groupMap = selectedModifiers[group.name] || {};
              const groupTotalQty = Object.values(groupMap).reduce(
                (s, q) => s + (Number(q) || 0),
                0,
              );
              const groupMax = Math.max(1, Number(group.maxSelections) || 1);
              const singleChoice = groupMax === 1;

              const toggleOption = (opt, optId, currentlyChosen) => {
                if (currentlyChosen) {
                  // Tap-again deselects. Zero-out the option so it doesn't
                  // count toward the group total any more.
                  const currentQty = Number(groupMap[optId] || 0);
                  if (currentQty > 0) setPosModifierQty(group, optId, -currentQty);
                  return;
                }
                if (singleChoice) {
                  // Radio behaviour — clear any previous pick in this group
                  // before adding the new one, so the switch is atomic.
                  clearPosModifierGroup(group.name);
                }
                setPosModifierQty(group, optId, +1);
              };

              return (
                <div key={group?._id || group?.name || index} className="space-y-2 pt-3 border-t border-[#E2E8F0]">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] font-extrabold text-[#0F172A] truncate">{group?.name || "Group"}</span>
                      <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1E8] text-[#C2410C] shrink-0">
                        {groupTotalQty} / {groupMax}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-bold text-[#64748B]">
                        {group?.required ? "(Required)" : "(Optional)"}
                      </span>
                      {groupTotalQty > 0 && (
                        <button
                          type="button"
                          onClick={() => clearPosModifierGroup(group?.name || group)}
                          className="text-[11px] font-bold text-[#DC2626] hover:underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Compact chip grid. Auto-fills 2 columns on very
                      narrow modals and 3 columns above ~360px so 6+
                      components fit without scrolling. */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {(group?.options || []).map((opt) => {
                      const optId = String(opt?._id || opt?.id || opt?.name || "");
                      const qty = Number(groupMap[optId] || 0);
                      const chosen = qty > 0;
                      // `atCap` only blocks NEW picks; a chosen chip can
                      // always be tapped to deselect even at the cap.
                      const atCap = groupTotalQty >= groupMax && !chosen;

                      return (
                        <button
                          key={optId}
                          type="button"
                          onClick={() => toggleOption(opt, optId, chosen)}
                          disabled={atCap}
                          aria-pressed={chosen}
                          className={`h-[52px] px-2.5 rounded-xl border text-left transition-all flex flex-col justify-center min-w-0 ${
                            chosen
                              ? "border-[#FD5302] bg-[#FFF1E8] shadow-sm"
                              : "border-[#E2E8F0] bg-white hover:border-[#FD5302] hover:bg-[#F8FAFC]"
                          } ${atCap ? "opacity-50 cursor-not-allowed" : ""}`}
                          title={opt?.name || ""}
                        >
                          <span
                            className={`text-[12.5px] font-extrabold leading-tight truncate ${
                              chosen ? "text-[#C2410C]" : "text-[#0F172A]"
                            }`}
                          >
                            {opt?.name || ""}
                          </span>
                          <span
                            className={`text-[11.5px] font-bold leading-tight mt-0.5 ${
                              chosen ? "text-[#C2410C]" : "text-[#475569]"
                            }`}
                          >
                            ₹{opt.price}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Total calculation & Add to Cart button */}
            <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-[#64748B]">Unit Price</span>
                <p className="text-[18px] font-extrabold text-[#0F172A]">₹{calculatedPosUnitPrice}</p>
              </div>
              <button
                type="button"
                onClick={handlePosCustomizedAdd}
                className="h-[42px] px-6 rounded-xl bg-[#FD5302] text-white text-[13.5px] font-extrabold shadow-md hover:bg-[#D64502]"
              >
                Add to Cart
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

export default ProductPanel;
