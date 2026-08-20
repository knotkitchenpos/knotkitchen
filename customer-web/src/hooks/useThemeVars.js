import { useEffect } from "react";

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
 * Runs as soon as the bootstrap payload arrives so the browser tab and search
 * previews use the store's identity rather than the generic default in
 * index.html.
 */
export function useDocumentMeta(storeOrBootstrap) {
  useEffect(() => {
    if (!storeOrBootstrap) return undefined;

    const previousTitle = document.title;
    const title =
      storeOrBootstrap.siteTitle ||
      storeOrBootstrap.branding?.siteTitle ||
      storeOrBootstrap.name ||
      "Order Online";
    document.title = title;

    const description =
      storeOrBootstrap.siteDescription ||
      storeOrBootstrap.branding?.siteDescription ||
      "";
    const setMeta = (name, content) => {
      if (!content) return null;
      let tag = document.head.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.name = name;
        document.head.appendChild(tag);
      }
      tag.content = content;
      return tag;
    };
    setMeta("description", description);

    let faviconLink;
    const faviconUrl =
      storeOrBootstrap.faviconUrl || storeOrBootstrap.branding?.favicon?.url || "";
    if (faviconUrl) {
      faviconLink = document.head.querySelector("link[rel='icon']") || document.createElement("link");
      faviconLink.rel = "icon";
      faviconLink.href = faviconUrl;
      if (!faviconLink.parentNode) document.head.appendChild(faviconLink);
    }

    return () => {
      document.title = previousTitle;
    };
  }, [storeOrBootstrap]);
}
