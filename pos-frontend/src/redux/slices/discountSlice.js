import { createSlice, createSelector } from "@reduxjs/toolkit";

/**
 * POS cart-level discount (Module 2 §1, §2).
 *
 * The discount is a single "manual" override the biller applies to the cart
 * before finishing the order. Coupons, loyalty and promo-rule discounts
 * remain separate concerns (see backend orderPricingService — those already
 * compute server-side and are out of scope for Module 2).
 *
 * Shape:
 *   mode:  "none" | "percent" | "fixed"
 *   value: number
 *     - percent → 0..100 (validated at write-time; clamped again in the
 *       selector so a bad persisted value can't blow up the receipt)
 *     - fixed   → 0..1e6 (₹); the selector caps the resulting discount at
 *       the current pre-tax applicable amount so it can never exceed the
 *       order and produce a negative total
 *
 * The value is NEVER trusted for money by the backend — the server-side
 * order controller re-sanitises `bills.discount` (see sanitizeBills in
 * orderController.js). This slice is purely to drive the UI and to pass a
 * hint to the server; the server owns final numbers.
 */

const initialState = {
    mode: "none",
    value: 0,
};

const clampPercent = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return 0;
    if (v > 100) return 100;
    return v;
};

const clampFixed = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return 0;
    // Absolute upper bound to defeat obviously-broken input. The
    // selector further caps by the applicable order amount at read-time.
    if (v > 1_000_000) return 1_000_000;
    return v;
};

const discountSlice = createSlice({
    name: "discount",
    initialState,
    reducers: {
        setPercentDiscount: (state, action) => {
            state.mode = "percent";
            state.value = clampPercent(action.payload);
        },
        setFixedDiscount: (state, action) => {
            state.mode = "fixed";
            state.value = clampFixed(action.payload);
        },
        clearDiscount: () => ({ ...initialState }),
    },
});

export const { setPercentDiscount, setFixedDiscount, clearDiscount } = discountSlice.actions;

/**
 * Compute the discount amount in ₹ given the currently applicable amount
 * (typically subtotal, i.e. items × qty, before tax/packaging/delivery).
 *
 * Guarantees:
 *   - Never negative.
 *   - Never greater than `applicable` so the final total can't go below 0.
 *   - Rounded to 2 decimal places to match the way the rest of the pricing
 *     engine (orderPricingService.round2) treats money.
 */
export const computeDiscountAmount = ({ mode, value }, applicable) => {
    const base = Math.max(0, Number(applicable) || 0);
    if (!mode || mode === "none" || !Number(value)) return 0;
    if (mode === "percent") {
        const pct = clampPercent(value);
        const amt = (base * pct) / 100;
        return Math.round(amt * 100) / 100;
    }
    if (mode === "fixed") {
        const fixed = clampFixed(value);
        const amt = Math.min(fixed, base);
        return Math.round(amt * 100) / 100;
    }
    return 0;
};

/**
 * Selector factory so callers can memoise per-subtotal. Usage:
 *   const discountAmount = useSelector((s) => selectDiscountAmount(s, subtotal));
 */
export const selectDiscount = (state) => state.discount;

export const selectDiscountAmount = createSelector(
    [selectDiscount, (_state, applicable) => applicable],
    (discount, applicable) => computeDiscountAmount(discount, applicable),
);

/**
 * Human-readable label like "10%" or "₹50 off" for the cart summary row.
 */
export const formatDiscountLabel = ({ mode, value }) => {
    if (!mode || mode === "none" || !Number(value)) return "";
    if (mode === "percent") return `${clampPercent(value)}%`;
    return `₹${clampFixed(value)}`;
};

export default discountSlice.reducer;
