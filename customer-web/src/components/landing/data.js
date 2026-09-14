import { useEffect } from "react";

/**
 * Landing-page data helpers shared by the five designs: the address block,
 * per-design font loading and the featured dishes.
 */

/** The store's address as one printable block, or null. */
export const addressLines = (contact = {}) => {
  const lines = [contact.addressLine1, contact.addressLine2].filter(Boolean);
  const tail = [contact.city, contact.postalCode].filter(Boolean).join(" ");
  if (tail) lines.push(tail);
  return lines.length ? lines : null;
};

/**
 * Load a display font for one template.
 *
 * Each of the five designs leans on a different typeface -- a high-contrast
 * Bodoni for the tasting rooms, a condensed grotesk for the izakaya -- and
 * loading all of them on every site would cost every store bandwidth for four
 * fonts it never renders. The link is left in the head: a customer who returns
 * gets it from cache, and removing it on unmount would only make navigating
 * between the landing page and the menu re-request it.
 */
export function useGoogleFont(spec) {
  useEffect(() => {
    if (!spec) return;
    const href = `https://fonts.googleapis.com/css2?${spec}&display=swap`;
    if (document.head.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [spec]);
}

/**
 * The two or three dishes a landing page puts in front of a customer.
 *
 * The whole menu belongs on the menu page. A front door shows a few things
 * worth coming for and hands the customer on, so this returns at most `count`.
 *
 * The operator picks them in Manage Website. A store that never has falls back
 * to the first few available dishes, because an empty space where the food
 * should be is worse than an arbitrary but real dish.
 */
export function featuredDishes(landing, categories, count = 3) {
  const all = (categories || []).flatMap((c) =>
    (c.products || []).map((p) => ({ ...p, category: c.name }))
  );
  const available = all.filter((p) => p.isAvailable !== false);

  const picked = (landing?.featuredItems || [])
    .map((id) => available.find((p) => String(p.id) === String(id)))
    .filter(Boolean);

  if (picked.length) return picked.slice(0, count);

  // Prefer dishes that have a photograph: every one of these designs frames
  // the food, and a grey placeholder in the hero is worse than a second choice
  // of dish.
  const withImage = available.filter((p) => p.image);
  return (withImage.length >= count ? withImage : available).slice(0, count);
}
