import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { enqueueSnackbar } from "notistack";
import { getMenus, getPopularItems } from "../../https";
import { addItems } from "../../redux/slices/cartSlice";

/* ---------- Reference tile palette (exact colors from the screenshot) ---------- */
const TILE_COLORS = [
  "#F97316", // orange
  "#F97316",
  "#F97316",
  "#F4511E", // deep orange
  "#EF4444", // red
  "#2563EB", // blue
  "#2563EB",
  "#2563EB",
  "#2563EB",
  "#2563EB",
  "#F0A020", // amber
  "#F0A020",
  "#16A34A", // green
  "#16A34A",
  "#16A34A",
  "#5B21B6", // violet
  "#5B21B6",
  "#5B21B6",
  "#5B21B6",
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

/* ---------- Veg / Non-veg square marker (exact reference style) ---------- */
const DietMark = ({ veg }) => (
  <span
    className="absolute top-2 right-2 w-[15px] h-[15px] rounded-[3px] bg-white border-[1.5px] flex items-center justify-center"
    style={{ borderColor: veg ? "#16A34A" : "#DC2626" }}
    title={veg ? "Vegetarian" : "Non-Vegetarian"}
  >
    <span
      className="w-[7px] h-[7px] rounded-full"
      style={{ background: veg ? "#16A34A" : "#DC2626" }}
    />
  </span>
);

const ProductPanel = ({ onAddCategory, onAddProduct, onDeleteCategory }) => {
  const dispatch = useDispatch();
  const location = useLocation();
  const cart = useSelector((s) => s.cart);

  const [view, setView] = useState("grid");
  const [q, setQ] = useState("");
  const [catId, setCatId] = useState(null);
  const [subcat, setSubcat] = useState(null);
  const [variantPick, setVariantPick] = useState({});

  const { data: menusRes, isLoading } = useQuery({ queryKey: ["menus"], queryFn: getMenus });

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

  const add = (item) => {
    if (item.isAvailable === false) {
      enqueueSnackbar(`${item.name} is out of stock`, { variant: "error" });
      return;
    }
    for (const g of item.modifierGroups || []) {
      if (g.required) {
        enqueueSnackbar(`Select "${g.name}" for ${item.name}`, { variant: "warning" });
        return;
      }
    }
    let price = activePrice(item);
    let label = "";
    let variant = null;
    if (item.variants?.length) {
      const vid = variantPick[item._id] || item.variants[0]._id;
      variant = item.variants.find((v) => v._id === vid) || item.variants[0];
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
      {/* ===== Page title ===== */}
      <div className="px-7 pt-6 pb-3 shrink-0">
        <h1 className="text-[28px] font-extrabold text-[#0F172A] tracking-tight">Products</h1>
      </div>

      {/* ===== Toolbar: search + add category + view toggle ===== */}
      <div className="px-7 pb-4 shrink-0 flex items-center gap-3">
        <div className="relative flex-1 max-w-[440px]">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]">
            <IconSearch />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search product or category..."
            className="w-full h-[42px] pl-10 pr-16 rounded-xl border border-[#E2E8F0] bg-white text-[14px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#5B42F3]"
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
          className="h-[42px] px-4 rounded-xl border border-[#5B42F3] text-[#5B42F3] bg-white text-[14px] font-bold flex items-center gap-2 hover:bg-[#EEF0FE] transition-colors"
        >
          <IconPlus /> Add Category
        </button>

        <button
          onClick={onAddProduct}
          className="h-[42px] px-4 rounded-xl bg-[#5B42F3] text-white text-[14px] font-bold flex items-center gap-2 hover:bg-[#4A32E0] transition-colors"
        >
          <IconPlus /> Add Product
        </button>

        <div className="ml-auto flex items-center rounded-xl border border-[#E2E8F0] overflow-hidden h-[42px]">
          <button
            onClick={() => setView("grid")}
            className={`w-[42px] h-full flex items-center justify-center transition-colors ${
              view === "grid" ? "bg-[#5B42F3] text-white" : "bg-white text-[#94A3B8] hover:text-[#0F172A]"
            }`}
            title="Grid view"
          >
            <IconGrid />
          </button>
          <button
            onClick={() => setView("list")}
            className={`w-[42px] h-full flex items-center justify-center border-l border-[#E2E8F0] transition-colors ${
              view === "list" ? "bg-[#5B42F3] text-white" : "bg-white text-[#94A3B8] hover:text-[#0F172A]"
            }`}
            title="List view"
          >
            <IconList />
          </button>
        </div>
      </div>

      {/* ===== Category tiles — COMPACT, NO ICONS (fixed at top) ===== */}
      {!searching && (
        <div className="px-7 pb-4 shrink-0">
          <div className="flex flex-wrap gap-2 max-h-[152px] overflow-y-auto no-scrollbar">
            {menus.map((m, i) => {
              const on = category?._id === m._id;
              return (
                <div
                  key={m._id}
                  style={{ background: TILE_COLORS[i % TILE_COLORS.length] }}
                  className={`h-[44px] pl-4 pr-1 rounded-lg text-white text-[13px] font-bold leading-tight max-w-[240px] flex items-center gap-1 transition-all ${
                    on ? "ring-[3px] ring-[#0F172A]/25 shadow-md scale-[1.02]" : "hover:brightness-110"
                  }`}
                >
                  <button
                    onClick={() => setCatId(on ? null : m._id)}
                    className="min-w-0 flex-1 text-left truncate h-full"
                    title={m.name}
                  >
                    {m.name}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCategory?.(m);
                    }}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-white/75 hover:bg-black/20 hover:text-white text-[18px] leading-none shrink-0"
                    title={`Delete ${m.name}`}
                    aria-label={`Delete ${m.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}

            {/* Add Category tile */}
            <button
              onClick={onAddCategory}
              className="h-[44px] px-4 rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] text-[#475569] text-[13px] font-bold flex items-center gap-1.5 hover:border-[#5B42F3] hover:text-[#5B42F3] transition-colors"
            >
              <IconPlus size={14} /> Add Category
            </button>
          </div>

          {/* Breadcrumb inside a category */}
          {category && (
            <div className="mt-3 flex items-center gap-1.5 text-[12.5px]">
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

      {/* ===== Section heading ===== */}
      <div className="px-7 pb-3 shrink-0 flex items-center justify-between">
        <h2 className="text-[19px] font-extrabold text-[#0F172A]">{heading}</h2>
        {showPopular && menus.length > 0 && (
          <button
            onClick={() => setCatId(menus[0]._id)}
            className="text-[13px] font-bold text-[#5B42F3] underline underline-offset-2"
          >
            View All
          </button>
        )}
        {subcat && (
          <button
            onClick={() => setSubcat(null)}
            className="text-[13px] font-bold text-[#5B42F3] underline underline-offset-2"
          >
            Back to {category.name}
          </button>
        )}
      </div>

      {/* ===== Scrollable content ===== */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-7">
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
        ) : /* --- Subcategory selection screen --- */
        !searching && category && hasSubcats && !subcat ? (
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
          /* ===== PRODUCT GRID (exact reference card) ===== */
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {products.map((item) => {
              const img = item.imageThumbnailUrl || item.imageUrl || item.image;
              const price = item.variants?.length
                ? (item.variants.find((v) => v._id === variantPick[item._id]) || item.variants[0]).price
                : activePrice(item);
              const inCart = cart.find((c) => c.menuItemId === item._id);
              const off = item.isAvailable === false;
              return (
                <div
                  key={item._id}
                  className={`rounded-xl border border-[#E2E8F0] bg-white overflow-hidden hover:shadow-md transition-shadow ${
                    off ? "opacity-55" : ""
                  }`}
                >
                  {/* Image */}
                  <div className="relative w-full h-[118px] bg-[#F1F5F9] p-2">
                    <div className="relative w-full h-full rounded-lg overflow-hidden bg-[#E2E8F0] flex items-center justify-center">
                      {img ? (
                        <img src={img} alt={item.name} loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-3xl">🍽️</span>
                      )}
                    </div>
                    <DietMark veg={item.isVegetarian !== false} />
                  </div>

                  {/* Body */}
                  <div className="px-3 pb-3 pt-1">
                    <p className="text-[13.5px] font-bold text-[#0F172A] leading-snug line-clamp-2 min-h-[36px]">
                      {item.name}
                    </p>

                    {/* Variant chips */}
                    {item.variants?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {item.variants.slice(0, 3).map((v) => {
                          const sel = (variantPick[item._id] || item.variants[0]._id) === v._id;
                          return (
                            <button
                              key={v._id}
                              onClick={() => setVariantPick((p) => ({ ...p, [item._id]: v._id }))}
                              className={`px-2 py-[3px] rounded-md text-[10.5px] font-bold border transition-colors ${
                                sel
                                  ? "bg-[#5B42F3] text-white border-[#5B42F3]"
                                  : "bg-white text-[#475569] border-[#E2E8F0] hover:border-[#5B42F3]"
                              }`}
                            >
                              {v.name}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {off && (
                      <span className="inline-block mt-1.5 px-2 py-0.5 rounded-md bg-[#FEF2F2] text-[#DC2626] text-[10px] font-bold">
                        Out of Stock
                      </span>
                    )}

                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[16px] font-extrabold text-[#0F172A]">₹{price}</span>
                      <button
                        onClick={() => add(item)}
                        disabled={off}
                        className={`w-[30px] h-[30px] rounded-lg flex items-center justify-center transition-all ${
                          off
                            ? "bg-[#E2E8F0] text-[#94A3B8]"
                            : "bg-[#5B42F3] text-white hover:bg-[#4A32E0] active:scale-95"
                        }`}
                        title={off ? "Out of stock" : "Add to cart"}
                      >
                        <IconPlus size={16} w={3} />
                      </button>
                    </div>

                    {inCart && (
                      <p className="text-[10.5px] font-bold text-[#16A34A] mt-1 text-right">
                        In cart: {inCart.quantity}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ===== PRODUCT LIST VIEW ===== */
          <div className="space-y-2">
            {products.map((item) => {
              const img = item.imageThumbnailUrl || item.imageUrl || item.image;
              const price = item.variants?.length ? item.variants[0].price : activePrice(item);
              const off = item.isAvailable === false;
              return (
                <div
                  key={item._id}
                  className={`flex items-center gap-3 p-3 rounded-xl border border-[#E2E8F0] bg-white hover:border-[#CBD5E1] ${
                    off ? "opacity-55" : ""
                  }`}
                >
                  <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-[#F1F5F9] shrink-0 flex items-center justify-center">
                    {img ? <img src={img} alt={item.name} className="w-full h-full object-cover" /> : "🍽️"}
                  </div>
                  <span
                    className="w-[13px] h-[13px] rounded-[3px] border-[1.5px] flex items-center justify-center shrink-0"
                    style={{ borderColor: item.isVegetarian !== false ? "#16A34A" : "#DC2626" }}
                  >
                    <span
                      className="w-[6px] h-[6px] rounded-full"
                      style={{ background: item.isVegetarian !== false ? "#16A34A" : "#DC2626" }}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-[#0F172A] truncate">{item.name}</p>
                    <p className="text-[12px] text-[#94A3B8] truncate">
                      {item.categoryName || item.category}
                      {item.subcategory ? ` · ${item.subcategory}` : ""}
                    </p>
                  </div>
                  <span className="text-[15px] font-extrabold text-[#0F172A]">₹{price}</span>
                  <button
                    onClick={() => add(item)}
                    disabled={off}
                    className={`w-[30px] h-[30px] rounded-lg flex items-center justify-center shrink-0 ${
                      off ? "bg-[#E2E8F0] text-[#94A3B8]" : "bg-[#5B42F3] text-white hover:bg-[#4A32E0]"
                    }`}
                  >
                    <IconPlus size={16} w={3} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductPanel;
