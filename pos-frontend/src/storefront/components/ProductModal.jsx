import React, { useEffect, useMemo, useState } from "react";
import { formatPrice } from "../theme";
import { capOf } from "../../utils/modifierGroups";

/**
 * Product customization sheet (§9).
 *
 * Mirrors the exact validation rules the backend enforces (required groups,
 * min/max selections, variant required when variants exist) so the customer
 * gets instant feedback — but the server re-validates everything on checkout.
 */
const ProductModal = ({ product, currencySymbol, allowNotes = true, onClose, onAdd }) => {
  const [variantId, setVariantId] = useState(null);
  const [addonIds, setAddonIds] = useState([]);
  const [selections, setSelections] = useState({}); // groupId -> [optionId]
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // Preselect the first variant so the displayed price is never ambiguous.
  useEffect(() => {
    if (product?.variants?.length) setVariantId(product.variants[0].id);
  }, [product]);

  // Close on Escape + lock background scroll while the sheet is open.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const unitPrice = useMemo(() => {
    if (!product) return 0;
    const variant = product.variants?.find((v) => v.id === variantId);
    let base = variant ? variant.price : product.price;

    base += (product.addons || [])
      .filter((a) => addonIds.includes(a.id))
      .reduce((sum, a) => sum + a.price, 0);

    for (const group of product.modifierGroups || []) {
      const chosen = selections[group.id] || [];
      base += (group.options || [])
        .filter((o) => chosen.includes(o.id))
        .reduce((sum, o) => sum + o.price, 0);
    }
    return base;
  }, [product, variantId, addonIds, selections]);

  if (!product) return null;

  const toggleAddon = (id) =>
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  const toggleOption = (group, optionId) => {
    setSelections((prev) => {
      const chosen = prev[group.id] || [];
      // Infinity when Maximum Selection is off -- "no limit" means no limit.
      const max = capOf(group);

      if (chosen.includes(optionId)) {
        return { ...prev, [group.id]: chosen.filter((o) => o !== optionId) };
      }
      // Single-select behaves like a radio: replace rather than reject.
      if (max === 1) return { ...prev, [group.id]: [optionId] };
      if (chosen.length >= max) return prev;
      return { ...prev, [group.id]: [...chosen, optionId] };
    });
  };

  const handleAdd = () => {
    if (product.variants?.length && !variantId) {
      setError("Please choose an option.");
      return;
    }
    for (const group of product.modifierGroups || []) {
      const chosen = selections[group.id] || [];
      const min = group.required ? Math.max(1, group.minSelections || 1) : group.minSelections || 0;
      if (chosen.length < min) {
        setError(`Please choose ${min} option(s) for "${group.name}".`);
        return;
      }
    }

    const modifierSelections = Object.entries(selections).flatMap(([groupId, optionIds]) =>
      optionIds.map((optionId) => ({ groupId, optionId }))
    );

    const variant = product.variants?.find((v) => v.id === variantId);

    onAdd({
      menuId: product.menuId,
      itemId: product.id,
      name: product.name,
      quantity,
      unitPrice,
      image: product.thumbnail || product.image,
      variantId: variantId || null,
      variantName: variant?.name || "",
      addonIds,
      addonNames: (product.addons || []).filter((a) => addonIds.includes(a.id)).map((a) => a.name),
      modifierSelections,
      optionNames: (product.modifierGroups || []).flatMap((g) =>
        (g.options || []).filter((o) => (selections[g.id] || []).includes(o.id)).map((o) => o.name)
      ),
      note: note.trim(),
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Customize ${product.name}`}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:max-w-lg max-h-[92vh] flex flex-col bg-[var(--sf-bg)] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-[slideUp_.25s_ease-out]">
        {/* Header image */}
        {product.image || product.thumbnail ? (
          <img
            src={product.image || product.thumbnail}
            alt={product.imageAlt || product.name}
            className="w-full h-44 sm:h-52 object-cover shrink-0"
          />
        ) : null}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 text-white text-lg leading-none hover:bg-black/80"
        >
          ×
        </button>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5">
          <h2 className="text-xl font-bold text-[var(--sf-text)] mb-1">{product.name}</h2>
          {product.description ? (
            <p className="text-sm text-[var(--sf-muted)] mb-4">{product.description}</p>
          ) : null}

          {/* Variants */}
          {product.variants?.length ? (
            <fieldset className="mb-5">
              <legend className="font-semibold text-[var(--sf-text)] mb-2">
                Choose Size <span className="text-red-500">*</span>
              </legend>
              <div className="space-y-2">
                {product.variants.map((v) => (
                  <label
                    key={v.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-black/10 cursor-pointer hover:bg-[var(--sf-surface)]"
                  >
                    <input
                      type="radio"
                      name="variant"
                      checked={variantId === v.id}
                      onChange={() => setVariantId(v.id)}
                      className="accent-[var(--sf-primary)] w-4 h-4"
                    />
                    <span className="flex-1 text-[var(--sf-text)]">{v.name}</span>
                    <span className="font-semibold text-[var(--sf-text)]">
                      {formatPrice(v.price, currencySymbol)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* Modifier groups */}
          {(product.modifierGroups || []).map((group) => (
            <fieldset key={group.id} className="mb-5">
              <legend className="font-semibold text-[var(--sf-text)] mb-1">
                {group.name}{" "}
                {group.required ? <span className="text-red-500">*</span> : null}
              </legend>
              <p className="text-xs text-[var(--sf-muted)] mb-2">
                {capOf(group) === Infinity
                  ? "Choose any"
                  : capOf(group) > 1
                  ? `Choose up to ${capOf(group)}`
                  : "Choose 1"}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {group.options.map((o) => {
                  const chosen = (selections[group.id] || []).includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleOption(group, o.id)}
                      aria-pressed={chosen}
                      className={`h-[52px] px-3 rounded-xl border text-left transition-all flex flex-col justify-center min-w-0 ${
                        chosen
                          ? "border-[var(--sf-primary)] bg-[var(--sf-primary)]/10 shadow-sm"
                          : "border-black/10 hover:border-[var(--sf-primary)] hover:bg-[var(--sf-surface)]"
                      }`}
                    >
                      <span
                        className={`text-xs font-bold leading-tight truncate ${
                          chosen ? "text-[var(--sf-primary)]" : "text-[var(--sf-text)]"
                        }`}
                      >
                        {o.name}
                      </span>
                      <span className="text-[11px] text-[var(--sf-muted)] leading-tight mt-0.5 font-medium">
                        {o.price ? formatPrice(o.price, currencySymbol) : "Free"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {/* Add-ons */}
          {product.addons?.length ? (
            <fieldset className="mb-5">
              <legend className="font-semibold text-[var(--sf-text)] mb-2">Add-ons</legend>
              <div className="space-y-2">
                {product.addons.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-black/10 cursor-pointer hover:bg-[var(--sf-surface)]"
                  >
                    <input
                      type="checkbox"
                      checked={addonIds.includes(a.id)}
                      onChange={() => toggleAddon(a.id)}
                      className="accent-[var(--sf-primary)] w-4 h-4"
                    />
                    <span className="flex-1 text-[var(--sf-text)]">{a.name}</span>
                    <span className="text-sm font-medium text-[var(--sf-muted)]">
                      +{formatPrice(a.price, currencySymbol)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {/* Special instructions */}
          {allowNotes ? (
            <div className="mb-2">
              <label htmlFor="sf-note" className="block font-semibold text-[var(--sf-text)] mb-2">
                Special Instructions
              </label>
              <textarea
                id="sf-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 300))}
                rows={2}
                placeholder="e.g. No onions, extra spicy"
                className="w-full p-3 rounded-xl border border-black/10 bg-[var(--sf-surface)] text-[var(--sf-text)] text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--sf-primary)]"
              />
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-red-600 font-medium mt-2">
              {error}
            </p>
          ) : null}
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 p-4 border-t border-black/10 bg-[var(--sf-bg)] flex items-center gap-3">
          <div className="flex items-center gap-1 border border-black/15 rounded-full p-1">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Decrease quantity"
              className="w-9 h-9 rounded-full font-bold text-lg hover:bg-[var(--sf-surface)]"
            >
              −
            </button>
            <span className="w-8 text-center font-semibold" aria-live="polite">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(30, q + 1))}
              aria-label="Increase quantity"
              className="w-9 h-9 rounded-full font-bold text-lg hover:bg-[var(--sf-surface)]"
            >
              +
            </button>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            className="flex-1 py-3 px-4 font-semibold bg-[var(--sf-button)] text-[var(--sf-button-text)] hover:opacity-90 active:scale-[.98] transition-all"
            style={{ borderRadius: "var(--sf-radius)" }}
          >
            Add to Cart · {formatPrice(unitPrice * quantity, currencySymbol)}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductModal;
