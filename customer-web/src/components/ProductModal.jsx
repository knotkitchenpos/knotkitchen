import React, { useMemo, useState } from "react";
import { dispatchLabel } from "../lib/dispatch";
import { capLabel, capOf } from "../lib/modifierGroups";

/**
 * Product detail sheet.
 *
 * Laid out to match the table-QR sheet a diner sees after scanning, because
 * they are the same job on two surfaces and a customer who has used one should
 * recognise the other: a header that stays put, the choices scrolling between
 * it and a footer that always shows the running total and the button.
 *
 * Every option is a real checkbox or radio rather than a bordered button. A
 * button that changes colour when chosen is guesswork on a phone in a dark
 * room; a ticked box is not, and it is what assistive technology reads.
 *
 * The `unitPrice` computed here is only for a nicer experience -- the backend
 * re-prices from the same identifiers, so the customer cannot pay less by
 * editing the DOM.
 */
export default function ProductModal({ product, symbol, onClose, onAdd, allowNotes }) {
  const variants = product.variants || [];
  const groups = product.modifierGroups || [];
  const addons = product.addons || [];

  const [selectedVariant, setSelectedVariant] = useState(variants[0] || null);
  const [selectedAddons, setSelectedAddons] = useState([]);
  const [selectedModifiers, setSelectedModifiers] = useState({}); // { groupId: [option, ...] }
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  const money = (n) => `${symbol}${Number(n || 0).toFixed(2)}`;

  const toggleAddon = (addon) => {
    setSelectedAddons((prev) =>
      prev.find((a) => a.id === addon.id) ? prev.filter((a) => a.id !== addon.id) : [...prev, addon]
    );
  };

  const toggleModifier = (group, option) => {
    setSelectedModifiers((prev) => {
      const current = prev[group.id] || [];
      const already = current.find((o) => o.id === option.id);
      if (already) return { ...prev, [group.id]: current.filter((o) => o.id !== option.id) };

      const cap = capOf(group);
      // A cap of one behaves like a radio: picking swaps rather than blocks.
      if (cap === 1) return { ...prev, [group.id]: [option] };
      if (current.length >= cap) return prev;
      return { ...prev, [group.id]: [...current, option] };
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

  // Required groups are enforced BEFORE the button can be pressed, not after.
  // Telling a customer what was wrong once they have already committed is the
  // worst moment to tell them.
  const missingRequired = groups.filter(
    (g) => g.required && (selectedModifiers[g.id] || []).length < (g.minSelections || 1)
  );
  const needsVariant = variants.length > 0 && !selectedVariant;
  const blocked = needsVariant || missingRequired.length > 0;

  const handleAdd = () => {
    if (blocked) return;
    onAdd({
      menuId: product.menuId,
      itemId: product.id,
      name: product.name,
      // Carried onto the cart line so the basket can warn about a line that
      // does not suit the fulfilment the customer ends up choosing.
      dispatchType: product.dispatchType || null,
      quantity,
      unitPrice,
      price: unitPrice,
      variant: selectedVariant
        ? { variantId: selectedVariant.id, name: selectedVariant.name, price: selectedVariant.price }
        : null,
      addons: selectedAddons.map((a) => ({ addonId: a.id, name: a.name, price: a.price })),
      modifierSelections: Object.entries(selectedModifiers).flatMap(([groupId, opts]) => {
        const group = groups.find((g) => g.id === groupId);
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
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Choose options for ${product.name}`}
    >
      <div
        className="flex max-h-[88vh] w-full flex-col rounded-t-3xl bg-white sm:max-w-md sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — stays put while the choices scroll under it. */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-extrabold leading-snug text-slate-900">{product.name}</h3>
            {product.description ? (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-slate-500">{product.description}</p>
            ) : null}
            {dispatchLabel(product.dispatchType) ? (
              <span className="mt-1.5 inline-block rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                {dispatchLabel(product.dispatchType)}
              </span>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 shrink-0 rounded-full bg-slate-100 text-lg font-bold leading-none text-slate-600"
          >
            ×
          </button>
        </div>

        {/* Choices */}
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {variants.length > 0 ? (
            <Group title="Choose a size" hint="Required" hintTone="required">
              {variants.map((v) => (
                <Choice
                  key={v.id}
                  type="radio"
                  name="variant"
                  label={v.name}
                  price={money(v.price)}
                  checked={selectedVariant?.id === v.id}
                  onChange={() => setSelectedVariant(v)}
                />
              ))}
            </Group>
          ) : null}

          {groups.map((group) => {
            const chosen = selectedModifiers[group.id] || [];
            const cap = capOf(group);
            const single = cap === 1;
            return (
              <Group
                key={group.id}
                title={group.name}
                hint={`${group.required ? "Required" : "Optional"} · ${capLabel(group)}`}
                hintTone={group.required ? "required" : "optional"}
              >
                {group.options.map((o) => {
                  const active = chosen.some((x) => x.id === o.id);
                  return (
                    <Choice
                      key={o.id}
                      type={single ? "radio" : "checkbox"}
                      name={single ? `grp-${group.id}` : undefined}
                      label={o.name}
                      price={o.price ? `+${money(o.price)}` : ""}
                      checked={active}
                      // Past the cap the remaining options dim rather than
                      // disappear, so the customer can see what they gave up.
                      atCap={!active && !single && chosen.length >= cap}
                      onChange={() => toggleModifier(group, o)}
                    />
                  );
                })}
                {group.options.length === 0 ? (
                  <p className="text-[12px] text-slate-400">No options in this group.</p>
                ) : null}
              </Group>
            );
          })}

          {addons.length > 0 ? (
            <Group title="Add extras" hint="Optional · Choose any" hintTone="optional">
              {addons.map((a) => (
                <Choice
                  key={a.id}
                  type="checkbox"
                  label={a.name}
                  price={a.price ? `+${money(a.price)}` : ""}
                  checked={!!selectedAddons.find((x) => x.id === a.id)}
                  onChange={() => toggleAddon(a)}
                />
              ))}
            </Group>
          ) : null}

          {allowNotes ? (
            <Group title="Special instructions" hint="Optional" hintTone="optional">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 250))}
                rows={2}
                placeholder="e.g. no onions"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-brand"
              />
            </Group>
          ) : null}
        </div>

        {/* Footer — the running total and the button never scroll away. */}
        <div className="shrink-0 space-y-3 border-t border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="h-9 w-9 rounded-full bg-slate-100 text-lg font-bold text-slate-700"
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="min-w-[20px] text-center font-extrabold text-slate-900">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                className="h-9 w-9 rounded-full bg-brand text-lg font-bold text-brand-fg"
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
            <span className="font-extrabold text-slate-900">{money(unitPrice * quantity)}</span>
          </div>

          {blocked ? (
            <p className="text-center text-[12px] font-bold text-rose-500">
              {needsVariant
                ? "Please choose a size."
                : `Please choose ${missingRequired.map((g) => `"${g.name}"`).join(", ")}.`}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleAdd}
            disabled={blocked}
            className="h-12 w-full rounded-2xl bg-brand text-[14px] font-extrabold text-brand-fg transition hover:opacity-90 disabled:opacity-50"
          >
            Add to cart · {money(unitPrice * quantity)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Group({ title, hint, hintTone, children }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-[13px] font-extrabold text-slate-900">{title}</h4>
        {hint ? (
          <span
            className={`shrink-0 text-[11px] font-bold ${
              hintTone === "required" ? "text-rose-500" : "text-slate-400"
            }`}
          >
            {hint}
          </span>
        ) : null}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Choice({ type, name, label, price, checked, atCap, onChange }) {
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-[13px] ${
        atCap ? "opacity-45" : "cursor-pointer"
      } ${checked ? "border-brand" : "border-slate-200"}`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <input
          type={type}
          name={name}
          checked={checked}
          disabled={atCap}
          onChange={onChange}
          className="h-4 w-4 accent-[var(--brand,#e2571e)]"
        />
        <span className="truncate font-bold text-slate-800">{label}</span>
      </span>
      {price ? (
        <span className="shrink-0 font-extrabold text-slate-900">{price}</span>
      ) : (
        <span className="shrink-0 text-[11px] font-bold text-slate-400">Free</span>
      )}
    </label>
  );
}
