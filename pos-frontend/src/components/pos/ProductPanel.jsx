import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { enqueueSnackbar } from "notistack";
import { getMenus, getPopularItems } from "../../https";
import { addItems } from "../../redux/slices/cartSlice";

/* ---------- Reference tile palette ---------- */
const TILE_COLORS = [
  "#F97316", "#F97316", "#F97316", "#F4511E", "#EF4444",
  "#2563EB", "#2563EB", "#2563EB", "#2563EB", "#2563EB",
  "#F0A020", "#F0A020", "#16A34A", "#16A34A", "#16A34A",
  "#5B21B6", "#5B21B6", "#5B21B6", "#5B21B6",
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
const activePrice = (item) => {
  if (!item?.priceRules?.length) return item?.price;
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
  return rule ? rule.price : item?.price;
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

  const [view, setView] = useState("grid");
  const [q, setQ] = useState("");
  const [catId, setCatId] = useState(null);
  const [subcat, setSubcat] = useState(null);

  const { data: menusRes, isLoading } = useQuery({
    queryKey: ["menus", "system"],
    queryFn: () => getMenus({ source: "system" }),
  });


  const menus = useMemo(() => {
    const all = menusRes?.data?.data || [];
    return all.filter((m) => m.published !== false && inSchedule(m.schedule));
  }, [menusRes]);

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
      .filter((i) => inSchedule(i.schedule))
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
          .filter((i) => inSchedule(i.schedule))
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
    () => (popRes?.data?.data || []).filter((i) => inSchedule(i.schedule)),
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
  const add = (item) => {
    if (item.isAvailable === false) {
      enqueueSnackbar(`${item.name} is out of stock`, { variant: "error" });
      return;
    }
    for (const g of item.modifierGroups || []) {
      if (g.required) {
        enqueueSnackbar(`${item.name} requires "${g.name}" — open the product to select it.`, { variant: "warning" });
        return;
      }
    }
    // Multi-variant products need an explicit selection to avoid silently
    // charging the wrong price. Single-variant products fall through to the
    // default (variants[0]) which is unambiguous.
    if ((item.variants || []).length > 1) {
      enqueueSnackbar(`${item.name} has multiple sizes — open the product to choose one.`, { variant: "warning" });
      return;
    }

    let price = activePrice(item);
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
            className="w-full h-[40px] pl-10 pr-9 rounded-xl border border-[#E2E8F0] bg-white text-[13.5px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#5B42F3]"
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
          className="h-[40px] px-3.5 rounded-xl border border-[#5B42F3] text-[#5B42F3] bg-white text-[13px] font-bold flex items-center gap-1.5 hover:bg-[#EEF0FE] transition-colors"
        >
          <IconPlus size={14} /> Add Category
        </button>

        <button
          onClick={onAddProduct}
          className="h-[40px] px-3.5 rounded-xl bg-[#5B42F3] text-white text-[13px] font-bold flex items-center gap-1.5 hover:bg-[#4A32E0] transition-colors"
        >
          <IconPlus size={14} /> Add Product
        </button>

        <div className="ml-auto flex items-center rounded-xl border border-[#E2E8F0] overflow-hidden h-[40px]">
          <button
            onClick={() => setView("grid")}
            className={`w-[40px] h-full flex items-center justify-center transition-colors ${
              view === "grid" ? "bg-[#5B42F3] text-white" : "bg-white text-[#94A3B8] hover:text-[#0F172A]"
            }`}
            title="Grid view"
          >
            <IconGrid />
          </button>
          <button
            onClick={() => setView("list")}
            className={`w-[40px] h-full flex items-center justify-center border-l border-[#E2E8F0] transition-colors ${
              view === "list" ? "bg-[#5B42F3] text-white" : "bg-white text-[#94A3B8] hover:text-[#0F172A]"
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
              className="h-[38px] px-3.5 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-[#475569] text-[12.5px] font-bold flex items-center gap-1 hover:border-[#5B42F3] hover:text-[#5B42F3] transition-colors"
            >
              <IconPlus size={13} /> Add Category
            </button>
          </div>

          {category && (
            <div className="mt-2.5 flex items-center gap-1.5 text-[12px]">
              <button onClick={() => setCatId(null)} className="text-[#94A3B8] font-semibold hover:text-[#5B42F3]">
                All Categories
              </button>
              <span className="text-[#CBD5E1]"><IconChevron /></span>
              <button
                onClick={() => setSubcat(null)}
                className={`font-bold ${subcat ? "text-[#94A3B8] hover:text-[#5B42F3]" : "text-[#5B42F3]"}`}
              >
                {category.name}
              </button>
              {subcat && (
                <>
                  <span className="text-[#CBD5E1]"><IconChevron /></span>
                  <span className="font-bold text-[#5B42F3]">{subcat}</span>
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
            className="text-[12.5px] font-bold text-[#5B42F3] underline underline-offset-2"
          >
            View All
          </button>
        )}
        {subcat && (
          <button
            onClick={() => setSubcat(null)}
            className="text-[12.5px] font-bold text-[#5B42F3] underline underline-offset-2"
          >
            Back to {category.name}
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="w-9 h-9 rounded-full border-[3px] border-[#5B42F3] border-t-transparent animate-spin" />
          </div>
        ) : menus.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[15px] font-bold text-[#0F172A]">No categories yet</p>
            <p className="text-[13px] text-[#94A3B8] mt-1">Create your first category to start adding products.</p>
            <button onClick={onAddCategory} className="mt-4 h-[42px] px-5 rounded-xl bg-[#5B42F3] text-white text-[14px] font-bold">
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
                  className="text-left p-4 rounded-xl border border-[#E2E8F0] bg-white hover:border-[#5B42F3] hover:shadow-md transition-all"
                >
                  <p className="text-[15px] font-extrabold text-[#0F172A]">{s}</p>
                  <p className="text-[12px] text-[#94A3B8] mt-1">{n} items</p>
                </button>
              );
            })}
          </div>
        ) : popLoading && showPopular ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 rounded-full border-[3px] border-[#5B42F3] border-t-transparent animate-spin" />
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
                : activePrice(item);
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
                      : "hover:border-[#5B42F3] hover:shadow-md active:scale-[0.98]"
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
              const price = item.variants?.length ? item.variants[0].price : activePrice(item);
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
                      : "hover:border-[#5B42F3] hover:shadow-sm active:scale-[0.99]"
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
    </div>
  );
};

export default ProductPanel;
