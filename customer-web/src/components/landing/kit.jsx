import React from "react";
import { Link } from "react-router-dom";

/**
 * The three pieces of chrome all five landing designs genuinely share.
 *
 * Deliberately thin, and deliberately opinion-free. The five templates are
 * five different WEBSITES, not one website with five hero crops -- they order
 * their sections differently, lay out the menu differently, and draw their
 * mastheads and footers differently. An abstraction that tried to cover all of
 * that would end up as one design with switches, which is the thing being
 * replaced.
 *
 * So what lives here is only what has a single correct answer: the link that
 * reaches the ordering page, the scrim over a hero photograph, and the
 * full-width link list every design collapses to on a phone. Data helpers are
 * next door in data.js.
 */

/**
 * The link to the menu.
 *
 * Takes its class list whole rather than merging one, because every template
 * styles its own button -- a shared base would put a pill radius on the design
 * whose buttons are square.
 */
export function Cta({ to, label, className }) {
  return (
    <Link to={to} className={className}>
      {label || "View Menu"}
    </Link>
  );
}

/**
 * The photograph behind a hero, plus its darkening scrim.
 *
 * `overlayOpacity` is chosen per store because the right amount depends
 * entirely on the picture: a bright plate on a white tablecloth needs a heavy
 * scrim for white text to be readable, a dim interior shot needs almost none.
 */
export function Backdrop({ url, opacity, fallback = "bg-neutral-900" }) {
  return (
    <>
      {url ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${url})` }}
          aria-hidden="true"
        />
      ) : (
        <div className={`absolute inset-0 ${fallback}`} aria-hidden="true" />
      )}
      <div
        className="absolute inset-0 bg-black"
        style={{ opacity: (Number(opacity) || 0) / 100 }}
        aria-hidden="true"
      />
    </>
  );
}

/**
 * The mobile menu panel.
 *
 * The one piece of chrome that is the same everywhere: on a phone all five
 * designs collapse to a full-width list of links, because there is no room for
 * five opinions about it. The classes still come from the caller, so the panel
 * still looks like the site it belongs to.
 */
export function MobileLinks({ open, links, onClose, className = "", linkClass = "" }) {
  if (!open) return null;
  return (
    <div className={className}>
      {links.map((l) => (
        <a key={l.id} href={`#${l.id}`} onClick={onClose} className={linkClass}>
          {l.label}
        </a>
      ))}
    </div>
  );
}
