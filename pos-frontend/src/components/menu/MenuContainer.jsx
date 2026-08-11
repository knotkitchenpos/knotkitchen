import React, { useState, useEffect, useMemo } from "react";
import { GrRadialSelected } from "react-icons/gr";
import { FaShoppingCart } from "react-icons/fa";
import { FiGift, FiClock, FiPlus, FiSearch, FiX } from "react-icons/fi";
import { useDispatch, useSelector } from "react-redux";
import { addItems } from "../../redux/slices/cartSlice";
import { enqueueSnackbar } from "notistack";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getMenus } from "../../https";

const CATEGORY_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-500",
  "bg-teal-500",
  "bg-orange-500",
];

// === Helpers for menu scheduling ===
const currentTimeInMinutes = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const parseTime = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
};

const isInSchedule = (schedule) => {
  if (!schedule?.enabled) return true;
  const now = currentTimeInMinutes();
  const start = parseTime(schedule.startTime);
  const end = parseTime(schedule.endTime);
  if (start === null || end === null) return true;

  const today = new Date().getDay();
  const days = schedule.daysOfWeek || [];
  if (days.length === 0 || days.includes(today) === false) return false;

  // Handle overnight schedules (e.g. 22:00 - 02:00)
  if (start <= end) {
    return now >= start && now <= end;
  }
  return now >= start || now <= end;
};

const getActivePrice = (item) => {
  if (!item?.priceRules?.length) return item?.price;
  const now = currentTimeInMinutes();
  const today = new Date().getDay();
  const activeRule = item.priceRules.find((r) => {
    if (!r.isActive) return false;
    const days = r.daysOfWeek || [];
    if (days.length === 0 || days.includes(today) === false) return false;
    const start = parseTime(r.startTime);
    const end = parseTime(r.endTime);
    if (start === null || end === null) return true;
    if (start <= end) return now >= start && now <= end;
    return now >= start || now <= end;
  });
  return activeRule ? activeRule.price : item?.price;
};

