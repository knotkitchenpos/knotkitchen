import React, { useId } from "react";

/**
 * KnotKitchen brand mark.
 *
 * Recreates the official logo: a navy infinity-knot loop that sweeps up and
 * to the right, turning orange as it forms the arm of a stylised "K", with the
 * K's vertical bar (orange top → navy bottom) and orange lower leg.
 *
 * Props:
 *   size         – pixel size, or xs/sm/md/lg/xl
 *   withWordmark – render the official stacked wordmark below the mark
 *   showSubtitle – backwards-compatible alias used by the Auth screen
 *   dark         – use light text for the "Knot" half on dark surfaces
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
  const uid = useId().replace(/:/g, "");
  const gRibbon = `kk-ribbon-${uid}`;
  const gBar = `kk-bar-${uid}`;
  const gLeg = `kk-leg-${uid}`;

  return (
    <span className={`inline-flex flex-col items-center ${className}`}>
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 220 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="KnotKitchen"
      >
        <defs>
          {/* Navy (left / loop) → orange (right / K arm) */}
          <linearGradient id={gRibbon} x1="30" y1="140" x2="200" y2="45" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1B2440" />
            <stop offset="38%" stopColor="#26304F" />
            <stop offset="62%" stopColor="#8A4620" />
            <stop offset="82%" stopColor="#F4600F" />
            <stop offset="100%" stopColor="#FF6A1F" />
          </linearGradient>

          {/* K vertical bar: orange at the top, navy at the bottom */}
          <linearGradient id={gBar} x1="0" y1="40" x2="0" y2="180" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF6A1F" />
            <stop offset="42%" stopColor="#F4600F" />
            <stop offset="70%" stopColor="#4A3A47" />
            <stop offset="100%" stopColor="#16203A" />
          </linearGradient>

          {/* Lower-right leg */}
          <linearGradient id={gLeg} x1="120" y1="115" x2="205" y2="180" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF6A1F" />
            <stop offset="100%" stopColor="#F4600F" />
          </linearGradient>
        </defs>

        {/* K vertical bar (sits behind the ribbon crossing) */}
        <path d="M100 42h26v138h-26z" fill={`url(#${gBar})`} />

        {/* K lower-right leg */}
        <path d="M126 118 149 96l56 84h-36z" fill={`url(#${gLeg})`} />

        {/* The knot ribbon: loops on the left, rises into the K's upper arm */}
        <path
          d="M203 40
             C168 74, 137 102, 112 120
             C88 138, 55 136, 44 116
             C33 96, 52 72, 78 78
             C104 84, 122 110, 138 136"
          stroke={`url(#${gRibbon})`}
          strokeWidth="27"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>

      {(withWordmark || showSubtitle) && (
        <span
          className="font-extrabold tracking-tight leading-none mt-1"
          style={{ fontSize: markSize * 0.42 }}
        >
          <span style={{ color: dark ? "#FFFFFF" : "#16203A" }}>Knot</span>
          <span style={{ color: "#FF6A1F" }}>Kitchen</span>
        </span>
      )}

      {showSubtitle && (
        <>
          <span
            className="font-bold tracking-[0.18em] leading-none mt-1"
            style={{ fontSize: markSize * 0.13, color: dark ? "#FF8A43" : "#5B42F3" }}
          >
            POS
          </span>
        </>
      )}
    </span>
  );
};

export default KnotLogo;
