import { useEffect } from "react";
import { thumbUrl } from "../lib/thumbUrl";

/**
 * Apply a store's theme (colors + fonts) as CSS variables on <html>.
 *
 * This is the mechanism that makes the SAME customer website look completely
 * different for every restaurant without a rebuild (§32 of the spec). Nothing
 * else in the app writes to :root — reset happens in the cleanup phase so
 * navigating between stores in dev doesn't leak colors.
 */
export function useThemeVars(storeOrBootstrap) {
  useEffect(() => {
    if (!storeOrBootstrap) return undefined;

    // Support both the small "bootstrap" payload (primaryColor / secondaryColor)
    // and the full "storefront" payload (theme.colors / theme.typography).
    const colors = storeOrBootstrap.theme?.colors || {};
    const typography = storeOrBootstrap.theme?.typography || {};

    const vars = {
      "--brand": colors.button || colors.primary || storeOrBootstrap.primaryColor || "#e2571e",
      "--brand-fg": colors.buttonText || "#ffffff",
      "--accent": colors.accent || "#f5a524",
      "--text": colors.text || "#12161f",
      "--muted": colors.muted || "#6b7280",
      "--background": colors.background || "#ffffff",
      "--surface": colors.surface || "#f7f8fa",
      "--primary": colors.primary || storeOrBootstrap.primaryColor || "#e2571e",
      "--secondary": colors.secondary || storeOrBootstrap.secondaryColor || "#0d1526",
      "--font-heading": typography.headingFont || "Poppins",
      "--font-body": typography.bodyFont || "Inter",
    };

    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));

    return () => {
      Object.keys(vars).forEach((k) => root.style.removeProperty(k));
    };
  }, [storeOrBootstrap]);
}

/**
 * Apply the store's <title>, description, and favicon.
 *
 * The first paint already has them: nginx puts each page's own head into
 * index.html (pos-backend services/storeHead.js). This keeps them right as
 * the customer moves between pages without a reload, with the same wording:
 * the store's title on the home page, "<page> | <store>" elsewhere.
 */
export function useDocumentMeta(storeOrBootstrap, page = "") {
  useEffect(() => {
    if (!storeOrBootstrap) return undefined;

    const previousTitle = document.title;
    const name =
      storeOrBootstrap.name ||
      storeOrBootstrap.store?.name ||
      storeOrBootstrap.branding?.siteTitle ||
      storeOrBootstrap.siteTitle ||
      "Order Online";
    const siteTitle = storeOrBootstrap.siteTitle || storeOrBootstrap.branding?.siteTitle || name;
    document.title = page ? `${page} | ${name}` : siteTitle;

    const description =
      storeOrBootstrap.siteDescription ||
      storeOrBootstrap.branding?.siteDescription ||
      `Order online from ${name}.`;
    const setMeta = (metaName, content) => {
      if (!content) return null;
      let tag = document.head.querySelector(`meta[name="${metaName}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.name = metaName;
        document.head.appendChild(tag);
      }
      tag.content = content;
      return tag;
    };
    setMeta("description", description);

    // The store's favicon, else its logo. The full storefront payload sends
    // branding.favicon as a plain URL; the bootstrap sends faviconUrl.
    const fav = storeOrBootstrap.branding?.favicon;
    const logo = storeOrBootstrap.logoUrl || storeOrBootstrap.branding?.logo || "";
    const faviconUrl =
      storeOrBootstrap.faviconUrl || (typeof fav === "string" ? fav : fav?.url) || (logo ? thumbUrl(logo, 160) : "");
    if (faviconUrl) {
      const faviconLink = document.head.querySelector("link[rel='icon']") || document.createElement("link");
      faviconLink.rel = "icon";
      faviconLink.href = faviconUrl;
      if (!faviconLink.parentNode) document.head.appendChild(faviconLink);
    }

    return () => {
      document.title = previousTitle;
    };
  }, [storeOrBootstrap, page]);
}
