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