const MenuContainer = () => {
  const location = useLocation();
  const dispatch = useDispatch();
  const cartData = useSelector((state) => state.cart);

  const { data: menusData, isLoading } = useQuery({
    queryKey: ["menus"],
    queryFn: getMenus,
  });

  const menus = useMemo(() => {
    const all = menusData?.data?.data || [];
    // Only show published menus
    return all.filter((menu) => menu.published !== false && isInSchedule(menu.schedule));
  }, [menusData]);

  const [selectedId, setSelectedId] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [selectedVariants, setSelectedVariants] = useState({});
  const [selectedAddons, setSelectedAddons] = useState({});
  const [selectedModifiers, setSelectedModifiers] = useState({});
  const [searchQuery, setSearchQuery] = useState("");

  // Support pre-selecting a category when navigating from global search
  useEffect(() => {
    const { selectedCategoryId } = location.state || {};
    if (selectedCategoryId && menus.length > 0) {
      const menu = menus.find((m) => m._id === selectedCategoryId);
      if (menu) {
        setSelectedId(menu._id);
        setQuantities({});
      }
    }
  }, [location.state, menus]);

  const selected = menus.find((m) => m._id === selectedId) || menus[0];

  // Only show items that are scheduled to be available
  const visibleItems = useMemo(() => {
    if (!selected?.items) return [];
    return selected.items
      .filter((item) => isInSchedule(item.schedule))
      .map((item) => ({ ...item, categoryId: selected._id, categoryName: selected.name }));
  }, [selected]);

  // Search across all menu items
  const allAvailableItems = useMemo(() => {
    return menus.flatMap((menu) =>
      (menu.items || [])
        .filter((item) => isInSchedule(item.schedule))
        .map((item) => ({ ...item, categoryId: menu._id, categoryName: menu.name }))
    );
  }, [menus]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allAvailableItems.filter((item) =>
      item.name?.toLowerCase().includes(q) ||
      item.categoryName?.toLowerCase().includes(q) ||
      (item.variants || []).some((v) => v.name?.toLowerCase().includes(q))
    );
  }, [searchQuery, allAvailableItems]);

  const isSearching = searchQuery.trim().length > 0;
  const displayItems = isSearching ? filteredItems : visibleItems;

  // Reset quantities when selected category changes
  useEffect(() => {
    setQuantities({});
    setSelectedVariants({});
    setSelectedAddons({});
    setSelectedModifiers({});
  }, [selectedId]);

  const getItemQuantity = (itemId) => quantities[itemId] || 0;

  const increment = (itemId) => {
    setQuantities((prev) => {
      const current = prev[itemId] || 0;
      if (current >= 4) {
        enqueueSnackbar("Maximum 4 quantity per item!", { variant: "warning" });
        return prev;
      }
      return { ...prev, [itemId]: current + 1 };
    });
  };

  const decrement = (itemId) => {
    setQuantities((prev) => {
      const current = prev[itemId] || 0;
      if (current <= 0) return prev;
      return { ...prev, [itemId]: current - 1 };
    });
  };

  const handleAddToCart = (item) => {
    if (item.isAvailable === false) {
      enqueueSnackbar(item.name + " is currently out of stock!", { variant: "error" });
      return;
    }

    const itemQty = getItemQuantity(item._id);
    if (itemQty === 0) {
      enqueueSnackbar("Please select a quantity first!", { variant: "warning" });
      return;
    }

    // Validate required modifier groups
    for (const group of item.modifierGroups || []) {
      if (group.required) {
        const selected = selectedModifiers[item._id]?.[group._id] || [];
        if (selected.length === 0) {
          enqueueSnackbar(`Please select "${group.name}" for ${item.name}`, { variant: "warning" });
          return;
        }
      }
    }

    // Determine price with variant
    let finalPrice = getActivePrice(item);
    let variantLabel = "";
    const variant = item.variants?.find((v) => v._id === selectedVariants[item._id]);
    if (item.variants?.length > 0) {
      if (!variant) {
        enqueueSnackbar(`Please select a variant for ${item.name}`, { variant: "warning" });
        return;
      }
      finalPrice = variant.price;
      variantLabel = ` (${variant.name})`;
    }

    // Add add-ons
    const addonTotal = (item.addons || [])
      .filter((a) => selectedAddons[item._id]?.includes(a._id))
      .reduce((sum, a) => sum + (a.price || 0), 0);

    // Add modifiers
    let modifierTotal = 0;
    const modifierLabels = [];
    for (const group of item.modifierGroups || []) {
      const selectedOpts = selectedModifiers[item._id]?.[group._id] || [];
      for (const opt of group.options || []) {
        if (selectedOpts.includes(opt._id)) {
          modifierTotal += opt.price || 0;
          modifierLabels.push(opt.name);
        }
      }
    }

    const finalUnitPrice = Number(finalPrice || 0) + addonTotal + modifierTotal;

    const { name } = item;
    const existingItem = cartData.find((cartItem) => cartItem.menuItemId === item._id);

    const extraLabel = [variantLabel, ...modifierLabels].filter(Boolean).join(", ");

    const newObj = {
      id: Date.now() + Math.random(),
      menuItemId: item._id,
      // Server-side pricing inputs — the backend re-resolves prices
      // from these IDs and never trusts the browser-supplied price.
      variantId: variant?._id || null,
      addonIds: (item.addons || [])
        .filter((a) => selectedAddons[item._id]?.includes(a._id))
        .map((a) => a._id),
      modifierSelections: Object.fromEntries(
        Object.entries(selectedModifiers[item._id] || {}).map(([groupId, optIds]) => [
          groupId,
          optIds,
        ])
      ),
      name: extraLabel ? `${name}${extraLabel}` : name,
      pricePerQuantity: finalUnitPrice,
      quantity: itemQty,
      price: finalUnitPrice * itemQty,
      addons: (item.addons || []).filter((a) => selectedAddons[item._id]?.includes(a._id)),
      modifiers: modifierLabels,
      variant: variant ? { name: variant.name, price: variant.price } : null,
      isCombo: item.isCombo || false,
    };

    dispatch(addItems(newObj));
    setQuantities((prev) => ({ ...prev, [item._id]: 0 }));
    setSelectedAddons((prev) => ({ ...prev, [item._id]: [] }));
    setSelectedModifiers((prev) => ({ ...prev, [item._id]: {} }));
    enqueueSnackbar(
      existingItem
        ? `${name} quantity updated to ${(existingItem.quantity || 0) + itemQty} in cart!`
        : `${itemQty} x ${name} added to cart!`,
      { variant: "success" }
    );
  };

  const handleCategoryChange = (menu) => {
    setSelectedId(menu._id);
  };

  // Addon toggling
  const toggleAddon = (itemId, addonId) => {
    setSelectedAddons((prev) => {
      const current = prev[itemId] || [];
      return {
        ...prev,
        [itemId]: current.includes(addonId)
          ? current.filter((a) => a !== addonId)
          : [...current, addonId],
      };
    });
  };

  // Modifier toggling
  const toggleModifier = (itemId, group, optionId) => {
    setSelectedModifiers((prev) => {
      const itemMods = prev[itemId] || {};
      const current = itemMods[group._id] || [];

      let next;
      if (current.includes(optionId)) {
        next = current.filter((o) => o !== optionId);
      } else {
        // Respect max selections
        if (current.length >= (group.maxSelections || 1)) {
          enqueueSnackbar(`Maximum ${group.maxSelections || 1} selection(s) for "${group.name}"!`, { variant: "warning" });
          return prev;
        }
        next = [...current, optionId];
      }

      return {
        ...prev,
        [itemId]: { ...itemMods, [group._id]: next },
      };
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-accent border-t-transparent" />
      </div>
    );
  }

  if (menus.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <div className="w-16 h-16 mx-auto bg-surface-tertiary rounded-2xl flex items-center justify-center mb-4">
          <span className="text-2xl">🍽️</span>
        </div>
        <h2 className="text-2xl font-display font-bold mb-2 text-content">No Menu Yet</h2>
        <p className="text-content-muted text-sm">
          You haven't added any menu categories yet. Go to the Dashboard to add categories and dishes for your takeaway.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="relative">
        <FiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted" size={18} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search products..."
          className="w-full bg-surface-input border border-border rounded-xl pl-11 pr-10 py-3 text-sm text-content placeholder:text-content-muted focus:outline-none focus:border-accent transition-colors"
        />
        {isSearching && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted hover:text-accent-red transition-colors p-1"
            title="Clear search"
          >
            <FiX size={18} />
          </button>
        )}
        {isSearching && (
          <p className="text-xs text-content-muted mt-2">
            {filteredItems.length} result{filteredItems.length !== 1 ? "s" : ""} for {`"${searchQuery.trim()}"`}
          </p>
        )}
      </div>

      {!isSearching && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
        {menus.map((menu, index) => {
          const colorClass = CATEGORY_COLORS[index % CATEGORY_COLORS.length];
          const isSelected = selected?._id === menu._id;
          return (
            <div
              key={menu._id}
              className={`relative flex flex-col items-start justify-between p-5 rounded-xl h-[110px] cursor-pointer transition-all ${colorClass} ${
                isSelected
                  ? "ring-4 ring-accent/30 scale-[1.02] shadow-hover"
                  : "hover:scale-[1.02] hover:shadow-hover"
              }`}
              onClick={() => handleCategoryChange(menu)}
            >
              <div className="flex items-center justify-between w-full">
                <h1 className="text-white text-base font-semibold font-display">
                  {menu.name}
                </h1>
                {isSelected && (
                  <GrRadialSelected className="text-white" size={18} />
                )}
              </div>
              <p className="text-white/80 text-sm font-semibold">
                {visibleItems.length} Items
              </p>
            </div>
          );
        })}
        </div>
      )}

      <hr className="border-border border-t-2" />

      {/* Dishes Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {displayItems.length > 0 ? (
          displayItems.map((item) => {
            const currentQty = getItemQuantity(item._id);
            const inCartItem = cartData.find((ci) => ci.menuItemId === item._id);
            const isAvailable = item.isAvailable !== false;
            const displayPrice = getActivePrice(item);
            const hasVariants = (item.variants?.length || 0) > 0;
            const hasAddons = (item.addons?.length || 0) > 0;
            const hasModifiers = (item.modifierGroups?.length || 0) > 0;
            const selectedVariant = item.variants?.find((v) => v._id === selectedVariants[item._id]);
            const effectivePrice = selectedVariant ? selectedVariant.price : displayPrice;
            const selectedAddonList = (item.addons || []).filter((a) => selectedAddons[item._id]?.includes(a._id));
            const selectedModifierList = [];
            for (const group of item.modifierGroups || []) {
              const selOpts = selectedModifiers[item._id]?.[group._id] || [];
              for (const opt of group.options || []) {
                if (selOpts.includes(opt._id)) selectedModifierList.push(opt);
              }
            }
            const extraPrice = selectedAddonList.reduce((s, a) => s + (a.price || 0), 0) +
              selectedModifierList.reduce((s, o) => s + (o.price || 0), 0);

            return (
              <div
                key={item._id}
                className={`card flex flex-col p-5 hover:!translate-y-0 hover:border-accent/50 ${
                  !isAvailable ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start justify-between w-full mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-content font-semibold text-base">
                      {item.name}
                    </h1>
                    {item.isCombo && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-amber/10 text-accent-amber text-[10px] font-semibold flex items-center gap-1">
                        <FiGift size={10} /> Combo
                      </span>
                    )}
                    {item.schedule?.enabled && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue text-[10px] font-semibold flex items-center gap-1">
                        <FiClock size={10} /> {item.schedule.startTime}-{item.schedule.endTime}
                      </span>
                    )}
                    {!isAvailable && (
                      <span className="px-2 py-0.5 rounded-full bg-accent-red/10 text-accent-red text-[10px] font-semibold whitespace-nowrap">
                        Out of Stock
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleAddToCart(item)}
                    disabled={!isAvailable}
                    className={`p-2.5 rounded-xl transition-all ${
                      !isAvailable
                        ? "bg-surface-tertiary text-content-muted cursor-not-allowed"
                        : inCartItem
                        ? "bg-accent text-white shadow-card"
                        : "bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                    }`}
                    title={
                      !isAvailable
                        ? "Out of stock"
                        : inCartItem
                        ? "Update quantity in cart"
                        : "Add to cart"
                    }
                  >
                    <FaShoppingCart size={16} />
                  </button>
                </div>

                {item.comboDescription && (
                  <p className="text-xs text-content-muted mb-2">{item.comboDescription}</p>
                )}

                {/* Variant selection */}
                {hasVariants && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-content-muted mb-1">Variant</p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.variants.map((v) => (
                        <button
                          key={v._id}
                          onClick={() =>
                            setSelectedVariants((prev) => ({ ...prev, [item._id]: v._id }))
                          }
                          disabled={!isAvailable}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                            selectedVariants[item._id] === v._id
                              ? "bg-accent text-white border-accent"
                              : "bg-surface-input border-border text-content-secondary hover:border-accent"
                          }`}
                        >
                          {v.name} · ₹{v.price}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Modifier groups */}
                {hasModifiers && (
                  <div className="mb-3 space-y-2.5">
                    {item.modifierGroups.map((group) => (
                      <div key={group._id}>
                        <p className="text-[10px] font-semibold text-content-muted mb-1">
                          {group.name}
                          {group.required && <span className="text-accent-red"> *</span>}
                          <span className="text-content-muted/70"> · Max {group.maxSelections || 1}</span>
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {group.options.map((opt) => (
                            <button
                              key={opt._id}
                              onClick={() => toggleModifier(item._id, group, opt._id)}
                              disabled={!isAvailable || opt.isAvailable === false}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                                selectedModifiers[item._id]?.[group._id]?.includes(opt._id)
                                  ? "bg-accent text-white border-accent"
                                  : "bg-surface-input border-border text-content-secondary hover:border-accent"
                              }`}
                            >
                              {opt.name}
                              {opt.price > 0 && ` +₹${opt.price}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add-ons */}
                {hasAddons && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-content-muted mb-1 flex items-center gap-1">
                      <FiPlus size={10} /> Add-ons
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {item.addons.map((a) => (
                        <button
                          key={a._id}
                          onClick={() => toggleAddon(item._id, a._id)}
                          disabled={!isAvailable || a.isAvailable === false}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all disabled:opacity-50 ${
                            selectedAddons[item._id]?.includes(a._id)
                              ? "bg-accent text-white border-accent"
                              : "bg-surface-input border-border text-content-secondary hover:border-accent"
                          }`}
                        >
                          {a.name}
                          {a.price > 0 && ` +₹${a.price}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between w-full gap-3">
                  <p className="text-content text-lg font-bold">
                    ₹{effectivePrice}
                    {extraPrice > 0 && (
                      <span className="text-sm text-content-muted font-normal">
                        {" "}+ ₹{extraPrice}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center justify-between bg-surface-input border border-border rounded-xl px-3 py-2 gap-4 flex-1 max-w-[160px]">
                    <button
                      onClick={() => decrement(item._id)}
                      disabled={!isAvailable}
                      className="text-accent text-xl font-bold hover:text-accent-red transition-colors leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      &minus;
                    </button>
                    <span className="text-content font-semibold text-sm">
                      {currentQty}
                    </span>
                    <button
                      onClick={() => increment(item._id)}
                      disabled={!isAvailable}
                      className="text-accent text-xl font-bold hover:text-accent-green transition-colors leading-none disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      &#43;
                    </button>
                  </div>
                </div>
                {inCartItem && (
                  <p className="text-accent-green text-xs font-semibold mt-2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-accent-green rounded-full inline-block" />
                    In cart: {inCartItem.quantity} × ₹{inCartItem.pricePerQuantity}
                  </p>
                )}
              </div>
            );
          })
        ) : (
          <div className="col-span-full text-center py-10 text-content-muted">
            {isSearching
              ? "No products found matching your search."
              : "No dishes available in this category right now."}
          </div>
        )}
      </div>

      {/* Legend */}
      {!isSearching &&
        (visibleItems.some((i) => i.variants?.length > 0) ||
          visibleItems.some((i) => i.addons?.length > 0) ||
          visibleItems.some((i) => i.modifierGroups?.length > 0)) && (
          <p className="text-xs text-content-muted mt-4">
            Select a variant, modifiers, or add-ons before adding to cart for the most accurate price.
          </p>
        )}
    </div>
  );
};

export default MenuContainer;