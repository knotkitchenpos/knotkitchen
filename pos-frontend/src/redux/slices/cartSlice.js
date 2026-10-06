import { createSlice } from "@reduxjs/toolkit";
import { setOrderType } from "./orderTypeSlice.js";

const initialState = [];

/**
 * Build a stable fingerprint for the customisation of a cart line so two
 * additions of the SAME product with DIFFERENT extras/variant/note are kept
 * as separate lines instead of being silently merged.
 *
 * Example: adding "Chicken + Tomato" and then "Chicken + Sauce" used to
 * merge into "2× Chicken + Sauce" because the reducer matched only on
 * `menuItemId`. With the fingerprint we compare the full customisation
 * so each combination gets its own line, preserving the extras the
 * biller actually rang in.
 */
const modFingerprint = (mods) => {
    if (!Array.isArray(mods) || mods.length === 0) return "";
    return mods
        .map((m) => {
            const g = m?.groupName || m?.groupId || "";
            const o = m?.optionName || m?.optionId || m?.name || "";
            const q = Number(m?.quantity || 1);
            return `${g}::${o}::${q}`;
        })
        .sort()
        .join("|");
};

const lineFingerprint = (item) => {
    if (!item) return "";
    return [
        String(item.menuItemId || ""),
        String(item.variantId || item.variant?.name || ""),
        modFingerprint(item.modifiers || item.modifierSelections || []),
        String(item.note || ""),
    ].join("###");
};

/**
 * Whether the ⊗ on a cart extra may remove it. The last choice of a required
 * group may not: the add dialog enforces "required", but the cart could undo
 * it and send the table a line the server then rejects or misprices. To change
 * a required choice, remove the line and add it again.
 */
export const canRemoveModifier = (item, index) => {
    const mods = Array.isArray(item?.modifiers) ? item.modifiers : [];
    const mod = mods[index];
    if (!mod?.required) return true;
    return mods.some((m, i) => i !== index && m?.groupName === mod.groupName);
};

const cartSlice = createSlice({
    name : "cart",
    initialState,
    reducers : {
        addItems : (state, action) => {
            const newItem = action.payload;
            // Merge ONLY when the incoming line is an exact duplicate of an
            // existing line (same product, same variant, same modifiers,
            // same note). Anything else must become its own line so the
            // per-instance extras are preserved through the bill.
            const newFp = lineFingerprint(newItem);
            const existing = state.find(item => lineFingerprint(item) === newFp);
            if (existing) {
                existing.quantity += newItem.quantity;
                existing.price = existing.pricePerQuantity * existing.quantity;
            } else {
                state.push(newItem);
            }
        },

        removeItem: (state, action) => {
            return state.filter(item => item.id != action.payload);
        },

        removeAllItems: () => [],

        setCart: (_state, action) => {
            return Array.isArray(action.payload) ? action.payload : [];
        },

        updateQuantity: (state, action) => {
            const { id, quantity } = action.payload;
            const item = state.find(item => item.id === id);
            if (item && quantity > 0) {
                item.quantity = quantity;
                item.price = item.pricePerQuantity * quantity;
            }
        },

        updateItemNote: (state, action) => {
            const { id, note } = action.payload;
            const item = state.find(item => item.id === id);
            if (item) {
                item.note = note;
            }
        },

        // Drop a single modifier from a cart line without touching the base
        // product. Payload: { id, index, kind: "structured" | "token" }.
        // "structured" removes item.modifiers[index] and reprices the line.
        // "token" edits the display name to strip the parsed "(+ X, Y)"
        // token at `index` — used for legacy items already in the cart that
        // predate structured modifiers and carry their extras only in name.
        removeModifier: (state, action) => {
            const { id, index, kind = "structured" } = action.payload || {};
            const item = state.find((i) => i.id === id);
            if (!item || typeof index !== "number") return;

            if (kind === "structured") {
                const mods = Array.isArray(item.modifiers) ? item.modifiers : [];
                if (index < 0 || index >= mods.length) return;
                if (!canRemoveModifier(item, index)) return;
                const removed = mods[index];
                const removedUnit = Number(removed?.price || 0) * Number(removed?.quantity || 1);
                item.modifiers = mods.filter((_, i) => i !== index);
                // modifierSelections is what the table server prices and the
                // receipt falls back to; left alone, the removed extra was
                // still billed and printed. ProductPanel fills both with the
                // same list, so keep them the same.
                if (Array.isArray(item.modifierSelections)) item.modifierSelections = item.modifiers;

                // Reprice: pricePerQuantity was base + all mod unit prices.
                // Subtract just the removed one and re-derive line total.
                item.pricePerQuantity = Math.max(
                    0,
                    Number(item.pricePerQuantity || 0) - removedUnit
                );
                item.price = item.pricePerQuantity * Number(item.quantity || 1);

                // Keep the display name aligned with what's actually in the
                // line so the printed bill/kitchen ticket doesn't lie.
                const removedLabel = (removed?.optionName || removed?.name || "").trim();
                if (removedLabel && typeof item.name === "string") {
                    // "Base (+ A, B, C)" → remove the matching token
                    item.name = item.name.replace(
                        /\s*\(\+\s*([^()]+)\)\s*$/,
                        (m, inside) => {
                            const kept = inside
                                .split(",")
                                .map((s) => s.trim())
                                .filter((s) => s && s !== removedLabel);
                            return kept.length ? ` (+ ${kept.join(", ")})` : "";
                        }
                    );
                }
                return;
            }

            if (kind === "token") {
                // Legacy line: modifiers live only in the "Base (+ A, B)" tail.
                if (typeof item.name !== "string") return;
                item.name = item.name.replace(
                    /\s*\(\+\s*([^()]+)\)\s*$/,
                    (m, inside) => {
                        const parts = inside.split(",").map((s) => s.trim()).filter(Boolean);
                        const kept = parts.filter((_, i) => i !== index);
                        return kept.length ? ` (+ ${kept.join(", ")})` : "";
                    }
                );
            }
        },
    },
    // A line's price was fixed when it was added, so switching Collection /
    // Delivery / Table kept the old channel's price while the grid showed the
    // new one. ProductPanel stamps every channel's base price on the line
    // (channelBase); reprice from it. Variant lines have none: a variant's
    // price is the same on every channel.
    extraReducers: (builder) => {
        builder.addCase(setOrderType, (state, { payload }) => {
            for (const line of state) {
                const base = line.channelBase?.[payload];
                if (base == null) continue;
                const extras = (line.modifiers || []).reduce(
                    (s, m) => s + Number(m?.price || 0) * Number(m?.quantity || 1),
                    0
                );
                line.pricePerQuantity = Number(base) + extras;
                line.price = line.pricePerQuantity * Number(line.quantity || 1);
            }
        });
    },
})

export const getTotalPrice = (state) => state.cart.reduce((total, item) => total + item.price, 0);
export const { addItems, removeItem, removeAllItems, setCart, updateQuantity, updateItemNote, removeModifier } = cartSlice.actions;
export default cartSlice.reducer;