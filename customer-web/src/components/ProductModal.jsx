import React, { useMemo, useState } from "react";

/**
 * Product detail sheet.
 *
 * Handles required modifier groups (min/max selection), optional add-ons,
 * variants, quantity, and an optional note. The `unitPrice` we compute here is
 * only for a nicer UX — the backend re-prices from the same identifiers, so
 * the customer cannot pay less by editing the DOM (§10).
 */
export default function ProductModal({ product, symbol, onClose, onAdd, allowNotes }) {
  const [selectedVariant, setSelectedVariant] = useState(product.variants?.[0] || null);
  const [selectedAddons, setSelectedAddons] = useState([]);
  const [selectedModifiers, setSelectedModifiers] = useState({}); // { groupId: [optionId, ...] }
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const toggleAddon = (addon) => {
    setSelectedAddons((prev) =>
      prev.find((a) => a.id === addon.id) ? prev.filter((a) => a.id !== addon.id) : [...prev, addon]
    );
  };

  const toggleModifier = (group, option) => {
    setSelectedModifiers((prev) => {
      const current = prev[group.id] || [];
      const already = current.find((o) => o.id === option.id);
      let next;
      if (already) {
        next = current.filter((o) => o.id !== option.id);
      } else if (group.maxSelections <= 1) {
        next = [option];
      } else if (current.length >= group.maxSelections) {
        return prev;
      } else {
        next = [...current, option];
      }
      return { ...prev, [group.id]: next };
    });
  };

  const unitPrice = useMemo(() => {
    const base = selectedVariant?.price ?? product.price ?? 0;
    const addonSum = selectedAddons.reduce((s, a) => s + Number(a.price || 0), 0);
    const modifierSum = Object.values(selectedModifiers)
      .flat()
      .reduce((s, o) => s + Number(o.price || 0), 0);
    return base + addonSum + modifierSum;
  }, [product, selectedVariant, selectedAddons, selectedModifiers]);

  const handleAdd = () => {
    // Enforce required-group rules client-side too, so the customer gets an
    // instant, friendly error before we hit the server.
    for (const group of product.modifierGroups || []) {
      const chosen = selectedModifiers[group.id] || [];
      if (group.required && chosen.length < (group.minSelections || 1)) {
        setError(`Please select at least ${group.minSelections || 1} option in "${group.name}".`);
        return;
      }
    }

    onAdd({
      menuId: product.menuId,
      itemId: product.id,
      name: product.name,
      quantity,
      unitPrice,
      price: unitPrice,
      variant: selectedVariant
        ? { variantId: selectedVariant.id, name: selectedVariant.name, price: selectedVariant.price }
        : null,
      addons: selectedAddons.map((a) => ({ addonId: a.id, name: a.name, price: a.price })),
      modifierSelections: Object.entries(selectedModifiers).flatMap(([groupId, opts]) => {
        const group = (product.modifierGroups || []).find((g) => g.id === groupId);
        return opts.map((o) => ({
          groupId,
          groupName: group?.name || "",
          optionId: o.id,
          optionName: o.name,
          price: o.price,
        }));
      }),
      note: note.trim(),
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {product.image ? (
          <img src={product.image} alt={product.imageAlt || product.name} className="w-full h-48 object-cover" />
        ) : null}

        <div className="p-5 overflow-y-auto">
          <h2 className="text-xl font-semibold">{product.name}</h2>
          {product.description ? (
            <p className="mt-1 text-sm text-slate-500">{product.description}</p>
          ) : null}

          {product.variants?.length ? (
            <Section title="Size">
              {product.variants.map((v) => (
                <Option
                  key={v.id}
                  label={v.name}
                  hint={`${symbol}${Number(v.price).toFixed(2)}`}
                  selected={selectedVariant?.id === v.id}
                  onClick={() => setSelectedVariant(v)}
                />
              ))}
            </Section>
          ) : null}

          {(product.modifierGroups || []).map((group) => (
            <Section
              key={group.id}
              title={group.name}
              subtitle={
                group.required
                  ? `Required · pick ${group.minSelections || 1}${
                      group.maxSelections > 1 ? `–${group.maxSelections}` : ""
                    }`
                  : group.maxSelections > 1
                  ? `Pick up to ${group.maxSelections}`
                  : "Optional"
              }
            >
              {group.options.map((o) => (
                <Option
                  key={o.id}
                  label={o.name}
                  hint={o.price ? `+ ${symbol}${Number(o.price).toFixed(2)}` : ""}
                  selected={(selectedModifiers[group.id] || []).some((x) => x.id === o.id)}
                  onClick={() => toggleModifier(group, o)}
                />
              ))}
            </Section>
          ))}

          {product.addons?.length ? (
            <Section title="Add extras">
              {product.addons.map((a) => (
                <Option
                  key={a.id}
                  label={a.name}
                  hint={a.price ? `+ ${symbol}${Number(a.price).toFixed(2)}` : ""}
                  selected={!!selectedAddons.find((x) => x.id === a.id)}
                  onClick={() => toggleAddon(a)}
                />
              ))}
            </Section>
          ) : null}

          {allowNotes ? (
            <Section title="Special instructions">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 250))}
                rows={2}
                placeholder="e.g. no onions"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
              />
            </Section>
          ) : null}

          {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
        </div>

        <div className="border-t p-4 flex items-center gap-3">
          <div className="flex items-center rounded-full border border-slate-200 overflow-hidden">
            <button
              type="button"
              className="px-3 py-1 text-lg"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="px-3 min-w-[2rem] text-center">{quantity}</span>
            <button
              type="button"
              className="px-3 py-1 text-lg"
              onClick={() => setQuantity((q) => Math.min(20, q + 1))}
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            className="flex-1 bg-brand text-brand-fg font-semibold rounded-full py-3 hover:opacity-90 transition"
          >
            Add · {symbol}
            {(unitPrice * quantity).toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle ? <span className="text-xs text-slate-500">{subtitle}</span> : null}
      </div>
      <div className="mt-2 space-y-1.5">{children}</div>
    </div>
  );
}

function Option({ label, hint, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-sm transition ${
        selected ? "border-brand bg-brand/5 text-slate-900" : "border-slate-200 hover:border-slate-300"
      }`}
    >
      <span>{label}</span>
      {hint ? <span className="text-slate-500 text-xs">{hint}</span> : null}
    </button>
  );
}
