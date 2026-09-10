import { useEffect, useState } from "react";

/**
 * Landing-page data helpers.
 *
 * Split from kit.jsx because a module that exports both components and plain
 * functions breaks fast refresh, and this half is all plain functions and
 * hooks. Between them these two files are everything the five landing designs
 * genuinely share -- which is deliberately almost nothing with a look to it.
 */

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** True once the page has scrolled past `threshold`. */
export function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

/**
 * Operator-typed prose, split on blank lines.
 *
 * Returned as an array of strings rather than markup: nothing typed into the
 * POS reaches a customer's browser as HTML.
 */
export const paras = (text) =>
  String(text || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * What this store actually has to show, and what it has switched on.
 *
 * Every template asks the same question -- "is there a gallery worth a
 * section?" -- and a section heading over an empty grid is worse than no
 * section, so the emptiness check and the operator's switch are answered
 * together, once.
 */
export function useLandingData(landing, store) {
  const symbol = store?.ordering?.currencySymbol || "₹";
  const categories = store?.categories || [];
  const offers = (store?.offers || []).filter(Boolean);
  const hours = store?.openingHours || [];
  const contact = store?.contact || {};
  const features = (landing?.features || []).filter((f) => f && (f.title || f.text));
  const gallery = (landing?.gallery || []).filter((g) => g && g.url);

  const show = {
    features: features.length > 0,
    about: landing?.showAbout !== false && Boolean(landing?.about?.text || landing?.about?.image),
    menu: landing?.showMenuPreview !== false && categories.length > 0,
    gallery: landing?.showGallery !== false && gallery.length > 0,
    offers: landing?.showOffers !== false && offers.length > 0,
    hours: landing?.showHours !== false && hours.length > 0,
    contact:
      landing?.showContact !== false &&
      Boolean(contact.phone || contact.email || contact.addressLine1),
  };

  return { symbol, categories, offers, hours, contact, features, gallery, show };
}

/** The store's address as one printable block, or null. */
export const addressLines = (contact = {}) => {
  const lines = [contact.addressLine1, contact.addressLine2].filter(Boolean);
  const tail = [contact.city, contact.postalCode].filter(Boolean).join(" ");
  if (tail) lines.push(tail);
  return lines.length ? lines : null;
};

/** The social links a store has filled in. */
export const socialLinks = (contact = {}) =>
  [
    contact.social?.instagram ? { href: contact.social.instagram, label: "Instagram" } : null,
    contact.social?.facebook ? { href: contact.social.facebook, label: "Facebook" } : null,
    contact.social?.twitter ? { href: contact.social.twitter, label: "Twitter" } : null,
  ].filter(Boolean);

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
