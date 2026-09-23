import React from "react";

/**
 * A product photo that fills its frame without being cropped: the whole photo
 * sits on a blurred copy of itself, instead of being cut to the frame's shape
 * (object-cover) or sitting between grey bars (object-contain). Same look as
 * the website's product popup (customer-web ProductModal).
 *
 * `className` sizes and shapes the frame (e.g. "w-full h-44 rounded-xl").
 */
const FitImage = ({ src, alt = "", className = "", loading }) => (
  <div className={`relative overflow-hidden bg-[#F1F5F9] ${className}`}>
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading={loading}
      className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-xl"
    />
    <img src={src} alt={alt} loading={loading} className="relative h-full w-full object-contain" />
  </div>
);

export default FitImage;
