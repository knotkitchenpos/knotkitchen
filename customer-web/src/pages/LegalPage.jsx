/* eslint-disable react/no-unescaped-entities -- legal prose keeps its apostrophes and quotation marks */
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { LEGAL_PAGES, legalPage } from "../lib/legalPages";
import { legalPath } from "../lib/landingRoute";
import "./legal.css";
import Terms from "./legal/Terms";
import Privacy from "./legal/Privacy";
import Refund from "./legal/Refund";
import Return from "./legal/Return";
import Shipping from "./legal/Shipping";

/**
 * The five legal pages of a restaurant website: Terms & Conditions, Privacy
 * Policy, Refund & Cancellation Policy, Return Policy, Shipping & Delivery
 * Policy.
 *
 * One body of policy text, split into five pages, with every restaurant
 * specific value read from the storefront payload's `legal` block: the
 * restaurant's name, address, FSSAI and GST numbers, phone and email come
 * from the POS; the refund windows, the grievance officer and the
 * jurisdiction are set in Manage Website > Legal. Nothing here is typed per
 * restaurant. KnotKitchen's role is confined throughout to the technology
 * provider: never the seller, the food business operator, the payment
 * collector, nor (unless separately contracted) the delivery agent.
 */

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }) : "";

const BODIES = { terms: Terms, privacy: Privacy, "refund-cancellation": Refund, return: Return, "shipping-delivery": Shipping };

export default function LegalPage({ store, bootstrap, route }) {
  const page = legalPage(route.legalKey);
  const L = store?.legal || null;
  const name = store?.store?.name || bootstrap?.name || "";

  useEffect(() => {
    if (page) document.title = `${page.title} | ${name || "Restaurant"}`;
  }, [page, name]);

  if (!page) {
    return (
      <div className="kk-legal">
        <div className="wrap">
          <Link className="back" to={route.homePath}>← Back to {name || "the restaurant"}</Link>
          <h1>Page not found</h1>
          <p className="sub">The policy you asked for does not exist.</p>
        </div>
      </div>
    );
  }
  const Body = BODIES[page.key];

  return (
    <div className="kk-legal">
      <div className="wrap">
        <Link className="back" to={route.homePath}>← Back to {name || "the restaurant"}</Link>
        <h1>{page.title}</h1>
        {L ? (
          <p className="sub">
            For: {L.restaurantName}
            {L.websiteUrl ? <> &nbsp;|&nbsp; Website: {L.websiteUrl.replace(/^https?:\/\//, "")}</> : null}
            {L.fssaiNumber ? <> &nbsp;|&nbsp; FSSAI Licence: {L.fssaiNumber}</> : null}
            &nbsp;|&nbsp; Platform built, hosted &amp; secured by <strong>KnotKitchen</strong>
            {L.updatedAt ? <> &nbsp;|&nbsp; Last updated: {fmtDate(L.updatedAt)}</> : null}
          </p>
        ) : (
          <p className="sub">Loading…</p>
        )}
        <div className="toc-title">Policies</div>
        <nav aria-label="Legal pages">
          <Link to={route.homePath}>Home</Link>
          <Link to={route.menuPath}>Menu</Link>
          {LEGAL_PAGES.map((p) => (
            <Link key={p.key} to={legalPath(route, p.key)} className={p.key === page.key ? "on" : ""}>
              {p.title}
            </Link>
          ))}
        </nav>
        {L ? <Body L={L} /> : null}
        <footer>
          © {new Date().getFullYear()} {L?.legalName || name}. Website designed, hosted &amp; secured by KnotKitchen.
        </footer>
      </div>
    </div>
  );
}
