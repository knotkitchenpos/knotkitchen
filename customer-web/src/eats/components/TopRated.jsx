import React from "react";
import { Link } from "react-router-dom";
import { thumbUrl } from "../../lib/thumbUrl";
import { etaLabel, topRated } from "../../lib/eatsFormat";
import { FOCUS } from "../shared";

/**
 * "Top rated near you": topRated() of the list already loaded, in a row that
 * scrolls sideways. Hidden with fewer than two, where a row would look empty.
 */
export default function TopRated({ stores, mode }) {
  const top = topRated(stores);
  if (top.length < 2) return null;
  return (
    <section aria-labelledby="ke-top" className="mt-6">
      <h2 id="ke-top" className="mb-3 text-[18px] font-extrabold tracking-tight text-[color:var(--ke-ink)]">
        Top rated near you
      </h2>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {top.map((s) => {
          const photo = s.cover || (s.dishes || []).find((d) => d.image)?.image;
          const when = mode === "pickup" ? (s.prepTimeMinutes ? `~${s.prepTimeMinutes} mins` : "") : etaLabel(s.etaMinutes);
          return (
            <li key={s.storeId} className="w-[140px] shrink-0">
              <Link to={`/store/${s.storeId}`} className={`block rounded-2xl ${FOCUS}`}>
                <span className="relative block aspect-square overflow-hidden rounded-2xl bg-gradient-to-br from-orange-50 to-slate-200 shadow-md">
                  {photo ? (
                    <img src={thumbUrl(photo, 320)} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.visibility = "hidden")} className="h-full w-full object-cover" />
                  ) : (
                    <span aria-hidden="true" className="flex h-full w-full items-center justify-center text-[44px] font-extrabold text-slate-300">
                      {s.name?.charAt(0)}
                    </span>
                  )}
                  {s.offer ? (
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-[12px] font-extrabold uppercase leading-tight text-white">
                      <span className="block truncate">{s.offer.title}</span>
                    </span>
                  ) : null}
                </span>
                <span className="mt-2 block truncate text-[15px] font-bold text-[color:var(--ke-ink)]">{s.name}</span>
                <span className="flex items-center gap-1 text-[13px] font-semibold text-slate-600">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--ke-good)] text-white" aria-hidden="true">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18.3 5.5 22l1.7-7.4-5.7-5 7.5-.7z" />
                    </svg>
                  </span>
                  <span className="sr-only">Rated</span>
                  {Number(s.rating).toFixed(1)}
                  {when ? <span className="truncate font-medium"> · {when}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
