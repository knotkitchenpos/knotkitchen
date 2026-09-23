import React from "react";

/**
 * Small self-contained product card. Delegates the add-to-cart flow up to
 * the parent so we can show a product-detail modal for items with variants,
 * modifiers or add-ons.
 */
export default function ProductCard({ product, symbol, onSelect }) {
  const soldOut = product.isAvailable === false;
  // "Collection Only" and friends, from the payload. Null when the product
  // can be bought through every order type, which is the usual case.
  const dispatch = product.dispatchLabel || null;
  const hasDiscount = product.originalPrice && product.originalPrice > product.price;
  const base =
    "text-left group bg-white rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden flex flex-col";
  const disabled = soldOut ? " opacity-60 pointer-events-none" : "";

  return (
    <button
      type="button"
      onClick={() => !soldOut && onSelect(product)}
      disabled={soldOut}
      className={base + disabled}
    >
      {product.image ? (
        // The whole photo, never cropped. No blurred backdrop on cards (only
        // in ProductModal): a blur on every card blanks the list while
        // scrolling on slow devices.
        <div className="w-full h-40 overflow-hidden bg-slate-100">
          <img
            src={product.thumbnail || product.image}
            alt={product.imageAlt || product.name}
            loading="lazy"
            className="w-full h-full object-contain"
          />
        </div>
      ) : (
        <div className="w-full h-40 bg-slate-100 flex items-center justify-center text-4xl">
          <span aria-hidden="true">&#127869;</span>
        </div>
      )}

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-900">{product.name}</h3>
          {product.isVegetarian ? (
            <span className="inline-block text-xs px-1.5 py-0.5 rounded border border-green-600 text-green-700 shrink-0">
              Veg
            </span>
          ) : null}
        </div>
        {product.description ? (
          <p className="mt-1 text-sm text-slate-500 line-clamp-2">{product.description}</p>
        ) : null}
        {dispatch ? (
          <span className="mt-2 self-start inline-block text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            {dispatch}
          </span>
        ) : null}
        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-semibold text-slate-900">
            {symbol}
            {Number(product.price).toFixed(2)}
          </span>
          {hasDiscount ? (
            <span className="text-xs text-slate-400 line-through">
              {symbol}
              {Number(product.originalPrice).toFixed(2)}
            </span>
          ) : null}
          {soldOut ? (
            <span className="ml-auto text-xs font-medium text-red-600">Sold out</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
