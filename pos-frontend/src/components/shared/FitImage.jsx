import React from "react";

/**
 * A product photo that fills its frame edge to edge (object-cover), like every
 * product photo in the POS and on the website: no grey side bars and no
 * blurred copy beside a photo that is not the frame's shape.
 *
 * `className` sizes and shapes the frame (e.g. "w-full h-44 rounded-xl").
 */
const FitImage = ({ src, alt = "", className = "", loading }) => (
  <div className={`relative overflow-hidden bg-[#F1F5F9] ${className}`}>
    <img src={src} alt={alt} loading={loading} className="h-full w-full object-cover" />
  </div>
);

export default FitImage;
