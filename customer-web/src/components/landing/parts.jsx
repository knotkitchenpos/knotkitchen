import React, { useEffect, useState } from "react";
import "./styles/shared.css";
import { Link } from "react-router-dom";
import { telHref } from "./content";

/**
 * Small pieces the five designs from Templates/ share. Class names are the
 * templates' own, so each design's stylesheet styles them.
 */

/** "food peddler." -- first word italic where the design has a mark span. */
export function Wordmark({ c, markClass = "", plain = false }) {
  const [first, ...rest] = c.words;
  return (
    <>
      {c.logo ? <img src={c.logo} alt="" className="kkt-logo" /> : null}
      {plain ? (
        c.name
      ) : (
        <>
          <span className={markClass}>{first}</span>
          {rest.length ? ` ${rest.join(" ")}` : ""}
        </>
      )}
      <span className="dot">.</span>
    </>
  );
}

/** The design's top navigation, with Book a Table when the store takes bookings. */
export function Nav({ className, ctaClass, menuPath, onBookTable, labels = ["Story", "Menu", "Visit"], ctaLabel = "Order" }) {
  return (
    <nav className={className} aria-label="Main navigation">
      <a href="#story">{labels[0]}</a>
      <a href="#menu">{labels[1]}</a>
      <a href="#visit">{labels[2]}</a>
      {onBookTable ? (
        <button type="button" className="kkt-book" onClick={onBookTable}>
          Book a Table
        </button>
      ) : null}
      <Link className={ctaClass} to={menuPath}>
        {ctaLabel}
      </Link>
    </nav>
  );
}

/** Mobile toggle for the Classic design, which hides its nav on phones. */
export function useMenuToggle() {
  const [open, setOpen] = useState(false);
  return { open, toggle: () => setOpen((v) => !v), close: () => setOpen(false) };
}

/** Name, address, phone and email -- the restaurant's own details. */
export function VisitDetails({ c }) {
  return (
    <>
      <p>
        {c.name}
        {c.address.map((line) => (
          <React.Fragment key={line}>
            <br />
            {line}
          </React.Fragment>
        ))}
      </p>
      {c.phone || c.email ? (
        <p>
          {c.phone ? <a href={telHref(c.phone)}>{c.phone}</a> : null}
          {c.phone && c.email ? <br /> : null}
          {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null}
        </p>
      ) : null}
    </>
  );
}

/** Multi-line operator text as <br>-separated lines. */
export function Lines({ lines }) {
  return lines.map((line, i) => (
    <React.Fragment key={i}>
      {i ? <br /> : null}
      {line}
    </React.Fragment>
  ));
}

export function PoweredBy({ className = "powered" }) {
  return (
    <p className={className}>
      Powered by{" "}
      <a href="https://knotkitchen.com" target="_blank" rel="noreferrer">
        KnotKitchen
      </a>
    </p>
  );
}

/**
 * An image that tries each source in turn. A restaurant's upload can go
 * missing (deleted, or never finished uploading); the page should show the
 * next photo rather than a broken-image icon in the hero.
 */
export function Photo({ srcs, alt = "", className }) {
  const list = (srcs || []).filter(Boolean);
  const key = list.join("|");
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [key]);
  if (!list.length) return null;
  return (
    <img
      src={list[Math.min(i, list.length - 1)]}
      alt={alt}
      className={className}
      onError={() => setI((n) => (n < list.length - 1 ? n + 1 : n))}
    />
  );
}
