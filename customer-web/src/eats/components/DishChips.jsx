import React, { useState } from "react";
import { Link } from "react-router-dom";
import { thumbUrl } from "../../lib/thumbUrl";
import { FOCUS } from "../shared";

/**
 * "What's on your mind?": round dish photos in two rows that scroll sideways
 * (one row when there are few). Each opens /search?tag=…. A tag with no photo
 * (config.dishTags has none) shows its initial.
 */
export default function DishChips({ tags = [] }) {
  if (!tags.length) return null;
  return (
    <ul
      className={`-mx-4 grid auto-cols-[80px] grid-flow-col gap-x-2 gap-y-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] ${
        tags.length > 5 ? "grid-rows-2" : "grid-rows-1"
      }`}
    >
      {tags.map((t) => (
        <li key={t.tag}>
          <Link to={`/search?tag=${encodeURIComponent(t.tag)}`} className={`flex flex-col items-center gap-1.5 rounded-xl p-1 text-center ${FOCUS}`}>
            <span className="block h-[68px] w-[68px] overflow-hidden rounded-full bg-orange-50">
              <ChipImage image={t.image} label={t.label} tag={t.tag} />
            </span>
            <span className="text-[13px] font-medium leading-tight text-slate-700">{t.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Knot Eats' dish tags (services/knotEats.js DISH_TAGS) as a picture, for a tag with no photo.
const EMOJI = {
  biryani: "🍛", momo: "🥟", chicken: "🍗", paneer: "🧀", pizza: "🍕", burger: "🍔", roll: "🌯", noodles: "🍜",
  "fried-rice": "🍚", thali: "🍱", dosa: "🥞", cake: "🍰", shake: "🥤", "tea-coffee": "☕", kebab: "🍢",
  sandwich: "🥪", pasta: "🍝", "ice-cream": "🍨", fish: "🐟", mutton: "🍖", egg: "🍳",
};

/** The dish photo; else its picture, else its initial (also when the photo will not load). */
function ChipImage({ image, label, tag }) {
  const [broken, setBroken] = useState(false);
  return image && !broken ? (
    <img src={thumbUrl(image, 160)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="h-full w-full object-cover" />
  ) : (
    <span aria-hidden="true" className={`flex h-full w-full items-center justify-center font-bold text-brand ${EMOJI[tag] ? "text-[34px]" : "text-[24px]"}`}>
      {EMOJI[tag] || label?.charAt(0)}
    </span>
  );
}
