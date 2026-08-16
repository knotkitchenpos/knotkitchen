import React from "react";
import { formatPrice } from "../theme";

/**
 * Product card — renders in the layout the store selected
 * (grid | list | compact | showcase).
 *
 * Images are lazy-loaded and use the thumbnail derivative when available, so a
 * long menu doesn't download dozens of full-resolution photos (§23).
 */

const VegBadge = ({ isVeg }) => (
  <span
    aria-label={isVeg ? "Vegetarian" : "Non-vegetarian"}
    title={isVeg ? "Vegetarian" : "Non-vegetarian"}
    className={`inline-flex items-center justify-center w-4 h-4 border-2 rounded-[3px] shrink-0 ${
      isVeg ? "border-green-600" : "border-red-600"
    }`}
  >
    <span className={`w-2 h-2 rounded-full ${isVeg ? "bg-green-600" : "bg-red-600"}`} />
  </span>
);

const ProductImage = ({ product, className }) => {
  if (!product.thumbnail && !product.image) {
    return (
      <div
        className={`${className} flex items-center justify-center bg-[var(--sf-surface)] text-3xl`}
        aria-hidden="true"
      >
        🍽️
      </div>
    );
  }
  return (
    <img
      src={product.thumbnail || product.image}
      alt={product.imageAlt || product.name}
      loading="lazy"
      decoding="async"
      className={`${className} object-cover`}
    />
  );
};

const ProductCard = ({ product, layout = "grid", currencySymbol = "₹", onSelect }) => {
  const unavailable = !product.isAvailable;
  const needsChoice =
    product.variants?.length > 0 || product.modifierGroups?.some((g) => g.required);

  const priceBlock = (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="font-bold text-[var(--sf-text)]">
        {formatPrice(product.price, currencySymbol)}
      </span>
      {product.originalPrice ? (
        <span className="text-sm line-through text-[var(--sf-muted)]">
          {formatPrice(product.originalPrice, currencySymbol)}
        </span>
      ) : null}
    </div>
  );

  const addButton = (
    <button
      type="button"
      disabled={unavailable}
      onClick={() => onSelect(product)}
      aria-label={`Add ${product.name} to cart`}
      className={`shrink-0 px-5 py-2 text-sm font-semibold transition-all ${
        unavailable
          ? "bg-gray-200 text-gray-400 cursor-not-allowed"
          : "bg-[var(--sf-button)] text-[var(--sf-button-text)] hover:opacity-90 active:scale-95 shadow-sm"
      }`}
      style={{ borderRadius: "var(--sf-radius)" }}
    >
      {unavailable ? "Unavailable" : needsChoice ? "Choose" : "Add"}
    </button>
  );

  // ---- List / compact: horizontal, image on the side ----
  if (layout === "list" || layout === "compact") {
    return (
      <article
        className={`flex gap-4 p-4 bg-[var(--sf-bg)] border border-black/5 rounded-2xl ${
          unavailable ? "opacity-60" : ""
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <VegBadge isVeg={product.isVegetarian} />
            <h3 className="font-semibold text-[var(--sf-text)] truncate">{product.name}</h3>
          </div>
          {product.description && layout === "list" ? (
            <p className="text-sm text-[var(--sf-muted)] line-clamp-2 mb-2">{product.description}</p>
          ) : null}
          {priceBlock}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <ProductImage product={product} className="w-24 h-24 rounded-xl" />
          {addButton}
        </div>
      </article>
    );
  }

  // ---- Grid / showcase: vertical, image on top ----
  const imageHeight = layout === "showcase" ? "h-56" : "h-40";

  return (
    <article
      className={`group flex flex-col bg-[var(--sf-bg)] border border-black/5 rounded-2xl overflow-hidden hover:shadow-lg transition-shadow ${
        unavailable ? "opacity-60" : ""
      }`}
    >
      <div className="relative overflow-hidden">
        <ProductImage
          product={product}
          className={`w-full ${imageHeight} group-hover:scale-105 transition-transform duration-300`}
        />
        {product.originalPrice ? (
          <span className="absolute top-3 left-3 px-2 py-1 text-xs font-bold rounded-full bg-[var(--sf-accent)] text-white shadow">
            OFFER
          </span>
        ) : null}
        {unavailable ? (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="px-3 py-1 bg-white text-sm font-semibold rounded-full">
              Unavailable
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col flex-1 p-4">
        <div className="flex items-center gap-2 mb-1">
          <VegBadge isVeg={product.isVegetarian} />
          <h3 className="font-semibold text-[var(--sf-text)] leading-tight">{product.name}</h3>
        </div>
        {product.description ? (
          <p className="text-sm text-[var(--sf-muted)] line-clamp-2 mb-3">{product.description}</p>
        ) : null}
        <div className="mt-auto flex items-center justify-between gap-3">
          {priceBlock}
          {addButton}
        </div>
      </div>
    </article>
  );
};

export default ProductCard;
