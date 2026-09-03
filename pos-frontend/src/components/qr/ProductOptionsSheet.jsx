import { useMemo, useState } from "react";

/**
 * Options a diner must pick before a product can go in the cart.
 *
 * The table-QR page used to add every product straight to the cart, so a
 * product carrying variants or modifier groups was ordered with none of them
 * chosen. The server validates those selections (services/price), which meant
 * a product with variants could not be ordered through the QR at all — the
 * order failed with "Please select a valid variant" — and a required group was
 * simply skipped.
 *
 * Rules mirrored from the server so the customer is never told "no" after the
 * fact:
 *   - variants: exactly one, and mandatory whenever the product has any;
 *   - a `required` group needs at least one option;
 *   - a group caps its selections at `maxSelections` UNLESS Maximum Selection
 *     is explicitly off (`maxSelectionEnabled === false`), which means any
 *     number. Groups predating that flag keep their cap.
 */
const ProductOptionsSheet = ({ item, currency = "₹", primary = "#5B42F3", onClose, onAdd }) => {
  const variants = useMemo(() => (Array.isArray(item?.variants) ? item.variants : []), [item]);
  const groups = useMemo(
    () => (Array.isArray(item?.modifierGroups) ? item.modifierGroups : []).filter((g) => g?.isActive !== false),
    [item],
  );

  const [variantId, setVariantId] = useState(() => {
    const firstAvailable = variants.find((v) => v.isAvailable !== false);
    return firstAvailable ? String(firstAvailable._id) : "";
  });
  // { [groupKey]: Set(optionKey) }
  const [picked, setPicked] = useState({});
  const [qty, setQty] = useState(1);

  const money = (n) => `${currency}${Number(n || 0).toFixed(2)}`;
  const groupKey = (g, i) => String(g._id || g.name || i);
  const optionKey = (o, i) => String(o._id || o.name || i);

  const capOf = (g) => {
    if (g.maxSelectionEnabled === false) return Infinity;
    return Math.max(1, Number(g.maxSelections) || 1);
  };

  const toggleOption = (g, gi, o, oi) => {
    const gk = groupKey(g, gi);
    const ok = optionKey(o, oi);
    setPicked((prev) => {
      const current = new Set(prev[gk] || []);
      if (current.has(ok)) {
        current.delete(ok);
      } else {
        const cap = capOf(g);
        // A cap of one behaves like a radio: picking swaps rather than blocks.
        if (cap === 1) current.clear();
        else if (current.size >= cap) return prev;
        current.add(ok);
      }
      return { ...prev, [gk]: current };
    });
  };

  const selectedVariant = variants.find((v) => String(v._id) === variantId) || null;

  const unitPrice = useMemo(() => {
    let price = selectedVariant ? Number(selectedVariant.price) || 0 : Number(item?.price) || 0;
    groups.forEach((g, gi) => {
      const chosen = picked[groupKey(g, gi)];
      if (!chosen) return;
      (g.options || []).forEach((o, oi) => {
        if (chosen.has(optionKey(o, oi))) price += Number(o.price) || 0;
      });
    });
    return price;
  }, [selectedVariant, item, groups, picked]);

  const missingRequired = groups.filter((g, gi) => {
    if (!g.required) return false;
    const chosen = picked[groupKey(g, gi)];
    return !chosen || chosen.size === 0;
  });
  const needsVariant = variants.length > 0 && !selectedVariant;
  const blocked = needsVariant || missingRequired.length > 0;

  const handleAdd = () => {
    if (blocked) return;
    // Shaped for the server's modifierSelections array format.
    const modifiers = [];
    groups.forEach((g, gi) => {
      const chosen = picked[groupKey(g, gi)];
      if (!chosen) return;
      (g.options || []).forEach((o, oi) => {
        if (!chosen.has(optionKey(o, oi))) return;
        modifiers.push({
          groupId: g._id ? String(g._id) : undefined,
          groupName: g.name,
          optionId: o._id ? String(o._id) : undefined,
          optionName: o.name,
          price: Number(o.price) || 0,
          quantity: 1,
        });
      });
    });

    onAdd({
      item,
      qty,
      variant: selectedVariant
        ? { variantId: String(selectedVariant._id), name: selectedVariant.name, price: Number(selectedVariant.price) || 0 }
        : null,
      modifiers,
      unitPrice,
    });
  };

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Choose options for ${item.name}`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-extrabold text-slate-900 text-[15px] leading-snug">{item.name}</h3>
            {item.description ? (
              <p className="text-[12px] text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-full bg-slate-100 text-slate-600 text-lg font-bold leading-none"
          >
            ×
          </button>
        </div>

        {/* Choices */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {variants.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-extrabold text-slate-900 text-[13px]">Choose a size</h4>
                <span className="text-[11px] font-bold text-rose-500">Required</span>
              </div>
              <div className="space-y-2">
                {variants.map((v) => {
                  const disabled = v.isAvailable === false;
                  const active = String(v._id) === variantId;
                  return (
                    <label
                      key={String(v._id)}
                      className={`flex items-center justify-between gap-3 p-3 rounded-xl border text-[13px] ${
                        disabled
                          ? "opacity-50 border-slate-200"
                          : active
                          ? "border-transparent ring-2"
                          : "border-slate-200"
                      }`}
                      style={active && !disabled ? { ringColor: primary, borderColor: primary } : undefined}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="radio"
                          name="variant"
                          disabled={disabled}
                          checked={active}
                          onChange={() => setVariantId(String(v._id))}
                          className="w-4 h-4"
                          style={{ accentColor: primary }}
                        />
                        <span className="font-bold text-slate-800 truncate">{v.name}</span>
                      </span>
                      <span className="font-extrabold text-slate-900 shrink-0">{money(v.price)}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          {groups.map((g, gi) => {
            const gk = groupKey(g, gi);
            const chosen = picked[gk] || new Set();
            const cap = capOf(g);
            const capLabel =
              cap === Infinity ? "Choose any" : cap === 1 ? "Choose 1" : `Choose up to ${cap}`;
            return (
              <section key={gk}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-extrabold text-slate-900 text-[13px]">{g.name}</h4>
                  <span
                    className={`text-[11px] font-bold ${g.required ? "text-rose-500" : "text-slate-400"}`}
                  >
                    {g.required ? "Required" : "Optional"} · {capLabel}
                  </span>
                </div>
                <div className="space-y-2">
                  {(g.options || []).map((o, oi) => {
                    const ok = optionKey(o, oi);
                    const active = chosen.has(ok);
                    const atCap = !active && chosen.size >= cap && cap !== 1;
                    return (
                      <label
                        key={ok}
                        className={`flex items-center justify-between gap-3 p-3 rounded-xl border text-[13px] ${
                          atCap ? "opacity-45" : ""
                        } ${active ? "border-transparent ring-2" : "border-slate-200"}`}
                        style={active ? { borderColor: primary } : undefined}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <input
                            type={cap === 1 ? "radio" : "checkbox"}
                            name={cap === 1 ? `grp-${gk}` : undefined}
                            checked={active}
                            disabled={atCap}
                            onChange={() => toggleOption(g, gi, o, oi)}
                            className="w-4 h-4"
                            style={{ accentColor: primary }}
                          />
                          <span className="font-bold text-slate-800 truncate">{o.name}</span>
                        </span>
                        {Number(o.price) > 0 ? (
                          <span className="font-extrabold text-slate-900 shrink-0">+{money(o.price)}</span>
                        ) : (
                          <span className="text-[11px] font-bold text-slate-400 shrink-0">Free</span>
                        )}
                      </label>
                    );
                  })}
                  {(g.options || []).length === 0 && (
                    <p className="text-[12px] text-slate-400">No options in this group.</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 font-bold text-lg"
                aria-label="Reduce quantity"
              >
                −
              </button>
              <span className="min-w-[20px] text-center font-extrabold text-slate-900">{qty}</span>
              <button
                onClick={() => setQty((q) => q + 1)}
                className="w-9 h-9 rounded-full text-white font-bold text-lg"
                style={{ background: primary }}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <span className="font-extrabold text-slate-900">{money(unitPrice * qty)}</span>
          </div>

          {blocked ? (
            <p className="text-[12px] font-bold text-rose-500 text-center">
              {needsVariant
                ? "Please choose a size."
                : `Please choose ${missingRequired.map((g) => `"${g.name}"`).join(", ")}.`}
            </p>
          ) : null}

          <button
            onClick={handleAdd}
            disabled={blocked}
            className="w-full h-12 rounded-2xl text-white font-extrabold text-[14px] disabled:opacity-50"
            style={{ background: primary }}
          >
            Add to cart · {money(unitPrice * qty)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductOptionsSheet;
