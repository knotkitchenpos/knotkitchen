import React, { useState } from "react";
import { thumbUrl } from "../lib/thumbUrl";
import {
  isCustomisable,
  linesFor,
  qtyInCart,
  simpleLine,
} from "../lib/cartLine";

/** ₹250, or ₹249.50 when there are paise. */
const price = (symbol, n) => {
  const v = Number(n) || 0;
  return `${symbol}${v % 1 ? v.toFixed(2) : v}`;
};

/** The square-and-dot food mark: green for veg, red with a triangle for non-veg. */
export function FoodMark({ veg }) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] ${
        veg ? "border-green-600" : "border-red-700"
      }`}
      role="img"
      aria-label={veg ? "Vegetarian" : "Non-vegetarian"}
    >
      {veg ? (
        <span className="h-2 w-2 rounded-full bg-green-600" />
      ) : (
        <span className="h-0 w-0 border-x-[4px] border-b-[7px] border-x-transparent border-b-red-700" />
      )}
    </span>
  );
}

/**
 * ADD, then − n + once it is in the cart. A dish with choices opens its
 * sheet instead of adding blind; taking one off a dish that is in the cart
 * with different choices opens the cart, where each line can be changed.
 */
function AddControl({ product, cart, onCustomise, onOpenCart, onAdded }) {
  const soldOut = product.isAvailable === false;
  const choices = isCustomisable(product);
  const qty = qtyInCart(cart.items, product.id);
  const base =
    "h-9 w-[104px] rounded-lg text-[14px] font-extrabold shadow-[0_2px_8px_rgba(15,23,42,.14)]";

  if (soldOut) {
    return (
      <span
        className={`${base} flex items-center justify-center border border-slate-200 bg-slate-50 text-[12px] text-slate-400 shadow-none`}
      >
        Sold out
      </span>
    );
  }

  const more = () => {
    if (choices) return onCustomise(product);
    cart.addItem(simpleLine(product));
    onAdded(product.name);
  };

  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={more}
        aria-label={`Add ${product.name}`}
        className={`${base} relative border border-slate-200 bg-white text-brand hover:bg-slate-50`}
      >
        ADD
        <span
          className="absolute right-1.5 top-0.5 text-[13px] leading-none"
          aria-hidden="true"
        >
          +
        </span>
      </button>
    );
  }

  const less = () => {
    const lines = linesFor(cart.items, product.id);
    if (lines.length !== 1) return onOpenCart();
    const line = lines[0];
    cart.updateQuantity(
      cart.lineSignature(line),
      (Number(line.quantity) || 1) - 1,
    );
  };

  return (
    <div
      className={`${base} flex items-center justify-between overflow-hidden bg-brand text-brand-fg`}
    >
      <button
        type="button"
        onClick={less}
        aria-label={`One less ${product.name}`}
        className="h-full w-8 text-lg leading-none"
      >
        −
      </button>
      <span className="tabular-nums" aria-live="polite">
        {qty}
      </span>
      <button
        type="button"
        onClick={more}
        aria-label={`One more ${product.name}`}
        className="h-full w-8 text-lg leading-none"
      >
        +
      </button>
    </div>
  );
}

/**
 * One dish on the menu, as a food-delivery app lists it: the mark, tags,
 * name, price and description on the left; the photo on the right with the
 * ADD button sitting on its bottom edge. Tapping the photo or the name opens
 * the full sheet.
 */
export default function ProductCard({
  product,
  symbol,
  tag,
  cart,
  onSelect,
  onOpenCart,
  onAdded,
}) {
  const [more, setMore] = useState(false);
  const soldOut = product.isAvailable === false;
  // "Collection Only" and friends, from the payload. Null when the product
  // can be bought through every order type, which is the usual case.
  const dispatch = product.dispatchLabel || null;
  const hasDiscount =
    product.originalPrice && product.originalPrice > product.price;
  const description = product.description || "";
  const long = description.length > 90;

  return (
    <article
      className={`flex gap-4 border-b border-dashed border-slate-300 py-6 last:border-b-0 ${soldOut ? "opacity-60" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <FoodMark veg={product.isVegetarian} />
          {tag ? (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-amber-700">
              {tag}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onSelect(product)}
          className="mt-1.5 text-left"
        >
          <h4 className="text-[16px] font-semibold leading-snug text-slate-900">
            {product.name}
          </h4>
        </button>
        <div className="mt-1 flex items-baseline gap-2 text-[15px]">
          <span className="font-medium text-slate-900">
            {price(symbol, product.price)}
          </span>
          {hasDiscount ? (
            <span className="text-[13px] text-slate-400 line-through">
              {price(symbol, product.originalPrice)}
            </span>
          ) : null}
        </div>
        {dispatch ? (
          <span className="mt-2 inline-block rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            {dispatch}
          </span>
        ) : null}
        {description ? (
          <p
            className={`mt-2 text-[13.5px] leading-relaxed text-slate-500 ${more ? "" : "line-clamp-2"}`}
          >
            {description}
          </p>
        ) : null}
        {long ? (
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            className="mt-0.5 text-[13px] font-semibold text-slate-700"
          >
            {more ? "less" : "read more"}
          </button>
        ) : null}
      </div>

      <div className="flex w-[132px] shrink-0 flex-col items-center sm:w-[156px]">
        {product.image ? (
          // 4:3, the shape item photos are made in the POS.
          <button
            type="button"
            onClick={() => onSelect(product)}
            aria-label={`About ${product.name}`}
            className="block aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-100"
          >
            <img
              src={thumbUrl(product.thumbnail || product.image, 320)}
              alt={product.imageAlt || product.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        ) : null}
        <div className={`relative z-10 ${product.image ? "-mt-5" : "mt-1"}`}>
          <AddControl
            product={product}
            cart={cart}
            onCustomise={onSelect}
            onOpenCart={onOpenCart}
            onAdded={onAdded}
          />
        </div>
        {isCustomisable(product) && !soldOut ? (
          <p className="mt-1.5 text-[11px] text-slate-400">customisable</p>
        ) : null}
      </div>
    </article>
  );
}
