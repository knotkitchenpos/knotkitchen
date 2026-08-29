import React from "react";
import markUrl from "../../assets/images/brand/knotkitchen-mark.png";

/**
 * KnotKitchen brand mark.
 *
 * Renders the official logo mark (the navy infinity-knot sweeping into an
 * orange "K"). The artwork ships as a transparent PNG rather than inline SVG
 * so it stays pixel-identical to the brand asset.
 *
 * The mark is letterboxed into a square `markSize` box via object-contain,
 * matching the footprint of the SVG it replaced so no caller's layout shifts.
 *
 * Props:
 *   size         – pixel size, or xs/sm/md/lg/xl
 *   withWordmark – render the stacked "KnotKitchen" wordmark below the mark
 *   showSubtitle – backwards-compatible alias used by the Auth screen
 *   dark         – use light text for the "Knot" half on dark surfaces.
 *                  REQUIRED on dark backgrounds: the brand navy used otherwise
 *                  is nearly invisible against them.
 */
const KnotLogo = ({
  size = 36,
  className = "",
  withWordmark = false,
  showSubtitle = false,
  dark = false,
}) => {
  const sizeMap = { xs: 24, sm: 32, md: 42, lg: 76, xl: 126 };
  const markSize = typeof size === "number" ? size : sizeMap[size] || sizeMap.md;

  return (
    <span className={`inline-flex flex-col items-center ${className}`}>
      <img
        src={markUrl}
        alt="KnotKitchen"
        className="object-contain"
        style={{ width: markSize, height: markSize }}
      />

      {(withWordmark || showSubtitle) && (
        <span
          className="font-extrabold tracking-tight leading-none mt-1"
          style={{ fontSize: markSize * 0.42 }}
        >
          <span style={{ color: dark ? "#FFFFFF" : "#16203A" }}>Knot</span>
          <span style={{ color: "#FF6A1F" }}>Kitchen</span>
        </span>
      )}
    </span>
  );
};

export default KnotLogo;
